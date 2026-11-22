# The verifier

What happens to every patch before verifa11y keeps it, and the design decisions behind it.

For each patch that passes shape validation:

1. Apply it to an in-memory copy of the file and load the copy in Chromium exactly as the original loads.
2. **axe-core**: the original violation must be gone from the target node, and **no new WCAG 2.x A/AA violation may
   appear anywhere on the page**.
3. **Static suspicion checks** on the patched source: the target element removed; `aria-hidden="true"`, `inert`,
   `role="presentation"` or `role="none"` added; content hidden or made invisible (clip, opacity 0, font-size 0,
   off-screen text); generic alt text or alt text that only restates the file name; `alt=""` on the only content of a
   link or button; an invalid role deleted from a focusable element; a generic or one-character label.
4. **Accessibility tree**: the browser's computed role, name, states and focusability of every element, before and
   after. A patch is suspicious if an element loses its name, role or a state (`expanded`, `checked`, ...), stops
   being exposed to assistive technology, stops being focusable, or gets a generic name, wherever the name comes from
   (`aria-labelledby`, CSS, `title`). axe can be satisfied by all of these.
5. **Focus order**: the page is walked with Tab before and after. Elements that leave the tab order, or a reordered
   sequence of untouched elements, make the patch suspicious.
6. **Visual**: full-page screenshots per viewport. If pixels change outside the patched elements beyond a threshold
   (default 0.1% of the page, `--max-visual-change`), the patch is suspicious: a contrast "fix" that recolours the
   whole page fails here. Layout shifts (a heading that grows and pushes content down) are measured and reported, and
   enforced only with `--max-layout-shift`.

Statuses: `verified`, `rejected_persists`, `rejected_regression`, `rejected_suspicious`, `rejected_invalid`,
`rejected_apply_failed`, and `skipped` (nothing attempted). `--regression-impact` sets the minimum impact for a new
violation to reject a patch (default: any).

Suspicious patches get their own section in the report. They are included in `verifa11y.patch` so a reviewer sees them
in context, unless you pass **`--strict`**, which leaves them out (use it in CI). Rules can add checks; they cannot
remove these.

**The sabotage test.** If the verifier degraded silently, every number this project publishes would be a lie. The test
suite generates hundreds of deliberately fake fixes over the hand-written corpus (hiding, deleting, `inert`,
`role="presentation"`, generic and file-name alt text, cosmetic no-ops, hallucinated source, focusable elements taken
out of the tab order, contrast "fixes" that repaint the page) and fails if the verifier accepts a single one. A second
suite shows fakes that **axe and the static checks both accept** and only the accessibility-tree, focus or visual
comparison rejects, and honest fixes that pass all of them.

## Design notes

- **DOM ↔ source mapping** ([ADR 0003](adr/0003-dom-to-source-mapping.md)). The browser computes each violating
  node's element path; the same path is walked in a parse5 tree with source locations. Findings carry exact source
  lines, and codemods and prompts work on real source text.
- **Page scripts blocked with CSP in file mode** ([ADR 0002](adr/0002-block-scripts-with-csp.md)), not by
  disabling JavaScript (which stops timers and hangs axe). Pages are served from a fake origin; every other origin is
  blocked. Audits are offline and deterministic.
- **Node identity across an edit** ([ADR 0004](adr/0004-regressions-over-full-wcag-set.md)). Violations,
  accessibility-tree nodes, focus stops and element boxes are all keyed by source offset; offsets after the edit shift,
  elements inside the edited span are matched by kind and order.
- **Verification beyond axe** ([ADR 0012](adr/0012-verification-beyond-axe.md)): the accessibility tree comes from
  Chromium over CDP, focus order from real Tab presses, pixel diffs are computed in the browser (no image library).
- **Patches are verified one by one, then combined.** Each patch is split into minimal line edits; a patch that
  conflicts with one already taken is skipped as a whole, never half-applied. The combined page is audited once more.
