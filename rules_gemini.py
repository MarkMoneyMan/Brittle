"""
Rule database for Google's Gemini API Python SDK breaking changes — the
third provider, after Anthropic and OpenAI, on the theory (now checked, not
just assumed) that this is a genuinely bigger addressable set of real
codebases, not just more of the same.

Researched 2026-09-11, same manual-stand-in-for-extract_rules.py approach
rules.py and rules_openai.py were originally seeded with. Sources:

- https://github.com/googleapis/python-genai/blob/main/CHANGELOG.md — the
  current, actively-maintained SDK's changelog. Semantic-release generated,
  with an explicit "### ⚠ BREAKING CHANGES" (or a close variant — see
  sync_rules.py's parse_dated_sections_gemini docstring) marker per release,
  same structural advantage OpenAI's changelog has over Anthropic's.
- https://github.com/google-gemini/deprecated-generative-ai-python and its
  JS sibling https://github.com/google-gemini/deprecated-generative-ai-js —
  the OLD SDKs (`google-generativeai` / `@google/generative-ai`), now
  archived. This is where the one rule below actually comes from, not the
  changelog above.
- https://ai.google.dev/gemini-api/docs/migrate — Google's own migration
  guide, old-vs-new code side by side.

Why only one rule, honestly stated (same "under-report over noise"
discipline as everywhere else in this project, not laziness): read all 13
"### ⚠ BREAKING CHANGES"-marked sections in python-genai's real CHANGELOG.md
(v0.3.0 2024-12-17 through v2.9.0 2026-06-19) by hand before writing
anything. Almost all of them are either (a) over a year old — narrow method
renames/removals (generate_image -> generate_images, Part.from_video_metadata
removed, etc.) from the SDK's 0.x/early-1.x days, unlikely to still be
sitting in anyone's actively-maintained code — or (b) scoped to the
Interactions API specifically, which v2.0.0's own changelog entry says
outright: "Note: The breaking changes are only in interactions.
GenerateContent usage in unaffected." That's the newer/more-2026 material
(v2.0.0 2026-05-07, v2.9.0 2026-06-19), but it's a narrower, less-adopted
API surface than the mainline client.models.generate_content(...) path most
real Gemini code actually calls, and — unlike the rule below — nothing here
has been checked against a real external codebase yet. Rather than guess at
regex precision for a part of the SDK this project hasn't tested, those are
deliberately left for a future pass (see README) instead of shipped
speculatively.

Also deliberately NOT added: an httpx-to-httpx2 rule, the same kind of
change already tracked for both Anthropic (python-sdk-v1-httpx-to-httpx2)
and OpenAI (openai-httpx-to-httpx2). Checked: v2.18.0 (2026-08-12) added
"Support injecting httpx2 client" as a plain Feature, not a breaking change
— httpx (v1) still works today, this is additive support, not a forced
migration. Nothing to flag yet; worth revisiting if/when Google's SDK
actually deprecates httpx the way OpenAI's and (indirectly, via the
underlying library going unmaintained) Anthropic's did.

The one rule that IS here comes from a different, better signal than any
changelog entry: `google-generativeai`, the SDK basically every pre-2025
Gemini tutorial and code sample was written against, is now a fully
archived repository (confirmed: "All support for this repository ended
permanently on November 30, 2025" — both the Python and JS README say
this, word for word). That's a stronger, more unambiguous deprecation
signal than any single changelog line, and — same as rules.py's Legacy Text
Completions rule and rules_openai.py's pre-v1 module-level-calls rule — it
is exactly the kind of thing that survives in old, unmaintained code long
after the SDK it targets stopped shipping fixes.

Tested for real against litellm's own llms/deprecated_providers/palm.py
(litellm's own legacy PaLM/Gemini integration, still in the tree): a real,
genuine `import google.generativeai as palm` + `palm.configure(...)` +
`palm.generate_text(...)` hit — confirming the pattern isn't hypothetical.
Also found the pattern's real string-literal trap live in the same repo
(prompt_templates/factory.py:3268 has "google.generativeai" appearing only
inside an exception message string, never a real import) — this is exactly
why the rule keys on the Import/ImportFrom node itself (never a Call/Assign
snippet's raw text): ast_scan.py's generic_scan() structural-snippet
masking (see that file's GENERIC_RULES_MATCH_INSIDE_STRINGS) only blanks
string *contents*, and a Python import statement's module path is bare
identifier syntax, never a string literal in the first place — so the
factory.py false positive is closed by construction, not by an added
exemption. (The JS/TS port needs the opposite, deliberate fix: an ES import
specifier IS a string literal — see rules_js.js's own note on this.)

Every rule here needs "provider": "gemini" — same convention as
rules_openai.py's own file, gating this rule off `file_references_gemini`
(not yet needed for this one rule, since it's precise enough that no
file-level precondition is required; see ast_scan.py).
"""

RULES_GEMINI = [
    {
        "id": "gemini-legacy-sdk-deprecated",
        "provider": "gemini",
        # Anchored to the start of the node's own unparsed text — this
        # rule only ever fires on Import/ImportFrom nodes (see
        # ast_scan.py's GENERIC_CANDIDATE_TYPES), so `^import ` / `^from `
        # is not a stylistic nicety, it's what guarantees the match only
        # ever lands on a real import statement, never on some other
        # candidate node (a Call, an Assign) whose text coincidentally
        # contains these words.
        "pattern": r"^import google\.generativeai\b|^from google\.generativeai\b",
        "applies_if_model": None,
        "severity": "HIGH",
        "deadline": "already active (repo archived, EOL 2025-11-30)",
        "title": "google-generativeai is archived — migrate to google-genai",
        "detail": (
            "The `google-generativeai` package (import path `google.generativeai`, "
            "the `genai.configure(...)` / `genai.GenerativeModel(...)` calling "
            "style) is the pre-Gemini-2.0 SDK. Both its README and its JS "
            "sibling's say support ended permanently on 2025-11-30 — critical-"
            "bug-fixes-only before that, nothing at all after. It still works "
            "today (nothing about the API itself was pulled), but it will not "
            "get security fixes, new model support, or any other update going "
            "forward, and every current Gemini API doc/example now shows the "
            "new SDK instead."
        ),
        "fix": (
            "Replace `import google.generativeai as genai; genai.configure(api_key=...); "
            "model = genai.GenerativeModel(...)` with the unified SDK: "
            "`from google import genai; client = genai.Client(api_key=...); "
            "client.models.generate_content(model=..., contents=...)`. Full "
            "guide: https://ai.google.dev/gemini-api/docs/migrate"
        ),
    },
]
