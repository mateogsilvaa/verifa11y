#!/usr/bin/env node
// Generates the images the GitHub page uses, from the same mark and fonts as the website:
//   docs/assets/banner-dark.png, docs/assets/banner-light.png   top of the README (dark and light themes)
//   docs/assets/social-preview.png                              1280x640, upload under Settings > Social preview
//
//   npm run brand:assets
//
// Needs the browser verifa11y already installs (npx verifa11y install-browser).

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs/assets");
const require = createRequire(import.meta.url);
const coreRequire = createRequire(path.join(ROOT, "packages/core/package.json"));
const { chromium } = coreRequire("playwright");

const fontDir = (pkg) => path.join(path.dirname(require.resolve(`${pkg}/package.json`)), "files");
const font = (pkg, file) => pathToFileURL(path.join(fontDir(pkg), file)).href;

const MARK = (color) => `<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true"><rect x="7" y="7" width="50" height="50" rx="15" fill="none" stroke="${color}" stroke-width="4" stroke-dasharray="7.6 6" stroke-linecap="round"/><path d="M21 32.5l8 8 15-17" fill="none" stroke="${color}" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const THEMES = {
  dark: { bg: "#08090a", card: "#111214", line: "rgba(255,255,255,.12)", text: "#f7f8f8", muted: "#9aa0aa", green: "#4ade80", red: "#ff7b6b", dot: "rgba(255,255,255,.07)", code: "#0a0b0c" },
  light: { bg: "#f6f7f4", card: "#ffffff", line: "rgba(8,9,10,.14)", text: "#0e1512", muted: "#4d5a52", green: "#17803f", red: "#b3361f", dot: "rgba(8,9,10,.07)", code: "#f0f2ee" },
};

const css = (t) => `
@font-face { font-family: "Geist"; src: url("${font("@fontsource-variable/geist", "geist-latin-wght-normal.woff2")}"); font-weight: 100 900; }
@font-face { font-family: "Geist Mono"; src: url("${font("@fontsource-variable/geist-mono", "geist-mono-latin-wght-normal.woff2")}"); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }
body { width: var(--w); height: var(--h); background: ${t.bg}; color: ${t.text}; font-family: "Geist", sans-serif; overflow: hidden; position: relative;
  background-image: radial-gradient(${t.dot} 1.2px, transparent 1.6px); background-size: 28px 28px; }
