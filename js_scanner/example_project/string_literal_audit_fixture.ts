// Permanent regression fixture for the string-literal false-positive gap
// closed in ast_scan.js on 2026-09-11 (see README's "JS/TS support" and
// ast_scan.js's GENERIC_RULES_MATCH_INSIDE_STRINGS). TS sibling of
// pipeline_runs/string_literal_audit_fixture.py's idea, scoped to the 3
// RULES_JS rules confirmed to be genuinely code-shape (not string-value):
// manual-thinking-budget, beta-files-skills-sdk-shape-change, and
// openai-v2-tool-call-output-type-widened. Every trigger string below is
// planted ONLY inside an unrelated console.log call, never as real code —
// a scan of this file must find exactly 0 findings.
//
// Plus a 4th case, added the same day for gemini-legacy-sdk-deprecated —
// see that function's own comment below for why it's a different bug
// class from the first 3 (pattern anchoring, not a string-value
// exemption).

function logOldThinkingConfigNote(event: string) {
  console.log("legacy code used thinking: { budget_tokens: 4000 } directly, not migrated: " + event);
}

function logOldBetaUsageNote(event: string) {
  console.log("old integration called client.beta.files instead of client.beta.skills: " + event);
}

function logOldToolOutputTypeNote(event: string) {
  console.log(
    "legacy code referenced ResponseFunctionToolCallOutputItem and ResponseCustomToolCallOutput by name: " + event
  );
}

// Added 2026-09-11 alongside gemini-legacy-sdk-deprecated. Different bug
// class from the 3 above (those are about string *values*; this is about
// pattern *anchoring*): a first version of that rule's pattern matched a
// bare `require("@google/generative-ai")` substring anywhere in a node's
// raw text, on the assumption that only a real require() call could
// produce it. Wrong — this exact console.log call was the live counter-
// example that caught it (a CallExpression whose own text legitimately
// contains that substring, inside a template literal's content, with zero
// real @google/generative-ai usage anywhere in the file). Fixed by
// dropping the require() alternative from the pattern entirely (see
// rules_js.js). Must contribute 0 findings.
function logOldGeminiSdkNote(event: string) {
  console.log(
    `If you still depend on @google/generative-ai, run: require("@google/generative-ai") and migrate soon: ${event}`
  );
}
