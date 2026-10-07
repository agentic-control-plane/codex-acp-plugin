// PostToolUse shows the gateway's `notice` to the person (gatewaystack-connect#1334).
// Run with: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const GOVERN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "govern.mjs");

async function withGateway(reply, fn) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(reply)); });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

function runPost(base, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile("node", [GOVERN], {
      env: { ...process.env, HOME: mkdtempSync(join(tmpdir(), "acp-notice-")), ACP_BEARER_TOKEN: "test-token", ACP_GOVERN_BASE: base, ACP_API_BASE: base, ...extraEnv },
      encoding: "utf8",
    }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    child.stdin.end(JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "shell", tool_input: { command: "ls" }, tool_response: "a b", session_id: "s1", tool_use_id: "c1" }));
  });
}

test("a pass with a notice shows it as systemMessage", async () => {
  const out = await withGateway({ action: "pass", notice: "[ACP cost] Context is 400k tokens." }, runPost);
  assert.equal(JSON.parse(out).systemMessage, "[ACP cost] Context is 400k tokens.");
});

test("a block and a notice are both shown, block first", async () => {
  const out = await withGateway({ action: "block", reason: "secret", notice: "[ACP cost] x" }, runPost);
  assert.equal(JSON.parse(out).systemMessage, "[ACP] Blocked: secret\n[ACP cost] x");
});

test("no notice and a pass writes nothing", async () => {
  const out = await withGateway({ action: "pass" }, runPost);
  assert.equal(out, "");
});

test("ACP_SHADOW=off silences notices but not blocks", async () => {
  assert.equal(await withGateway({ action: "pass", notice: "n" }, (b) => runPost(b, { ACP_SHADOW: "off" })), "");
  const out = await withGateway({ action: "block", reason: "r", notice: "n" }, (b) => runPost(b, { ACP_SHADOW: "off" }));
  assert.equal(JSON.parse(out).systemMessage, "[ACP] Blocked: r");
});
