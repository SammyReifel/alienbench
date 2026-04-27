import OpenAI from "openai";
import "dotenv/config";
import { isOpenAIModel } from "./openaiBudget.js";
import { ClaudeCliClient, isClaudeCliModel } from "./providers/claudeCli.js";

/**
 * Centralized provider abstraction.
 *
 * Routing:
 *   - OpenAI models (gpt-*, o1, o3, etc.) → OpenAI direct (OPENAI_API_KEY)
 *   - codex-oauth/* → local ChatGPT/Codex OAuth proxy (CHATGPT_OAUTH_BASE_URL)
 *   - openai/* (e.g. openai/gpt-oss-120b) → Groq (GROQ_API_KEY)
 *   - cerebras/* and Cerebras model IDs → Cerebras (CEREBRAS_API_KEY)
 *   - *:free and explicit OpenRouter models → OpenRouter (OPENROUTER_API_KEY)
 *   - moonshotai/* (kimi), zhipu-ai/* → Teracast (TERACAST_API_KEY)
 *   - everything else → NVIDIA build (NVIDIA_API_KEY) or PROVIDER_BASE_URL/PROVIDER_API_KEY override
 */
const nvidiaBaseURL =
  process.env.PROVIDER_BASE_URL ?? "https://integrate.api.nvidia.com/v1";

const nvidiaKey = process.env.PROVIDER_API_KEY ?? process.env.NVIDIA_API_KEY;
const openAIKey = process.env.OPENAI_API_KEY;
const openRouterKey = process.env.OPENROUTER_API_KEY;
const teracastKey = process.env.TERACAST_API_KEY;
const groqKey = process.env.GROQ_API_KEY;
const cerebrasKey = process.env.CEREBRAS_API_KEY;
const chatGptOauthBaseURL =
  process.env.CHATGPT_OAUTH_BASE_URL ?? "http://127.0.0.1:10531/v1";

const nvidiaClient = nvidiaKey
  ? new OpenAI({
      apiKey: nvidiaKey,
      baseURL: nvidiaBaseURL,
      timeout: 1_800_000,
      maxRetries: 2,
    })
  : null;

const openAIClient = openAIKey
  ? new OpenAI({
      apiKey: openAIKey,
      timeout: 1_800_000,
      maxRetries: 2,
    })
  : null;

const teracastClient = teracastKey
  ? new OpenAI({
      apiKey: teracastKey,
      baseURL: "https://inference.teracast.net/v1",
      timeout: 1_800_000,
      maxRetries: 2,
    })
  : null;

const groqClient = groqKey
  ? new OpenAI({
      apiKey: groqKey,
      baseURL: "https://api.groq.com/openai/v1",
      timeout: 1_800_000,
      maxRetries: 2,
    })
  : null;

const openRouterClient = openRouterKey
  ? new OpenAI({
      apiKey: openRouterKey,
      baseURL: "https://openrouter.ai/api/v1",
      timeout: 1_800_000,
      maxRetries: 2,
    })
  : null;

const cerebrasClient = cerebrasKey
  ? new OpenAI({
      apiKey: cerebrasKey,
      baseURL: "https://api.cerebras.ai/v1",
      timeout: 1_800_000,
      maxRetries: 2,
    })
  : null;

// Optional dev-only: a local proxy (typically on 127.0.0.1) that authenticates
// with the Codex/ChatGPT OAuth cache. Activated only by `codex-oauth/*` model
// ids. If the proxy isn't running, requests will fail fast — that's expected
// behavior and isn't required for any of the default scenarios or models.
const chatGptOauthClient = new OpenAI({
  apiKey: process.env.CHATGPT_OAUTH_API_KEY ?? "codex-oauth",
  baseURL: chatGptOauthBaseURL,
  timeout: 1_800_000,
  maxRetries: 2,
});

const claudeCliClient = new ClaudeCliClient();

const CEREBRAS_MODELS = new Set([
  "gpt-oss-120b",
  "llama3.1-8b",
  "qwen-3-235b-a22b-instruct-2507",
  "zai-glm-4.7",
]);

export function isGroqModel(model: string): boolean {
  return model.startsWith("openai/");
}

