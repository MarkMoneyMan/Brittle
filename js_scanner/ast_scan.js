#!/usr/bin/env node
/**
 * ast_scan.js — JS/TS sibling of ast_scan.py.
 *
 * Same philosophy, ported: walk the real syntax tree (via @babel/parser,
 * with the typescript+jsx plugins so it reads .js/.jsx/.ts/.tsx alike) and
 * only match a rule's pattern against the source slice of one real AST
 * node at a time — never the whole file. That's what keeps this from
 * matching a comment or an unrelated string, the exact problem that made
 * scan.py (the original Python regex scanner) noisy on real repos.
 *
 * Deliberately built as a single generic engine from day one, unlike
 * ast_scan.py (which started fully hand-coded and only grew a generic
 * engine later, once extract_rules.py existed). There's no reason to
 * repeat that order here — the lesson from the Python side (test against
 * real repos before declaring a rule set "done", and narrow with real
 * structural preconditions when a pattern turns out too broad, not with a
 * wider or narrower regex) is applied from the start instead of relearned.
 *
 * Known, stated limitation: this is a first pass, tested against 3 real
 * repos (see README). It has not gone through anywhere near as many
 * rounds of live hardening as ast_scan.py did — treat findings here as
 * less trustworthy until it's been run against more real code.
 *
 * Usage:
 *   node ast_scan.js /path/to/project
 *   node ast_scan.js /path/to/project --json report.json
 */

const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const { RULES_JS } = require("./rules_js");

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", "coverage"]);
const EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);

function parseFile(code, filename) {
  try {
    return parser.parse(code, {
      sourceType: "unambiguous",
      allowReturnOutsideFunction: true,
      errorRecovery: true,
      plugins: ["typescript", "jsx", "classProperties", "decorators-legacy", "topLevelAwait"],
    });
  } catch (e) {
    return null; // not valid JS/TS (or a syntax this parser config can't handle) — skip quietly
  }
}

function getCallChainName(calleeNode) {
  const parts = [];
  let cur = calleeNode;
  while (cur && cur.type === "MemberExpression") {
    if (cur.property.type === "Identifier") parts.push(cur.property.name);
    else if (cur.property.type === "StringLiteral") parts.push(cur.property.value);
    cur = cur.object;
  }
  if (cur && cur.type === "Identifier") parts.push(cur.name);
  return parts.reverse().join(".");
}

function literalStr(node) {
  if (!node) return null;
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0 && node.quasis.length === 1) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

function findObjectArg(callNode) {
  // First ObjectExpression argument, e.g. client.messages.create({ ... })
  return (callNode.arguments || []).find((a) => a.type === "ObjectExpression") || null;
}

function getProp(objExpr, name) {
  if (!objExpr) return null;
  const prop = objExpr.properties.find(
    (p) => p.type === "ObjectProperty" && !p.computed &&
      ((p.key.type === "Identifier" && p.key.name === name) ||
       (p.key.type === "StringLiteral" && p.key.value === name))
  );
  return prop ? prop.value : null;
}

function nodeModelLiteral(callNode) {
  if (!callNode || callNode.type !== "CallExpression") return null;
  const obj = findObjectArg(callNode);
  const modelVal = getProp(obj, "model");
  return literalStr(modelVal);
}

// Rules pulled out of the generic engine because a plain node-scoped regex
// proved too broad even at single-node granularity. Each gets one small,
// bespoke structural check instead — same escalation path ast_scan.py took
// (start generic, promote a rule to hand-coded only once real testing
// shows the pattern alone can't tell true from false positives).
const GENERIC_RULE_EXCLUDE_IDS = new Set(["assistant-prefill-removed"]);

