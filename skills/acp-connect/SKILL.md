---
name: acp-connect
description: Connect Codex to ACP — identity & governance for shell commands, plus the self-optimization data plane
user-invocable: true
---

Help the user connect to the Agentic Control Plane.

1. Check if `~/.acp/credentials` exists (already configured?)
2. If not: open `https://cloud.agenticcontrolplane.com/plugin/authorize` in the browser
3. Wait for the user to paste their token
4. Store the token in `~/.acp/credentials` with `chmod 600`
5. Verify by hitting `GET https://api.agenticcontrolplane.com/govern/health`
6. Remind them to trust the plugin's hooks (Codex skips plugin hooks until reviewed): they will be prompted, or can review under Codex's hooks settings
7. Direct them to `https://cloud.agenticcontrolplane.com/logs` to see their audit trail

Keep it conversational and seamless. The user should go from zero to seeing their first logged tool call in under 2 minutes.

After setup, let them know: "Every shell command I run is now logged to your ACP workspace, and your policies decide what needs approval. The ACP MCP tools (acp_cost, acp_audit, acp_optimize, …) also give me your workspace's cost and quality data, so you can ask things like 'what did my agents spend this week?'"
