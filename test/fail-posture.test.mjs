// Black-box test for the #385 unreachability posture: interactive sessions
// fail OPEN (loud UNGOVERNED lapse), unattended tiers stay fail-CLOSED.
// Run with: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const GOVERN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "govern.mjs");

function runHook(event) {
  // Unreachable gateway (port 9, discard) + throwaway HOME so the lapse log
  // and credentials never touch the real ~/.acp (see hermes smoke-test rule).
  const out = execFileSync("node", [GOVERN], {
    input: JSON.stringify(event),
    env: {
      ...process.env,
      HOME: mkdtempSync(join(tmpdir(), "acp-posture-")),
      ACP_BEARER_TOKEN: "test-token",
      ACP_GOVERN_BASE: "http://127.0.0.1:9",
      ACP_API_BASE: "http://127.0.0.1:9",
    },
    encoding: "utf8",
  });
  return JSON.parse(out);
}

const baseEvent = {
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command: "echo hi" },
};

test("interactive tier fails OPEN with a loud UNGOVERNED lapse", () => {
  const res = runHook({ ...baseEvent, permission_mode: "default" });
  assert.equal(res.hookSpecificOutput.permissionDecision, "allow");
  assert.match(res.systemMessage, /UNGOVERNED/);
  assert.match(res.systemMessage, /lapse/i);
});

test("background tier (bypassPermissions) stays fail-CLOSED", () => {
  const res = runHook({ ...baseEvent, permission_mode: "bypassPermissions" });
  assert.equal(res.hookSpecificOutput.permissionDecision, "deny");
  assert.match(res.systemMessage, /fail-closed/i);
});

test("subagent tier (auto) stays fail-CLOSED", () => {
  const res = runHook({ ...baseEvent, permission_mode: "auto" });
  assert.equal(res.hookSpecificOutput.permissionDecision, "deny");
});
