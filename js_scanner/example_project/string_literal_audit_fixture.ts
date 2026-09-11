// Permanent regression fixture for the string-literal false-positive gap
// closed in ast_scan.js on 2026-09-11 (see README's "JS/TS support" and
// ast_scan.js's GENERIC_RULES_MATCH_INSIDE_STRINGS). TS sibling of
// pipeline_runs/string_literal_audit_fixture.py's idea, scoped to the 3
// RULES_JS rules confirmed to be genuinely code-shape (not string-value):
// manual-thinking-budget, beta-files-skills-sdk-shape-change, and
// openai-v2-tool-call-output-type-widened. Every trigger string below is
// planted ONLY inside an unrelated console.log call, never as real code —
// a scan of this file must find exactly 0 findings.

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
