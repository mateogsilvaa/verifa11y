# Site mode

Audit a live site, with scripts running. Site mode reports; it never patches.

```sh
verifa11y site https://staging.example.com/ --depth 2 --max-pages 100 --viewports desktop,mobile \
  --basic-auth "$STAGING_USER:$STAGING_PASS" --db verifa11y.sqlite --incremental
```

- Crawls the start URL's origin only, to `--depth` links and `--max-pages` pages, seeded from `sitemap.xml`; honours
  `robots.txt` (RFC 9309, with `Crawl-delay`) unless you pass `--ignore-robots` for a site you own.
- Renders every page for real: scripts run, the audit waits for network idle, once per viewport (desktop, tablet,
  mobile or `WIDTHxHEIGHT`), and each finding says in which viewports it appears.
- Captures a screenshot of each finding's element.
- Deduplicates pages by a hash of the rendered DOM (`/` and `/index.html` are audited once), and groups findings with
  the same rule and markup across pages: one template issue reported as one, with the pages it affects.
- Authentication for staging: `--header`, `--cookie`, `--basic-auth` (or `VERIFA11Y_BASIC_AUTH`), sent to the target
  origin only.
- Sandbox: the browser loads only the target origin and origins you allow with `--allow-origin`; every other request
  is blocked and counted. One isolated browser context per page, bounded concurrency, `--delay` between requests.
- `--db` stores sites, runs, pages, findings, patches and verifications in SQLite (`node:sqlite`, Node ≥ 22.13).
  `--incremental` re-renders only pages whose HTML changed since the last run.

Writes `site-report.md`, `site.json` and `screenshots/`. Site mode does not patch: fix the source files with
`verifa11y fix`.

For untrusted sites, run verifa11y in the container: see [docs/sandbox.md](sandbox.md).
