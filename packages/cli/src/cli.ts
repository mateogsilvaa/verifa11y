#!/usr/bin/env node
// verifa11y command-line interface.

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { Command, InvalidArgumentError, Option } from "commander";
import {
  BROWSER,
  installBrowser,
  CommandGenerator,
  DEFAULT_DEEP_CHECKS,
  DEFAULT_MODEL,
  Store,
  VIEWPORTS,
  crawlSite,
  renderSiteReport,
  siteStats,
  LlmGenerator,
  auditFile,
  auditSource,
  closeBrowser,
  countBy,
  engineVersions,
  gitPatch,
  limiter,
  metricsFile,
  processPage,
  renderReport,
  applyCommand,
  toPatchPath,
  verifyPatch,
  writeJson,
  writePageArtifacts,
  type CommandInput,
  type DeepCheckOptions,
  type Impact,
  type Effort,
  type Finding,
  type Generator,
  type MetricsFile,
  type Mode,
  type PageOutcome,
  type RuleRegistry,
  type SiteAuth,
  type Viewport,
} from "verifa11y-core";
import { createCoreRegistry } from "verifa11y-rules-core";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const int = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError("must be a positive integer");
  return n;
};

const hasCredentials = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);

interface CheckOpts {
  ax: boolean;
  focus: boolean;
  visual: Viewport[];
  maxVisualChange: number;
  maxLayoutShift?: number;
  regressionImpact: Impact;
}

function deepChecks(o: CheckOpts): DeepCheckOptions | undefined {
  if (!o.ax && !o.focus && o.visual.length === 0) return undefined;
  return {
    ax: o.ax,
    focus: o.focus,
    visual: o.visual,
    maxVisualChange: o.maxVisualChange / 100,
    maxLayoutShift: o.maxLayoutShift ?? null,
  };
}

const percent = (v: string) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new InvalidArgumentError("must be a percentage between 0 and 100");
  return n;
};

interface GenOpts {
  mode: Mode;
  model: string;
  effort: Effort;
  generatorCmd?: string;
  generatorInput: CommandInput;
}

/**
 * The tier-1 generator for a mode, or null. A generator command (any agent
 * or model CLI) wins over the built-in Anthropic client; `auto` uses the
 * built-in client only when credentials are configured.
 */
function makeLlm(o: GenOpts): Generator | null {
  if (o.mode === "codemod") return null;
  if (o.generatorCmd) return new CommandGenerator({ command: o.generatorCmd, input: o.generatorInput });
  if (o.mode === "auto" && !hasCredentials()) {
    console.error(
      "verifa11y: no model configured (no --generator-cmd, ANTHROPIC_API_KEY unset): findings that need judgment will be skipped.",
    );
    return null;
  }
  return new LlmGenerator({ model: o.model, effort: o.effort });
}

async function readFindings(file: string): Promise<Finding[]> {
  const data = JSON.parse(await readFile(file, "utf8")) as unknown;
  if (!Array.isArray(data)) throw new Error(`${file}: expected an array of findings`);
  return data as Finding[];
}

function groupByFile(findings: Finding[]): Map<string, Finding[]> {
  const out = new Map<string, Finding[]>();
  for (const f of findings) out.set(f.sourceFile, [...(out.get(f.sourceFile) ?? []), f]);
  return out;
}

async function listHtml(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listHtml(p)));
    else if (/\.html?$/i.test(entry.name)) out.push(p);
  }
  return out.sort();
}

function parseViewports(v: string): Viewport[] {
  return v.split(",").map((raw) => {
    const name = raw.trim();
    const vp = VIEWPORTS[name];
    if (vp) return vp;
    const m = /^(\d+)x(\d+)$/.exec(name);
    if (m) return { name, width: Number(m[1]), height: Number(m[2]) };
    throw new InvalidArgumentError(`unknown viewport ${JSON.stringify(name)} (desktop, tablet, mobile or WIDTHxHEIGHT)`);
  });
}

const registry: RuleRegistry = createCoreRegistry();

const program = new Command()
  .name("verifa11y")
  .description(
    "Audit HTML for accessibility violations, patch them, and keep only the patches a re-audit proves correct.\n" +
      "No telemetry. No network access other than the page under audit and, only for tier-1 fixes, the model you configure.",
  )
  .version(pkg.version);

