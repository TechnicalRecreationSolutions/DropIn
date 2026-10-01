import Link from "next/link";
import PublicNav from "@/components/layout/PublicNav";
import CopyrightYear from "@/components/layout/CopyrightYear";
import Providers from "@/components/layout/Providers";

const FOOTER_LINKS = [
  { title: "Residents", links: [{ href: "/find", label: "Find a centre" }] },
  {
    title: "Product",
    links: [
      { href: "/#how-it-works", label: "How it works" },
      { href: "/#product", label: "Features" },
      { href: "/#pricing", label: "Pricing" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/signup", label: "Get started" },
      { href: "/login", label: "Sign in" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/terms", label: "Terms of Service" },
    ],
  },
];

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <div className="min-h-screen flex flex-col">
        <PublicNav />
        <main className="flex-1">{children}</main>
        <footer className="print:hidden mt-auto border-t border-[#efeff1] bg-white">
          <div className="mx-auto flex max-w-[1200px] flex-col gap-12 px-4 pt-14 pb-12 sm:px-6 xl:px-0">
            <div className="flex flex-col justify-between gap-10 md:flex-row">
              <div className="flex flex-col gap-2">
                <p className="text-xl font-bold tracking-[-0.03em] text-[#111113]">Dropin</p>
                <p className="text-sm text-[#5d5d63]">Visual scheduling for shared recreation space.</p>
              </div>
              <div className="grid grid-cols-2 gap-x-16 gap-y-8 text-sm sm:grid-cols-4">
                {FOOTER_LINKS.map((group) => (
                  <div key={group.title} className="flex flex-col gap-2.5">
                    <p className="font-semibold text-[#111113]">{group.title}</p>
                    {group.links.map((l) => (
                      <Link key={l.href} href={l.href} className="text-[#5d5d63] transition-colors hover:text-[#111113]">
                        {l.label}
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <p className="text-[13px] text-[#5d5d63]">
              © <CopyrightYear /> Dropin. All rights reserved.
            </p>
          </div>
        </footer>
      </div>
    </Providers>
  );
}