.row { position: absolute; inset: 0; display: flex; align-items: center; justify-content: space-between; padding: var(--pad); gap: 48px; }
.brand { display: flex; align-items: center; gap: 22px; }
.mark { width: var(--mark); height: var(--mark); color: ${t.green}; }
.name { font-weight: 700; font-size: var(--name); letter-spacing: -0.045em; line-height: 1; }
.name b { color: ${t.green}; font-weight: 700; }
.tag { margin-top: var(--tagGap); font-size: var(--tag); line-height: 1.25; letter-spacing: -0.02em; color: ${t.text}; max-width: 18ch; font-weight: 600; }
.sub { margin-top: 14px; font-size: var(--sub); color: ${t.muted}; line-height: 1.45; max-width: 34ch; }
.chips { display: flex; gap: 10px; margin-top: 28px; flex-wrap: wrap; }
.chip { font: 500 20px "Geist Mono", monospace; color: ${t.muted}; border: 1.5px dashed ${t.line}; border-radius: 10px; padding: 7px 13px; }
.card { width: var(--cardW); background: ${t.card}; border: 1px solid ${t.line}; border-radius: 18px; overflow: hidden; box-shadow: 0 30px 60px -30px rgba(0,0,0,.45); flex: none; }
.bar { display: flex; align-items: center; gap: 8px; padding: 14px 18px; border-bottom: 1px solid ${t.line}; font: 500 var(--mono) "Geist Mono", monospace; color: ${t.muted}; }
.bar i { width: 11px; height: 11px; border-radius: 50%; background: ${t.line}; }
.diff { margin: 16px; padding: 14px 16px; background: ${t.code}; border-radius: 10px; font: var(--mono) / 1.7 "Geist Mono", monospace; }
.diff .del { color: ${t.red}; } .diff .add { color: ${t.green}; }
.checks { list-style: none; padding: 0 16px 8px; display: grid; gap: 8px; }
.checks { margin-top: var(--cm); }
.checks li { display: flex; align-items: center; gap: 12px; padding: var(--cp); border: 1px solid ${t.line}; border-radius: 10px; font-size: var(--check); font-weight: 550; }
.checks .ok::before, .checks .no::before { content: ""; width: 20px; height: 20px; border-radius: 50%; flex: none; }
.checks .ok::before { background: ${t.green}; } .checks .no::before { background: ${t.red}; }
.checks .no { border-color: ${t.red}; }
.verdict { margin: 8px 16px 16px; padding: 12px 16px; border-radius: 10px; background: ${t.card}; border: 1.5px solid ${t.red}; color: ${t.red}; font-size: var(--check); font-weight: 650; }
`;

const card = (compact) => `<div class="card">
  <div class="bar"><i></i><i></i><i></i><span>verifa11y verify</span></div>
  ${compact ? "" : `<div class="diff"><div class="del">- &lt;img src="plot-map.png"&gt;</div><div class="add">+ &lt;img src="plot-map.png" alt="plot map"&gt;</div></div>`}
  <ul class="checks"><li class="ok">Violation gone</li><li class="ok">Nothing new on the page</li><li class="no">Nothing hidden or meaningless</li></ul>
  <div class="verdict">Rejected: alt restates the file name</div>
</div>`;

const page = (theme, kind) => {
  const t = THEMES[theme];
  const big = kind === "social";
  const vars = big
    ? "--w:1280px;--h:640px;--pad:72px;--mark:92px;--name:88px;--tag:52px;--tagGap:46px;--sub:26px;--cardW:470px;--mono:17px;--check:21px;--cp:10px 14px;--cm:0px"
    : "--w:1280px;--h:340px;--pad:56px;--mark:64px;--name:64px;--tag:30px;--tagGap:22px;--sub:21px;--cardW:470px;--mono:15px;--check:17px;--cp:7px 12px;--cm:14px";
  const left = big
    ? `<div><div class="brand"><div class="mark">${MARK("currentColor")}</div><div class="name">verifa<b>11</b>y</div></div>
        <div class="tag">Accessibility fixes that prove themselves</div>
        <div class="chips"><span class="chip">HTML</span><span class="chip">WCAG 2.x A/AA</span><span class="chip">axe-core</span><span class="chip">MCP</span></div></div>`
    : `<div><div class="brand"><div class="mark">${MARK("currentColor")}</div><div class="name">verifa<b>11</b>y</div></div>
        <div class="tag">Accessibility fixes that prove themselves</div></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>:root{${vars}}${css(t)}</style></head><body><div class="row">${left}${card(!big)}</div></body></html>`;
};

const jobs = [
  ["banner-dark.png", "dark", "banner", 1280, 340],
  ["banner-light.png", "light", "banner", 1280, 340],
  ["social-preview.png", "dark", "social", 1280, 640],
];

await mkdir(OUT, { recursive: true });
const tmp = await mkdtemp(path.join(os.tmpdir(), "verifa11y-brand-"));
const browser = await chromium.launch();
try {
  for (const [file, theme, kind, w, h] of jobs) {
    const html = path.join(tmp, `${file}.html`);
    await writeFile(html, page(theme, kind));
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: kind === "social" ? 1 : 2 });
    const p = await ctx.newPage();
    await p.goto(pathToFileURL(html).href);
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(OUT, file) });
    await ctx.close();
    console.log(`wrote docs/assets/${file}`);
  }
} finally {
  await browser.close();
  await rm(tmp, { recursive: true, force: true });
}
