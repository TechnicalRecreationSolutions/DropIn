import Link from "next/link";
import Providers from "@/components/layout/Providers";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <div className="min-h-screen bg-background flex flex-col">
        <header className="px-4 py-5">
          <Link href="/" className="inline-flex items-center text-lg font-bold text-foreground">
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
