# The verifa11y agent contract

For AI agents and the people who configure them. verifa11y is a **fixer verified against axe-core and the
browser's accessibility tree, focus order and pixels**. It is not an accessibility audit and it does not certify
anything. This document defines what its results mean; agents must not claim more than this.

## What the results mean

| Status | Meaning |
|---|---|
| `verified` | After applying the patch to a copy: axe-core no longer reports the violation on that node; no new WCAG 2.x A/AA violation appeared anywhere on the page; no static suspicion check fired (nothing hidden, deleted or silenced); no element lost its accessible name, role, state or focusability; the Tab order of untouched elements is the same; no pixels changed outside the patched elements beyond the threshold. |
| `rejected_persists` | axe still reports the violation on the target. |
| `rejected_regression` | the patch introduced a new violation somewhere on the page. |
| `rejected_suspicious` | the patch makes axe quiet in a way that looks like hiding, silencing or damaging the page; the reason says which check fired. Listed in the report for human review. **With `strict` (the MCP default) it is not in the patch.** |
| `rejected_invalid` | the patch was malformed: wrong shape, `before` not found verbatim in the file, too large. |
| `rejected_apply_failed` | `before` matched more than one place, or the patched page could not be loaded. |
| `skipped` | nothing was attempted (see below). |

`verified` does **not** mean: WCAG conformance; that a person reviewed it; that the alternative text is *right*
about what an image means; that the page is usable with a screen reader; that anything outside the checked rules is
fine. Automated checks cover a subset of WCAG; most success criteria need a person.

**`skipped` has exactly two causes**:

1. *Needs judgment, no tier-1 generator configured*: tier-1 rules (`image-alt`, `color-contrast`,
   `aria-required-attr`) have no codemod. In MCP `mode: "codemod"` (the default) they are always skipped; propose the
   fix yourself and check it with `verify`.
2. *Declined by design*: a tier-0 codemod refuses cases it cannot prove. The `rules` tool lists, per rule, what it
   declines (`declines`). These need judgment too.

**Forbidden.** Never tell a user "the page is accessible now", "the site is WCAG compliant" or anything equivalent
based on verifa11y results. Say what was verified, what was rejected or skipped, and that a person must review it.
Every MCP result carries `conformance: "axe-clean on the checked rules, not WCAG conformance"` and a list of
`caveats`, and its text starts with a warning; repeat them, do not drop them.

## Required workflow

1. `rules`: learn what will be fixed automatically, what needs judgment and what is declined by design.
2. `audit` the file.
3. `fix` the file. It writes a patch under the output directory and **never edits the HTML file**.
4. The user applies the patch with `git apply` (the diff is visible before anything changes).
5. For findings that need judgment: propose the smallest edit, check it with `verify`, and suggest only verified
   edits.
6. A person reviews the changes before committing.
7. Report honestly: verified, rejected (with reasons), skipped (with the cause), and the conformance caveat.

## 1. The MCP server

`verifa11y-mcp` (ADR 0013) implements MCP revision 2026-07-28 with the v2 TypeScript SDK and still serves 2025-era
hosts. It never calls a model unless `mode: "auto"` is passed explicitly and the server's environment configures one.

```sh
claude mcp add verifa11y -- npx -y verifa11y-mcp --root .
```

```json
{ "mcpServers": { "verifa11y": { "command": "npx", "args": ["-y", "verifa11y-mcp", "--root", "/path/to/project"] } } }
```

| Tool | Input | Result (`structuredContent`) | Annotations |
|---|---|---|---|
| `rules` | none | every rule: `id`, `version`, `axe`, `wcag`, `tier`, `hasCodemod`, `description`, `declines`, `deprecated` | read-only, idempotent |
| `audit` | `path`; optional `level` (1 = structural rules, 2 = also contrast; default 2) | `findings` (id, rule, WCAG, impact, source `lines` and text, `tier`, `hasCodemod`, help, guidance), `truncated`, `otherWcagViolations` | read-only, idempotent |
| `fix` | `path`; optional `mode` (`codemod` default, `auto`), `strict` (default `true`), `out` (default `.verifa11y`), `limit` | `runId`, `patchPath` (`<out>/<runId>/verifa11y.patch`), `applyWith`, `counts` per status, `included`, `rejected` with reasons, `skipped` with causes, `diff` (inline up to 20 kB), `remainingFindings` | writes only under `<out>/<runId>/`, idempotent |
| `verify` | `path`, `patch` (`findingId`, `before`, `after`, optional `rationale`, `confidence`) | `verification`: `status`, `verified`, `reason`, `newViolations`, `accessibilityTree`, `focus`, `visual`, `diff` | read-only |

Every result also has `conformance`, `caveats` and `engine` (versions of verifa11y, axe-core, Playwright, Node and the
MCP SDK). The `fix-accessibility` prompt encodes the workflow above.

**Limits and safety.** Only `.html` files inside the roots (`--root`, repeatable, or `VERIFA11Y_MCP_ROOT`; default: the
working directory), after resolving symlinks; files up to 2 MB; at most 500 findings per `audit`. Writes go only to a
new directory per run, so parallel agents never overwrite each other. Pages are rendered with scripts blocked and every
network request outside the file's directory aborted. There is no site crawling and no benchmark over MCP.

**Tier 1 over MCP and cost.** `mode: "auto"` uses `VERIFA11Y_GENERATOR_CMD` or `ANTHROPIC_API_KEY` from the server's
environment (default model `claude-haiku-5-5` with low effort, override with `VERIFA11Y_MODEL`). If the agent calling
the server is itself a model, that is two bills for one task: usually it is better to keep `mode: "codemod"` and let
the calling agent write the judgment fixes and `verify` them.

## 2. The CLI as a judge

```sh
verifa11y audit page.html --out findings.json
# write patch.json: {"findingId", "rationale", "before", "after", "confidence"}
verifa11y verify page.html patch.json --findings findings.json --out verdict.json   # exit 0 = verified
verifa11y fix findings.json --verify --strict --mode codemod --out patches           # then: git apply patches/verifa11y.patch
```

## 3. verifa11y drives, the agent writes patches: `--generator-cmd`

```sh
verifa11y fix findings.json --verify --strict --generator-cmd "<command>"   # or VERIFA11Y_GENERATOR_CMD
```

For each finding that tier 0 cannot fix, verifa11y runs the command through the shell, writes the request to stdin and
reads a patch from stdout.

- Request, `--generator-input text` (default): the system instructions, the source file with line numbers, and the
  finding. Works with any CLI that takes a prompt on stdin.
- Request, `--generator-input json`: `{system, file, sourceFile, prompt, finding, schema}`.
- Answer: `{"findingId", "rationale", "before", "after", "confidence"}`. Prose and markdown fences around it are
  tolerated; invalid output is retried twice with the error appended; a command that cannot start stops the run;
  5 minutes per attempt.

The patch then goes through the same verifier. The command receives the full page source: use a model you are allowed
to send it to.

| Command | Status in this repository |
|---|---|
| `ollama run qwen3:8b --think=false` | Tested end to end, offline. |
| `claude -p` | Protocol tested; the CLI must be signed in. |
| `codex exec -`, `llm -m <model>`, others | Not tested here. Anything that reads stdin and prints the answer works. |
| a script of yours | See [`packages/core/test/fixtures/agents/alt-agent.mjs`](../packages/core/test/fixtures/agents/alt-agent.mjs). |