function hasFunctionBodyArgument(callNode) {
  // A JS/TS-specific version of the "a candidate node's span can be way
  // bigger than it looks" problem — bug found live against vercel/ai's own
  // test suite: `describe('AnthropicLanguageModel', () => { ...the ENTIRE
  // rest of the test file... })` is itself one CallExpression, so its
  // source slice is the whole block, and a pattern matching anything
  // anywhere inside it (a real `claude-opus-4-7` mention 40 lines down,
  // wholly unrelated to this particular test) counts as a "match" on that
  // outer call. describe/it/test/run-with-a-callback is idiomatic in JS
  // test frameworks in a way it isn't in Python (pytest uses function
  // decorators, not callback-wrapped closures), which is probably why this
  // didn't show up building ast_scan.py. Fix: a call whose argument is a
  // function with a real block body isn't treated as a match candidate at
  // all — traverse() still walks into its body independently, so a real
  // Anthropic call nested inside still gets checked on its own, much
  // smaller, node.
  return (callNode.arguments || []).some(
    (a) =>
      (a.type === "FunctionExpression" || a.type === "ArrowFunctionExpression") &&
      a.body &&
      a.body.type === "BlockStatement"
  );
}

function checkAssistantPrefill(callNode, filePath, rule) {
  // Bug found live against vercel/ai: matching `role: "assistant"` +
  // `content:` anywhere in a Call/Assign/Import's source slice hit 1,619
  // times — any code that represents an assistant chat message at all
  // (rendering history, type defs, test fixtures) matches that shape, not
  // just an outgoing request whose *last* message primes the model's
  // reply. Ported the precise version of this check from
  // extract_messages_prefill() in ast_scan.py: only the literal last
  // element of the `messages` array on an actual messages.create() call
  // counts.
  const obj = findObjectArg(callNode);
  const messagesVal = getProp(obj, "messages");
  if (!messagesVal || messagesVal.type !== "ArrayExpression" || messagesVal.elements.length === 0) {
    return null;
  }
  const last = messagesVal.elements[messagesVal.elements.length - 1];
  if (!last || last.type !== "ObjectExpression") return null;
  const roleVal = getProp(last, "role");
  if (literalStr(roleVal) !== "assistant") return null;

  return findingObj(filePath, last.loc ? last.loc.start.line : callNode.loc.start.line, "(last message has role: \"assistant\")", rule);
}

// Candidate node types for the generic engine — deliberately narrow, same
// reasoning as GENERIC_CANDIDATE_TYPES in ast_scan.py: real executable
// code only, nothing that could be a comment (Babel never emits comment
// nodes into the walked tree the way it emits real statements) or a
// standalone unrelated string.
const GENERIC_CANDIDATE_TYPES = new Set([
  "CallExpression",
  "ImportDeclaration",
  "VariableDeclarator",
]);

// NOT a straight port of ast_scan.py's GENERIC_RULES_MATCH_INSIDE_STRINGS
// (2026-09-11) — turned out to need real, empirical re-derivation for this
// scanner, not just copying the Python set, and that mattered: the first
// version of this set only had the 2 rules below (Python's non-hand-coded
// equivalents), and running it against a real-usage fixture immediately
// broke model-deprecated-sonnet4-opus4 (a true positive on bot.ts:33
// silently disappeared). Root cause is architectural, not a porting typo:
// on the Python side, every model-name/config-value rule
// (sdk-v1-sampling-params-removed and friends) is hand-coded in
// scan_source() using find_calls()/get_kwargs() — real AST field access to
// the actual keyword argument value, never regex-on-text at all, so
// whether that value happens to be a string literal is irrelevant to it.
// rules_js.js has no equivalent hand-coded path for any of its
// model-name/config rules — every one of them goes through this same
// generic regex-on-snippet loop, which means several rules whose true
// signal legitimately lives inside a plain string value (a model name
// literal, a "fast"/"xhigh"/"disabled" config string, a URL path string)
// need to be exempted here that have no Python-side counterpart to copy
// from. Confirmed each one empirically (a synthetic real-usage snippet per
// rule, not just reasoned about) before adding it:
const GENERIC_RULES_MATCH_INSIDE_STRINGS = new Set([
  "model-retired-opus-4-1", // model name is always a string literal
  "model-deprecated-sonnet4-opus4", // same — the regression that caught this whole issue
  "fast-mode-removed-opus-4-7", // model name string + `speed: "fast"` string
  "opus5-effort-xhigh-thinking-disabled", // `type: "disabled"` / `effort: "xhigh"` are string values
  "experimental-endpoint-retiring", // the retired path is a URL string literal
  "memory-list-managed-agents-header-behavior-change", // header value is a string literal
  "computer-use-toolset-new-shape", // tool "type" value is a string literal
]);
// Confirmed the OTHER 4 rules are genuinely code-shape, not string-value,
// so masking is safe (and correctly closes their false-positive risk)
// for: manual-thinking-budget (matches the `budget_tokens` property name,
// never quoted), beta-files-skills-sdk-shape-change (`client.beta.files`
// attribute access), assistant-prefill-removed (excluded from this loop
// entirely, see GENERIC_RULE_EXCLUDE_IDS above), and
// openai-v2-tool-call-output-type-widened (a type name in an import
// specifier/type annotation — an identifier, not a string — which is
// exactly the rule this whole masking fix was built to protect).

