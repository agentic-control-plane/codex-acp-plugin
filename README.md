# codex-acp-plugin

Checks every shell command [Codex CLI](https://developers.openai.com/codex) runs against your [Agentic Control Plane](https://agenticcontrolplane.com) rules before it executes, and logs it with who ran it and from which session.

- **Log.** Each command is recorded with identity and session.
- **Control.** Server-side policy can deny a command or hold it for your approval. A hardline floor refuses catastrophic commands (`rm -rf /`, `mkfs`, fork bombs) and no configuration can allow them.
- **Read your own numbers.** The bundled ACP MCP server gives Codex your workspace's cost and audit data (`acp_cost`, `acp_audit`, `acp_optimize` and others), so an agent can report on its own spend.

Companion to the [Claude Code plugin](https://github.com/agentic-control-plane/claude-code-acp-plugin) and the [Hermes plugin](https://github.com/agentic-control-plane/hermes-acp-plugin). Same backend, dashboard and rule keys, across every harness ACP supports ([coverage matrix](https://agenticcontrolplane.com/coverage)).

If you just want Codex set up, `curl -sf https://agenticcontrolplane.com/install.sh | bash` does the hook, the MCP entry and the cost wrapper in one go. The steps below are the manual plugin route.

## Install

```
/plugins marketplace add agentic-control-plane/codex-acp-plugin
/plugins install agentic-control-plane
```

Then connect (about 2 minutes):

```
$acp-connect
```

Or by hand: get a token at [cloud.agenticcontrolplane.com/plugin/authorize](https://cloud.agenticcontrolplane.com/plugin/authorize) and write it to `~/.acp/credentials` (`chmod 600`).

**Trust the hooks.** Codex skips plugin-bundled hooks until you review them. When prompted, review and trust the two `govern.mjs` entries. Until you do, nothing is checked.

## How it works

| Component | Behavior |
|---|---|
| `PreToolUse` hook | POSTs the command to `/govern/tool-use` before it runs. `deny` blocks it with the policy reason. An `ask` blocks with an approval link: approve on the dashboard (or from the notification email), re-run, and the grant admits it. |
| `PostToolUse` hook | POSTs the result to `/govern/tool-output` for audit, redaction logging and DLP scanning. |
| MCP server (`acp`) | Streamable HTTP at `api.agenticcontrolplane.com/mcp`. Sign-in is MCP OAuth: Codex opens the browser, you approve, and calls are attributed to you. Nine tools: eight read-only, plus `acp_propose_rule`, which drafts a rule for you to confirm in the console. It never applies policy itself. |
| Skills | `acp` (how it works), `acp-connect` (setup), `cost-xray` (read your own spend). |

## What Codex limits

- **Coverage.** On current Codex builds the hook fires for shell commands, `apply_patch` edits, MCP calls and other local tools. Older builds fire it for shell only. Hosted tools such as web search never reach a hook; the MCP connector's `acp_check` is the route for those. See the [Codex hooks docs](https://developers.openai.com/codex/hooks) and the [coverage matrix](https://agenticcontrolplane.com/coverage).
- **Approvals.** Codex's hook parser acts on `deny` only. There's no inline `ask` prompt like Claude Code's. ACP turns an `ask` into a deny that carries the approval link. After you approve, the identical re-run passes.
- **No token injection.** Codex rejects `updatedInput`, so ACP's scoped vendor-token injection (GitHub and others) is off under Codex. Your local credentials work as before.
- **If the gateway is unreachable.** Interactive sessions proceed with a loud `UNGOVERNED` warning, and a record goes to `~/.acp/lapse.log`. Sessions in `bypassPermissions` or `auto` mode count as unattended and stay blocked, with a message saying why. For a self-hosted gateway, set `ACP_API_BASE` and `ACP_GOVERN_BASE`.

## Enterprise

Codex's `requirements.toml` can carry this hook to every seat as a managed `PreToolUse`/`PostToolUse` hook that users can't remove (`allow_managed_hooks_only`), plus an `[mcp_servers.acp]` allowlist entry by URL. The source can be a system file, a macOS MDM profile, or the ChatGPT Enterprise workspace's managed configuration. Codex enforces the hook config but doesn't ship the script, so your MDM copies `govern.mjs` and a two-line wrapper into the `managed_dir` the config names. Each person enrolls once by signing in at the ACP console and writing their own key to `~/.acp/credentials`, so every call is attributed to a person.

The enrollment-blocking option and the full file are in the guide: https://agenticcontrolplane.com/docs/enterprise/codex

## License

MIT
