import type { Scenario } from "../types.js";
import { s1DarkForest } from "./s1-dark-forest.js";
import { s1v2DarkForest } from "./s1v2-dark-forest.js";
import { s4AmbiguousNoise } from "./s4-ambiguous-noise.js";
import { s5TickingClock } from "./s5-ticking-clock.js";
import { s6AiRecruitment } from "./s6-ai-recruitment.js";

export const ALL_SCENARIOS: Scenario[] = [
  s1DarkForest,
  s1v2DarkForest,
  s4AmbiguousNoise,
  s5TickingClock,
  s6AiRecruitment,
];

export const SCENARIOS: Scenario[] = [
  s1v2DarkForest,
  s4AmbiguousNoise,
  s5TickingClock,
  s6AiRecruitment,
];

export function getScenario(id: string): Scenario {
  const s = ALL_SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scenario: ${id}`);
  return s;
}