// Deliberately NOT using @babel/traverse for this inner walk (even though
// it's already a dependency) — traverse() builds a scope map as it goes,
// and that's exactly what already crashed once on valid-but-unusual TS in
// a real repo (see the crash documented in checkAssistantPrefill's sibling
// bug list / README's "JS/TS support", bug #1). A plain recursive walk
// over own-enumerable-properties needs no scope tracking at all, so it
// can't hit that failure mode — safer for a helper that runs on every
// single candidate node, not just once per file.
function collectStringLiteralSpans(node, spans) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectStringLiteralSpans(item, spans);
    return;
  }
  if (typeof node.type !== "string") return;
  if (node.type === "StringLiteral") {
    if (typeof node.start === "number" && typeof node.end === "number") {
      spans.push([node.start, node.end, '""']);
    }
    return; // a string literal has no children worth recursing into
  }
  if (node.type === "TemplateLiteral") {
    // Blanks the WHOLE template, quasis and any embedded ${...}
    // expressions alike — same trade-off ast_scan.py's _mask_string_literals
    // makes for f-strings/JoinedStr, stated there just as plainly: a
    // template literal's real, live expression (`` `...${someRealCall()}...` ``)
    // gets blanked away along with the rest of it, not preserved. Accepted
    // for the same reason: "the real signal is a call embedded inside a
    // template literal" is a much rarer shape than the false positive this
    // closes.
    if (typeof node.start === "number" && typeof node.end === "number") {
      spans.push([node.start, node.end, "``"]);
    }
    return;
  }
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end" || key === "type" || key === "range") continue;
    collectStringLiteralSpans(node[key], spans);
  }
}

// Returns `rawSnippet` with every string-literal / template-literal
// sub-span blanked out, so pattern-matching it reflects only the real code
// shape (calls, property access, identifiers, keyword names) — never the
// *contents* of a string a rule's pattern might coincidentally match
// inside. `nodeStart` is the candidate node's own `.start` offset, needed
// to convert each found span's file-absolute offsets into offsets relative
// to `rawSnippet` (which begins at `nodeStart`). On any inconsistency
// (a span that doesn't fit cleanly inside rawSnippet — shouldn't happen,
// but this runs on every candidate node in every file, so fail safe rather
// than throw) that one span is skipped rather than corrupting the whole
// snippet.
function buildStructuralSnippet(node, rawSnippet, nodeStart) {
  const spans = [];
  collectStringLiteralSpans(node, spans);
  if (spans.length === 0) return rawSnippet;
  spans.sort((a, b) => a[0] - b[0]);
  let result = rawSnippet;
  // Splice from the end backwards so earlier offsets in `spans` stay valid
  // as later (higher-offset) replacements change the string's length.
  for (let i = spans.length - 1; i >= 0; i--) {
    const [start, end, replacement] = spans[i];
    const relStart = start - nodeStart;
    const relEnd = end - nodeStart;
    if (relStart < 0 || relEnd > result.length || relStart >= relEnd) continue;
    result = result.slice(0, relStart) + replacement + result.slice(relEnd);
  }
  return result;
}

