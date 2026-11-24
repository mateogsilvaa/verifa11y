// Orchestration shared by `fix` and `bench`.
//
// For each finding:
//   tier 0  the owning rule's deterministic codemod, if it has one and does
//           not decline;
//   tier 1  otherwise the LLM generator, if one is configured (mode auto/llm);
//   skipped otherwise.
// Every patch, whatever its tier, goes through the same validator and verifier.
//
// Patches are generated and verified independently against the original
// file. The ones to ship (verified, plus suspicious unless --strict) are then
// combined into one patched page (applied back to front, skipping overlaps),
// and that page is audited once more so the report can say what is left.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { diffLines } from "diff";
import path from "node:path";
import { auditSource, type AuditResult } from "./audit.js";
import { collectIds, elementStartingAt, startTagOf } from "./html.js";
import type { Generator } from "./llm.js";
import { gitPatch, toPatchPath } from "./patchfile.js";
import type { Rule, RuleRegistry } from "./rule.js";
import { parseSource } from "./source.js";
import { ZERO_USAGE, addUsage, type Finding, type GenerationResult, type Patch, type Usage, type Verification } from "./types.js";
import { validatePatch } from "./validate.js";
import { verifyPatch } from "./verify.js";
import { probeOptions, type DeepCheckOptions } from "./deepcheck.js";
import type { Impact } from "./types.js";

export type Mode = "auto" | "codemod" | "llm";

export interface PatchOutcome {
  finding: Finding;
  generation: GenerationResult;
  /** Final status. Generation failures are rejected_invalid; nothing attempted is skipped. */
  verification: Verification;
  /** False when verification is off: status then reflects shape validation only. */
  verified: boolean;
  /** Goes into the output patch: verified, or suspicious when not strict. */
  included: boolean;
  editStart: number | null;
  editEndOld: number | null;
  after: string | null;
}

export interface PageOutcome {
  file: string;
  src: string;
  findings: Finding[];
  outcomes: PatchOutcome[];
  usage: Usage;
  ms: number;
  /** Subset violations left after applying every included patch together. */
  remaining: Finding[] | null;
  /** WCAG A/AA violations (any rule) before and after combining. */
  allBefore: number;
  allAfter: number | null;
  combined: string | null;
  combinedSkipped: string[];
}

/** Minimal concurrency limiter. */
export function limiter(n: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= n) return;
    const job = queue.shift();
    if (job) {
      active++;
      job();
    }
  };
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
}

export interface ProcessOptions {
  registry: RuleRegistry;
  mode: Mode;
  /** Tier-1 generator. Null means no model: judgment findings are skipped. */
  llm: Generator | null;
  verify: boolean;
  /** Exclude suspicious patches from the output patch. */
  strict: boolean;
  limit?: number;
  /** Accessibility-tree, focus-order and visual checks in the verifier. Omit for axe-only verification. */
  checks?: DeepCheckOptions;
  /** New violations below this impact do not reject a patch. */
  regressionImpact?: Impact;
  genLimit: ReturnType<typeof limiter>;
  auditLimit: ReturnType<typeof limiter>;
  log?: (msg: string) => void;
}

/** Run a rule's tier-0 codemod. Never throws: a crashing codemod declines. */
export function runCodemod(rule: Rule, finding: Finding, src: string): GenerationResult {
  const started = Date.now();
  const result = (patch: Patch | null, error: string | null): GenerationResult => ({
    patch,
    error,
    attempts: 1,
    usage: ZERO_USAGE,
    ms: Date.now() - started,
    tier: 0,
  });
  if (!rule.fix) return result(null, "rule has no codemod");
  try {
    const parsed = parseSource(src);
    const element = finding.sourceRange ? elementStartingAt(parsed, finding.sourceRange.start) : null;
    const st = element ? startTagOf(src, element) : null;
    const r = rule.fix({
      finding,
      src,
      parsed,
      element,
      startTag: st?.text ?? null,
      startTagRange: st?.range ?? null,
      ids: collectIds(parsed),
    });
    if (!r) return result(null, "codemod declined");
    const patch: Patch = {
      findingId: finding.id,
      rationale: r.rationale,
      before: r.before,
      after: r.after,
      confidence: r.confidence ?? rule.confidence,
    };
    // A codemod knows the limits: an edit that would fail shape validation
    // (too large, ambiguous) is a decline, not a proposal.
    const shape = validatePatch(src, finding, patch);
    if (!shape.ok) return result(null, `codemod declined: its edit fails shape validation (${shape.reason})`);
    return result(patch, null);
  } catch (err) {
    return result(null, `codemod crashed: ${(err as Error).message}`);
  }
}

