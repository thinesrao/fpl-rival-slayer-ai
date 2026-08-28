// Node module-customization hook (built-in API, no new dependency) that lets
// `node --experimental-strip-types` resolve this repo's "@/*" tsconfig path
// alias and extensionless TypeScript specifiers, matching how the Next.js
// bundler already resolves them at build time.
//
// Registered via `--import ./scripts/register-ts-paths.mjs` on the `backtest`
// npm script (see package.json). Node's own ESM resolver requires explicit
// file extensions and has no concept of tsconfig "paths", so without this
// hook `node scripts/backtest.ts` cannot import anything under `src/`.

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const rootDir = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const candidateSuffixes = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveOnDisk(basePath) {
  for (const suffix of candidateSuffixes) {
    const candidate = basePath + suffix;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const resolved = resolveOnDisk(path.join(rootDir, "src", specifier.slice(2)));
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
  } else if (specifier.startsWith(".") && context.parentURL) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const resolved = resolveOnDisk(path.resolve(parentDir, specifier));
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
