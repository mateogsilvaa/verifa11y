# Changelog

All notable changes. The project follows semver; while it is 0.x, minor versions may break the experimental Rule
API (ADR 0006).

## 0.4.2 (2026-11-23)

Documentation and packaging. No change to auditing, patching or verification.

### Added
- **Website**: https://mateogsilvaa.github.io/verifa11y/ (checked with axe-core before every deploy).
- `SECURITY.md`, `CITATION.cff`, a Dependabot configuration (axe-core and Playwright stay pinned, because every
  benchmark report records their versions), `CODEOWNERS` and a feature request template.

### Changed
- **README is a landing page**: banner, quick start, flow diagram, the six checks, results and comparison. The detailed
  sections moved word for word into `docs/` (how it works, the verifier, install and command line, MCP server, site mode,
  packages, benchmark, limitations), with an index in `docs/README.md`.
- **npm pages**: the `verifa11y` README has a banner and links to the new docs, and `verifa11y` and `verifa11y-mcp` have
  fuller descriptions and keywords.
- The GitHub Action's cache step uses `actions/cache@v6`; the project's own workflows use newer actions.
- `docs/publishing.md` lists the browser install the test suite needs, the two-factor requirement, and the whole
  release sequence including the tag and the GitHub release.
- `docs/agents.md`: dropped a link to a benchmark report that is not in the repository.

## 0.4.1 (2026-11-20)

Ready for npm. No change to auditing, patching or verification.

### Added
- **npm packages**: `verifa11y` (the CLI, so `npx verifa11y` works), `verifa11y-mcp`, `verifa11y-core`,
  `verifa11y-rules-core`, with READMEs, repository metadata, and `LICENSE`/`NOTICE` copied in at pack time.
  Publishing steps in `docs/publishing.md`.
- `verifa11y install-browser [--with-deps]` and `verifa11y-mcp --install-browser`: install the headless Chromium
  that matches the bundled Playwright version.
- A clear error when that browser is missing, with the exact command to install it, instead of Playwright's stack.

### Changed
- The CLI package is named `verifa11y` (was `verifa11y-cli` in 0.4.0, never published).
- README, AGENTS.md and docs/agents.md install and configure from npm (`npx`); from source is still documented.
- NOTICE lists the held-out corpus sources.

## 0.4.0 (2026-11-20)

The project is now **verifa11y** (ADR 0018). This release measures the verifier instead of only trusting it: a naive
baseline shows what it catches and what it cannot, a held-out corpus keeps the numbers honest, and a GitHub Action
brings verified fixes to pull requests.

### Breaking
- **Renamed from a11yfix to verifa11y.** Command `a11yfix` → `verifa11y`, `a11yfix-mcp` → `verifa11y-mcp`; packages
  `a11yfix-*` → `verifa11y-*`; environment variables `A11YFIX_*` → `VERIFA11Y_*` (`VERIFA11Y_GENERATOR_CMD`,
  `VERIFA11Y_MODEL`, `VERIFA11Y_MCP_ROOT`, `VERIFA11Y_BASIC_AUTH`); output names `a11yfix.patch` →
  `verifa11y.patch`, `.a11yfix/` → `.verifa11y/`, `a11yfix.sqlite` → `verifa11y.sqlite`. Repository
  `mateogsilvaa/verifa11y` (the old URL redirects). No aliases.
- Two new verifier checks (below) can reject patches that 0.3 verified.

### Added
- **Held-out eval corpus** (ADR 0017): 73 pages in `corpus/eval/` (Start Bootstrap templates, Bootstrap 5.3.9
  examples, MDN learning-area accessibility pages, axe-core fixtures not used in dev), each with its source and
  license, never used to write or tune codemods, rules, prompts or the verifier. The 22 existing pages are dev.
- `verifa11y bench` reports eval and dev separately (summary, tiers, comparison, verifier ablation, outcomes and
  per-rule tables, with intervals); `metrics.json` adds `bySet`, and `--compare` matches set to set. Tier 0 on eval:
  18 of 18 verified, 100% [82.4–100].
