import Link from "next/link";
import { CalendarDays } from "lucide-react";
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
        <footer className="bg-gray-950 text-muted-foreground/70 py-12 mt-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col md:flex-row justify-between gap-6">
              <div>
                <p className="flex items-center gap-2 text-white font-bold mb-1">
                  <CalendarDays className="w-4 h-4" />
                  Dropin
                </p>
                <p className="text-sm">
                  Drop-in schedules for recreation centres.
                </p>
              </div>
              <div className="flex gap-8 text-sm">
                <div>
                  <p className="text-white font-medium mb-2">Product</p>
                  <ul className="space-y-1">
                    <li><Link href="/#features" className="hover:text-white transition-colors">Features</Link></li>
                    <li><Link href="/#product" className="hover:text-white transition-colors">Preview</Link></li>
                    <li><Link href="/#pricing" className="hover:text-white transition-colors">Pricing</Link></li>
                    <li><Link href="/#faq" className="hover:text-white transition-colors">FAQ</Link></li>
                  </ul>
                </div>
                <div>
                  <p className="text-white font-medium mb-2">Account</p>
                  <ul className="space-y-1">
                    <li><Link href="/signup" className="hover:text-white transition-colors">Get Started</Link></li>
                    <li><Link href="/login" className="hover:text-white transition-colors">Sign In</Link></li>
                  </ul>
                </div>
                <div>
                  <p className="text-white font-medium mb-2">Legal</p>
                  <ul className="space-y-1">
                    <li><Link href="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link></li>
                    <li><Link href="/terms" className="hover:text-white transition-colors">Terms of Service</Link></li>
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