const fixOpts = (cmd: Command) =>
  cmd
    .addOption(
      new Option("--mode <mode>", "auto: codemods, then the model for what needs judgment; codemod: no model; llm: model for everything")
        .choices(["auto", "codemod", "llm"])
        .default("auto"),
    )
    .option("--strict", "leave suspicious patches out of the output patch", false)
    .option(
      "--generator-cmd <command>",
      "tier 1 through any agent or model CLI: gets the request on stdin, prints the patch JSON on stdout (e.g. \"claude -p\", \"ollama run qwen3\")",
      process.env.VERIFA11Y_GENERATOR_CMD,
    )
    .addOption(
      new Option("--generator-input <format>", "what the generator command receives on stdin").choices(["text", "json"]).default("text"),
    )
    .option("--model <id>", "Claude model id for the built-in tier-1 client", DEFAULT_MODEL)
    .addOption(new Option("--effort <level>", "model effort").choices(["low", "medium", "high", "xhigh", "max"]).default("medium"))
    .option("--concurrency <n>", "parallel model calls", int, 4)
    .option("--no-ax", "verifier: skip the accessibility-tree comparison")
    .option("--no-focus", "verifier: skip the focus-order comparison")
    .option(
      "--visual <viewports>",
      'verifier: viewports for the visual comparison (desktop, tablet, mobile, WIDTHxHEIGHT) or "none"',
      (v: string) => (v === "none" ? [] : parseViewports(v)),
      DEFAULT_DEEP_CHECKS.visual as Viewport[],
    )
    .option("--max-visual-change <percent>", "verifier: page pixels that may change outside the patched elements", percent, DEFAULT_DEEP_CHECKS.maxVisualChange * 100)
    .option("--max-layout-shift <n>", "verifier: elements outside the patch that may move (default: measured, not enforced)", (v) => Number(v))
    .addOption(
      new Option("--regression-impact <level>", "verifier: new violations below this impact are reported, not rejected")
        .choices(["minor", "moderate", "serious", "critical"])
        .default("minor"),
    );

program
  .command("audit")
  .description("audit an HTML file and write normalized findings")
  .argument("<file>", "HTML file")
  .option("--out <file>", "findings output", "findings.json")
  .addOption(new Option("--level <n>", "1 = structural rules, 2 = also color-contrast").choices(["1", "2"]).default("2"))
  .action(async (file: string, o: { out: string; level: "1" | "2" }) => {
    const r = await auditFile(file, { rules: registry.axeIds(Number(o.level) as 1 | 2), filter: ruleFilter });
    await writeJson(o.out, r.findings);
    console.log(`${r.findings.length} finding(s) in ${file} (${(r.ms / 1000).toFixed(1)} s, axe ${r.axeVersion})`);
    for (const [rule, n] of Object.entries(countBy(r.findings.map((f) => f.ruleId)))) {
      console.log(`  ${rule}: ${n} (tier ${registry.forFinding({ ruleId: rule } as Finding)?.tier ?? "?"})`);
    }
    console.log(`wrote ${o.out}`);
  });

function ruleFilter(f: Finding): boolean {
  const rule = registry.forFinding(f);
  return rule?.detect ? rule.detect(f) : true;
}

