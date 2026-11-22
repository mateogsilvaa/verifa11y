# Limitations

What verifa11y does not do, and what "verified" does not mean.

**axe-core is still the first judge, and no automated check is a person.** The accessibility-tree, focus and visual
comparisons catch what changed for users, not whether the result is good: an `alt` can be specific and still wrong
about what the image means, and a `label` can be present and confusing. "Verified" means *the violation is gone and
none of these checks found anything worse*. Review the patch before merging it.

**Patching is static HTML only.** Site mode audits rendered pages, but a finding in generated markup must be fixed in
the template or component, and verifa11y cannot find it there yet (roadmap phase 2).

**Contrast is fixed as a loose value.** Tier 1 changes a colour where the text is styled; resolving the background up
the tree and proposing a design-token change instead is roadmap phase 3 work that is not done.

**Cost and latency.** Every patch costs a browser re-audit with the extra probes (about 0.3 s per patch on the
corpus) and, in tier 1, a model call. One shared Chromium (a fresh context per audit), bounded concurrency, prompt
caching per page, tier 0 for everything mechanical, `--limit`, and incremental site runs keep this under control.

**Eight rules are patched** (`image-alt`, `label`, `heading-order`, `aria-roles`, `aria-required-attr`,
`aria-allowed-attr`, `aria-valid-attr-value`, `color-contrast`). Everything else axe finds is used to detect
regressions and is reported in site mode.
