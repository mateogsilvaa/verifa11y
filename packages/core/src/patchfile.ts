// Standard patch output: a unified diff with git headers, applicable with
// `git apply`. Inside a repository, paths are relative to its root: git skips
// any other path silently (and exits 0) when run from a subdirectory.

import { existsSync } from "node:fs";
import path from "node:path";
import { structuredPatch } from "diff";

export interface FileChange {
  /** Path as it should appear in the patch, relative to the repository root. */
  path: string;
  before: string;
  after: string;
}

/** Root of the git work tree that contains `file`, or null. */
export function gitRoot(file: string): string | null {
  let dir = path.dirname(path.resolve(file));
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The command that applies `patchFile`, whose paths come from toPatchPath, from the current directory. */
export function applyCommand(patchFile: string, changedFile: string, cwd = process.cwd()): string {
  const q = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
  const posix = (s: string) => s.split(path.sep).join("/");
  const root = gitRoot(changedFile) ?? cwd;
  if (path.resolve(root) === path.resolve(cwd)) return `git apply ${q(posix(path.relative(cwd, path.resolve(patchFile))))}`;
  return `git -C ${q(posix(root))} apply ${q(posix(path.resolve(patchFile)))}`;
}

export function toPatchPath(file: string, root = gitRoot(file) ?? process.cwd()): string {
  return path.relative(root, path.resolve(file)).split(path.sep).join("/");
}

/** One git-style patch covering every changed file. Unchanged files are skipped. */
export function gitPatch(changes: FileChange[], context = 3): string {
  const out: string[] = [];
  for (const c of changes) {
    if (c.before === c.after) continue;
    const p = structuredPatch(`a/${c.path}`, `b/${c.path}`, c.before, c.after, undefined, undefined, { context });
    out.push(`diff --git a/${c.path} b/${c.path}`);
    out.push(`--- a/${c.path}`);
    out.push(`+++ b/${c.path}`);
    for (const h of p.hunks) {
      out.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
      out.push(...h.lines);
    }
  }
  return out.length ? `${out.join("\n")}\n` : "";
}