- **Naive baseline** (ADR 0014): `bench/baselines/naive-fixer.mjs`, unchecked quick fixes run through
  `--generator-cmd`, offline (`npm run bench:naive`). Results and a rule-by-rule analysis in
  `bench/baselines/naive/`, including the patches the verifier accepts that a reviewer would often reject (403 after ADR 0015).
- **"What the verifier adds"** in every benchmark report: the same patches judged with no verifier, axe only, axe
  plus source checks, and the full verifier.
- **95% Wilson intervals and n** for precision in the tier and rule tables.
- `flaggedBy` in `verification.json`: which verifier layers raised a suspicion reason.
- README demo recorded from real runs (`docs/demo.svg`, `docs/demo.cast`, `npm run demo:record`), a results
  section with the naive baseline next to tier 0, and a real rejected patch.
- **GitHub Action** (`action.yml`, `packages/action`, ADR 0016). On `pull_request`, audits the changed HTML files, runs
  `fix --verify` (codemods by default; tier 1 only with an explicit `generator-cmd`) and posts one review whose
  inline comments are suggestions for verified patches only, on the exact lines they change. Suspicious, rejected
  and skipped findings are listed in the body, never suggested. Job summary for fork pull requests. Inputs `paths`,
  `mode`, `strict`, `fail-on`, `generator-cmd`, `max-files`, `working-directory`, `github-token`. Example workflow in
  `docs/examples/`. Not tagged or published to the Marketplace yet.
- **Verifier: labels that restate an identifier** (ADR 0015). An `aria-label` added by the patch whose words all come
  from the element's `name` or `id` (`name="first"` → `aria-label="first"`) is suspicious, unless it contains the
  visible text next to the element (label in name, WCAG 2.5.3).
- **Verifier: dangling id references** (ADR 0015). An `aria-controls`, `aria-labelledby`, `aria-describedby`,
  `aria-owns`, `aria-activedescendant` (or another id-reference attribute) that the patch leaves pointing at no
  element on the page (`aria-controls="false"`) is suspicious.
- Both in the sabotage suite and in `verify.test.ts` (fixture `identifiers.html`). On the naive baseline they move
  56 patches from verified to suspicious (`label` 51 → 2, `aria-required-attr` 29 → 22); no tier-0 patch is flagged.

### Changed
- The conformance warning and caveats (`CONFORMANCE`, `CAVEATS`, `WARNING`) live in `verifa11y-core`; `verifa11y-mcp`
  re-exports them unchanged.

## 0.3.0

Roadmap phases 1 (sites) and 3 (verification beyond axe), and tier 1 through any model or agent.

### Added
- **Verifier: accessibility tree** (ADR 0012). Chromium's computed role, name, states and focusability of every
  element before and after each patch. Lost names, roles or states, elements no longer exposed or focusable, and new
  generic or file-name names make a patch suspicious.
- **Verifier: focus order.** Real Tab presses before and after; elements leaving the tab order or a reordered
  sequence make a patch suspicious.
- **Verifier: visual regression.** Full-page screenshots per viewport (`--visual`), pixel diff outside the patched
  elements (`--max-visual-change`, default 0.1%), layout shift measured (`--max-layout-shift` to enforce).
- **Verifier: `--regression-impact`** to tolerate new violations below an impact level (reported, not rejected).
- **Verifier: `inert`** added to the static suspicion checks (it silences axe).
- **Second sabotage suite** and `deepcheck.test.ts`: fakes that axe and the static checks accept and only the new
  checks reject, and honest fixes that pass everything.
- **`a11yfix site <url>`** (ADR 0010): same-origin crawler with depth and page limits, robots.txt, sitemap.xml,
  rendered-DOM deduplication, real rendering with network-idle wait, several viewports, element captures, findings
  grouped across pages, auth (headers, cookies, basic), origin allowlist, concurrency and delay.
