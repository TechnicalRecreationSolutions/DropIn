export type SportCategory = {
  id: string;
  label: string;
  icon: string; // emoji used in UI
};

export const SPORT_CATEGORIES: SportCategory[] = [
  { id: "swimming", label: "Swimming", icon: "🏊" },
  { id: "hockey", label: "Hockey", icon: "🏒" },
  { id: "skating", label: "Skating", icon: "⛸️" },
  { id: "basketball", label: "Basketball", icon: "🏀" },
  { id: "volleyball", label: "Volleyball", icon: "🏐" },
  { id: "badminton", label: "Badminton", icon: "🏸" },
  { id: "squash", label: "Squash", icon: "🎾" },
  { id: "pickleball", label: "Pickleball", icon: "🏓" },
  { id: "tennis", label: "Tennis", icon: "🎾" },
  { id: "soccer", label: "Soccer", icon: "⚽" },
  { id: "gymnastics", label: "Gymnastics", icon: "🤸" },
  { id: "fitness", label: "Fitness / Gym", icon: "🏋️" },
  { id: "yoga", label: "Yoga", icon: "🧘" },
  { id: "dance", label: "Dance", icon: "💃" },
  { id: "martial_arts", label: "Martial Arts", icon: "🥋" },
  { id: "curling", label: "Curling", icon: "🥌" },
  { id: "open_gym", label: "Open Gym", icon: "🏟️" },
  { id: "other", label: "Other", icon: "🎯" },
];

export const SPORT_CATEGORY_IDS = SPORT_CATEGORIES.map((c) => c.id) as [
  string,
  ...string[]
];

export function getSportCategory(id: string): SportCategory | undefined {
  return SPORT_CATEGORIES.find((c) => c.id === id);
}
