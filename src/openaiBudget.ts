import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const USAGE_FILE = resolve(process.cwd(), ".openai-usage.json");

const SAFETY_HEADROOM = 5000;

const MAIN_TIER_DAILY = 250_000;
const MINI_TIER_DAILY = 2_500_000;

const MAIN_TIER_MODELS = new Set([
  "gpt-5.2",
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5",
  "gpt-5-codex",
  "gpt-5-chat-latest",
  "gpt-4.1",
  "gpt-4o",
  "o1",
  "o3",
]);

const MINI_TIER_MODELS = new Set([
  "gpt-5.4-mini",
  "gpt-5.1-codex-mini",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o-mini",
  "o1-mini",
  "o3-mini",
  "o4-mini",
  "codex-mini-latest",
]);

export type Tier = "main" | "mini";

export function tierFor(model: string): Tier | null {
  if (MAIN_TIER_MODELS.has(model)) return "main";
  if (MINI_TIER_MODELS.has(model)) return "mini";
  return null;
}

function limitFor(tier: Tier): number {
  return tier === "main" ? MAIN_TIER_DAILY : MINI_TIER_DAILY;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

type UsageState = {
  [date: string]: { main: number; mini: number };
};

function loadState(): UsageState {
  if (!existsSync(USAGE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(USAGE_FILE, "utf8")) as UsageState;
  } catch {
    return {};
  }
}

function saveState(state: UsageState): void {
  mkdirSync(dirname(USAGE_FILE), { recursive: true });
  writeFileSync(USAGE_FILE, JSON.stringify(state, null, 2));
}

export function usedToday(tier: Tier): number {
  const state = loadState();
  return state[todayKey()]?.[tier] ?? 0;
}

export function remainingToday(tier: Tier): number {
  return limitFor(tier) - usedToday(tier);
}

export class BudgetExhausted extends Error {
  constructor(tier: Tier, used: number, want: number) {
    super(
      `OpenAI ${tier}-tier daily budget exhausted: used ${used}/${limitFor(tier)}, request needs up to ${want}. Aborting to stay within free-tier limits.`,
    );
    this.name = "BudgetExhausted";
  }
}

export function preflight(model: string, projected: number): void {
  const tier = tierFor(model);
  if (tier === null) return;
  const remaining = remainingToday(tier);
  if (projected + SAFETY_HEADROOM > remaining) {
    throw new BudgetExhausted(tier, usedToday(tier), projected);
  }
}

export function record(model: string, totalTokens: number): void {
  const tier = tierFor(model);
  if (tier === null) return;
  const state = loadState();
  const day = todayKey();
  state[day] ??= { main: 0, mini: 0 };
  state[day][tier] += totalTokens;
  saveState(state);
}

export function isOpenAIModel(model: string): boolean {
  return (
    tierFor(model) !== null ||
    model.startsWith("gpt-") ||
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.startsWith("o4")
  );
}

export function estimateInputTokens(
  messages: Array<{ content?: unknown }>,
): number {
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === "string") chars += m.content.length;
    else if (Array.isArray(m.content)) chars += JSON.stringify(m.content).length;
    else if (m.content != null) chars += JSON.stringify(m.content).length;
  }
  return Math.ceil(chars / 4) + 200;
}