- **SQLite storage** (`--db`, `node:sqlite`, Node 22.13+): sites, runs, pages, findings, patches, verifications.
  `site --incremental` reuses unchanged pages. `fix --db` records patches and verifications.
- **`--generator-cmd`** (ADR 0011): tier 1 through any command (local models, agent CLIs, scripts), text or JSON
  request on stdin, patch JSON on stdout, tolerant parsing, retries with feedback. `A11YFIX_GENERATOR_CMD`.
- **`a11yfix-mcp`** (ADR 0013): MCP server on the v2 SDK (revision 2026-07-28, 2025-era hosts still served) with
  `rules`, `audit`, `fix` and `verify` tools and a `fix-accessibility` prompt. Structured results with the conformance
  caveat in every one; `fix` defaults to codemod mode and strict, writes a git patch under `<out>/<runId>/` and never
  edits the input; files confined to `--root`. Tests for the warning, path confinement, wire conformance and the tool
  schema snapshot. **AGENTS.md** for coding agents.
- **Rule API**: optional `declines` field, what a rule leaves alone by design (filled for every core rule).
- **docs/agents.md**: using a11yfix from agents, in all three directions. **docs/sandbox.md**, **Dockerfile** and a CI job
  that runs it with no network, read-only root, no capabilities and CPU/memory caps.
- Benchmark with a local model (`qwen3:8b` through Ollama) as tier 1: `bench/local-qwen3-8b/`.

### Changed
- `fix` and `bench` run the accessibility-tree, focus and desktop visual checks by default (`--no-ax`, `--no-focus`,
  `--visual none` to turn them off). Library callers opt in with `checks`.
- Reports have a "Verifier checks" section. `PageViolation` and `ViolationRef` carry the axe impact.
- `audit.ts` exposes `runAxe` and `normalize` for pages loaded by other means (site mode).

## 0.2.0

Phase 0 of the roadmap: consolidate the core.

### Added
- **Tiered fixing.** Tier 0 deterministic codemods for `label`, `heading-order`, `aria-roles`, `aria-allowed-attr`
  and `aria-valid-attr-value`; they decline whatever needs judgment. Tier 1 (the model) handles the rest.
  `--mode auto|codemod|llm`. Reports break results down by tier; tier 0 is held to 100% precision.
- **Rule plugin API** (experimental): typed `Rule` with `detect`, `fix`, `verify`, `wcag`, `tier`, `confidence`,
  per-rule semver and deprecation; `RuleRegistry`; `defineRule` validation.
- **Packages**: `a11yfix-core`, `a11yfix-rules-core`, `a11yfix-cli` in an npm workspaces monorepo.
- **Git patch output**: `fix --verify` writes `a11yfix.patch`, applicable with `git apply`.
- **`--strict`**: leaves suspicious patches out of the output patch. Suspicious patches get their own report section.
- **Verifier**: flags content made invisible with clip/clip-path, opacity 0, font-size 0 or text-indent.
- **Sabotage test**: hundreds of deliberately fake fixes over the hand-written corpus; the verifier must reject all.
- Engine versions (a11yfix, axe-core, Playwright, Node) recorded in every report.
- Governance: CONTRIBUTING, CODE_OF_CONDUCT, GOVERNANCE, rule author guide, rule versioning policy, ADRs, issue and
  PR templates, ROADMAP.
- CI matrix: Linux, Windows, macOS × Node 20, 22, 24; offline benchmark job that fails if tier 0 drops below 100%.

### Changed
- License: MIT → Apache-2.0 (ADR 0007).
- axe-core, Playwright and all direct dependencies pinned to exact versions.
- `audit` filters through each rule's `detect`.

### Removed
- The naive heuristic generator (`--generator heuristic`), replaced by tier-0 codemods.

## 0.1.0

First prototype: audit, LLM patch generation, shape validation, verification, benchmark over a 22-page corpus.
