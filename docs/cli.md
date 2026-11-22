# Install and command line

Everything the `verifa11y` command can do, and how to install it from npm or from source.

## Install

Requires Node.js 20+ (Node 22.13+ for `--db`).

```sh
npx verifa11y install-browser       # once: the headless Chromium verifa11y renders with
npx verifa11y audit page.html --out findings.json
```

Or install it: `npm install -g verifa11y` (the CLI), `verifa11y-mcp` (the MCP server), `verifa11y-core` (the
engine, to embed it). On Linux CI, `verifa11y install-browser --with-deps` also installs the system libraries.

From source, to work on verifa11y itself:

```sh
git clone https://github.com/mateogsilvaa/verifa11y.git
cd verifa11y
npm ci
npx playwright install chromium-headless-shell
npm run build
```

Tier 1 is optional, with either:

```sh
export ANTHROPIC_API_KEY=...                       # the built-in client
export VERIFA11Y_GENERATOR_CMD="ollama run qwen3:8b"  # or any model or agent CLI (same as --generator-cmd)
```

From source, run the CLI with `node packages/cli/dist/cli.js <command>` (or `npm run verifa11y -- <command>`), or in Docker:
`docker build -t verifa11y .` (see [docs/sandbox.md](sandbox.md)).

## Usage

```sh
verifa11y audit <file.html> --out findings.json [--level 1|2]
verifa11y fix findings.json --verify --out patches/ [--strict] [--mode auto|codemod|llm] [--generator-cmd CMD] [--db FILE]
verifa11y verify <file.html> <patch.json> [--findings findings.json]
verifa11y site <url> [--depth N] [--max-pages N] [--viewports LIST] [--db FILE --incremental]
verifa11y bench --corpus ./corpus --report report.md [--mode ...] [--strict] [--compare metrics.json]
git apply patches/verifa11y.patch
```

- `--verify` is off by default for `fix` only to iterate quickly while developing; without it no `.patch` is written.
- Verifier options (`fix`, `bench`): `--no-ax`, `--no-focus`, `--visual desktop,mobile|none`,
  `--max-visual-change <percent>`, `--max-layout-shift <n>`, `--regression-impact minor|moderate|serious|critical`.
- Tier 1: `--generator-cmd`, `--generator-input text|json`, `--model` (built-in client, default `claude-opus-5-5`),
  `--effort`, `--concurrency`. `--limit N` caps findings per file.

`fix` writes `verifa11y.patch` (paths relative to the current directory, for `git apply` from the repository root) and,
per finding, `<id>.patch.json`, `<id>.verification.json` (with the accessibility-tree, focus and visual results) and
`<id>.diff`.
