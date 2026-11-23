# Publishing to npm

Four packages are published; `verifa11y-action` and the monorepo root are private.

| Package | Folder | What people install it for |
|---|---|---|
| `verifa11y-core` | `packages/core` | the engine (a dependency of the others) |
| `verifa11y-rules-core` | `packages/rules-core` | the rule set (a dependency of the CLI and MCP server) |
| `verifa11y` | `packages/cli` | the command: `npx verifa11y` |
| `verifa11y-mcp` | `packages/mcp` | the MCP server: `npx verifa11y-mcp` |

All four share one version and depend on each other at that exact version, so they are always published together,
dependencies first.

## Once

- An npm account with **two-factor authentication on, for "Authorization and writes"** (npmjs.com, Account settings,
  Two-Factor Authentication). Without it `npm publish` fails with `403 Forbidden ... Two-factor authentication ... is
  required`. Do not work around that with a token that bypasses 2FA: npm is restricting those.
- `npm login` in this shell.

## Each release

Replace `X.Y.Z` with the version.

**1. Prepare it on `main`.**

- Set `"version": "X.Y.Z"` in the root `package.json` and in all five packages, and the exact pins between them
  (`verifa11y-core`, `verifa11y-rules-core`). Then `npm install --package-lock-only` refreshes the lockfile.
- Add the entry to `CHANGELOG.md`, write `docs/releases/vX.Y.Z.md`, and update `version` and `date-released` in
  `CITATION.cff`.
- Commit and push to `main`, then tag that commit and push the tag:

```sh
git tag vX.Y.Z
git push origin vX.Y.Z
```

**2. Publish from a clean checkout of the tag**, at the repository root:

```sh
git switch --detach vX.Y.Z
npm ci
npx playwright install chromium-headless-shell   # the tests render pages in a real browser
npm test                                         # must pass
npm run build
npm publish -w packages/core
npm publish -w packages/rules-core
npm publish -w packages/cli
npm publish -w packages/mcp
```

The browser install is needed once per machine; without it about 100 tests fail with "Chromium is not installed".
npm asks you to confirm each publish in the browser (or for a one-time code). When you finish, `git switch main`.

`npm publish` runs each package's `prepack`, which copies `LICENSE` and `NOTICE` into the package and refuses to
publish a package whose `dist/` is missing or older than its `src/`. Each package publishes `dist/`, `src/` (for
source maps), its README, `LICENSE` and `NOTICE`; no tests and no corpus.

To see exactly what would be published without publishing: `npm pack -w packages/cli --dry-run`.

**3. Create the GitHub release.**

1. Copy the notes without their first line, which becomes the title:
   `(Get-Content docs\releases\vX.Y.Z.md | Select-Object -Skip 2) | Set-Clipboard` (PowerShell).
2. Open https://github.com/mateogsilvaa/verifa11y/releases/new and choose the existing tag `vX.Y.Z`.
3. Title: `verifa11y X.Y.Z`. Paste the notes as the description.
4. Tick "Set as the latest release" for the newest version only. Leave the pre-release and Marketplace boxes empty.
5. Publish release.

## Check

```sh
npm view verifa11y version
npx -y verifa11y@latest --version
npx -y verifa11y install-browser && npx -y verifa11y audit demo/before/index.html --out /tmp/findings.json
```

## If something goes wrong

- A package published by mistake can be unpublished within 72 hours (`npm unpublish <name>@<version>`), but that
  version number can never be reused. Prefer publishing a fixed patch version.
- If one package fails halfway, fix it and publish the remaining ones at the same version; do not bump only some.