function blank(f: Finding, status: Verification["status"], reason: string): Verification {
  return { findingId: f.id, status, ruleGone: false, newViolations: [], suspicious: false, reason };
}

/** Process every finding of one page. `findings` must all belong to `file`. */
export async function processPage(
  file: string,
  findings: Finding[],
  opts: ProcessOptions,
  baseline?: AuditResult,
): Promise<PageOutcome> {
  const started = Date.now();
  const src = await readFile(file, "utf8");
  const selected = opts.limit !== undefined ? findings.slice(0, opts.limit) : findings;
  const log = opts.log ?? (() => {});
  const ruleIds = Array.from(new Set([...opts.registry.axeIds(2), ...selected.map((f) => f.ruleId)]));

  const probe = opts.checks ? probeOptions(opts.checks) : undefined;
  let base = opts.verify ? (baseline ?? (await opts.auditLimit(() => auditSource(file, src, { rules: ruleIds, probe })))) : null;
  if (base && probe && !base.probe) {
    const b = base;
    base = await opts.auditLimit(() => auditSource(file, src, { rules: b.rules, probe }));
  }

  const generate = async (f: Finding, rule: Rule | undefined): Promise<GenerationResult | string> => {
    let declined = rule ? "" : "no rule registered for this finding";
    if (rule && opts.mode !== "llm" && rule.fix) {
      const g = runCodemod(rule, f, src);
      if (g.patch) return g;
      declined = g.error ?? "codemod declined";
    } else if (rule && opts.mode !== "llm") {
      declined = `needs judgment (tier-${rule.tier} rule without codemod)`;
    }
    if (opts.mode !== "codemod" && opts.llm) {
      const llm = opts.llm;
      return opts.genLimit(() => llm.generate(f, src, rule));
    }
    return `${declined}; no model configured`;
  };

  const one = async (f: Finding): Promise<PatchOutcome> => {
    const rule = opts.registry.forFinding(f);
    const g = await generate(f, rule);
    const none = { editStart: null, editEndOld: null, after: null, included: false, verified: opts.verify };
    if (typeof g === "string") {
      log(`  ${f.id} ${f.ruleId}: skipped (${g})`);
      const generation: GenerationResult = { patch: null, error: g, attempts: 0, usage: ZERO_USAGE, ms: 0, tier: 1 };
      return { finding: f, generation, verification: blank(f, "skipped", g), ...none };
    }
    if (!g.patch) {
      log(`  ${f.id} ${f.ruleId}: generation failed (${g.error})`);
      return { finding: f, generation: g, verification: blank(f, "rejected_invalid", `generation failed: ${g.error}`), ...none };
    }
    const shape = validatePatch(src, f, g.patch);
    const edit = shape.ok
      ? {
          editStart: shape.applied.editStart,
          editEndOld: shape.applied.editEndOld,
          after: shape.applied.patched.slice(shape.applied.editStart, shape.applied.editEndNew),
        }
      : { editStart: null, editEndOld: null, after: null };

    let verification: Verification;
    if (!opts.verify || !shape.ok) {
      verification = {
        ...blank(f, shape.ok ? "verified" : shape.status, shape.ok ? "shape-valid; not verified (--verify off)" : shape.reason),
        diff: shape.ok ? shape.applied.diff : undefined,
      };
    } else {
      const out = await opts.auditLimit(() =>
        verifyPatch({ file, src, finding: f, patch: g.patch, baseline: base!, rule, checks: opts.checks, regressionImpact: opts.regressionImpact }),
      );
      verification = out.verification;
    }
    const included = verification.status === "verified" || (verification.status === "rejected_suspicious" && !opts.strict);
    log(`  ${f.id} ${f.ruleId} [tier ${g.tier}]: ${verification.status}${verification.reason ? ` (${verification.reason})` : ""}`);
    return { finding: f, generation: g, verification, verified: opts.verify, included, ...edit };
  };

  // Warm the prompt cache with one request before fanning out, so the
  // remaining LLM requests for this page read the cached file instead of all
  // writing it at once.
  const outcomes: PatchOutcome[] = [];
  if (selected.length > 0) outcomes.push(await one(selected[0]!));
  outcomes.push(...(await Promise.all(selected.slice(1).map(one))));

  const usage = outcomes.reduce((u, o) => addUsage(u, o.generation.usage), ZERO_USAGE);

  let remaining: Finding[] | null = null;
  let allAfter: number | null = null;
  let combined: string | null = null;
  let combinedSkipped: string[] = [];
  if (opts.verify) {
    const c = combine(src, outcomes.filter((o) => o.included));
    combined = c.text;
    combinedSkipped = c.skipped;
    const after = await opts.auditLimit(() => auditSource(file, c.text, { rules: ruleIds }));
    remaining = after.findings;
    allAfter = after.all.length;
  }

  return {
    file,
    src,
    findings: selected,
    outcomes,
    usage,
    ms: Date.now() - started,
    remaining,
    allBefore: base?.all.length ?? 0,
    allAfter,
    combined,
    combinedSkipped,
  };
}

