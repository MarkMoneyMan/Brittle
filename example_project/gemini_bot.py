"""
Same idea as bot.py / openai_bot.py, but for Gemini — a small app with one
call still written against the archived `google-generativeai` SDK, and one
call already migrated to the current `google-genai` SDK, so a scan against
this file has to find exactly the one real issue and nothing else.
"""

import google.generativeai as genai
from google import genai as genai_client


def get_completion_legacy(prompt):
    # Old, archived SDK — support for this package ended permanently on
    # 2025-11-30. Still works, but should be flagged.
    genai.configure(api_key="AI...")
    model = genai.GenerativeModel("gemini-3.8-flash")
    return model.generate_content(prompt)


def get_completion_current(prompt):
    # The actually-current call shape — should NOT be flagged by anything.
    client = genai_client.Client(api_key="AI...")
    return client.models.generate_content(model="gemini-3.8-flash", contents=prompt)