function findingObj(file, line, code, rule, titleOverride) {
  return {
    file,
    line,
    code: code.length > 200 ? code.slice(0, 200) + "…" : code,
    rule_id: rule.id,
    severity: rule.severity,
    deadline: rule.deadline,
    title: titleOverride || rule.title,
    detail: rule.detail,
    fix: rule.fix,
  };
}

function dedupeFindings(findings) {
  // Same overlap-between-candidate-node-types bug found in ast_scan.py's
  // generic_scan (a CallExpression is a child of the VariableDeclarator
  // that assigns its result, so matching text inside the call also matches
  // when the declarator's own source slice is checked) — fixed there by
  // deduping on (file, line, rule_id), same fix applied here from the
  // start instead of waiting to rediscover it independently.
  //
  // Second refinement, also found live (translating this same fix from
  // ast_scan.py surfaced it immediately here too): prefer the more
  // informative duplicate. A model-scoped rule can only see the model on
  // the CallExpression node itself, never on the wrapping
  // VariableDeclarator — keeping "whichever copy was seen first" would
  // silently downgrade a confirmed match to an "unconfirmed, flagged for
  // manual check" one whenever the outer node happened to be visited
  // first.
  const best = new Map();
  const order = [];
  for (const f of findings) {
    const key = f.file + "::" + f.line + "::" + f.rule_id;
    if (!best.has(key)) {
      order.push(key);
      best.set(key, f);
    } else if (best.get(key).title.indexOf("unconfirmed") !== -1 && f.title.indexOf("unconfirmed") === -1) {
      best.set(key, f);
    }
  }
  return order.map(function (key) { return best.get(key); });
}