fixOpts(
  program
    .command("fix")
    .description("generate a patch per finding; with --verify, keep only re-audited ones and write a git-apply patch")
    .argument("<findings>", "findings.json from `audit`")
    .option("--out <dir>", "output directory", "patches")
    .option("--verify", "re-audit every patch (off by default only to iterate quickly while developing)", false)
    .option("--limit <n>", "only the first N findings per file", int)
    .option("--db <file>", "also record findings, patches and verifications in this SQLite database (Node >= 22.13)"),
).action(
  async (
    findingsFile: string,
    o: GenOpts & CheckOpts & { out: string; verify: boolean; strict: boolean; limit?: number; concurrency: number; db?: string },
  ) => {
    const llm = makeLlm(o);
    const store = o.db ? await Store.open(o.db) : undefined;
    const runId = store?.beginRun("fix", null, engineVersions(), { mode: o.mode, generator: llm?.name ?? null, strict: o.strict, verify: o.verify });
    const groups = groupByFile(await readFindings(findingsFile));
    const genLimit = limiter(o.concurrency);
    const auditLimit = limiter(Math.max(2, Math.min(o.concurrency, 6)));
    const pages: PageOutcome[] = [];
    for (const [file, findings] of groups) {
      console.log(`${file}: ${findings.length} finding(s), mode ${o.mode}${llm ? ` (${llm.name})` : ""}${o.verify ? ", verifying" : ""}`);
      const page = await processPage(file, findings, {
        registry,
        mode: o.mode,
        llm,
        verify: o.verify,
        strict: o.strict,
        limit: o.limit,
        checks: deepChecks(o),
        regressionImpact: o.regressionImpact,
        genLimit,
        auditLimit,
        log: console.log,
      });
      pages.push(page);
      store?.savePageOutcome(runId!, page);
      const dir = groups.size > 1 ? path.join(o.out, path.basename(file, path.extname(file))) : o.out;
      await writePageArtifacts(dir, page);
      const st = countBy(page.outcomes.map((x) => x.verification.status));
      console.log(`  ${JSON.stringify(st)}${page.remaining ? `; ${page.remaining.length} subset violation(s) left after the patch` : ""}`);
    }
    if (o.verify) {
      const patch = gitPatch(
        pages.filter((p) => p.combined !== null).map((p) => ({ path: toPatchPath(p.file), before: p.src, after: p.combined! })),
      );
      await mkdir(o.out, { recursive: true });
      await writeFile(path.join(o.out, "verifa11y.patch"), patch, "utf8");
      const included = pages.flatMap((p) => p.outcomes.filter((x) => x.included));
      const sus = included.filter((x) => x.verification.status === "rejected_suspicious").length;
      console.log(
        `wrote ${path.join(o.out, "verifa11y.patch")}: ${included.length} change(s)${sus ? `, ${sus} marked suspicious (use --strict to leave them out)` : ""}. Apply with: ${applyCommand(path.join(o.out, "verifa11y.patch"), pages[0]?.file ?? o.out)}`,
      );
    }
    if (store) {
      store.finishRun(runId!, { pages: pages.length, statuses: countBy(pages.flatMap((p) => p.outcomes.map((x) => x.verification.status))) });
      store.close();
    }
  },
);

const collect = (v: string, prev: string[] = []) => [...prev, v];

function parseHeader(h: string): [string, string] {
  const i = h.indexOf(":");
  if (i < 1) throw new InvalidArgumentError(`expected "Name: value", got ${JSON.stringify(h)}`);
  return [h.slice(0, i).trim().toLowerCase(), h.slice(i + 1).trim()];
}

function parseCookie(c: string): { name: string; value: string } {
  const i = c.indexOf("=");
  if (i < 1) throw new InvalidArgumentError(`expected "name=value", got ${JSON.stringify(c)}`);
  return { name: c.slice(0, i).trim(), value: c.slice(i + 1).trim() };
}


