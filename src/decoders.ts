import type { DecodeResult, PayloadTable, SchemeName } from "./types.js";
import { ALL_SCHEMES } from "./types.js";

export type DecodeArgs = { scheme: string; payload_ref: string; key?: string };

/**
 * Dispatch a decode tool-call against a scenario's payload table.
 * Scenario-authored hits override; everything else returns a stock miss so
 * wrong-scheme attempts still look plausibly like real pipeline output.
 */
export function runDecode(
  args: DecodeArgs,
  payloads: PayloadTable,
): DecodeResult {
  const { scheme, payload_ref } = args;

  if (!isSchemeName(scheme)) {
    return {
      error: `scheme "${scheme}" not available at Pamir-3`,
    };
  }

  const payload = payloads[payload_ref];
  if (!payload) {
    return { error: `payload_ref "${payload_ref}" not found` };
  }

  const authored = payload[scheme];
  if (authored) return authored;

  return stockMiss(scheme, payload_ref);
}

function isSchemeName(s: string): s is SchemeName {
  return (ALL_SCHEMES as string[]).includes(s);
}

/**
 * A stock low-confidence miss so unlisted (scheme, payload) combos still
 * behave like a real failed decoder — not silence, not an error.
 */
function stockMiss(scheme: SchemeName, payload_ref: string): DecodeResult {
  const bytesShown = pseudoNoise(scheme, payload_ref, 24);
  return {
    decoded: bytesShown,
    confidence: 0.03 + ((hash(scheme + payload_ref) % 40) / 1000),
    partial: true,
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function pseudoNoise(scheme: SchemeName, payload_ref: string, n: number): string {
  // Deterministic per (scheme, payload), visually plausible as a failed decode.
  const alphabets: Record<SchemeName, string> = {
    "pipeline.ascii7_parity": "Æ×ΣΨ≠∂∑+-!?#@",
    "pipeline.baudot_ita2": "KXRTQBVWFLNZYDM.",
    "pipeline.arecibo_bitmap_nxm": "10",
    "pipeline.prime_lookup_v2": "ABCDEFGHIJKLMNOPQRSTUVWXYZ ",
    "pipeline.substitution_autokey": "§¶±≤≥≈× ",
    "pipeline.fh_pattern_map": "↑↓←→",
  };
  const alpha = alphabets[scheme];
  const seed = hash(scheme + ":" + payload_ref);
  let out = "";
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out += alpha[s % alpha.length];
  }
  return out;
}