interface SubEdit {
  start: number;
  end: number;
  text: string;
}

/**
 * Split one replacement into minimal line-level edits, in original-file
 * coordinates. A patch that re-levels two headings ten lines apart becomes
 * two small edits instead of one span that would collide with every other
 * patch in between.
 */
export function subEdits(src: string, start: number, end: number, after: string): SubEdit[] {
  const before = src.slice(start, end);
  const out: SubEdit[] = [];
  let offset = start;
  let pending: SubEdit | null = null;
  for (const part of diffLines(before, after)) {
    if (!part.added && !part.removed) {
      if (pending) out.push(pending);
      pending = null;
      offset += part.value.length;
      continue;
    }
    pending ??= { start: offset, end: offset, text: "" };
    if (part.removed) {
      offset += part.value.length;
      pending.end = offset;
    } else {
      pending.text += part.value;
    }
  }
  if (pending) out.push(pending);
  return out;
}

/**
 * Apply every included patch to the original file. Each patch is atomic: if
 * any of its edits overlaps an edit already taken, the whole patch is
 * skipped (and reported), never half-applied.
 */
export function combine(src: string, accepted: PatchOutcome[]): { text: string; skipped: string[] } {
  const taken: SubEdit[] = [];
  const skipped: string[] = [];
  const overlaps = (a: SubEdit, b: SubEdit) => a.start < b.end && b.start < a.end || (a.start === a.end && b.start === b.end && a.start === b.start);
  const patches = accepted
    .filter((o) => o.editStart !== null && o.editEndOld !== null && o.after !== null)
    .sort((a, b) => a.editStart! - b.editStart!);
  for (const o of patches) {
    const edits = subEdits(src, o.editStart!, o.editEndOld!, o.after!);
    if (edits.some((e) => taken.some((t) => overlaps(e, t)))) {
      skipped.push(o.finding.id);
      continue;
    }
    taken.push(...edits);
  }
  let text = src;
  for (const e of taken.sort((a, b) => b.start - a.start)) text = text.slice(0, e.start) + e.text + text.slice(e.end);
  return { text, skipped };
}

/* ---------------------------------------------------------------------- */

export async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/** The git-apply patch for a page (empty string when nothing is included). */
export function pagePatch(page: PageOutcome, root?: string): string {
  if (page.combined === null) return "";
  return gitPatch([{ path: toPatchPath(page.file, root), before: page.src, after: page.combined }]);
}

/** Write per-patch artifacts for one page into `dir`. */
export async function writePageArtifacts(dir: string, page: PageOutcome): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const o of page.outcomes) {
    const id = o.finding.id;
    if (o.generation.patch) await writeJson(path.join(dir, `${id}.patch.json`), o.generation.patch satisfies Patch);
    const { diff, ...verification } = o.verification;
    await writeJson(path.join(dir, `${id}.verification.json`), { ...verification, tier: o.generation.patch ? o.generation.tier : null });
    if (diff) await writeFile(path.join(dir, `${id}.diff`), diff, "utf8");
  }
  await writeFile(path.join(dir, "verifa11y.patch"), pagePatch(page), "utf8");
  await writeJson(path.join(dir, "summary.json"), {
    file: page.file,
    findings: page.findings.length,
    statuses: countBy(page.outcomes.map((o) => o.verification.status)),
    included: page.outcomes.filter((o) => o.included).map((o) => o.finding.id),
    remainingSubsetViolations: page.remaining?.length ?? null,
    wcagViolationsBefore: page.allBefore,
    wcagViolationsAfter: page.allAfter,
    combinedSkipped: page.combinedSkipped,
    usage: page.usage,
    ms: page.ms,
    results: page.outcomes.map((o) => ({
      findingId: o.finding.id,
      ruleId: o.finding.ruleId,
      line: o.finding.sourceLines?.start ?? null,
      tier: o.generation.patch ? o.generation.tier : null,
      status: o.verification.status,
      included: o.included,
      reason: o.verification.reason,
      confidence: o.generation.patch?.confidence ?? null,
      attempts: o.generation.attempts,
      usage: o.generation.usage,
    })),
  });
}

export function countBy(xs: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}