program
  .command("site")
  .description("crawl a live site (same origin) and audit every page it reaches; reports only, no patches")
  .argument("<url>", "start URL")
  .option("--out <dir>", "report, site.json and element captures", "site-audit")
  .option("--depth <n>", "link depth from the start page", (v) => Number(v), 2)
  .option("--max-pages <n>", "stop after this many pages", int, 50)
  .option("--viewports <list>", "desktop, tablet, mobile or WIDTHxHEIGHT, comma-separated", parseViewports, [VIEWPORTS.desktop!])
  .addOption(new Option("--level <n>", "1 = structural rules, 2 = also color-contrast").choices(["1", "2"]).default("2"))
  .option("--header <header>", 'extra request header for the target origin, "Name: value" (repeatable)', collect, [])
  .option("--cookie <cookie>", 'cookie for the target origin, "name=value" (repeatable)', collect, [])
  .option("--basic-auth <user:pass>", "HTTP basic auth for the target origin (or set VERIFA11Y_BASIC_AUTH)", process.env.VERIFA11Y_BASIC_AUTH)
  .option("--allow-origin <origin>", "let the browser load resources from this origin too (CDN); never crawled (repeatable)", collect, [])
  .option("--include <regex>", "only crawl URLs matching this")
  .option("--exclude <regex>", "never crawl URLs matching this")
  .option("--ignore-robots", "do not honour robots.txt (only for sites you own)", false)
  .option("--no-sitemap", "do not seed the crawl from sitemap.xml")
  .option("--concurrency <n>", "pages rendered in parallel", int, 2)
  .option("--delay <ms>", "minimum delay between requests to the site (default: robots.txt Crawl-delay, else 0)", (v) => Number(v))
  .option("--timeout <ms>", "per page navigation timeout", int, 30_000)
  .option("--no-screenshots", "do not capture the elements of each finding")
  .option("--db <file>", "SQLite database for runs, pages and findings (Node >= 22.13)")
  .option("--incremental", "with --db: reuse the stored audit of pages whose HTML did not change", false)
  .action(
    async (
      url: string,
      o: {
        out: string;
        depth: number;
        maxPages: number;
        viewports: Viewport[];
        level: "1" | "2";
        header: string[];
        cookie: string[];
        basicAuth?: string;
        allowOrigin: string[];
        include?: string;
        exclude?: string;
        ignoreRobots: boolean;
        sitemap: boolean;
        concurrency: number;
        delay?: number;
        timeout: number;
        screenshots: boolean;
        db?: string;
        incremental: boolean;
      },
    ) => {
      if (o.incremental && !o.db) throw new Error("--incremental needs --db <file> to remember the previous run");
      if (!Number.isInteger(o.depth) || o.depth < 0) throw new Error("--depth must be a non-negative integer");
      const auth: SiteAuth = {
        headers: Object.fromEntries(o.header.map(parseHeader)),
        cookies: o.cookie.map(parseCookie),
      };
      if (o.basicAuth) {
        const i = o.basicAuth.indexOf(":");
        if (i < 0) throw new Error("--basic-auth expects user:pass");
        auth.basic = { username: o.basicAuth.slice(0, i), password: o.basicAuth.slice(i + 1) };
      }
      const store = o.db ? await Store.open(o.db) : undefined;
      try {
        console.log(`site: ${url}, depth ${o.depth}, up to ${o.maxPages} page(s), viewports ${o.viewports.map((v) => v.name).join(", ")}`);
        const result = await crawlSite({
          start: url,
          maxDepth: o.depth,
          maxPages: o.maxPages,
          rules: registry.axeIds(Number(o.level) as 1 | 2),
          filter: ruleFilter,
          viewports: o.viewports,
          auth,
          allowOrigins: o.allowOrigin,
          respectRobots: !o.ignoreRobots,
          useSitemap: o.sitemap,
          concurrency: o.concurrency,
          delayMs: o.delay,
          timeoutMs: o.timeout,
          include: o.include ? new RegExp(o.include) : undefined,
          exclude: o.exclude ? new RegExp(o.exclude) : undefined,
          screenshotsDir: o.screenshots ? path.join(o.out, "screenshots") : null,
          store,
          incremental: o.incremental,
          log: console.log,
        });
        await mkdir(o.out, { recursive: true });
        await writeFile(path.join(o.out, "site-report.md"), renderSiteReport(result, registry), "utf8");
        await writeJson(path.join(o.out, "site.json"), result);
        const st = siteStats(result);
        console.log(
          `${st.pages} page(s): ${st.audited} audited, ${st.reused} reused, ${st.duplicate} duplicate, ${st.skipped} skipped, ${st.error} error(s); ${st.findings} finding(s) in ${(result.ms / 1000).toFixed(1)} s`,
        );
        console.log(`wrote ${path.join(o.out, "site-report.md")} and site.json${o.db ? `; stored run ${result.runId} in ${o.db}` : ""}`);
      } finally {
        store?.close();
      }
    },
  );

program
  .command("verify")
  .description("verify one patch against a file")
  .argument("<file>", "HTML file the patch applies to")
  .argument("<patch>", "patch.json")
  .option("--findings <file>", "findings.json the patch refers to (default: re-audit the file)")
  .option("--out <file>", "write verification.json here")
  .action(async (file: string, patchFile: string, o: { findings?: string; out?: string }) => {
    const src = await readFile(file, "utf8");
    const patch = JSON.parse(await readFile(patchFile, "utf8")) as { findingId?: string };
    const baseline = await auditSource(file, src, { rules: registry.axeIds(), filter: ruleFilter });
    const findings = o.findings ? await readFindings(o.findings) : baseline.findings;
    const finding = findings.find((f) => f.id === patch.findingId);
    if (!finding) throw new Error(`finding ${patch.findingId} not found ${o.findings ? `in ${o.findings}` : `in a fresh audit of ${file}`}`);
    // The full verifier: axe, static checks, accessibility tree, focus order, desktop pixels.
    const { verification } = await verifyPatch({ file, src, finding, patch, baseline, rule: registry.forFinding(finding), checks: DEFAULT_DEEP_CHECKS });
    const { diff, ...rest } = verification;
    console.log(JSON.stringify(rest, null, 2));
    if (diff) console.log(`\n${diff}`);
    if (o.out) await writeJson(o.out, rest);
    process.exitCode = verification.status === "verified" ? 0 : 1;
  });