function scanSource(filePath, code) {
  const ast = parseFile(code, filePath);
  if (!ast) return [];

  const findings = [];

  // Bug found live against a real repo (vercel/ai): @babel/traverse builds
  // a scope map before walking, and throws (not a caught SyntaxError, an
  // uncaught TypeError) on some valid-but-unusual TS — a file exporting a
  // type and a value of the same name from two different modules crashed
  // it with "Duplicate declaration". That's a Babel scope-crawling quirk,
  // not a real problem with the file. Uncaught, it killed the entire batch
  // scan, silently discarding every finding already collected from every
  // other file. One bad file must not be able to do that — same principle
  // as ast.parse's SyntaxError being caught per-file in ast_scan.py, just
  // a different failure mode to guard here since it surfaces at traverse
  // time instead of parse time.
  try {
    traverse(ast, {
      enter(nodePath) {
        const node = nodePath.node;
        if (!GENERIC_CANDIDATE_TYPES.has(node.type)) return;
        if (typeof node.start !== "number" || typeof node.end !== "number") return;
        if (node.type === "CallExpression" && hasFunctionBodyArgument(node)) return;
        // Blunter version of the same span problem, still real: a call
        // like `expect(requestBody).toMatchObject({ ...huge nested mock
        // object... })` isn't a callback, so hasFunctionBodyArgument()
        // doesn't catch it, but its snippet can still run for hundreds of
        // lines and pick up an unrelated model string or config key buried
        // deep inside a large test fixture. A structural fix per test-
        // assertion library isn't worth it for a first pass — capping
        // snippet length is a blunt but honest safety valve, same
        // trade-off as leaving `assistant-prefill-removed` unable to
        // confirm "last message" in the whole-file era: better to
        // under-report on a huge call than risk noise on a small one.
        if (node.end - node.start > 2000) return;

        const snippet = code.slice(node.start, node.end);
        // Used for regex matching in place of `snippet` for every rule
        // except the ones in GENERIC_RULES_MATCH_INSIDE_STRINGS — see that
        // set's comment above. `snippet` itself is untouched and still used
        // for display (findingObj below) and for isMessagesCall/model
        // detection just below, same as before this existed.
        const structuralSnippet = buildStructuralSnippet(node, snippet, node.start);
        // A model literal is only meaningful when this exact node is a
        // messages.create()/completions.create() call — not inherited from
        // anywhere else in the file (the mistake v1's Python scanner made).
        let model = null;
        let isMessagesCall = false;
        if (node.type === "CallExpression") {
          const chain = getCallChainName(node.callee);
          isMessagesCall = chain.endsWith("messages.create") || chain.endsWith("completions.create");
          if (isMessagesCall) {
            model = nodeModelLiteral(node);
          }
        }

        if (isMessagesCall) {
          const prefillRule = RULES_JS.find((r) => r.id === "assistant-prefill-removed");
          const finding = checkAssistantPrefill(node, filePath, prefillRule);
          if (finding) findings.push(finding);
        }

        for (const rule of RULES_JS) {
          if (GENERIC_RULE_EXCLUDE_IDS.has(rule.id)) continue;
          const matchText = GENERIC_RULES_MATCH_INSIDE_STRINGS.has(rule.id) ? snippet : structuralSnippet;
          if (!rule.pattern.test(matchText)) continue;

          let title = rule.title;
          if (rule.appliesIfModel) {
            if (model) {
              if (!rule.appliesIfModel.some((a) => model.includes(a))) continue;
            } else {
              title += " (model-scoped rule, but no literal model on this exact call — unconfirmed, flagged for manual check)";
            }
          }

          const line = node.loc ? node.loc.start.line : 0;
          findings.push(findingObj(filePath, line, snippet.split("\n")[0], rule, title));
        }
      },
    });
  } catch (e) {
    process.stderr.write(`Warning: skipped ${filePath} (traverse error: ${e.message})\n`);
    return [];
  }

  return dedupeFindings(findings);
}

function walkDir(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (EXTENSIONS.has(path.extname(entry.name))) {
        out.push(full);
      }
    }
  }
  return out;
}

function scanDir(root) {
  const files = walkDir(root);
  let all = [];
  for (const file of files) {
    let code;
    try {
      code = fs.readFileSync(file, "utf8");
    } catch (e) {
      continue;
    }
    all = all.concat(scanSource(file, code));
  }
  return all;
}

const SEVERITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };

function printReport(findings) {
  if (findings.length === 0) {
    console.log("No known Claude API breaking changes detected in live call sites.");
    return;
  }
  findings.sort((a, b) => {
    const sa = SEVERITY_ORDER[a.severity] ?? 9;
    const sb = SEVERITY_ORDER[b.severity] ?? 9;
    if (sa !== sb) return sa - sb;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.line - b.line;
  });
  console.log(`Found ${findings.length} affected call site(s):\n`);
  for (const f of findings) {
    console.log(`[${f.severity}] ${f.file}:${f.line}  (${f.deadline})`);
    console.log(`  ${f.title}`);
    console.log(`  > ${f.code}`);
    console.log(`  Fix: ${f.fix}`);
    console.log();
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: node ast_scan.js /path/to/project [--json report.json]");
    process.exit(2);
  }
  const target = args[0];
  const jsonIdx = args.indexOf("--json");
  const jsonOut = jsonIdx !== -1 ? args[jsonIdx + 1] : null;

  const findings = scanDir(target);
  printReport(findings);
  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify(findings, null, 2));
    console.log(`Wrote ${findings.length} finding(s) to ${jsonOut}`);
  }
  process.exit(findings.length ? 1 : 0);
}

main();
