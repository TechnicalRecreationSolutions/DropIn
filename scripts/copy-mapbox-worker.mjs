/**
 * Copies mapbox-gl's CSP-build worker into public/, so it is served from this
 * origin and the CSP can keep `worker-src 'self'` (see src/lib/security/csp.ts).
 *
 * Runs before `dev` and `build` (package.json), so the served worker always
 * matches the installed mapbox-gl — a stale worker against a newer main bundle
 * fails at runtime with a message-format error. The copy is gitignored.
 */
import fs from "fs";

const from = new URL("../node_modules/mapbox-gl/dist/mapbox-gl-csp-worker.js", import.meta.url);
const to = new URL("../public/mapbox-gl-csp-worker.js", import.meta.url);

fs.copyFileSync(from, to);
