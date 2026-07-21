export type SportCategory = {
  id: string;
  label: string;
  icon: string; // filename in /public/images/sports/
};

export const SPORT_CATEGORIES: SportCategory[] = [
  { id: "swimming", label: "Swimming", icon: "swimming.svg" },
  { id: "hockey", label: "Hockey", icon: "hockey.svg" },
  { id: "skating", label: "Skating", icon: "skating.svg" },
  { id: "basketball", label: "Basketball", icon: "basketball.svg" },
  { id: "volleyball", label: "Volleyball", icon: "volleyball.svg" },
  { id: "badminton", label: "Badminton", icon: "badminton.svg" },
  { id: "squash", label: "Squash", icon: "squash.svg" },
  { id: "pickleball", label: "Pickleball", icon: "pickleball.svg" },
  { id: "tennis", label: "Tennis", icon: "tennis.svg" },
  { id: "soccer", label: "Soccer", icon: "soccer.svg" },
  { id: "gymnastics", label: "Gymnastics", icon: "gymnastics.svg" },
  { id: "fitness", label: "Fitness / Gym", icon: "fitness.svg" },
  { id: "yoga", label: "Yoga", icon: "yoga.svg" },
  { id: "dance", label: "Dance", icon: "dance.svg" },
  { id: "martial_arts", label: "Martial Arts", icon: "martial-arts.svg" },
  { id: "curling", label: "Curling", icon: "curling.svg" },
  { id: "open_gym", label: "Open Gym", icon: "open-gym.svg" },
  { id: "other", label: "Other", icon: "other.svg" },
];

export const SPORT_CATEGORY_IDS = SPORT_CATEGORIES.map((c) => c.id) as [
  string,
  ...string[]
];

export function getSportCategory(id: string): SportCategory | undefined {
  return SPORT_CATEGORIES.find((c) => c.id === id);
}
