// verifa11y as an MCP server (protocol revision 2026-07-28, SDK v2; 2025-era
// clients are still served by the SDK's legacy path).
//
// A thin wrapper over verifa11y-core: path confinement, size limits, output
// directories and wording live here; every decision about findings, patches
// and verification is made by the core, exactly as for the CLI.
//
// What this server must never do is let an agent conclude "the page is
// accessible". Every result carries the conformance warning in its
// structured content and as the first line of its text.

import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import {
  CAVEATS,
  CONFORMANCE,
  CommandGenerator,
  DEFAULT_DEEP_CHECKS,
  LlmGenerator,
  auditSource,
  countBy,
  engineVersions,
  applyCommand,
  gitRoot,
  gitPatch,
  toPatchPath,
  limiter,
  probeOptions,
  processPage,
  truncate,
  verifyPatch,
  WARNING,
  type AuditResult,
  type Finding,
  type Generator,
  type RuleRegistry,
} from "verifa11y-core";
import { createCoreRegistry } from "verifa11y-rules-core";
import { z } from "zod";

/* ---------------------------------------------------------------------- */
/* The truth every result carries.                                          */
/* ---------------------------------------------------------------------- */

export { CAVEATS, CONFORMANCE, WARNING };

const Caveated = {
  conformance: z.literal(CONFORMANCE),
  caveats: z.array(z.string()),
};
const caveated = () => ({ conformance: CONFORMANCE, caveats: [...CAVEATS] });

/* ---------------------------------------------------------------------- */

export interface ServerOptions {
  /** Directories the tools may read and write. Default: the current directory. */
  roots?: string[];
  registry?: RuleRegistry;
}

export const LIMITS = {
  /** Largest HTML file the server will open. */
  maxFileBytes: 2_000_000,
  /** Most findings returned by one audit call. */
  maxFindings: 500,
  /** Largest diff returned inline by fix (the full patch is always on disk). */
  maxInlineDiff: 20_000,
} as const;

const require_ = createRequire(import.meta.url);

/** Engine versions recorded in every result, including the MCP SDK. */
export function mcpEngine(): Record<string, string> {
  const own = require_("../package.json") as { version: string };
  let sdk = "unknown";
  try {
    const main = require_.resolve("@modelcontextprotocol/server");
    let dir = path.dirname(main);
    while (!existsSync(path.join(dir, "package.json"))) dir = path.dirname(dir);
    sdk = (JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { version: string }).version;
  } catch {
    // keep "unknown"
  }
  return { ...engineVersions(), "verifa11y-mcp": own.version, "@modelcontextprotocol/server": sdk };
}

const FindingOut = z.object({
  id: z.string(),
  ruleId: z.string(),
  wcag: z.array(z.string()),
  impact: z.string().nullable(),
  lines: z.array(z.number()).nullable(),
  tier: z.number().nullable(),
  hasCodemod: z.boolean(),
  help: z.string(),
  helpUrl: z.string(),
  failureSummary: z.string(),
  source: z.string(),
  guidance: z.string().nullable(),
});

const VerificationOut = z.object({
  findingId: z.string(),
  status: z.string(),
  verified: z.boolean(),
  reason: z.string().nullable(),
  ruleGone: z.boolean(),
  newViolations: z.array(z.object({ ruleId: z.string(), selector: z.string(), lines: z.array(z.number()).nullable() })),
  accessibilityTree: z.array(z.string()).nullable(),
  focus: z
    .object({ before: z.number(), after: z.number(), lost: z.array(z.string()), added: z.array(z.string()), reordered: z.boolean() })
    .nullable(),
  visual: z
    .array(z.object({ viewport: z.string(), changeOutside: z.number(), layoutShift: z.number() }))
    .nullable(),
  diff: z.string().nullable(),
});

const Engine = z.record(z.string(), z.string());

