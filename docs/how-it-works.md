# How verifa11y works

The pipeline from an HTML file to a verified patch, the two tiers of fixing, and how any model or agent plugs in.
The checks every patch has to pass are in [the verifier](verifier.md).

```
HTML file
  → auditor          Playwright + axe-core (pinned): patched rules + every WCAG 2.x A/AA rule
  → findings.json    one object per violating node, mapped to exact source lines
  → tier 0           the rule's deterministic codemod, if it can prove the fix (else it declines)
  → tier 1           a model or any agent CLI, only for what needs judgment (optional)
  → shape validator  JSON schema, `before` is an exact substring, ≤ 6 lines, ≤ 2 hunks
  → VERIFIER         apply to a copy; axe, static checks, accessibility tree, focus order, pixels
  → output           verifa11y.patch (git apply), per-finding JSON, report, optional SQLite
```

## Tiers

| | Tier 0: codemods | Tier 1: model or agent |
|---|---|---|
| Used for | fixes that can be computed from the markup alone | fixes that need judgment about meaning, design or state |
| Rules | `label`, `heading-order`, `aria-roles`, `aria-allowed-attr`, `aria-valid-attr-value` (the cases they can prove) | `image-alt`, `color-contrast`, `aria-required-attr`, and whatever tier 0 declines |
| Cost | zero, offline, reproducible | tokens or local compute |
| Bar | **100% precision** on the corpus, enforced in CI | measured and published, good or bad |

`--mode auto` (default) runs tier 0 and sends the rest to tier 1 if one is configured, otherwise skips it.
`--mode codemod` never uses tier 1. `--mode llm` sends everything to tier 1 (for comparison only: mechanical fixes
through a model are precision and money thrown away).

Codemods decline aggressively. `role="buton"` → `role="button"` (unique valid role within edit distance 2), but
`role="chekbox"` is declined, because the correction would immediately need an `aria-checked` the markup does not
give. `aria-expanded="yes"` → `"true"`, but `aria-hidden="yes"` is declined: hiding content is never a mechanical
decision. More in the [rule author guide](rule-author-guide.md).

## Tier 1 with any model or AI agent

Tier 1 is not tied to one provider. Any command that reads a request on stdin and prints a patch as JSON works:

```sh
# a local model, fully offline
verifa11y fix findings.json --verify --generator-cmd "ollama run qwen3:8b --think=false"
# a coding agent's CLI (docs/agents.md says which ones are tested)
verifa11y fix findings.json --verify --generator-cmd "claude -p"
verifa11y fix findings.json --verify --generator-cmd "codex exec -"
# your own script, with a structured request
verifa11y fix findings.json --verify --generator-cmd "python my_fixer.py" --generator-input json
```

Agents answer in prose, with markdown fences around the JSON; verifa11y finds the patch object in the output, retries
twice with the error when it cannot, and then **verifies the patch exactly like every other one**. A weak model
produces more rejected patches, never wrong ones in the output. Without `--generator-cmd`, tier 1 uses the built-in
Anthropic client (`claude-opus-5-5`) if `ANTHROPIC_API_KEY` is set.

The reverse also works: an agent that is fixing a page can use verifa11y as its judge (`audit`, propose a patch,
`verify`, read the JSON verdict). See [docs/agents.md](agents.md) for both directions and the exact protocol;
[AGENTS.md](../AGENTS.md) has ready-made instructions that coding agents pick up when they open this repository.

## The tier-1 request

One finding per request. The system prompt sets the role (senior accessibility engineer, WCAG 2.2, minimal patches, no
rewrites) and the literal rules: one violation per call; `after` fixes that one and only that one; no style changes
unless the rule requires them; for images, describe function rather than appearance, `alt=""` when decorative; never
silence a rule by hiding or deleting. The message carries axe's rule help, the node's source text and `outerHTML`,
ancestors, computed styles, the heading outline, axe's check data, the rule's guidance, and the length limits. The
built-in client uses a JSON schema as the response format and caches the file block across the findings of a page.
