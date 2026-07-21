import Link from "next/link";
import { MapPin } from "lucide-react";
import Providers from "@/components/layout/Providers";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="px-4 py-5">
          <Link href="/" className="inline-flex items-center gap-2 text-blue-600 font-bold text-lg">
            <MapPin className="w-5 h-5" />
            Dropin
          </Link>
        </header>
        <main className="flex-1 flex items-center justify-center px-4 pb-12">
          {children}
        </main>
      </div>
    </Providers>
  );
}
