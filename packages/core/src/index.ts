// verifa11y-core public entry point.

export * from "./types.js";
export { CAVEATS, CONFORMANCE, WARNING } from "./caveats.js";
export * from "./rule.js";
export * from "./wcag.js";
export * from "./source.js";
export * from "./html.js";
export { auditFile, auditSource, type AuditOptions, type AuditResult, type PageViolation } from "./audit.js";
export { BROWSER, browserInstallCommand, closeBrowser, getBrowser, installBrowser, withPage } from "./browser.js";
export { describeContext, extractNodeContext } from "./context.js";
export { applyAt, locate, type AppliedPatch, type LocateResult } from "./apply.js";
export { MAX_HUNKS, MAX_LINES, PATCH_JSON_SCHEMA, PatchSchema, parsePatch, validatePatch, type ValidationResult } from "./validate.js";
export {
  IDREF_ATTRS,
  compare,
  isGenericText,
  restatesFileName,
  restatesIdentifier,
  suspicionReasons,
  verifyPatch,
  type VerifyInput,
  type VerifyOutput,
} from "./verify.js";
export {
  DEFAULT_MODEL,
  LlmGenerator,
  SYSTEM_PROMPT,
  buildFindingPrompt,
  estimateUsd,
  type Effort,
  type Generator,
  type LlmOptions,
} from "./llm.js";
export {
  combine,
  subEdits,
  countBy,
  limiter,
  pagePatch,
  processPage,
  runCodemod,
  writeJson,
  writePageArtifacts,
  type Mode,
  type PageOutcome,
  type PatchOutcome,
  type ProcessOptions,
} from "./pipeline.js";
export { CommandGenerator, extractPatch, type CommandInput, type CommandOptions } from "./command.js";
export { applyCommand, gitPatch, gitRoot, toPatchPath, type FileChange } from "./patchfile.js";
export {
  corpusSetOf,
  EVAL_DIR,
  metricsFile,
  metricsOf,
  rateCI,
  renderReport,
  splitPages,
  wilson,
  type CorpusSet,
  type Metrics,
  type MetricsFile,
  type ReportInput,
  type SetMetrics,
} from "./report.js";
export { engineVersions } from "./versions.js";
export { runAxe, normalize, type AxeRun, type NormalizeOptions } from "./audit.js";
export {
  VIEWPORTS,
  canonicalUrl,
  crawlSite,
  fingerprintOf,
  siteStats,
  type CrawlOptions,
  type PageStatus,
  type SiteAuth,
  type SiteFinding,
  type SitePage,
  type SiteResult,
  type Viewport,
} from "./site/crawl.js";
export { parseRobots, type Robots } from "./site/robots.js";
export { parseSitemap, type SitemapDoc } from "./site/sitemap.js";
export { Store, SCHEMA_VERSION, type PreviousPage } from "./site/store.js";
export { renderSiteReport, sharedGroups, type SiteGroup } from "./site/report.js";
export { probePage, type AxInfo, type Probe, type ProbeOptions, type VisualCapture } from "./probe.js";
export { DEFAULT_DEEP_CHECKS, deepCheck, probeOptions, type DeepCheckOptions, type DeepCheckResult, type VisualDiff } from "./deepcheck.js";
