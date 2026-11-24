#!/usr/bin/env node
// Committed entry point. npm links executables at install time, before a clone
// is built, and drops the ones that do not exist yet: this file always exists.
// Keep it plain: it must also parse on Node.js versions that are too old.
import { existsSync } from "node:fs";

const target = new URL("../dist/cli.js", import.meta.url);
if (Number(process.versions.node.split(".")[0]) < 20) {
  console.error("verifa11y: needs Node.js 20 or later; this is " + process.versions.node + ".");
  process.exitCode = 1;
} else if (!existsSync(target)) {
  console.error("verifa11y: this is a source checkout that has not been built. Run: npm ci && npm run build");
  process.exitCode = 1;
} else {
  await import(target.href);
}
