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

// Every character that must never reach the terminal or the model from a reason.
// Built from code points so the source stays plain ASCII.
const ch = (n) => String.fromCharCode(n);
const FORBIDDEN = new RegExp("[" + [
  [0x00, 0x08], [0x0b, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x2029],
  [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x2069], [0xfeff, 0xfeff],
].map(([a, b]) => ch(a) + "-" + ch(b)).join("") + "]");
const RLO = ch(0x202e), PDF = ch(0x202c), ZWSP = ch(0x200b), LSEP = ch(0x2028), BOM = ch(0xfeff);

test("terminal escapes, control and bidi characters in a reason are dropped from both fields", async () => {
  const dirty =
    "\x1b[2J\x1b[31mforce push\x1b[0m blocked\r\n" +
    "\x1b]8;;https://evil.example/\x07click here\x1b]8;;\x07\x1b]0;title\x1b\\" +
    RLO + "esrever" + PDF + ZWSP + LSEP + BOM + "\x00\x07\x9b5m\x7f\n" +
    `Approve: ${URL}`;
  const clean = "force push blocked\nclick hereesrever\n" + `Approve: ${URL}`;
  for (const decision of ["deny", "ask"]) {
    const { out } = await run({ decision, reason: dirty });
    assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
    for (const text of [out.hookSpecificOutput.permissionDecisionReason, out.systemMessage]) {
      assert.ok(!FORBIDDEN.test(text), `${decision}: forbidden character left in ${JSON.stringify(text)}`);
      assert.ok(!text.includes("evil.example"), `${decision}: hidden hyperlink target leaked`);
      assert.ok(text.endsWith(clean), `${decision}: ${JSON.stringify(text)}`);
    }
  }
});

test("a reason that is not a non-empty string falls back and still denies", async () => {
  for (const reason of [{ x: 1 }, 42, ["a"], "\x1b[0m" + ZWSP + " \x07"]) {
    const { out } = await run({ decision: "deny", reason });
    assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
    assert.equal(out.hookSpecificOutput.permissionDecisionReason, "[ACP] Denied by policy: policy did not return a reason");
    assert.equal(out.systemMessage, out.hookSpecificOutput.permissionDecisionReason);
  }
  const { out } = await run({ decision: "ask", reason: { x: 1 } });
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  assert.ok(out.systemMessage.endsWith("\n\napproval required"));
});

test("a runaway reason is shortened in the middle and keeps the console link", async () => {
  const long = "x".repeat(50000) + `\nApprove: ${URL}`;
  const { out } = await run({ decision: "deny", reason: long });
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  const text = out.hookSpecificOutput.permissionDecisionReason;
  assert.equal(text, out.systemMessage);
  assert.ok(text.length < 4100, `length ${text.length}`);
  assert.ok(text.includes("[... reason shortened ...]"));
  assert.ok(text.endsWith(`Approve: ${URL}`));
});

const LONE = /\p{Surrogate}/u;
const FFFD = ch(0xfffd);
const EMOJI = ch(0xd83d) + ch(0xde00); // a valid surrogate pair

test("an unpaired surrogate in a reason becomes U+FFFD, so the output is well-formed", async () => {
  for (const decision of ["deny", "ask"]) {
    const { stdout, out } = await run({ decision, reason: "bad " + ch(0xd83d) + " tail " + ch(0xdc00) + " " + EMOJI });
    assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
    assert.ok(!/\\ud[89a-f][0-9a-f]{2}/i.test(stdout), `${decision}: lone surrogate escape in ${stdout}`);
    for (const text of [out.hookSpecificOutput.permissionDecisionReason, out.systemMessage]) {
      assert.ok(!LONE.test(text));
      assert.ok(text.endsWith("bad " + FFFD + " tail " + FFFD + " " + EMOJI), `${decision}: ${JSON.stringify(text)}`);
    }
  }
});

test("shortening a runaway reason never splits a surrogate pair", async () => {
  for (const pad of ["", "x"]) {
    const { stdout, out } = await run({ decision: "deny", reason: pad + EMOJI.repeat(30000) + `\nApprove: ${URL}` });
    const text = out.hookSpecificOutput.permissionDecisionReason;
    assert.ok(text.includes("[... reason shortened ...]"));
    assert.ok(!LONE.test(text));
    assert.ok(!/\\ud[89a-f][0-9a-f]{2}/i.test(stdout));
    assert.ok(text.endsWith(`Approve: ${URL}`));
  }
});

test("hostile escapes do not eat the console link", async () => {
  const cases = [
    ["blocked \x1b]0;title\nApprove: " + URL, "blocked \nApprove: " + URL],
    ["Approve: \x1b" + URL, "Approve: " + URL],
    ["Approve: \x1b[31\n" + URL, "Approve: [31\n" + URL],
    ["x\x1b]8;;\x1bApprove: " + URL, "xApprove: " + URL],
  ];
  for (const [reason, expected] of cases) {
    const { out } = await run({ decision: "deny", reason });
    assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
    assert.equal(out.hookSpecificOutput.permissionDecisionReason, "[ACP] Denied by policy: " + expected, JSON.stringify(reason));
    assert.equal(out.systemMessage, out.hookSpecificOutput.permissionDecisionReason);
  }
});

test("the PreToolUse request never declares native_ask", async () => {
  for (const decision of ["deny", "ask", "allow"]) {
    const { body } = await run({ decision, reason: "r" });
    assert.ok(body, `no request reached the stub for ${decision}`);
    assert.ok(!JSON.stringify(body.capabilities ?? []).includes("native_ask"));
  }
});
