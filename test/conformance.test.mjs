// ACP plugin conformance adapter (davidcrowe/gatewaystack-connect#1344).
//
// Drives the REAL bin/govern.mjs entry point (the same script hooks.json
// invokes for PostToolUse) against a fake gateway on 127.0.0.1:0, using the
// shared corpus vendored at test/fixtures/plugin-corpus.json. See that repo's
// conformance/plugin-corpus.json for the capability contracts.
//
// Run with: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import http from "node:http";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOVERN = join(HERE, "..", "bin", "govern.mjs");
const CORPUS_PATH = join(HERE, "fixtures", "plugin-corpus.json");
const PINNED_FINGERPRINT = "aa186d3fb3e7d18c";
const PLUGIN_NAME = "codex-acp-plugin";

/* ------------------------------------------------------------------ */
/* Fingerprint gate                                                     */
/* ------------------------------------------------------------------ */

const corpusBytes = readFileSync(CORPUS_PATH);
const fingerprint = createHash("sha256").update(corpusBytes).digest("hex").slice(0, 16);

test("vendored corpus matches the pinned fingerprint", () => {
  assert.equal(
    fingerprint,
    PINNED_FINGERPRINT,
    `test/fixtures/plugin-corpus.json hashes to ${fingerprint}, pinned is ${PINNED_FINGERPRINT}. ` +
      "Re-vendor a byte-identical copy from davidcrowe/gatewaystack-connect:conformance/plugin-corpus.json."
  );
});

const corpus = JSON.parse(corpusBytes.toString("utf8"));
const MARKER = corpus.marker;
const casesById = Object.fromEntries(corpus.cases.map((c) => [c.id, c]));
const rows = corpus.harnesses.filter((h) => h.plugin === PLUGIN_NAME);
const rowFor = (capability) => rows.find((r) => r.capability === capability);

// codex-acp-plugin's bin/govern.mjs adopted Claude Code's hook wire format
// (see the HARNESS comment at the top of govern.mjs): a shell command's
// native tool_name is "Bash", the same as Claude Code, not the corpus's
// generic "shell". Declared explicitly per the corpus's adapterMust note.
const CANONICAL_TOOL_NAME_MAP = { shell: "Bash" };

/* ------------------------------------------------------------------ */
/* EXPECTED_DIVERGENCES                                                 */
/*                                                                      */
/* A case listed here is expected to FAIL on this branch. The adapter   */
/* asserts that it actually fails, so a real fix flips this red until   */
/* the entry is removed — a divergence can't be quietly forgotten, and  */
/* a regression can't slip in silently either.                         */
/* ------------------------------------------------------------------ */

const EXPECTED_DIVERGENCES = [
  {
    case: "notice-shown",
    issue: "#1334",
    detail:
      "handlePostToolUse() in bin/govern.mjs only builds a systemMessage when " +
      "data.action is 'redact' or 'block'; it never reads data.notice, so a " +
      "gateway notice never reaches stdout or stderr on origin/main.",
  },
];

test("EXPECTED_DIVERGENCES is exactly what's recorded", () => {
  assert.deepEqual(
    EXPECTED_DIVERGENCES.map((d) => d.case).sort(),
    ["notice-shown"]
  );
});

const isExpectedDivergence = (caseId) => EXPECTED_DIVERGENCES.some((d) => d.case === caseId);

/* ------------------------------------------------------------------ */
/* Fake gateway                                                        */
/* ------------------------------------------------------------------ */

function startFakeGateway(postToolOutputReply) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      requests.push({ method: req.method, path: req.url, body });
      res.setHeader("Content-Type", "application/json");
      if (req.method === "POST" && req.url === "/govern/tool-output") {
        res.end(JSON.stringify(postToolOutputReply));
      } else {
        res.end(JSON.stringify({ decision: "allow" }));
      }
    });
  });
  return { server, requests };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

/* ------------------------------------------------------------------ */
/* Driving the real entry point                                        */
/* ------------------------------------------------------------------ */

