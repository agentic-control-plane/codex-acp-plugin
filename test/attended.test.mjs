// #1518 attended signal: PreToolUse carries it, PostToolUse never does.
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

async function run(event, extraEnv = {}) {
  const bodies = [];
  const headersSeen = [];
  const server = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => { b += c; });
    req.on("end", () => {
      bodies.push(JSON.parse(b));
      headersSeen.push(req.headers);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ decision: "allow", action: "pass" }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const env = { PATH: process.env.PATH, HOME: mkdtempSync(join(tmpdir(), "acp-att-")), ACP_BEARER_TOKEN: "test-token", ACP_GOVERN_BASE: base, ACP_API_BASE: base, ACP_HARNESS: "codex", ...extraEnv };
  await new Promise((resolve) => {
    const child = execFile("node", [GOVERN], { env }, () => resolve());
    child.stdin.end(JSON.stringify(event));
  });
  server.close();
  return { body: bodies[0], headers: headersSeen[0] };
}

const pre = (extra = {}) => ({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" }, session_id: "s1", tool_use_id: "c1", ...extra });

for (const mode of ["default", "plan", "acceptEdits", "auto"]) {
  test(`mode ${mode} claims attended`, async () => {
    const { body } = await run(pre({ permission_mode: mode }), { ACP_CLIENT: "codex-plugin" });
    assert.deepEqual(body.attended, { claim: true, source: "permission_mode", mode });
  });
}
for (const mode of ["bypassPermissions", "dontAsk", "never"]) {
  test(`mode ${mode} is a positive not-attended`, async () => {
    const { body } = await run(pre({ permission_mode: mode }), { ACP_CLIENT: "codex-plugin" });
    assert.deepEqual(body.attended, { claim: false, source: "permission_mode", mode });
  });
}
test("no attended when permission_mode is absent or empty", async () => {
  assert.equal((await run(pre())).body.attended, undefined);
  assert.equal((await run(pre({ permission_mode: "" }))).body.attended, undefined);
});
test("agent_tier is not used as the attended signal", async () => {
  const { body } = await run(pre({ permission_mode: "default" }), { ACP_AGENT_TIER: "background" });
  assert.equal(body.attended.claim, true);
});
test("never declares native_ask", async () => {
  const { body } = await run(pre({ permission_mode: "default" }));
  assert.equal(body.capabilities, undefined);
});
test("PostToolUse carries no attended or capabilities", async () => {
  const { body } = await run({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" }, tool_response: "x", session_id: "s1", tool_use_id: "c1", permission_mode: "default" });
  assert.equal(body.attended, undefined);
  assert.equal(body.capabilities, undefined);
});
test("missing ACP_CLIENT defaults to codex-plugin, never claude-code-plugin", async () => {
  const { headers } = await run(pre({ permission_mode: "default" }));
  assert.match(headers["x-gs-client"], /^codex-plugin\//);
});
