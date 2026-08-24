import Link from "next/link";
import { Clock, ArrowRight } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";

/**
 * Placeholder — there's no cross-schedule session list yet. Sessions are
 * currently managed per-schedule inside the command centre, not as an
 * org-wide log. This page exists so the sidebar's "Sessions" menu item
 * resolves to something honest instead of a 404. See
 * docs/RESUME-layout-rework.md for what a real version needs.
 */
export default async function SessionsPage() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
        <Clock className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <h1 className="font-medium text-gray-900 mb-1">Session log — coming soon</h1>
        <p className="text-sm text-gray-500 mb-4 max-w-sm mx-auto">
          There&apos;s no org-wide session list yet. Sessions are managed inside
          each schedule&apos;s command centre for now.
        </p>
        <Link
          href="/dashboard/schedule"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          Open a schedule
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
