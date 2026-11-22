# Packages and the Rule API

What each npm package contains, and the experimental Rule API.

| Package | Contents |
|---|---|
| [`verifa11y-core`](../packages/core) | audit, source mapping, validation, verifier, site crawler, storage, pipeline, report, Rule API, tier-1 generators |
| [`verifa11y-rules-core`](../packages/rules-core) | the core rules and their tier-0 codemods |
| [`verifa11y`](../packages/cli) | the `verifa11y` command |
| [`verifa11y-mcp`](../packages/mcp) | the MCP server (`verifa11y-mcp`): a thin wrapper over the core |
| [`verifa11y-action`](../packages/action) | the GitHub Action's logic (`action.yml` at the root); private, not published |

A rule is a typed object: `id`, `version` (semver), `axe`, `wcag`, `level`, `tier`, `confidence`, `detect`, `fix`
(the codemod), `guidance` (for tier 1), `verify` (extra checks) and `deprecated`. See the
[rule author guide](rule-author-guide.md) and the [versioning and deprecation policy](rule-versioning.md).

**The Rule API is still experimental** ([ADR 0006](adr/0006-experimental-rule-api.md)). The verifier now covers
the accessibility tree, focus order and visual regressions, which was the main condition for opening it. What is left
before external rule packages are accepted: real contrast resolution (backgrounds up the tree, design tokens instead of
loose hex values) and a conformance suite that third-party rules must pass (phase 4).
