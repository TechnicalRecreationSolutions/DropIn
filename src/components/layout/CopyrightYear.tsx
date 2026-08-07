import { cacheLife } from "next/cache";

/**
 * The current year, for the footer copyright line.
 *
 * Reading the clock during a prerender is not allowed under Cache Components —
 * a static shell has no "now". Marking it as cached gives the value a defined
 * lifetime instead, so the shell can be prerendered and the year still rolls
 * over on its own without a deploy.
 */
export default async function CopyrightYear() {
  "use cache";
  cacheLife("days");

  return <>{new Date().getFullYear()}</>;
}
