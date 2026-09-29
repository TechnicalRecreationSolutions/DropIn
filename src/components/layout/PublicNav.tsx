"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";

/**
 * Top navigation for all public-facing pages.
 * Mobile: hamburger menu with full-screen overlay.
 * Desktop: horizontal link bar with CTA.
 */
export default function PublicNav() {
  const [mobileOpen, setMobileOpen] = useState(false);

  // Mostly aimed at a recreation centre evaluating the product. "Find a centre"
  // is the one resident entry: the opt-in directory that came back on
  // 2026-09-16 (docs/PLAN.md). The old "Find Activities" / "Browse Sports"
  // entries pointed at the aggregator pages deleted in ef0a035.
  const navLinks = [
    { href: "/find", label: "Find a centre" },
    { href: "/#how-it-works", label: "How it works" },
    { href: "/#features", label: "Features" },
    { href: "/#pricing", label: "Pricing" },
    { href: "/#faq", label: "FAQ" },
  ];

  return (
    <header className="print:hidden sticky top-0 z-50 border-b border-[#efeff1] bg-white/90 backdrop-blur-sm">
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-12">
        <div className="flex h-[72px] items-center justify-between">
          {/* Logo */}
          <Link href="/" className="text-xl font-bold tracking-[-0.03em] text-[#111113]">
            Dropin
          </Link>

          {/* Desktop nav */}
          <nav aria-label="Main" className="hidden items-center gap-9 md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-[#5d5d63] transition-colors hover:text-[#111113]"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Desktop CTA */}
          <div className="hidden items-center gap-2 md:flex">
            <Link
              href="/login"
              className="px-4 py-3 text-sm font-semibold text-[#111113] hover:text-[#0066cc]"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex h-10 items-center rounded-full bg-[#111113] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#2a2a2e]"
            >
              Start free trial
            </Link>
          </div>

          {/* Mobile hamburger — min 44px tap target */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="rounded-lg p-2 text-[#111113] transition-colors hover:bg-[#f4f4f5] md:hidden"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile menu overlay */}
      {mobileOpen && (
        <div className="border-t border-[#efeff1] bg-white md:hidden">
          <nav className="px-4 py-4 flex flex-col gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="block rounded-lg px-2 py-3 text-base font-medium text-[#111113] transition-colors hover:bg-[#f4f4f5]"
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-4 flex flex-col gap-2 border-t border-[#efeff1] pt-4">
              <Link
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="block rounded-full border border-[#d9d9de] px-2 py-3 text-center text-base font-semibold text-[#111113]"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                onClick={() => setMobileOpen(false)}
                className="block rounded-full bg-[#111113] px-4 py-3 text-center text-base font-semibold text-white transition-colors hover:bg-[#2a2a2e]"
              >
                Start free trial
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
