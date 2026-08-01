import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSportCategory, SPORT_CATEGORIES } from "@/lib/utils/sport-categories";
import FacilityCard from "@/components/discovery/FacilityCard";

interface PageProps {
  params: Promise<{ sport: string }>;
}

export async function generateStaticParams() {
  return SPORT_CATEGORIES.map((cat) => ({ sport: cat.id }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { sport } = await params;
  const category = getSportCategory(sport);
  if (!category) return { title: "Not Found" };
  return {
    title: `Drop-In ${category.label}`,
    description: `Find drop-in ${category.label.toLowerCase()} facilities and schedules near you on Dropin.`,
  };
}

export default async function BrowseSportPage({ params }: PageProps) {
  const { sport } = await params;
  const category = getSportCategory(sport);
  if (!category) notFound();

  const supabase = await createClient();

  type RawFacility = {
    id: string; name: string; slug: string; city: string;
    province: string; description: string | null;
    schedule_groups: { sport_category: string }[];
  };

  // Get facilities that have at least one published schedule in this sport
  // Relational select — cast needed until Supabase CLI generates types with FK relations
  const { data: raw } = await supabase
    .from("facilities")
    .select("id, name, slug, city, province, description, schedule_groups(sport_category)")
    .eq("is_published", true)
    .eq("schedule_groups.is_published", true)
    .eq("schedule_groups.sport_category", sport)
    .order("name")
    .limit(100) as unknown as { data: RawFacility[] | null };

  const facilities = (raw ?? [])
    .filter((f) => f.schedule_groups.length > 0)
    .map((f) => ({
      id: f.id,
      name: f.name,
      slug: f.slug,
      city: f.city,
      province: f.province,
      description: f.description,
      sport_categories: [...new Set(f.schedule_groups.map((sg) => sg.sport_category))],
      schedule_count: f.schedule_groups.length,
    }));

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
          <Link href="/search" className="hover:text-gray-700 transition-colors">All sports</Link>
          <span>›</span>
          <span className="text-gray-900">{category.label}</span>
        </div>
        <h1 className="text-3xl font-bold text-gray-900">
          {category.icon} Drop-In {category.label}
        </h1>
        <p className="text-gray-500 mt-2">
          {facilities.length} facilit{facilities.length !== 1 ? "ies" : "y"} offering drop-in {category.label.toLowerCase()}
        </p>
      </div>

      {/* Sport category nav */}
      <div className="flex gap-2 overflow-x-auto pb-3 mb-8 -mx-1 px-1">
        {SPORT_CATEGORIES.map((cat) => (
          <Link
            key={cat.id}
            href={`/browse/${cat.id}`}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              cat.id === sport
                ? "bg-blue-600 border-blue-600 text-white"
                : "border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600"
            }`}
          >
            <span>{cat.icon}</span>
            <span>{cat.label}</span>
          </Link>
        ))}
      </div>

      {/* Results */}
      {facilities.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-4xl mb-4">{category.icon}</p>
          <p className="font-medium">No {category.label.toLowerCase()} facilities listed yet</p>
          <p className="text-sm mt-1">Check back soon or
            <Link href="/signup" className="text-blue-600 hover:underline ml-1">list your facility</Link>.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {facilities.map((facility) => (
            <FacilityCard key={facility.id} facility={facility} />
          ))}
        </div>
      )}
    </div>
  );
}
