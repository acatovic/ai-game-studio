import test from "node:test";
import assert from "node:assert/strict";
import { validatePrompt, MAX_PROMPT_LENGTH } from "../server/validation.ts";

test("drafts and generation share a generous prompt limit with useful errors", () => {
  const prompt = "a".repeat(MAX_PROMPT_LENGTH);
  assert.equal(validatePrompt(prompt, "Character prompt"), prompt);
  assert.equal(validatePrompt(prompt, "Character prompt", true), prompt);
  assert.equal(validatePrompt("", "Movement prompt", true), "");
  assert.equal(validatePrompt("  hero  ", "Character prompt"), "hero");
  for (const allowEmpty of [true, false]) {
    assert.throws(() => validatePrompt(prompt + "a", "Movement prompt", allowEmpty), /Movement prompt.*20,000.*20,001/);
    assert.throws(() => validatePrompt(null, "Character prompt", allowEmpty), /Character prompt must be text/);
  }
  assert.throws(() => validatePrompt("   ", "Character prompt"), /required/);
});
