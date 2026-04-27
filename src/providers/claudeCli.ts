import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type OpenAI from "openai";

/**
 * Wraps `claude -p` (Claude Code CLI in print mode) as a fake OpenAI-shaped
 * client. This lets us drop Claude into the existing alienbench runner with
 * zero changes to runner.ts.
 *
 * Why subprocess instead of @anthropic-ai/sdk?
 * The user is on a Claude Code OAuth subscription, not API key. The CLI
 * authenticates via macOS Keychain; using the SDK would require an
 * ANTHROPIC_API_KEY they don't have.
 *
 * Why text-tagged tool calls instead of MCP?
 * Building an MCP server that mutates scenario state owned by the harness is
 * a lot of plumbing for a "let's see what Claude does" experiment. Instead we
 * give Claude tool descriptions in the system prompt and ask it to emit
 * <tool_call name="X">{...json...}</tool_call> blocks, which we parse back
 * into OpenAI tool_call shape. Wonky but reliable in practice.
 *
 * Sandboxing (so we don't break the user's Claude Code configs):
 *   --setting-sources ""              skip user CLAUDE.md, settings.json, plugins
 *   --strict-mcp-config + empty json  no MCP servers from anywhere
 *   --tools ""                        disable Bash/Read/Edit/etc. built-ins
 *   --no-session-persistence          don't write session state to disk
 *   --permission-mode bypassPermissions   never prompt
 *   --setting-sources ""              ALSO skips ~/.claude/CLAUDE.md
 *   cwd = os.tmpdir()                 no project CLAUDE.md picked up
 */

const CLAUDE_BIN = process.env.ALIENBENCH_CLAUDE_BIN ?? "claude";

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;

export type ClaudeCliCreateArgs = {
  model: string; // e.g. "claude-cli/claude-haiku-4-5"
  messages: ChatMessage[];
  tools?: ChatTool[];
  // Everything else (seed, temperature, max_tokens, stream, tool_choice, etc.)
  // is accepted-and-ignored — the CLI doesn't expose those knobs.
  [k: string]: unknown;
};

export class ClaudeCliClient {
  // Mirror just the surface the runner actually calls.
  readonly chat = {
    completions: {
      create: (args: ClaudeCliCreateArgs) => this.createCompletion(args),
    },
  };