fixOpts(
  program
    .command("bench")
    .description("run audit + fix + verify over a corpus and write a report")
    .option("--corpus <dir>", "directory of HTML pages (searched recursively)", "corpus")
    .option("--report <file>", "markdown report", "report.md")
    .option("--out <dir>", "per-page artifacts", "bench/run")
    .option("--limit <n>", "only the first N findings per page", int)
    .option("--pages <n>", "only the first N pages", int)
    .option("--notes <file>", "markdown appended to the report (analysis)")
    .option("--compare <file>", "metrics.json of another run to compare against"),
).action(
  async (o: GenOpts & CheckOpts & {
    corpus: string;
    report: string;
    out: string;
    limit?: number;
    pages?: number;
    notes?: string;
    compare?: string;
    strict: boolean;
    concurrency: number;
  }) => {
    const llm = makeLlm(o);
    const compare = o.compare ? (JSON.parse(await readFile(o.compare, "utf8")) as MetricsFile) : undefined;
    if (!(await stat(o.corpus)).isDirectory()) throw new Error(`${o.corpus} is not a directory`);
    let files = await listHtml(o.corpus);
    if (o.pages) files = files.slice(0, o.pages);
    const started = Date.now();
    const genLimit = limiter(o.concurrency);
    const auditLimit = limiter(4);
    const pageLimit = limiter(2);

    console.log(`bench: ${files.length} page(s), mode ${o.mode}${llm ? ` (${llm.name})` : ""}`);
    const pages: PageOutcome[] = await Promise.all(
      files.map((file) =>
        pageLimit(async () => {
          const baseline = await auditLimit(() => auditFile(file, { rules: registry.axeIds(), filter: ruleFilter }));
          const page = await processPage(
            file,
            baseline.findings,
            {
              registry,
              mode: o.mode,
              llm,
              verify: true,
              strict: o.strict,
              limit: o.limit,
              checks: deepChecks(o),
              regressionImpact: o.regressionImpact,
              genLimit,
              auditLimit,
            },
            baseline,
          );
          const rel = path.relative(o.corpus, file).replace(/\.html?$/i, "").split(path.sep).join("/");
          await writePageArtifacts(path.join(o.out, rel), page);
          const st = countBy(page.outcomes.map((x) => x.verification.status));
          console.log(`  ${rel}: ${page.findings.length} finding(s) ${JSON.stringify(st)} in ${(page.ms / 1000).toFixed(1)} s`);
          return page;
        }),
      ),
    );

    pages.sort((a, b) => a.file.localeCompare(b.file));
    const input = {
      generator: llm ? llm.name : "codemods only",
      mode: o.mode,
      strict: o.strict,
      model: llm instanceof LlmGenerator ? llm.model : null,
      corpus: o.corpus,
      rules: registry.all(),
      pages,
      versions: engineVersions(),
      wallMs: Date.now() - started,
      date: new Date().toISOString().slice(0, 10),
      notes: o.notes ? await readFile(o.notes, "utf8") : undefined,
      compare,
      checks: deepChecks(o) ?? null,
      regressionImpact: o.regressionImpact,
    };
    await mkdir(path.dirname(path.resolve(o.report)), { recursive: true });
    await writeFile(o.report, renderReport(input), "utf8");
    await writeJson(path.join(o.out, "metrics.json"), metricsFile(input));
    console.log(`wrote ${o.report} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  },
);

program
  .command("install-browser")
  .description(`install the headless Chromium verifa11y renders with (${BROWSER}), matching its Playwright version`)
  .option("--with-deps", "also install the system libraries it needs (Linux; may ask for sudo)", false)
  .action(async (o: { withDeps: boolean }) => {
    const code = await installBrowser({ withDeps: o.withDeps });
    if (code !== 0) throw new Error(`browser install failed (exit code ${code})`);
  });

/** Filesystem errors, in the user's terms. */
function explain(err: NodeJS.ErrnoException): string {
  const given = process.argv.slice(2).find((a) => /^https?:\/\//i.test(a));
  if (err.code === "ENOENT" && given) return `this command reads HTML files. To audit a live site: npx verifa11y site ${given}`;
  if (err.code === "ENOENT" && err.path) {
    const hint = err.path.endsWith("findings.json") ? "\nCreate it first with: npx verifa11y audit page.html --out findings.json" : "";
    return `file not found: ${err.path}${hint}`;
  }
  if (err.code === "EISDIR") return "expected an HTML file, got a directory. Pass one .html file.";
  return err.message;
}

program
  .parseAsync()
  .catch((err: Error) => {
    console.error(`verifa11y: ${explain(err)}`);
    process.exitCode = 1;
  })
  .finally(() => closeBrowser());
