// Real-usage fixture for 4 RULES_JS rules that had never been exercised
// against any TS fixture in this repo before 2026-09-11 (only found while
// building the string-literal masking regression tests — see
// string_literal_audit_fixture.ts alongside this file). Also serves as the
// "exempted rules still catch their real, string-based signal" half of
// that regression test: all 4 of these are in GENERIC_RULES_MATCH_INSIDE_STRINGS
// (ast_scan.js) because their real signal is a plain string value (a model
// name, a config string, a URL path) — this file proves masking didn't
// blind the scanner to them.

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

async function getSummaryRetiredModel(text: string) {
  // model-retired-opus-4-1: fully retired, this call now errors.
  return client.messages.create({
    model: "claude-opus-4-1-20250805",
    max_tokens: 10,
    messages: [{ role: "user", content: text }],
  });
}

async function getFastAnalysis(text: string) {
  // fast-mode-removed-opus-4-7: speed: "fast" no longer falls back, errors.
  return client.messages.create({
    model: "claude-opus-4-7-20260101",
    max_tokens: 10,
    speed: "fast",
    messages: [{ role: "user", content: text }],
  });
}

async function getMaxEffortNoThinking(text: string) {
  // opus5-effort-xhigh-thinking-disabled: rejected on Opus 5.
  return client.messages.create({
    model: "claude-opus-5-20260501",
    max_tokens: 10,
    thinking: { type: "disabled" },
    effort: "xhigh",
    messages: [{ role: "user", content: text }],
  });
}

async function generatePromptOldWay() {
  // experimental-endpoint-retiring: shut down 2026-08-17.
  return fetch("/v1/experimental/generate_prompt", { method: "POST" });
}

async function listMemoryOldHeader() {
  // memory-list-managed-agents-header-behavior-change: header value adopts
  // new listing behavior — never previously exercised by any TS fixture.
  return client.beta.memory.list({}, { headers: { "anthropic-beta": "managed-agents-2026-04-01" } });
}

async function useOldComputerTool() {
  // computer-use-toolset-new-shape: beta tool type superseded by GA shape —
  // never previously exercised by any TS fixture.
  return client.messages.create({
    model: "claude-opus-5-20260501",
    max_tokens: 10,
    tools: [{ type: "computer_20251124", display_width_px: 1024, display_height_px: 768 }],
    messages: [{ role: "user", content: "take a screenshot" }],
  });
}
