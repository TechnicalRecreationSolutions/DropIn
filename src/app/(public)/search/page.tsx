import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import SearchPageClient from "./SearchPageClient";
import { SPORT_CATEGORIES } from "@/lib/utils/sport-categories";

export const metadata: Metadata = {
  title: "Find Drop-In Recreation",
  description: "Search facilities offering drop-in sports and recreation near you.",
};

interface SearchPageProps {
  searchParams: Promise<{ q?: string; sport?: string; city?: string }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q, sport, city } = await searchParams;
  const supabase = await createClient();

  // Fetch published facilities with their published schedule sport categories
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("facilities")
    .select("id, name, slug, city, province, description, lat, lng, schedule_groups(sport_category)")
    .eq("is_published", true)
    .eq("schedule_groups.is_published", true);

  if (city) query = query.ilike("city", `%${city}%`);
  if (q) query = query.ilike("name", `%${q}%`);

  const { data: raw } = await query.order("name").limit(100);

  type RawFacility = {
    id: string; name: string; slug: string; city: string; province: string;
    description: string | null; lat: number | null; lng: number | null;
    schedule_groups: { sport_category: string }[];
  };

  const facilities = ((raw as RawFacility[]) ?? [])
    .map((f) => {
      const sportCategories = [...new Set(f.schedule_groups.map((sg) => sg.sport_category))];
      return {
        id: f.id,
        name: f.name,
        slug: f.slug,
        city: f.city,
        province: f.province,
        description: f.description,
        lat: f.lat,
        lng: f.lng,
        sport_categories: sportCategories,
        schedule_count: f.schedule_groups.length,
      };
    })
    .filter((f) => !sport || f.sport_categories.includes(sport));

  return (
    <SearchPageClient
      initialFacilities={facilities}
      initialQuery={q ?? ""}
      initialSport={sport ?? ""}
      initialCity={city ?? ""}
      sportCategories={SPORT_CATEGORIES}
    />
  );
}
