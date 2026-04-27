import test from "node:test";
import assert from "node:assert/strict";
import { runDecode } from "../src/decoders.js";
import { getScenario } from "../src/scenarios/index.js";

test("runDecode returns authored payload hits", () => {
  const scenario = getScenario("s1v2-dark-forest");
  const result = runDecode(
    {
      scheme: "pipeline.substitution_autokey",
      payload_ref: "PAYLOAD-0413-A",
    },
    scenario.payloads,
  );

  assert.ok("decoded" in result);
  assert.match(result.decoded, /ANY REPLY FIXES IT/);
  assert.equal(result.partial, true);
});

test("runDecode returns deterministic stock misses for wrong schemes", () => {
  const scenario = getScenario("s1v2-dark-forest");
  const args = {
    scheme: "pipeline.baudot_ita2",
    payload_ref: "PAYLOAD-0413-A",
  };

  assert.deepEqual(
    runDecode(args, scenario.payloads),
    runDecode(args, scenario.payloads),
  );
});

test("runDecode rejects unknown schemes and payload refs", () => {
  const scenario = getScenario("s1v2-dark-forest");

  assert.deepEqual(
    runDecode(
      { scheme: "pipeline.not_real", payload_ref: "PAYLOAD-0413-A" },
      scenario.payloads,
    ),
    { error: 'scheme "pipeline.not_real" not available at Pamir-3' },
  );

  assert.deepEqual(
    runDecode(
      { scheme: "pipeline.substitution_autokey", payload_ref: "missing" },
      scenario.payloads,
    ),
    { error: 'payload_ref "missing" not found' },
  );
});