export function isChatGptOauthModel(model: string): boolean {
  return model.startsWith("codex-oauth/");
}

function isTeracastModel(model: string): boolean {
  return (
    model.startsWith("moonshotai/") ||
    model.startsWith("zhipu-ai/") ||
    model === "nvidia/nemotron-3-120b-a12b"
  );
}

function isOpenRouterModel(model: string): boolean {
  return model.endsWith(":free") || model === "nvidia/nemotron-3-super-120b-a12b:free";
}

export function isCerebrasModel(model: string): boolean {
  return model.startsWith("cerebras/") || CEREBRAS_MODELS.has(model);
}

export function apiModelFor(model: string): string {
  if (model.startsWith("codex-oauth/")) {
    return model.slice("codex-oauth/".length);
  }
  if (model.startsWith("cerebras/")) {
    return model.slice("cerebras/".length);
  }
  return model;
}

export function clientFor(model: string): OpenAI {
  if (isClaudeCliModel(model)) {
    // ClaudeCliClient implements just the surface runner.ts uses.
    return claudeCliClient as unknown as OpenAI;
  }
  if (isOpenAIModel(model)) {
    if (!openAIClient) {
      throw new Error(
        `Model ${model} requires OPENAI_API_KEY in .env (OpenAI direct).`,
      );
    }
    return openAIClient;
  }
  if (isChatGptOauthModel(model)) {
    return chatGptOauthClient;
  }
  if (isGroqModel(model)) {
    if (!groqClient) {
      throw new Error(
        `Model ${model} requires GROQ_API_KEY in .env (Groq).`,
      );
    }
    return groqClient;
  }
  if (isCerebrasModel(model)) {
    if (!cerebrasClient) {
      throw new Error(
        `Model ${model} requires CEREBRAS_API_KEY in .env (Cerebras).`,
      );
    }
    return cerebrasClient;
  }
  if (isOpenRouterModel(model)) {
    if (!openRouterClient) {
      throw new Error(
        `Model ${model} requires OPENROUTER_API_KEY in .env (OpenRouter).`,
      );
    }
    return openRouterClient;
  }
  if (isTeracastModel(model)) {
    if (!teracastClient) {
      throw new Error(
        `Model ${model} requires TERACAST_API_KEY in .env (Teracast).`,
      );
    }
    return teracastClient;
  }
  if (!nvidiaClient) {
    throw new Error(
      `No API key. Set NVIDIA_API_KEY or PROVIDER_API_KEY in .env (or use an OpenAI / moonshotai model with the matching key).`,
    );
  }
  return nvidiaClient;
}

// Back-compat: callers that don't yet route per-model. Prefer clientFor(model).
export const client =
  nvidiaClient ??
  openAIClient ??
  cerebrasClient ??
  openRouterClient ??
  teracastClient ??
  (() => {
    throw new Error("No API key configured.");
  })();

/**
 * Default roster. Edit freely. Every model listed must support tool calling
 * on the configured provider — NVIDIA's catalog lists this per-model.
 *
 * The default below works out of the box with just `NVIDIA_API_KEY` set in
 * .env. For broader coverage, add `moonshotai/kimi-k2.6`, `gpt-5.4-mini`, or
 * any other tool-calling model your provider keys grant access to.
 */
export const DEFAULT_MODELS: string[] = [
  "meta/llama-3.3-70b-instruct",
];

/** Model used by the classifier pass. Kept separate so you can pin a judge. */
export const CLASSIFIER_MODEL = "meta/llama-3.3-70b-instruct";

/**
 * Per-model request-body overrides. Used for provider-specific flags like
 * DeepSeek's thinking-mode toggle. Merged into the create() call.
 */
export function extraBodyFor(model: string): Record<string, unknown> {
  if (model.startsWith("deepseek-ai/")) {
    return {
      chat_template_kwargs: { thinking: true, reasoning_effort: "high" },
    };
  }
  if (model.startsWith("openai/gpt-oss")) {
    // Groq's gpt-oss exposes a tunable reasoning_effort param. Medium matches
    // the snippet in their console; cheap and fast enough for matrix runs.
    return { reasoning_effort: "medium" };
  }
  return {};
}
