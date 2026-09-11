// TS sibling of ../../example_project/openai_bot.py, scoped to the one
// OpenAI rule this scanner currently knows about
// (openai-v2-tool-call-output-type-widened). A scan against this file has
// to find exactly the one real issue and nothing else.

import OpenAI from "openai";
import type { ResponseFunctionToolCallOutputItem } from "openai/resources/responses/responses";

const client = new OpenAI();

// Old code, written before SDK v6.0.0 widened .output from string to
// string | Array<...> — still assumes it's always a plain string.
function summarizeToolOutput(item: ResponseFunctionToolCallOutputItem): string {
  return item.output.toUpperCase(); // <- breaks once .output is an array
}

async function getResponse(prompt: string) {
  // The actually-current call shape — should NOT be flagged by anything.
  return client.responses.create({
    model: "gpt-5.6-sol",
    input: prompt,
  });
}
