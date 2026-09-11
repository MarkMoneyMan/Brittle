// TS sibling of ../../example_project/gemini_bot.py, scoped to the one
// Gemini rule this scanner currently knows about
// (gemini-legacy-sdk-deprecated). A scan against this file has to find
// exactly the one real issue and nothing else.

import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleGenAI } from "@google/genai";

// Old, archived SDK — support for this package ended permanently on
// 2025-11-30. Still works, but should be flagged.
const legacyClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

async function getCompletionLegacy(prompt: string) {
  const model = legacyClient.getGenerativeModel({ model: "gemini-3.8-flash" });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

// The actually-current call shape — should NOT be flagged by anything.
const currentClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function getCompletionCurrent(prompt: string) {
  const response = await currentClient.models.generateContent({
    model: "gemini-3.8-flash",
    contents: prompt,
  });
  return response.text;
}
