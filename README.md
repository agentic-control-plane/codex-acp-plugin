# codex-acp-plugin

Identity, governance, and audit for [Codex CLI](https://developers.openai.com/codex) tool calls, via the [Agentic Control Plane](https://agenticcontrolplane.com).

- **Audit** — every shell command Codex runs is logged with identity + session attribution.
- **Control** — server-side policy denies or requires human approval on individual commands before they execute, including a hardline floor for catastrophic patterns (`rm -rf /`, `mkfs`, fork bombs) that no configuration can allow.
- **Understand** — the bundled ACP MCP server gives Codex your workspace's own cost and audit data (`acp_cost`, `acp_audit`, `acp_optimize`, …), so agents can report on — and optimize — their own economics.

Companion to the [Claude Code plugin](https://github.com/agentic-control-plane/claude-code-acp-plugin) and the [Hermes plugin](https://github.com/agentic-control-plane/hermes-acp-plugin). Same backend, same dashboard, same policies across all three harnesses.

## Install

```
/plugins marketplace add agentic-control-plane/codex-acp-plugin
/plugins install agentic-control-plane
```

Then connect (2 minutes):

```
$acp-connect
```

…or manually: get a token at [cloud.agenticcontrolplane.com/plugin/authorize](https://cloud.agenticcontrolplane.com/plugin/authorize) and write it to `~/.acp/credentials` (`chmod 600`).

**Trust the hooks.** Codex deliberately skips plugin-bundled hooks until you review them — when prompted, review and trust the two `govern.mjs` hook entries. Until you do, nothing is governed.

## How it works

| Component | Behavior |
|---|---|
| `PreToolUse` hook | POSTs the command to `/govern/tool-use` before execution. `deny` blocks it with the policy reason. An `ask` policy blocks with an approval deep link — approve on the dashboard (or from the notification email), re-run, and the standing grant admits it. |
| `PostToolUse` hook | POSTs the result to `/govern/tool-output` for audit, redaction logging, and DLP scanning. |
| MCP server (`acp`) | Streamable HTTP at `api.agenticcontrolplane.com/mcp`. Sign-in uses MCP OAuth — Codex opens the browser, you approve, and calls are attributed to your user. 9 governance tools — 8 read-only introspection tools plus `acp_propose_rule`, which drafts a policy rule for a human to confirm in the console (it never applies policy itself). |
| Skills | `acp` (how governance works), `acp-connect` (setup), `cost-xray` (read your own spend). |

### Codex-specific behavior (honest notes)

- **Coverage**: Codex fires `PreToolUse` for shell commands only — file edits, web fetches, and MCP calls don't hit hooks yet. Shell is where the blast radius lives, but this is narrower than the Claude Code plugin's full-surface coverage. ([Codex hooks docs](https://developers.openai.com/codex/hooks))
- **Approvals**: Codex's hook parser acts on `deny` only — there is no inline `ask` prompt like Claude Code's. ACP maps `ask` to a deny that carries the approval link; after a human approves, the identical re-run passes under the grant.
- **No token injection**: Codex rejects `updatedInput`, so ACP's scoped vendor-token injection (GitHub etc.) is disabled under Codex; your local credentials are used as before.
- **Fail-safe, never-brick** (#385): gateway unreachable / gateway error → interactive sessions proceed with a loud `⚠ UNGOVERNED` warning and a lapse record in `~/.acp/lapse.log` (a human is present to read it); unattended tiers (subagent/background) stay blocked with a clear message. Configure `ACP_API_BASE`/`ACP_GOVERN_BASE` for self-hosted.

## Enterprise

Codex's `requirements.toml` — from a system file, a macOS MDM profile, or the ChatGPT Enterprise workspace's managed configuration — can carry this hook to every seat as a managed `PreToolUse`/`PostToolUse` hook that users can't remove (`allow_managed_hooks_only`), plus an `[mcp_servers.acp]` allowlist entry by URL. Codex enforces the hook config but doesn't ship the script, so your MDM copies `govern.mjs` and a two-line wrapper into the `managed_dir` the config names. Set `ACP_REQUIRE_ENROLLMENT=1` in that wrapper and an unenrolled seat blocks each shell command with the enrollment step instead of running it ungoverned; each person enrolls once by signing in at the ACP console and writing their own key to `~/.acp/credentials`, so every call stays attributed to a person.

The complete file and the MDM drop: https://agenticcontrolplane.com/docs/enterprise/codex

## License

MIT
