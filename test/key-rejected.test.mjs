// A 401/403 from the gateway is a credential failure, not an outage, and a
// 401 with `code: "workspace_deleted"` says so once per session
// (gatewaystack-connect#1693; mirrors claude-code-acp-plugin
// test/workspace-deleted-notice.test.mjs + test/429-is-a-verdict.test.mjs).
// Run with: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";

const GOVERN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "govern.mjs");

async function withGateway(status, reply, fn) {
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(reply === undefined ? "" : JSON.stringify(reply));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

function runPre(base, home, event) {
  return new Promise((resolve, reject) => {
    const child = execFile("node", [GOVERN], {
      env: { ...process.env, HOME: home, ACP_BEARER_TOKEN: "test-token", ACP_GOVERN_BASE: base, ACP_API_BASE: base },
      encoding: "utf8",
    }, (err, stdout) => (err ? reject(err) : resolve(JSON.parse(stdout))));
    child.stdin.end(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "echo hi" }, ...event }));
  });
}

const tmpHome = () => mkdtempSync(join(tmpdir(), "acp-keyrej-"));
const DELETED = { error: "workspace deleted", code: "workspace_deleted" };

test("interactive 401 proceeds with KEY REJECTED naming the key and the fix, and logs the lapse", async () => {
  const home = tmpHome();
  const res = await withGateway(401, { error: "invalid key" }, (b) => runPre(b, home, { permission_mode: "default", session_id: "s1" }));
  assert.equal(res.hookSpecificOutput.permissionDecision, "allow");
  assert.match(res.systemMessage, /^\[ACP\] ⚠ KEY REJECTED \(HTTP 401\): the key in ~\/\.acp\/credentials is revoked or invalid/);
  assert.match(res.systemMessage, /install\.sh/);
  assert.match(res.systemMessage, /settings\/api-keys/);
  assert.doesNotMatch(res.systemMessage, /unreachable/i);
  assert.match(readFileSync(join(home, ".acp", "lapse.log"), "utf8"), /key rejected \(HTTP 401\)/);
});

test("interactive 401 with no body still reads as KEY REJECTED", async () => {
  const res = await withGateway(401, undefined, (b) => runPre(b, tmpHome(), { permission_mode: "default" }));
  assert.equal(res.hookSpecificOutput.permissionDecision, "allow");
  assert.match(res.systemMessage, /KEY REJECTED \(HTTP 401\)/);
});

test("unattended 401 stays denied with the cause named", async () => {
  for (const mode of ["auto", "bypassPermissions"]) {
    const res = await withGateway(401, { error: "invalid key" }, (b) => runPre(b, tmpHome(), { permission_mode: mode }));
    assert.equal(res.hookSpecificOutput.permissionDecision, "deny");
    assert.match(res.systemMessage, /Key rejected \(HTTP 401\)/);
    assert.match(res.systemMessage, /~\/\.acp\/credentials/);
    assert.doesNotMatch(res.systemMessage, /unreachable/i);
  }
});

test("403 is treated like 401", async () => {
  const i = await withGateway(403, { error: "forbidden" }, (b) => runPre(b, tmpHome(), { permission_mode: "default" }));
  assert.equal(i.hookSpecificOutput.permissionDecision, "allow");
  assert.match(i.systemMessage, /KEY REJECTED \(HTTP 403\)/);
  const u = await withGateway(403, { error: "forbidden" }, (b) => runPre(b, tmpHome(), { permission_mode: "auto" }));
  assert.equal(u.hookSpecificOutput.permissionDecision, "deny");
  assert.match(u.systemMessage, /Key rejected \(HTTP 403\)/);
});

test("5xx keeps the outage posture", async () => {
  const i = await withGateway(503, { error: "down" }, (b) => runPre(b, tmpHome(), { permission_mode: "default" }));
  assert.equal(i.hookSpecificOutput.permissionDecision, "allow");
  assert.match(i.systemMessage, /UNGOVERNED: gateway unreachable \(HTTP 503/);
  const u = await withGateway(503, { error: "down" }, (b) => runPre(b, tmpHome(), { permission_mode: "auto" }));
  assert.equal(u.hookSpecificOutput.permissionDecision, "deny");
  assert.match(u.systemMessage, /Gateway unreachable/);
});

test("interactive workspace_deleted: one notice per session, then silent; lapse logged every call", async () => {
  const home = tmpHome();
  await withGateway(401, DELETED, async (b) => {
    const first = await runPre(b, home, { permission_mode: "default", session_id: "sess-a" });
    assert.equal(first.hookSpecificOutput.permissionDecision, "allow");
    assert.match(first.systemMessage, /workspace this machine was connected to has been deleted/);
    assert.match(first.systemMessage, /acp-uninstall/);
    assert.match(first.systemMessage, /uninstall\.sh/);
    assert.ok(existsSync(join(home, ".acp", "notices", "workspace-deleted.sess-a")));

    const second = await runPre(b, home, { permission_mode: "default", session_id: "sess-a" });
    assert.equal(second.hookSpecificOutput.permissionDecision, "allow");
    assert.equal(second.systemMessage, undefined);

    const otherSession = await runPre(b, home, { permission_mode: "default", session_id: "sess-b" });
    assert.match(otherSession.systemMessage, /has been deleted/);
  });
  const lapses = readFileSync(join(home, ".acp", "lapse.log"), "utf8").trim().split("\n");
  assert.equal(lapses.length, 3);
});

test("interactive workspace_deleted with no session id: at most once per 24h", async () => {
  const home = tmpHome();
  await withGateway(401, DELETED, async (b) => {
    const first = await runPre(b, home, { permission_mode: "default" });
    assert.match(first.systemMessage, /has been deleted/);
    const second = await runPre(b, home, { permission_mode: "default" });
    assert.equal(second.hookSpecificOutput.permissionDecision, "allow");
    assert.equal(second.systemMessage, undefined);
  });
});

test("unattended workspace_deleted denies every call with the deleted message", async () => {
  const home = tmpHome();
  await withGateway(401, DELETED, async (b) => {
    for (let i = 0; i < 2; i++) {
      const res = await runPre(b, home, { permission_mode: "auto", session_id: "sess-u" });
      assert.equal(res.hookSpecificOutput.permissionDecision, "deny");
      assert.match(res.systemMessage, /has been deleted/);
      assert.match(res.systemMessage, /acp-uninstall/);
    }
  });
});
