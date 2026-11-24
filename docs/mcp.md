# MCP server

Use verifa11y as a tool from any agent that speaks the Model Context Protocol.

`verifa11y-mcp` serves verifa11y over the [Model Context Protocol](https://modelcontextprotocol.io) (revision 2026-07-28,
v2 SDK; 2025-era hosts still work), so any MCP client (Claude Desktop, Claude Code, Cursor, VS Code, and others) can
call it:

| Tool | Does |
|---|---|
| `rules` | lists the rules: tier, WCAG criteria, and what each codemod declines by design |
| `audit` | findings for an HTML file, with source lines, tier and rule guidance |
| `fix` | runs the codemods (offline by default), verifies every patch, writes a `git apply` patch under `<out>/<runId>/`; never edits the file |
| `verify` | runs the full verifier on an edit the agent proposes, without touching the file |

Every result is structured JSON that carries `conformance: "axe-clean on the checked rules, not WCAG conformance"`
and its caveats, and its text starts with that warning: agents summarize results, and "4 verified" must not become
"your page is accessible". The agent writes the judgment fixes itself and verifa11y decides whether they hold. Files are
read and written only inside `--root`. The contract for agents is [docs/agents.md](agents.md).

```sh
# Claude Code
claude mcp add verifa11y -- npx -y verifa11y-mcp --root .
```

```json
{
  "mcpServers": {
    "verifa11y": {
      "command": "npx",
      "args": ["-y", "verifa11y-mcp", "--root", "/path/to/your/project"]
    }
  }
}
```

On a cold npm cache the first start downloads the package and can exceed a client's startup timeout, so install
the browser first: it also warms the cache. Do it once with `npx verifa11y-mcp --install-browser`. (The JSON form goes in Claude Desktop's `claude_desktop_config.json`, Cursor's `.cursor/mcp.json`, and similar.)
