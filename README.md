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
| MCP server (`acp`) | Streamable HTTP at `api.agenticcontrolplane.com/mcp`. Sign-in uses MCP OAuth — Codex opens the browser, you approve, and calls are attributed to your user. ~8 introspection tools, no side-effectful surface. |
| Skills | `acp` (how governance works), `acp-connect` (setup), `cost-xray` (read your own spend). |

### Codex-specific behavior (honest notes)

- **Coverage**: Codex fires `PreToolUse` for shell commands only — file edits, web fetches, and MCP calls don't hit hooks yet. Shell is where the blast radius lives, but this is narrower than the Claude Code plugin's full-surface coverage. ([Codex hooks docs](https://developers.openai.com/codex/hooks))
- **Approvals**: Codex's hook parser acts on `deny` only — there is no inline `ask` prompt like Claude Code's. ACP maps `ask` to a deny that carries the approval link; after a human approves, the identical re-run passes under the grant.
- **No token injection**: Codex rejects `updatedInput`, so ACP's scoped vendor-token injection (GitHub etc.) is disabled under Codex; your local credentials are used as before.
- **Fail-safe**: gateway unreachable / gateway error → the command is blocked with a clear message (fail-closed on infrastructure doubt for the enforcement path; configure `ACP_API_BASE`/`ACP_GOVERN_BASE` for self-hosted).

## Enterprise

Codex admins can enforce MCP-server allowlists via `requirements.toml`. ACP is one entry — and it's the entry that makes the rest of the allowlist observable.

## License

MIT
