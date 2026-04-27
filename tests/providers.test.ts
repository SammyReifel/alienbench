import test from "node:test";
import assert from "node:assert/strict";
import {
  apiModelFor,
  isCerebrasModel,
  isGroqModel,
} from "../src/providers.js";
import { isOpenAIModel, tierFor } from "../src/openaiBudget.js";

test("provider predicates classify documented model ids", () => {
  assert.equal(isOpenAIModel("gpt-5.4-mini"), true);
  assert.equal(isOpenAIModel("gpt-future-model"), true);
  assert.equal(isOpenAIModel("o4-mini"), true);
  assert.equal(isGroqModel("openai/gpt-oss-120b"), true);
  assert.equal(isCerebrasModel("cerebras/qwen-3-235b-a22b-instruct-2507"), true);
});

test("apiModelFor strips local routing prefixes only", () => {
  assert.equal(apiModelFor("codex-oauth/gpt-5.2"), "gpt-5.2");
  assert.equal(apiModelFor("cerebras/gpt-oss-120b"), "gpt-oss-120b");
  assert.equal(apiModelFor("meta/llama-3.3-70b-instruct"), "meta/llama-3.3-70b-instruct");
});

test("budget tiers remain exact while OpenAI routing supports prefixes", () => {
  assert.equal(tierFor("gpt-5.4-mini"), "mini");
  assert.equal(tierFor("gpt-future-model"), null);
  assert.equal(isOpenAIModel("gpt-future-model"), true);
});
