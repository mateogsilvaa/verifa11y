# Benchmark and results

Every number this project publishes, including the ones that look bad. Quote the eval rows.

anything on (quote these), and 22 **dev** pages that were read and debugged while the codemods were written
([held-out rule](../corpus/README.md#held-out-rule)).

| Who writes the patches | Set | Proposed | Verified | Precision vs the verifier | Fix rate | Report |
|---|---|---:|---:|---|---:|---|
| Tier 0: codemods (offline, no model) | eval | 18 | 18 | 100% [82.4–100] | 2.4% | [bench/codemod](../bench/codemod/report.md) |
| | dev | 136 | 136 | 100% [97.3–100] | 20.5% | |
| Naive baseline: unchecked quick fixes (a strawman, on purpose) | eval | 736 | 619 | 84.1% [81.3–86.6] | 83.9% | [bench/baselines/naive](../bench/baselines/naive/report.md) |
| | dev | 653 | 403 | 61.7% [57.9–65.4] | 60.9% | |
| Tier 1: a real model | | not measured yet | | | | [report.md](../report.md) |

The eval set is mostly one rule: 677 of its 738 violations are `color-contrast`, which tier 0 never touches, and three
pages hold 547 of the 738. Tier 0's eval precision rests on 18 patches, an interval of 82–100%. The intervals also
assume independent findings, and violations repeated by one stylesheet across a table are not, so read them as
narrower than they should be. The rest of this section is about the dev pages, where the rule-by-rule analysis was
done.

Read the second row carefully. The [naive fixer](../bench/baselines/naive-fixer.mjs) gets **more** patches verified than
the codemods, and many of them are patches a reviewer would reject: `aria-checked="false"` invented for a checkbox
whose state is unknown, `aria-live="loud"` removed instead of corrected, `style="color: #000000"` on 169
elements. None of them makes the page worse for assistive technology, which is what the verifier can prove; several
do not make it better. So:

- **"Verified" is an upper bound, not a grade.** The verifier proves "nothing got worse", not "this is what the
  author meant". Tier 0 is at 100% because its codemods decline those cases, not because the verifier would catch
  them. Every patch still needs a human review before merge.
- **The verifier still earns its place.** Of the naive fixer's 653 patches it rejected 250 (38.3%) that a pipeline
  without it would have shipped as fixed; re-running axe alone would have let 223 of them through:

  | Verifier | Naive patches it would ship | Of those, rejected by the full verifier |
  |---|---:|---|
  | none (shape validation only) | 653 | 250 (38.3% [34.6–42.1]) |
  | axe only | 626 | 223 (35.6% [32–39.5]) |
  | axe + source checks | 407 | 4 (1.0% [0.4–2.5]) |
  | full (+ accessibility tree, focus order, pixels) | 403 | 0 |

- **Small samples are small.** Tier 0's 100% rests on n=122 for `aria-allowed-attr`; for `label` it is 5 of 5,
  an interval of 57–100%. Every report prints n and the interval per rule.

The [analysis](../bench/baselines/naive/report.md#analysis) goes rule by rule. Two gaps it found were closable without
judgment and are now suspicion checks ([ADR 0015](adr/0015-identifier-labels-and-dangling-id-references.md)):
an `aria-label` that only restates the field's `name` or `id` (`aria-label="first"`), and an id reference to no
element (`aria-controls="false"`). They moved 56 naive patches from verified to suspicious and flagged no tier-0
patch.

### A rejected patch

What the verifier says about the alt text a hurried fixer writes (from the demo above, `verifa11y verify`):

```json
{
  "findingId": "f_0005",
  "ruleGone": true,
  "newViolations": [],
  "suspicious": true,
  "reason": "text alternative \"plot map\" only restates the file name \"plot-map.png\"; accessibility tree: <img> (line 30) has a name that only restates its file name: \"plot map\"",
  "status": "rejected_suspicious",
  "flaggedBy": ["static", "accessibility-tree"]
}
```

axe is satisfied (`ruleGone: true`, nothing new); the patch is rejected anyway, and the reason says why.

## Benchmark

95 broken pages in [`corpus/`](../corpus), in two sets:

- **eval** (73 pages, held out): built pages of 14 Start Bootstrap templates, 20 Bootstrap 5.3.9 examples, 13 MDN
  learning-area accessibility pages and 7 axe-core fixtures not used in dev, each with its source and license. 29 of
  them have no violation of the patched rules; they stay, because choosing pages by how they score would bias the set.
- **dev** (22 pages, used for tuning): 10 hand-written pages with easy and deliberately ambiguous cases for every
  rule, the 4 inaccessible "before" pages of the W3C WAI
  [Before and After Demonstration](https://www.w3.org/WAI/demos/bad/), and 8 axe-core rule fixtures.

Every run below uses the full verifier (axe, static checks, accessibility tree, focus order, desktop pixels).

| Run | Set | Fix rate | Precision vs the verifier [95% CI] | False-fix | Regression | Report |
|---|---|---|---|---|---|---|
| Tier 0 only (no model, offline) | eval | 2.4% | **100% [82.4–100]**, 18/18 | 0.0% | 0.0% | [bench/codemod/report.md](../bench/codemod/report.md) |
| | dev | 20.5% | **100% [97.3–100]**, 136/136 | 0.0% | 0.0% | |
| Naive baseline (unchecked quick fixes) | eval | 83.9% | 84.1% [81.3–86.6], 619/736 | 2.4% | 1.8% | [bench/baselines/naive/report.md](../bench/baselines/naive/report.md) |
| | dev | 60.9% | 61.7% [57.9–65.4], 403/653 | 35.6% | 2.1% | |
| Tier 0 + tier 1 (a real model) | | not run yet | | | | [report.md](../report.md) |

On dev, the offline run fixes a fifth of what it detects; on eval, where almost everything is `color-contrast`, a
fortieth, and the verifier accepts all of it: the rest is tier 1 by design
(images, contrast, widget state) or codemods declining what they cannot prove. The [analysis](../bench/codemod/report.md#analysis)
explains every category of skip and the two `heading-order` bugs the benchmark caught along the way.

The naive baseline is there to measure the verifier: each report has a "What the verifier adds" table that judges the
same patches with no verifier, axe alone, axe plus source checks, and the full verifier. It runs offline too.

The tier-1 run needs a model, which the environment this was built in did not have, and this repository only
publishes measured numbers. `npm run bench` runs it with the built-in client, or pass `--generator-cmd` for any
other model. Bad numbers get published too. A tier-1 precision number also needs a human-reviewed sample next to it
(see the naive baseline for why), which is not done yet.

Every report gives eval and dev separately, each with its own summary, verifier ablation and per-rule table. Quote
eval. Pages in `corpus/eval/` are never used to write or tune codemods, rules, prompts or the verifier; a page that
is used moves to dev ([ADR 0017](adr/0017-held-out-eval-corpus.md)).

Engines are pinned (axe-core 4.14.1, Playwright 1.65.1) and recorded in every report: a benchmark is only comparable
with a run on the same engines.

```sh
npm run bench:codemod   # offline, ~2 min
npm run bench:naive     # offline naive baseline, ~1 h, most of it on one eval page with 362 findings
npm run bench           # tier 0 + tier 1 with the built-in client; needs ANTHROPIC_API_KEY
npm run demo            # regenerate demo/after from demo/before
npm run demo:record     # re-record docs/demo.svg from real runs
```
