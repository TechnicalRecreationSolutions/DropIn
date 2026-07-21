import type { Metadata } from "next";
import Link from "next/link";
import { Search, MapPin, Calendar, Building2 } from "lucide-react";

export const metadata: Metadata = {
  title: "Dropin — Find Drop-In Recreation Near You",
  description:
    "Discover drop-in sports and recreation across your city. Find lap swim, hockey, pickleball, open gym, and more — all in one place.",
};

const sportCategories = [
  { id: "swimming", label: "Swimming", emoji: "🏊" },
  { id: "hockey", label: "Hockey", emoji: "🏒" },
  { id: "basketball", label: "Basketball", emoji: "🏀" },
  { id: "pickleball", label: "Pickleball", emoji: "🏓" },
  { id: "skating", label: "Skating", emoji: "⛸️" },
  { id: "fitness", label: "Fitness", emoji: "🏋️" },
  { id: "volleyball", label: "Volleyball", emoji: "🏐" },
  { id: "yoga", label: "Yoga", emoji: "🧘" },
];

export default function HomePage() {
  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="bg-gradient-to-br from-blue-600 to-blue-800 text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-4">
            Find drop-in recreation near you
          </h1>
          <p className="text-lg sm:text-xl text-blue-100 mb-10 max-w-2xl mx-auto">
            Lap swim, open hockey, pickleball, yoga — see every available
            session across all local facilities in one place.
          </p>

          {/* Search bar */}
          <div className="flex flex-col sm:flex-row gap-3 max-w-xl mx-auto">
            <div className="flex-1 relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Your city or postal code"
                className="w-full pl-10 pr-4 py-3.5 rounded-xl text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white"
              />
            </div>
            <Link
              href="/search"
              className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-white text-blue-700 font-semibold rounded-xl hover:bg-blue-50 transition-colors shrink-0"
            >
              <Search className="w-4 h-4" />
              Search
            </Link>
          </div>
        </div>
      </section>

      {/* ── Browse by Sport ───────────────────────────────────────────────── */}
      <section className="py-16 sm:py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
            Browse by sport
          </h2>
          <p className="text-gray-600 mb-8">
            Pick an activity and see what&apos;s available this week.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {sportCategories.map((sport) => (
              <Link
                key={sport.id}
                href={`/browse/${sport.id}`}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-100 bg-gray-50 hover:bg-blue-50 hover:border-blue-200 transition-colors group"
              >
                <span className="text-3xl">{sport.emoji}</span>
                <span className="text-xs font-medium text-gray-700 group-hover:text-blue-700 text-center">
                  {sport.label}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <section className="py-16 sm:py-20 bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-12">
            One place for all drop-in recreation
          </h2>
          <div className="grid sm:grid-cols-3 gap-8">
            {[
              {
                icon: Search,
                title: "Search your city",
                desc: "Find every available drop-in session across all local rec centres and facilities.",
              },
              {
                icon: Calendar,
                title: "See the week at a glance",
                desc: "Visual weekly schedules — no more hunting through long lists or PDF timetables.",
              },
              {
                icon: Building2,
                title: "All organizations, one place",
                desc: "City facilities, private clubs, and community centres all in one searchable platform.",
              },
            ].map((item) => (
              <div key={item.title} className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
                  <item.icon className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="font-semibold text-gray-900">{item.title}</h3>
                <p className="text-sm text-gray-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Org CTA ───────────────────────────────────────────────────────── */}
      <section className="py-16 sm:py-20 bg-gray-950 text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">
            Are you a recreation organization?
          </h2>
          <p className="text-gray-400 mb-8">
            Publish a beautiful visual schedule in minutes. Embed it on your
            existing website. Let Dropin handle the discovery.
          </p>
          <Link
            href="/signup"
            className="inline-flex items-center px-8 py-3.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-500 transition-colors"
          >
            List your facility — it&apos;s free
          </Link>
        </div>
      </section>
    </div>
  );
}
