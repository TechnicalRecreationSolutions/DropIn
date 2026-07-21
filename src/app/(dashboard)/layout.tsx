import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/session";
import DashboardSidebar from "@/components/layout/DashboardSidebar";
import DashboardBottomNav from "@/components/layout/DashboardBottomNav";
import DashboardTopbar from "@/components/layout/DashboardTopbar";
import Providers from "@/components/layout/Providers";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const orgContext = await getOrgContext();

  if (!orgContext) {
    redirect("/login");
  }

  return (
    <Providers>
      <div className="flex min-h-screen bg-gray-50">
        <DashboardSidebar orgName={orgContext.org.name} />
        <div className="flex-1 flex flex-col min-w-0">
          <DashboardTopbar org={orgContext.org} membership={orgContext.membership} />
          {/* pb-20 adds bottom padding on mobile so content isn't hidden behind the tab bar */}
          <main className="flex-1 p-4 sm:p-6 lg:p-8 pb-24 lg:pb-8">
            {children}
          </main>
        </div>
        <DashboardBottomNav />
      </div>
    </Providers>
  );
}
