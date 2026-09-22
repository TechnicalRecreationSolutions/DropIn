/**
 * Node resolve hook that teaches `node --experimental-strip-types` the `@/`
 * path alias from tsconfig.json.
 *
 * Exists so a harness can import the app's real TypeScript modules — the
 * actual src/lib/rrule/expand.ts, not a transcription of it — and exercise
 * pure logic without a database, a server or a build step. A reimplementation
 * in the harness would test the harness.
 *
 * Only for logic-only checks. Anything that touches Supabase, HTTP or React
 * still goes through the normal harness path against a running server.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const SRC = path.resolve(fileURLToPath(import.meta.url), "../../../src");

const ROOT = path.resolve(SRC, "..");

/**
 * Packages whose `main` is a bundle Node cannot lex named exports from, but
 * which ship a real ESM build under `module`. Node ignores `module`; the
 * bundler the app actually builds with does not, so pointing at it here is
 * what makes the harness load the same code the app runs.
 *
 * Without this, importing expand.ts fails with "The requested module 'rrule'
 * does not provide an export named 'RRule'" — a packaging artefact, nothing
 * to do with the code under test.
 */
const ESM_BUILDS = {
  rrule: "node_modules/rrule/dist/esm/index.js",
};

/** tsconfig's "@/*" -> "src/*", plus the extension resolution TypeScript does
 *  implicitly and Node does not. */
export async function resolve(specifier, context, nextResolve) {
  if (ESM_BUILDS[specifier]) {
    return {
      url: pathToFileURL(path.join(ROOT, ESM_BUILDS[specifier])).href,
      shortCircuit: true,
    };
  }

  if (specifier.startsWith("@/")) {
    const hit = firstFile(path.join(SRC, specifier.slice(2)), [".ts", ".tsx"]);
    if (hit) return { url: hit, shortCircuit: true };
    return nextResolve(specifier, context);
  }

  // Extensionless relative imports. TypeScript-authored ESM builds emit them
  // (rrule's does), and Node's ESM resolver requires the extension — so
  // without this the package resolves and then immediately fails on its own
  // first internal import.
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    const hit = firstFile(base, [".js", ".mjs", ".ts"]);
    if (hit) return { url: hit, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}

/** First of `base`, `base + ext`, or `base/index + ext` that is a real file. */
function firstFile(base, extensions) {
  const candidates = [
    base,
    ...extensions.map((e) => `${base}${e}`),
    ...extensions.map((e) => path.join(base, `index${e}`)),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return pathToFileURL(candidate).href;
    }
  }
  return null;
}
