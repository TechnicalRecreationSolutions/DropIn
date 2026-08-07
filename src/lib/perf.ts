/**
 * Lightweight server-side timing instrumentation.
 *
 * Gated behind the PERF_DEBUG env var so it costs nothing (not even a
 * Date.now() call) in normal dev or production runs. Enable with:
 *
 *   PERF_DEBUG=1 npm run dev
 *
 * Output goes to the dev server console as:
 *   [perf] /dashboard  getUser=182ms  membership=94ms  total=281ms
 */

const ENABLED = process.env.PERF_DEBUG === "1";

export type PerfTimer = {
  /**
   * Time a single awaited step and record it under `label`.
   * Accepts any thenable so Supabase's PostgrestBuilder can be passed directly.
   */
  step<T>(label: string, fn: () => PromiseLike<T>): Promise<T>;
  /** Emit the collected timings for this scope. */
  end(): void;
};

const NOOP: PerfTimer = {
  step: async (_label, fn) => fn(),
  end: () => {},
};

export function perf(scope: string): PerfTimer {
  if (!ENABLED) return NOOP;

  const marks: string[] = [];
  const started = performance.now();

  return {
    async step(label, fn) {
      const t0 = performance.now();
      try {
        return await fn();
      } finally {
        marks.push(`${label}=${Math.round(performance.now() - t0)}ms`);
      }
    },
    end() {
      const total = Math.round(performance.now() - started);
      console.log(`[perf] ${scope}  ${marks.join("  ")}  total=${total}ms`);
    },
  };
}