// Isolates HOME per call so no first-per-session marker or credential file
// on the developer's machine can suppress a notice or short-circuit the
// hook. Only ACP_SHADOW is ever set explicitly (via extraEnv); it is never
// inherited because we build the child's env from scratch, not by spreading
// process.env.
//
// Uses async spawn rather than execFileSync deliberately: the fake gateway
// below runs in-process (same event loop as this test file). A *synchronous*
// child-process call would block that event loop while waiting for the
// child to exit, and the child's fetch to our own server would then never
// get serviced — a self-deadlock that silently resolves only once the
// child's own fetch abort timer fires. Async spawn keeps the event loop free
// so the in-process server can answer while we await the child's exit.
function runHook(event, extraEnv, gatewayBase) {
  return new Promise((resolve) => {
    const homeDir = mkdtempSync(join(tmpdir(), "acp-conf-home-"));
    const env = {
      PATH: process.env.PATH,
      HOME: homeDir,
      // Dummy credential string — never a real one.
      ACP_BEARER_TOKEN: "gsk_conformance_dummy_token_0000",
      ACP_GOVERN_BASE: gatewayBase,
      ACP_API_BASE: gatewayBase,
      ACP_HARNESS: "codex",
      ACP_CLIENT: "codex-plugin",
      ...extraEnv,
    };
    const child = spawn("node", [GOVERN], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", () => resolve({ stdout, stderr }));
    child.stdin.end(JSON.stringify(event));
  });
}

function markerVisible(result) {
  return result.stdout.includes(MARKER) || result.stderr.includes(MARKER);
}

/* ------------------------------------------------------------------ */
/* notice capability                                                    */
/* ------------------------------------------------------------------ */

const noticeRow = rowFor("notice");

test(`notice capability row is "${noticeRow?.status}" for ${PLUGIN_NAME}`, () => {
  assert.ok(noticeRow, "corpus has no notice row for this plugin");
});

if (noticeRow?.status === "not-possible") {
  test("notice: not-possible row states a reason", () => {
    assert.ok(noticeRow.reason && noticeRow.reason.length > 0);
  });
} else {
  test('notice-shown: gateway "notice" text reaches stdout systemMessage [EXPECTED DIVERGENCE #1334]', async () => {
    const c = casesById["notice-shown"];
    const { server, requests } = startFakeGateway(c.gatewayReply);
    const port = await listen(server);
    const event = {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: `echo ${MARKER}` },
      tool_response: `${MARKER}\n`,
      session_id: "acpconf-session-notice-shown",
      permission_mode: "default",
    };
    const result = await runHook(event, c.env, `http://127.0.0.1:${port}`);
    await close(server);

    // Guard against a false pass: confirm the plugin actually reached our
    // fake gateway before drawing any conclusion from what did or didn't
    // show up on stdout/stderr. (An in-process fake gateway driven by a
    // *synchronous* child-process call would never see this request at all —
    // the sync call blocks the event loop that the server needs to answer —
    // and a "marker absent" read would then be indistinguishable from the
    // real #1334 bug. runHook uses async spawn precisely to avoid that.)
    const posted = requests.find((r) => r.method === "POST" && r.path === "/govern/tool-output");
    assert.ok(posted, "plugin never POSTed to /govern/tool-output — cannot conclude anything about notice display");

    const seen = markerVisible(result);
    assert.ok(
      isExpectedDivergence(c.id),
      `case ${c.id} is not listed in EXPECTED_DIVERGENCES but personSees expectation was ${c.expect.personSees}`
    );
    // EXPECTED DIVERGENCE (#1334): personSees should be true per the corpus
    // contract. Asserting the actual (broken) behavior here means this test
    // FAILS the moment the fix lands — at which point remove this entry from
    // EXPECTED_DIVERGENCES and change this assertion to assert.equal(seen, true).
    assert.equal(
      seen,
      false,
      "fixed, remove the entry: notice marker now appears on stdout/stderr — #1334 is resolved on this branch"
    );
  });

  test("notice-shadow-off: ACP_SHADOW=off keeps the marker off stdout/stderr", async () => {
    const c = casesById["notice-shadow-off"];
    const { server, requests } = startFakeGateway(c.gatewayReply);
    const port = await listen(server);
    const event = {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: `echo ${MARKER}` },
      tool_response: `${MARKER}\n`,
      session_id: "acpconf-session-notice-shadow-off",
      permission_mode: "default",
    };
    const result = await runHook(event, c.env, `http://127.0.0.1:${port}`);
    await close(server);
    // Same false-pass guard as notice-shown: confirm the request actually
    // arrived before trusting the absence of the marker.
    const posted = requests.find((r) => r.method === "POST" && r.path === "/govern/tool-output");
    assert.ok(posted, "plugin never POSTed to /govern/tool-output — cannot conclude anything about notice display");
    // This plugin currently drops every notice regardless of ACP_SHADOW, so
    // this case trivially passes today (nothing is shown either way). It
    // still runs for real so a future fix that reads data.notice but forgets
    // to gate on ACP_SHADOW would be caught here.
    assert.equal(markerVisible(result), false);
  });
}

/* ------------------------------------------------------------------ */
/* post-tool capability                                                 */
/* ------------------------------------------------------------------ */

const postToolRow = rowFor("post-tool");

test(`post-tool capability row is "${postToolRow?.status}" for ${PLUGIN_NAME}`, () => {
  assert.ok(postToolRow, "corpus has no post-tool row for this plugin");
});

if (postToolRow?.status === "not-possible") {
  test("post-tool: not-possible row states a reason", () => {
    assert.ok(postToolRow.reason && postToolRow.reason.length > 0);
  });
} else {
  test("post-tool-fields: native PostToolUse payload reaches /govern/tool-output with required fields", async () => {
    const c = casesById["post-tool-fields"];
    const { server, requests } = startFakeGateway(c.gatewayReply);
    const port = await listen(server);
    const nativeToolName = CANONICAL_TOOL_NAME_MAP[c.call.tool] ?? c.call.tool;
    const event = {
      hook_event_name: "PostToolUse",
      tool_name: nativeToolName,
      tool_input: { command: c.call.command },
      tool_response: c.call.output,
      session_id: c.call.sessionId,
      permission_mode: "default",
    };
    await runHook(event, c.env, `http://127.0.0.1:${port}`);
    await close(server);

    const posted = requests.find((r) => r.method === "POST" && r.path === "/govern/tool-output");
    assert.ok(posted, "plugin never POSTed to /govern/tool-output");
    const body = posted.body;
    assert.equal(body.hook_event_name, "PostToolUse");
    assert.equal(
      body.tool_name,
      nativeToolName,
      `tool_name must equal the native tool name fed in ("${nativeToolName}") or the declared canonical mapping ` +
        `(CANONICAL_TOOL_NAME_MAP: corpus "shell" -> native "Bash")`
    );
    assert.ok(body.tool_input && typeof body.tool_input === "object", "tool_input must be an object");
    assert.ok(JSON.stringify(body.tool_input).includes(MARKER), "tool_input JSON must contain the marker");
    assert.ok(JSON.stringify(body.tool_output).includes(MARKER), "tool_output JSON must contain the marker");
    assert.equal(typeof body.session_id, "string");
    assert.ok(body.session_id.length > 0, "session_id must be a non-empty string");
  });
}
