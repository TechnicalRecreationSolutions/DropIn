import Link from "next/link";
import PublicNav from "@/components/layout/PublicNav";
import CopyrightYear from "@/components/layout/CopyrightYear";
import Providers from "@/components/layout/Providers";

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
        <footer className="bg-gray-950 text-gray-400 py-12 mt-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col md:flex-row justify-between gap-6">
              <div>
                <p className="text-white font-bold mb-1">Dropin</p>
                <p className="text-sm">
                  The easiest way to discover drop-in recreation.
                </p>
              </div>
              <div className="flex gap-8 text-sm">
                <div>
                  <p className="text-white font-medium mb-2">Discover</p>
                  <ul className="space-y-1">
                    <li><Link href="/search" className="hover:text-white transition-colors">Find Activities</Link></li>
                    <li><Link href="/browse" className="hover:text-white transition-colors">Browse Sports</Link></li>
                  </ul>
                </div>
                <div>
                  <p className="text-white font-medium mb-2">Organizations</p>
                  <ul className="space-y-1">
                    <li><Link href="/signup" className="hover:text-white transition-colors">List Your Facility</Link></li>
                    <li><Link href="/login" className="hover:text-white transition-colors">Sign In</Link></li>
                  </ul>
                </div>
              </div>
            </div>
            <div className="mt-8 pt-6 border-t border-gray-800 text-xs">
              © <CopyrightYear /> Dropin. All rights reserved.
            </div>
          </div>
        </footer>
      </div>
    </Providers>
  );
}
