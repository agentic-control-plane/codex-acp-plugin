// Deny text: the gateway's reason, console link included, reaches both the
// person (systemMessage) and the model (permissionDecisionReason), unchanged.
// Run with: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const GOVERN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "govern.mjs");

// Stub gateway answers every PreToolUse with `reply`. Async execFile so the
// in-process server can answer while the child waits on it.
async function run(reply, extraEnv = {}) {
  const bodies = [];
  const server = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => { b += c; });
    req.on("end", () => {
      bodies.push(JSON.parse(b));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const home = mkdtempSync(join(tmpdir(), "acp-deny-"));
  mkdirSync(join(home, ".acp"));
  writeFileSync(join(home, ".acp", "credentials"), "test-token\n");
  const env = { PATH: process.env.PATH, HOME: home, ACP_GOVERN_BASE: base, ACP_API_BASE: base, ACP_HARNESS: "codex", ACP_CLIENT: "codex-plugin", ...extraEnv };
  const stdout = await new Promise((resolve) => {
    const child = execFile("node", [GOVERN], { env }, (_err, out) => resolve(out));
    child.stdin.end(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git push --force" }, session_id: "s1", tool_use_id: "c1", permission_mode: "default" }));
  });
  server.close();
  return { stdout, out: stdout ? JSON.parse(stdout) : null, body: bodies[0] };
}

const URL = "https://cloud.agenticcontrolplane.com/a/AB12?x=1&ws=w1";
const MULTILINE = `Held for approval: force push to a protected branch.\nA person must approve it.\n\nApprove: ${URL}`;

test("policy deny carries the same text in permissionDecisionReason and systemMessage", async () => {
  const R = "force push is not allowed";
  const { out } = await run({ decision: "deny", reason: R });
  const expected = "[ACP] Denied by policy: " + R;
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(out.hookSpecificOutput.permissionDecisionReason, expected);
  assert.equal(out.systemMessage, expected);
});

test("a multi-line reason ending in a console link passes through byte for byte", async () => {
  const { stdout, out } = await run({ decision: "deny", reason: MULTILINE });
  const expected = "[ACP] Denied by policy: " + MULTILINE;
  assert.equal(out.hookSpecificOutput.permissionDecisionReason, expected);
  assert.equal(out.systemMessage, expected);
  assert.ok(out.hookSpecificOutput.permissionDecisionReason.endsWith(URL));
  assert.ok(out.systemMessage.endsWith(URL));
  assert.ok(!stdout.includes("&amp;"));
});

test("a gateway ask becomes a deny naming why, with the reason unchanged in both fields", async () => {
  const { out } = await run({ decision: "ask", reason: MULTILINE });
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  for (const text of [out.hookSpecificOutput.permissionDecisionReason, out.systemMessage]) {
    assert.ok(text.includes("Codex cannot ask from a hook"));
    assert.ok(text.endsWith("\n\n" + MULTILINE));
  }
  assert.equal(out.hookSpecificOutput.permissionDecisionReason, out.systemMessage);
});

test("a gateway ask is a deny even when ACP_HARNESS is not codex", async () => {
  const { out } = await run({ decision: "ask", reason: "needs approval" }, { ACP_HARNESS: "claude-code" });
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
});

test("the PreToolUse request never declares native_ask", async () => {
  for (const decision of ["deny", "ask", "allow"]) {
    const { body } = await run({ decision, reason: "r" });
    assert.ok(body, `no request reached the stub for ${decision}`);
    assert.ok(!JSON.stringify(body.capabilities ?? []).includes("native_ask"));
  }
});