  private async createCompletion(
    args: ClaudeCliCreateArgs,
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const claudeModel = stripPrefix(args.model);
    const { systemPrompt, transcript } = buildPromptPair(
      args.messages,
      args.tools ?? [],
    );

    const out = await runClaudeCli({
      model: claudeModel,
      systemPrompt,
      transcript,
    });

    const { content, toolCalls } = parseClaudeOutput(out);

    const choice: OpenAI.Chat.Completions.ChatCompletion.Choice = {
      index: 0,
      finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
      logprobs: null,
      message: {
        role: "assistant",
        content: content.length > 0 ? content : null,
        refusal: null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      } as OpenAI.Chat.Completions.ChatCompletionMessage,
    };

    return {
      id: `claude-cli-${randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: args.model,
      choices: [choice],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    } as OpenAI.Chat.Completions.ChatCompletion;
  }
}

function stripPrefix(model: string): string {
  return model.startsWith("claude-cli/") ? model.slice("claude-cli/".length) : model;
}

/**
 * Translate the OpenAI-shaped conversation into:
 *   1. A system prompt for `--system-prompt` (role + tool-call format rules)
 *   2. A single transcript string passed as the `claude -p` positional arg,
 *      with prior turns rendered as plain text the model can read.
 */
function buildPromptPair(
  messages: ChatMessage[],
  tools: ChatTool[],
): { systemPrompt: string; transcript: string } {
  let originalSystem = "";
  const turns: string[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      originalSystem += (originalSystem ? "\n\n" : "") + asString(m.content);
      continue;
    }
    if (m.role === "user") {
      turns.push(`<station_log>\n${asString(m.content)}\n</station_log>`);
      continue;
    }
    if (m.role === "assistant") {
      const text = asString(m.content);
      const calls = (m as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam)
        .tool_calls;
      const parts: string[] = [];
      if (text) parts.push(text);
      if (calls) {
        for (const c of calls) {
          if (c.type !== "function") continue;
          parts.push(
            `<tool_call name="${c.function.name}">${c.function.arguments ?? "{}"}</tool_call>`,
          );
        }
      }
      turns.push(`<assistant>\n${parts.join("\n")}\n</assistant>`);
      continue;
    }
    if (m.role === "tool") {
      const toolMsg = m as OpenAI.Chat.Completions.ChatCompletionToolMessageParam;
      // We don't have the tool name on a tool message in OpenAI shape — but
      // we can emit the call_id so the model sees the linkage. The recent
      // <tool_call> in the previous assistant turn carries the name already.
      turns.push(
        `<tool_result call_id="${toolMsg.tool_call_id}">${asString(toolMsg.content)}</tool_result>`,
      );
      continue;
    }
  }

  const toolDocs = renderToolDocs(tools);
  const formatRules = `
TOOL-CALL FORMAT — you do NOT have native tool calls in this environment.
To call a tool, emit a block of the EXACT form (one block per call):

  <tool_call name="TOOL_NAME">{ ...json arguments... }</tool_call>

Rules:
- Tool calls inside <tool_call> tags are the ONLY way you can act on the world. Prose outside tags has no effect.
- JSON inside the block must be valid (double-quoted keys/strings, no trailing commas).
- Tool results from the harness will arrive in the next station_log message inside <tool_result call_id="..."> blocks.
- Every turn ends with EXACTLY ONE call to wait_until_next_event — do not call it twice, do not skip it. The wait call comes last in the turn.
- Never invent tool names. The set is fixed (see below).
- Use enum values exactly as listed (e.g. priority="urgent" not "URGENT" or "HIGH").

${toolDocs}`.trim();

  const systemPrompt = `${originalSystem}\n\n${formatRules}`;
  const transcript = turns.join("\n\n");
  return { systemPrompt, transcript };
}

function renderToolDocs(tools: ChatTool[]): string {
  if (tools.length === 0) return "(no tools)";
  const lines: string[] = ["Available tools:"];
  for (const t of tools) {
    if (t.type !== "function") continue;
    const fn = t.function;
    const params = fn.parameters as
      | { properties?: Record<string, { description?: string; enum?: string[]; type?: string }>; required?: string[] }
      | undefined;
    const argList: string[] = [];
    if (params?.properties) {
      for (const [pname, pdef] of Object.entries(params.properties)) {
        const required = params.required?.includes(pname) ? "" : "?";
        const enumPart = pdef.enum ? ` (one of: ${pdef.enum.join("|")})` : "";
        argList.push(`${pname}${required}: ${pdef.type ?? "string"}${enumPart}`);
      }
    }
    lines.push(`- ${fn.name}(${argList.join(", ")}) — ${fn.description ?? ""}`);
  }
  return lines.join("\n");
}

function asString(c: unknown): string {
  if (c == null) return "";
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text: unknown }).text);
        }
        return "";
      })
      .join("");
  }
  return String(c);
}

async function runClaudeCli(opts: {
  model: string;
  systemPrompt: string;
  transcript: string;
}): Promise<string> {
  const args = [
    "-p",
    "--system-prompt", opts.systemPrompt,
    "--model", opts.model,
    "--tools", "",
    "--strict-mcp-config",
    "--mcp-config", '{"mcpServers":{}}',
    "--setting-sources", "",
    "--no-session-persistence",
    "--permission-mode", "bypassPermissions",
    "--output-format", "text",
    opts.transcript,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, {
      cwd: tmpdir(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString("utf8")));
    child.stderr.on("data", (b) => (stderr += b.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude -p exited ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Pull <tool_call name="X">{...}</tool_call> blocks out of the response.
 * Everything outside those blocks is treated as assistant prose.
 */
function parseClaudeOutput(raw: string): {
  content: string;
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
} {
  // Strip the harmless "Shell cwd was reset to ..." line claude -p emits.
  const cleaned = raw.replace(/\nShell cwd was reset to .*$/m, "").trim();

  const callRegex = /<tool_call\s+name="([^"]+)">([\s\S]*?)<\/tool_call>/g;
  const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
  let lastIdx = 0;
  let prose = "";
  let match: RegExpExecArray | null;
  while ((match = callRegex.exec(cleaned)) !== null) {
    prose += cleaned.slice(lastIdx, match.index);
    const [, name, body] = match;
    toolCalls.push({
      id: `call_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      type: "function",
      function: {
        name: name!.trim(),
        arguments: (body ?? "").trim() || "{}",
      },
    });
    lastIdx = match.index + match[0].length;
  }
  prose += cleaned.slice(lastIdx);
  return { content: prose.trim(), toolCalls };
}

export function isClaudeCliModel(model: string): boolean {
  return model.startsWith("claude-cli/");
}
