const SPORT_COLORS: Record<string, string> = {
  swimming:    "bg-blue-100 border-blue-400 text-blue-900",
  hockey:      "bg-slate-100 border-slate-400 text-slate-900",
  skating:     "bg-cyan-100 border-cyan-400 text-cyan-900",
  basketball:  "bg-orange-100 border-orange-400 text-orange-900",
  volleyball:  "bg-yellow-100 border-yellow-400 text-yellow-900",
  badminton:   "bg-green-100 border-green-400 text-green-900",
  pickleball:  "bg-lime-100 border-lime-400 text-lime-900",
  tennis:      "bg-emerald-100 border-emerald-400 text-emerald-900",
  soccer:      "bg-green-100 border-green-500 text-green-900",
  fitness:     "bg-purple-100 border-purple-400 text-purple-900",
  yoga:        "bg-pink-100 border-pink-400 text-pink-900",
  dance:       "bg-fuchsia-100 border-fuchsia-400 text-fuchsia-900",
  open_gym:    "bg-gray-100 border-gray-400 text-gray-900",
  curling:     "bg-indigo-100 border-indigo-400 text-indigo-900",
  default:     "bg-blue-100 border-blue-300 text-blue-900",
};

export function getSportColor(sportCategory: string): string {
  return SPORT_COLORS[sportCategory] ?? SPORT_COLORS.default;
}