export function createServer(opts: ServerOptions = {}): McpServer {
  const registry = opts.registry ?? createCoreRegistry();
  const roots = (opts.roots?.length ? opts.roots : [process.cwd()]).map((r) => realpathSync(path.resolve(r)));
  const audits = new Map<string, AuditResult>();
  const auditLimit = limiter(2);
  const engine = mcpEngine();

  const inRoots = (real: string) => roots.some((r) => real === r || real.startsWith(r + path.sep));

  /** An existing .html file inside the roots, after resolving symlinks. */
  const inputFile = (p: string): string => {
    let real: string;
    try {
      real = realpathSync(path.resolve(roots[0]!, p));
    } catch {
      throw new Error(`file not found: ${p}`);
    }
    if (!inRoots(real)) throw new Error(`${p} is outside the allowed roots`);
    if (!/\.html?$/i.test(real)) throw new Error(`${p} is not an .html file`);
    if (statSync(real).size > LIMITS.maxFileBytes) throw new Error(`${p} is larger than ${LIMITS.maxFileBytes} bytes`);
    return real;
  };

  /** A new, empty run directory under `out`, inside the roots. */
  const runDir = async (out: string): Promise<{ dir: string; runId: string }> => {
    const base = path.resolve(roots[0]!, out);
    // The nearest existing ancestor decides where the directory really is.
    let probe = base;
    while (!existsSync(probe)) probe = path.dirname(probe);
    const real = realpathSync(probe);
    if (!inRoots(real) || !inRoots(path.resolve(real, path.relative(probe, base)))) {
      throw new Error(`output directory ${out} is outside the allowed roots`);
    }
    const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
    const dir = path.join(base, runId);
    await mkdir(dir, { recursive: true });
    return { dir, runId };
  };

  const rel = (abs: string) => path.relative(roots[0]!, abs).split(path.sep).join("/");

  const filter = (f: Finding) => {
    const rule = registry.forFinding(f);
    return rule?.detect ? rule.detect(f) : true;
  };

  /** Audit with the verifier's probes, cached by content: finding ids are stable for the same content. */
  const auditCached = async (file: string, src: string): Promise<AuditResult> => {
    const key = `${file}\n${createHash("sha256").update(src).digest("hex")}`;
    const hit = audits.get(key);
    if (hit) return hit;
    const r = await auditLimit(() => auditSource(file, src, { rules: registry.axeIds(), filter, probe: probeOptions(DEFAULT_DEEP_CHECKS) }));
    if (audits.size >= 20) audits.delete(audits.keys().next().value!);
    audits.set(key, r);
    return r;
  };

  const summarize = (f: Finding): z.infer<typeof FindingOut> => {
    const rule = registry.forFinding(f);
    return {
      id: f.id,
      ruleId: f.ruleId,
      wcag: f.wcag,
      impact: f.impact,
      lines: f.sourceLines ? [f.sourceLines.start, f.sourceLines.end] : null,
      tier: rule?.tier ?? null,
      hasCodemod: Boolean(rule?.fix),
      help: f.help,
      helpUrl: f.helpUrl,
      failureSummary: f.failureSummary,
      source: truncate(f.sourceSnippet ?? f.outerHTML, 600),
      guidance: rule?.guidance ?? null,
    };
  };

  /** Structured result, with the warning as the first line of the text. */
  const ok = <T extends Record<string, unknown>>(data: T, summary: string) => ({
    content: [{ type: "text" as const, text: `${WARNING}\n\n${summary}\n\n${JSON.stringify(data, null, 2)}` }],
    structuredContent: data,
  });
  const fail = (err: unknown) => ({
    content: [{ type: "text" as const, text: `${WARNING}\n\nerror: ${(err as Error).message}` }],
    isError: true,
  });

  /** Tier 1 for mode=auto, from the server's environment only. */
  const tier1 = (): Generator => {
    if (process.env.VERIFA11Y_GENERATOR_CMD) return new CommandGenerator({ command: process.env.VERIFA11Y_GENERATOR_CMD });
    if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
      // Cheap by default: the calling agent is often a model too, and two
      // models on one task means two bills. VERIFA11Y_MODEL overrides.
      return new LlmGenerator({ model: process.env.VERIFA11Y_MODEL ?? "claude-haiku-5-5", effort: "low" });
    }
    throw new Error(
      "mode=auto needs a tier-1 generator in the server's environment (VERIFA11Y_GENERATOR_CMD or ANTHROPIC_API_KEY). " +
        "Otherwise use mode=codemod and write the judgment fixes yourself with verify.",
    );
  };

  const server = new McpServer(
    { name: "verifa11y", version: engine["verifa11y-mcp"]! },
    {
      capabilities: { tools: {}, prompts: {} },
      instructions:
        "verifa11y fixes accessibility violations in static HTML files and verifies every fix. Workflow: rules → audit → " +
        "fix (writes a patch under the output directory, never edits the file) → the user applies it with git apply → " +
        "human review before committing. For findings that need judgment, propose a minimal edit and check it with " +
        "verify before suggesting it. Never silence a violation by hiding, deleting, aria-hidden, role=presentation, " +
        "inert or generic text. Results are axe-clean, not WCAG conformance: never say the page is accessible.",
      cacheHints: {
        "tools/list": { ttlMs: 3_600_000, cacheScope: "public" },
        "prompts/list": { ttlMs: 3_600_000, cacheScope: "public" },
        "server/discover": { ttlMs: 3_600_000, cacheScope: "public" },
      },
    },
  );

  // Registration order is the tools/list order: keep it fixed.

  server.registerTool(
    "rules",
    {
      title: "List verifa11y rules",
      description:
        "The rules verifa11y can patch: axe rule, WCAG criteria, tier (0 = deterministic codemod, 1 = needs a model or " +
        "you), and what each one declines by design. Call it first, so you know what fix will do on its own, what needs " +
        "judgment, and what will end up skipped.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        ...Caveated,
        rules: z.array(
          z.object({
            id: z.string(),
            version: z.string(),
            axe: z.string(),
            wcag: z.array(z.string()),
            tier: z.number(),
            hasCodemod: z.boolean(),
            description: z.string(),
            declines: z.array(z.string()),
            deprecated: z.boolean(),
          }),
        ),
        engine: Engine,
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const data = {
        ...caveated(),
        rules: registry.all().map((r) => ({
          id: r.id,
          version: r.version,
          axe: r.axe,
          wcag: r.wcag,
          tier: r.tier,
          hasCodemod: Boolean(r.fix),
          description: r.description,
          declines: r.declines ?? [],
          deprecated: Boolean(r.deprecated),
        })),
        engine,
      };
      return ok(data, `${data.rules.length} rules: ${data.rules.filter((r) => r.hasCodemod).length} with a tier-0 codemod.`);
    },
  );

  server.registerTool(
    "audit",
    {
      title: "Audit an HTML file",
      description:
        "Audit a static HTML file with axe-core. Returns the violations verifa11y can patch, with id, WCAG criteria, " +
        "exact source lines and text, tier, whether a codemod exists, and rule guidance; plus how many other WCAG A/AA " +
        "violations the page has. Does not change anything.",
      inputSchema: z.object({
        path: z.string().describe("HTML file, relative to the server root"),
        level: z.union([z.literal(1), z.literal(2)]).optional().describe("1 = structural rules only, 2 = also color-contrast (default)"),
      }),
      outputSchema: z.object({
        ...Caveated,
        file: z.string(),
        findings: z.array(FindingOut),
        truncated: z.boolean(),
        otherWcagViolations: z.number(),
        engine: Engine,
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ path: p, level }) => {
      try {
        const file = inputFile(p);
        const src = await readFile(file, "utf8");
        const r = await auditCached(file, src);
        const levelRules = new Set(registry.axeIds(level ?? 2));
        const all = r.findings.filter((f) => levelRules.has(f.ruleId));
        const data = {
          ...caveated(),
          file: rel(file),
          findings: all.slice(0, LIMITS.maxFindings).map(summarize),
          truncated: all.length > LIMITS.maxFindings,
          otherWcagViolations: r.all.length - r.findings.length,
          engine,
        };
        const tiers = countBy(data.findings.map((f) => (f.hasCodemod ? "tier 0 (codemod may fix)" : "needs judgment")));
        return ok(data, `${all.length} finding(s): ${Object.entries(tiers).map(([k, v]) => `${v} ${k}`).join(", ") || "none in the patched rules"}.`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "fix",
    {
      title: "Generate verified fixes as a patch",
      description:
        "Audit an HTML file, generate a patch per finding (mode=codemod: deterministic codemods only, offline, the " +
        "default; mode=auto: also a tier-1 model configured in the server's environment), verify every patch, and write " +
        "the verified ones as a git patch under the output directory (<out>/<runId>/verifa11y.patch). Never edits the " +
        "HTML file: the user applies the patch with git apply and reviews it. strict (default true) leaves suspicious " +
        "patches out.",
      inputSchema: z.object({
        path: z.string().describe("HTML file, relative to the server root"),
        mode: z.enum(["codemod", "auto"]).optional().describe("codemod (default) or auto (needs a tier-1 generator in the server's environment)"),
        strict: z.boolean().optional().describe("Leave suspicious patches out of the patch (default true)"),
        out: z.string().optional().describe("Output directory, relative to the server root (default .verifa11y)"),
        limit: z.number().int().min(1).max(LIMITS.maxFindings).optional().describe("Only the first N findings"),
      }),
      outputSchema: z.object({
        ...Caveated,
        file: z.string(),
        runId: z.string(),
        patchPath: z.string(),
        applyWith: z.string(),
        mode: z.string(),
        strict: z.boolean(),
        counts: z.record(z.string(), z.number()),
        included: z.array(z.object({ findingId: z.string(), ruleId: z.string(), tier: z.number(), status: z.string(), rationale: z.string() })),
        rejected: z.array(z.object({ findingId: z.string(), ruleId: z.string(), status: z.string(), reason: z.string().nullable() })),
        skipped: z.array(z.object({ findingId: z.string(), ruleId: z.string(), reason: z.string().nullable() })),
        diff: z.string().nullable(),
        diffTruncated: z.boolean(),
        remainingFindings: z.number().nullable(),
        engine: Engine,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (a) => {
      try {
        const file = inputFile(a.path);
        const mode = a.mode ?? "codemod";
        const strict = a.strict ?? true;
        const llm = mode === "auto" ? tier1() : null;
        const src = await readFile(file, "utf8");
        const baseline = await auditCached(file, src);
        const page = await processPage(
          file,
          baseline.findings,
          { registry, mode, llm, verify: true, strict, limit: a.limit, checks: DEFAULT_DEEP_CHECKS, genLimit: limiter(2), auditLimit },
          baseline,
        );
        const { dir, runId } = await runDir(a.out ?? ".verifa11y");
        const changed = page.combined !== null && page.combined !== src;
        const patch = changed ? gitPatch([{ path: toPatchPath(file, gitRoot(file) ?? roots[0]!), before: src, after: page.combined! }]) : "";
        const patchFile = path.join(dir, "verifa11y.patch");
        await writeFile(patchFile, patch, "utf8");
        const results = page.outcomes.map((o) => ({
          findingId: o.finding.id,
          ruleId: o.finding.ruleId,
          tier: o.generation.patch ? o.generation.tier : null,
          status: o.verification.status,
          included: o.included,
          reason: o.verification.reason,
          patch: o.generation.patch,
        }));
        await writeFile(path.join(dir, "results.json"), `${JSON.stringify({ ...caveated(), engine, results }, null, 2)}\n`, "utf8");

        const data = {
          ...caveated(),
          file: rel(file),
          runId,
          patchPath: rel(patchFile),
          applyWith: applyCommand(patchFile, file, roots[0]!),
          mode,
          strict,
          counts: countBy(page.outcomes.map((o) => o.verification.status)),
          included: page.outcomes
            .filter((o) => o.included)
            .map((o) => ({ findingId: o.finding.id, ruleId: o.finding.ruleId, tier: o.generation.tier, status: o.verification.status, rationale: o.generation.patch?.rationale ?? "" })),
          rejected: page.outcomes
            .filter((o) => o.generation.patch && !o.included)
            .map((o) => ({ findingId: o.finding.id, ruleId: o.finding.ruleId, status: o.verification.status, reason: o.verification.reason })),
          skipped: page.outcomes
            .filter((o) => o.verification.status === "skipped")
            .map((o) => ({ findingId: o.finding.id, ruleId: o.finding.ruleId, reason: o.verification.reason })),
          diff: patch.length <= LIMITS.maxInlineDiff ? patch : null,
          diffTruncated: patch.length > LIMITS.maxInlineDiff,
          remainingFindings: page.remaining?.length ?? null,
          engine,
        };
        const summary =
          `Patch with ${data.included.length} verified change(s) written to ${data.patchPath} (the HTML file was not modified). ` +
          `${data.rejected.length} rejected, ${data.skipped.length} skipped, ${data.remainingFindings ?? "?"} finding(s) left. ` +
          `Apply with: ${data.applyWith}, then have a person review it.`;
        return ok(data, summary);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "verify",
    {
      title: "Verify a proposed fix",
      description:
        "Judge a fix you propose for one finding, without changing the file. The patch replaces `before` (copied " +
        "exactly from the file; at most 6 changed lines in 2 places) with `after`. The verifier applies it to a copy " +
        "and checks: the violation is gone; no new WCAG A/AA violation; nothing hidden, deleted or silenced; no element " +
        "lost its accessible name, role, state or focusability; the Tab order is intact; nothing changed visually " +
        "outside the patched elements. Suggest the edit only if verified is true.",
      inputSchema: z.object({
        path: z.string().describe("HTML file, relative to the server root"),
        patch: z.object({
          findingId: z.string().describe("Finding id from audit, e.g. f_0003"),
          before: z.string().describe("Exact text from the file to replace"),
          after: z.string().describe("Replacement text"),
          rationale: z.string().optional(),
          confidence: z.enum(["high", "medium", "low"]).optional(),
        }),
      }),
      outputSchema: z.object({ ...Caveated, verification: VerificationOut, engine: Engine }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ path: p, patch }) => {
      try {
        const file = inputFile(p);
        const src = await readFile(file, "utf8");
        const baseline = await auditCached(file, src);
        const finding = baseline.findings.find((f) => f.id === patch.findingId);
        if (!finding) throw new Error(`no finding ${patch.findingId} in ${p}; call audit again (ids change when the file changes)`);
        const full = {
          findingId: patch.findingId,
          rationale: patch.rationale ?? "proposed by an MCP client",
          before: patch.before,
          after: patch.after,
          confidence: patch.confidence ?? "medium",
        };
        const { verification: v } = await auditLimit(() =>
          verifyPatch({ file, src, finding, patch: full, baseline, rule: registry.forFinding(finding), checks: DEFAULT_DEEP_CHECKS }),
        );
        const data = {
          ...caveated(),
          verification: {
            findingId: v.findingId,
            status: v.status,
            verified: v.status === "verified",
            reason: v.reason,
            ruleGone: v.ruleGone,
            newViolations: v.newViolations.map((n) => ({ ruleId: n.ruleId, selector: n.selector, lines: n.sourceLines ? [n.sourceLines.start, n.sourceLines.end] : null })),
            accessibilityTree: v.checks?.ax ?? null,
            focus: v.checks?.focus ?? null,
            visual: v.checks?.visual?.map((x) => ({ viewport: x.viewport, changeOutside: x.changeOutside, layoutShift: x.layoutShift })) ?? null,
            diff: v.diff ?? null,
          },
          engine,
        };
        const summary =
          v.status === "verified"
            ? "verified: the edit can be suggested to the user for review."
            : `${v.status}: do not suggest this edit. Reason: ${v.reason ?? "n/a"}`;
        return ok(data, summary);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerPrompt(
    "fix-accessibility",
    {
      title: "Fix accessibility issues in an HTML file",
      description: "The rules → audit → fix → git apply → review workflow, for one file.",
      argsSchema: z.object({ path: z.string().describe("HTML file") }),
    },
    ({ path: p }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Fix the accessibility violations in ${p} with verifa11y:\n` +
              `1. Call \`rules\` to see what is fixed automatically, what needs judgment and what is declined by design.\n` +
              `2. Call \`audit\` on ${p}.\n` +
              `3. Call \`fix\` on ${p}. It writes a patch and never edits the file. Show the user the patch path and how to apply it (git apply).\n` +
              `4. For findings that need judgment, propose the smallest edit and check it with \`verify\`. Suggest only verified edits. ` +
              `Describe images by purpose; alt="" only for decorative ones. Never hide, delete or silence content.\n` +
              `5. Ask the user to review the changes before committing.\n` +
              `6. Summarize what was verified, what was rejected or skipped and why. Never write "the page is accessible now": ` +
              `verifa11y results are axe-clean on the checked rules, not WCAG conformance.`,
          },
        },
      ],
    }),
  );

  return server;
}
