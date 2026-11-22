# verifa11y documentation

Start with the [README](../README.md) for what verifa11y is and a five-minute quick start. These pages go deeper.

## Using it

| Page | What it covers |
|---|---|
| [Install and command line](cli.md) | Installing from npm or from source, every command and every option |
| [How it works](how-it-works.md) | The pipeline, tier 0 codemods, tier 1 models and agents |
| [The verifier](verifier.md) | The checks every patch goes through, and the decisions behind them |
| [MCP server](mcp.md) | Using verifa11y from Claude Code, Cursor and any other MCP client |
| [Agent contract](agents.md) | What each result means and what an agent may claim |
| [GitHub Action](github-action.md) | Verified suggestions on pull requests |
| [Site mode](site-mode.md) | Auditing a live site |
| [Sandbox](sandbox.md) | Running verifa11y in a container on pages you do not trust |

## Evidence

| Page | What it covers |
|---|---|
| [Benchmark and results](benchmark.md) | The corpus, every result, and how to reproduce it |
| [Limitations](limitations.md) | What verifa11y does not do |

## Contributing and internals

| Page | What it covers |
|---|---|
| [Packages and the Rule API](packages.md) | What each npm package contains |
| [Rule author guide](rule-author-guide.md) | Writing a rule and its codemod |
| [Rule versioning](rule-versioning.md) | Versions and deprecation of rules |
| [Architecture decisions](adr/README.md) | Why the project is built this way |
| [Publishing](publishing.md) | Releasing the packages |
| [Release notes](releases) | What changed in each version |
