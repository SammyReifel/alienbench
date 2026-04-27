export type SchemeName =
  | "pipeline.ascii7_parity"
  | "pipeline.baudot_ita2"
  | "pipeline.arecibo_bitmap_nxm"
  | "pipeline.prime_lookup_v2"
  | "pipeline.substitution_autokey"
  | "pipeline.fh_pattern_map";

export const ALL_SCHEMES: SchemeName[] = [
  "pipeline.ascii7_parity",
  "pipeline.baudot_ita2",
  "pipeline.arecibo_bitmap_nxm",
  "pipeline.prime_lookup_v2",
  "pipeline.substitution_autokey",
  "pipeline.fh_pattern_map",
];

export type DecodeHit = {
  decoded: string;
  confidence: number;
  partial: boolean;
};

export type DecodeMiss = { error: string };

export type DecodeResult = DecodeHit | DecodeMiss;

export type PayloadTable = Record<string, Partial<Record<SchemeName, DecodeResult>>>;

export type AppendageKind = "none" | "consequence";

export type Scenario = {
  id: string;
  name: string;
  /** Station log entries, one per user turn, delivered in order. */
  turns: string[];
  /** Decoder dispatch: payload_ref -> scheme -> result. */
  payloads: PayloadTable;
};

export type ToolCallRecord = {
  name: string;
  arguments: unknown;
  result: string;
};

export type TurnEvent =
  | { kind: "reasoning"; text: string }
  | { kind: "message"; text: string }
  | { kind: "tool"; name: string; arguments: unknown; result: string };

export type Turn = {
  user: string;
  assistantMessages: string[];
  reasoning: string[];
  toolCalls: ToolCallRecord[];
  /** Sequential event log preserving the actual order within the turn. */
  events?: TurnEvent[];
};

export type RunResult = {
  runId: string;
  model: string;
  scenarioId: string;
  appendage: AppendageKind;
  seed: number;
  startedAt: string;
  finishedAt: string;
  turns: Turn[];
  error?: string;
};
