import type { FacilityMapPayload } from "@/hooks/useFacilityMap";
import type { ExpandedSession, SessionTag } from "@/types/schedule.types";

/**
 * The sample centre behind the hero's live widget.
 *
 * Unlike the rest of the landing page, which draws hand-made copies of the
 * product, the hero runs the real public widget components — header, view
 * toggle, filters, every view, the session popup and the floorplan. Only the
 * data is invented, and it lives here: seven spaces a visitor can switch
 * between, each a weekly pattern expanded into `ExpandedSession`s for whatever
 * week is on screen, so the demo is always "this week" and the week arrows work.
 *
 * The pattern agrees with the other samples on the page: the swim club holds
 * lanes 1–3 on a Tuesday evening, Saturday morning in the gym is youth
 * basketball, pickleball and a birthday rental, Monday morning in the studios
 * is yoga, spin and a hall rental.
 *
 * Two product rules the data keeps:
 *  - Lane swim is recorded as what the public is shown once a rental has taken
 *    its lanes (the residual rule), so it appears split around the club.
 *  - A reservation is shown the way a patron sees one: named "Reserved", with
 *    no template, tags or description (migration 046's redaction).
 *
 * Ids are not UUIDs on purpose, so nothing here can be mistaken for, or
 * written against, a real row.
 */

export const DEMO_ORG_ID = "demo-org";

export interface DemoScope {
  id: string;
  label: string;
  context: string;
  facilityId: string;
  facilityName: string;
  departmentName: string;
  map: FacilityMapPayload;
}

// ---------------------------------------------------------------------------
// Spaces and floor maps
// ---------------------------------------------------------------------------

interface DemoSpace {
  id: string;
  name: string;
  zone: string | null;
  order: number;
  capacity: number | null;
  /** Where the space sits on the floor map, as fractions of the canvas. */
  rect: { x: number; y: number; width: number; height: number };
  preset: string;
  /** Lanes of one pool share an outer rect and a group (migration 018). */
  group?: { id: string; lane: number };
}

const POOL_RECT = { x: 0.03, y: 0.1, width: 0.55, height: 0.8 };

const POOL_SPACES: DemoSpace[] = [
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `lane-${i + 1}`,
    name: `Lane ${i + 1}`,
    zone: "Main pool",
    order: i + 1,
    capacity: 8,
    rect: POOL_RECT,
    preset: "pool-8lane-25m",
    group: { id: "main-pool", lane: i },
  })),
  {
    id: "leisure",
    name: "Leisure pool",
    zone: "Leisure",
    order: 9,
    capacity: 40,
    rect: { x: 0.62, y: 0.1, width: 0.35, height: 0.5 },
    preset: "pool-leisure",
  },
];

const GYM_SPACES: DemoSpace[] = [1, 2, 3].map((n) => ({
  id: `court-${n}`,
  name: `Court ${n}`,
  zone: null,
  order: n,
  capacity: null,
  rect: { x: 0.05 + (n - 1) * 0.31, y: 0.14, width: 0.28, height: 0.72 },
  preset: "gym-floor",
}));

const STUDIO_SPACES: DemoSpace[] = [
  {
    id: "studio-a",
    name: "Studio A",
    rect: { x: 0.04, y: 0.08, width: 0.3, height: 0.4 },
    preset: "generic-studio",
  },
  {
    id: "studio-b",
    name: "Studio B",
    rect: { x: 0.37, y: 0.08, width: 0.26, height: 0.4 },
    preset: "generic-studio",
  },
  {
    id: "cycle",
    name: "Cycle studio",
    rect: { x: 0.66, y: 0.08, width: 0.3, height: 0.4 },
    preset: "generic-small",
  },
  {
    id: "hall",
    name: "Hall",
    rect: { x: 0.04, y: 0.54, width: 0.92, height: 0.38 },
    preset: "generic-large",
  },
].map((s, i) => ({ ...s, zone: null, order: i + 1, capacity: null }));

/** An outdoor sport court: two fixed halves, lined for basketball. */
const SPORT_COURT_SPACES: DemoSpace[] = ["A", "B"].map((letter, i) => ({
  id: `sport-${letter.toLowerCase()}`,
  name: `Court ${letter}`,
  zone: null,
  order: i + 1,
  capacity: null,
  rect: { x: 0.03 + i * 0.49, y: 0.1, width: 0.45, height: 0.8 },
  preset: "court-basketball",
}));

/** A twin-pad arena: two sheets of ice, each booked on its own. */
const ARENA_SPACES: DemoSpace[] = [1, 2].map((n) => ({
  id: `rink-${n}`,
  name: `Rink ${n}`,
  zone: null,
  order: n,
  capacity: null,
  rect: { x: 0.04, y: n === 1 ? 0.05 : 0.53, width: 0.92, height: 0.42 },
  preset: "rink-hockey",
}));

const FIELD_SPACES: DemoSpace[] = [
  {
    id: "field-1",
    name: "Field 1",
    zone: null,
    order: 1,
    capacity: null,
    rect: { x: 0.03, y: 0.08, width: 0.6, height: 0.84 },
    preset: "field-soccer",
  },
  {
    id: "field-2",
    name: "Field 2",
    zone: null,
    order: 2,
    capacity: null,
    rect: { x: 0.67, y: 0.08, width: 0.3, height: 0.46 },
    preset: "field-soccer",
  },
];

const RACQUET_SPACES: DemoSpace[] = [
  ...[1, 2].map((n) => ({
    id: `tennis-${n}`,
    name: `Tennis ${n}`,
    rect: { x: 0.03, y: n === 1 ? 0.06 : 0.53, width: 0.56, height: 0.41 },
    preset: "court-tennis",
  })),
  ...[1, 2, 3, 4].map((n) => ({
    id: `pickle-${n}`,
    name: `Pickleball ${n}`,
    rect: {
      x: n % 2 ? 0.63 : 0.815,
      y: n <= 2 ? 0.06 : 0.53,
      width: 0.165,
      height: 0.41,
    },
    preset: "court-pickleball",
  })),
].map((s, i) => ({ ...s, zone: null, order: i + 1, capacity: null }));

const SPACES_BY_ID = new Map(
  [
    ...POOL_SPACES,
    ...GYM_SPACES,
    ...STUDIO_SPACES,
    ...SPORT_COURT_SPACES,
    ...ARENA_SPACES,
    ...FIELD_SPACES,
    ...RACQUET_SPACES,
  ].map((s) => [s.id, s]),
);

const STAMP = "2026-01-01T00:00:00.000Z";

function mapPayload(
  facilityId: string,
  width: number,
  height: number,
  spaces: DemoSpace[],
): FacilityMapPayload {
  const mapId = `${facilityId}-map`;
  return {
    facilityMap: {
      id: mapId,
      org_id: DEMO_ORG_ID,
      facility_id: facilityId,
      name: "Main floor",
      canvas_width: width,
      canvas_height: height,
      is_published: true,
      created_at: STAMP,
      updated_at: STAMP,
    },
    hotspots: spaces.map((s) => ({
      id: `${s.id}-hotspot`,
      org_id: DEMO_ORG_ID,
      facility_map_id: mapId,
      space_id: s.id,
      shape: "rect" as const,
      ...s.rect,
      rotation: 0,
      label: s.name,
      group_id: s.group?.id ?? null,
      lane_index: s.group?.lane ?? null,
      preset_key: s.preset,
      created_at: STAMP,
      updated_at: STAMP,
      spaceName: s.name,
      spaceCapacity: s.capacity,
    })),
    contextElements: [],
  };
}

export const DEMO_SCOPES: DemoScope[] = [
  {
    id: "pool",
    label: "Pool",
    context: "Sample Aquatic Centre › Aquatics",
    facilityId: "demo-aquatic-centre",
    facilityName: "Sample Aquatic Centre",
    departmentName: "Aquatics",
    map: mapPayload("demo-aquatic-centre", 42, 24, POOL_SPACES),
  },
  {
    id: "gym",
    label: "Gym",
    context: "Sample Community Centre › Gymnasium",
    facilityId: "demo-community-centre",
    facilityName: "Sample Community Centre",
    departmentName: "Gymnasium",
    map: mapPayload("demo-community-centre", 42, 24, GYM_SPACES),
  },
  {
    id: "sport-court",
    label: "Multi-sport court",
    context: "Sample Community Centre › Outdoor courts",
    facilityId: "demo-community-centre-outdoor",
    facilityName: "Sample Community Centre",
    departmentName: "Outdoor courts",
    map: mapPayload(
      "demo-community-centre-outdoor",
      64,
      24,
      SPORT_COURT_SPACES,
    ),
  },
  {
    id: "arena",
    label: "Arena",
    context: "Sample Arena › Ice",
    facilityId: "demo-arena",
    facilityName: "Sample Arena",
    departmentName: "Ice",
    map: mapPayload("demo-arena", 64, 60, ARENA_SPACES),
  },
  {
    id: "field",
    label: "Soccer field",
    context: "Sample Sports Park › Fields",
    facilityId: "demo-sports-park",
    facilityName: "Sample Sports Park",
    departmentName: "Fields",
    map: mapPayload("demo-sports-park", 170, 80, FIELD_SPACES),
  },
  {
    id: "racquets",
    label: "Racquets",
    context: "Sample Racquet Centre › Courts",
    facilityId: "demo-racquet-centre",
    facilityName: "Sample Racquet Centre",
    departmentName: "Courts",
    map: mapPayload("demo-racquet-centre", 44, 28, RACQUET_SPACES),
  },
  {
    id: "studios",
    label: "Studios",
    context: "Sample Community Centre › Fitness",
    facilityId: "demo-community-centre-fitness",
    facilityName: "Sample Community Centre",
    departmentName: "Fitness",
    map: mapPayload("demo-community-centre-fitness", 36, 24, STUDIO_SPACES),
  },
];

// ---------------------------------------------------------------------------
// The weekly pattern
// ---------------------------------------------------------------------------

const tag = (id: string, label: string, color: string): SessionTag => ({
  id,
  label,
  color,
});
const TAGS = {
  allAges: tag("all-ages", "All ages", "#0f766e"),
  adult: tag("adult", "Adult", "#475569"),
  shallow: tag("shallow", "Shallow water", "#0891b2"),
  youth: tag("youth", "Youth", "#9333ea"),
  seniors: tag("seniors", "55+", "#b45309"),
  beginner: tag("beginner", "Beginner friendly", "#15803d"),
};

interface Activity {
  name: string;
  color: string | null;
  kind: ExpandedSession["occupancyKind"];
  sport: string;
  cost: number;
  age: string | null;
  level: string | null;
  tags: SessionTag[];
  description: string | null;
}

function activity(
  name: string,
  color: string,
  sport: string,
  extra: Partial<Omit<Activity, "name" | "color" | "sport">> = {},
): Activity {
  return {
    name,
    color,
    kind: "drop_in",
    sport,
    cost: 0,
    age: null,
    level: null,
    tags: [],
    description: null,
    ...extra,
  };
}

const RESERVED: Activity = {
  name: "Reserved",
  color: null,
  kind: "rental",
  sport: "other",
  cost: 0,
  age: null,
  level: null,
  tags: [],
  description: null,
};

const A = {
  laneSwim: activity("Lane swim", "#0066cc", "swimming", {
    cost: 650,
    age: "Adult",
    tags: [TAGS.adult],
    description:
      "Lengths only. Lanes are marked slow, medium and fast; pick the one that fits and pass on the left.",
  }),
  aquafit: activity("Aquafit", "#0891b2", "swimming", {
    cost: 850,
    age: "Adult",
    level: "All levels",
    tags: [TAGS.shallow, TAGS.beginner],
    description:
      "A low-impact workout in chest-deep water, led from the deck. No swimming needed.",
  }),
  lessons: activity("Swim lessons", "#db2777", "swimming", {
    kind: "program",
    age: "Children",
    tags: [TAGS.youth],
    description:
      "Registered lessons. The lanes they use are not part of lane swim while they run.",
  }),
  tots: activity("Parent and tot swim", "#ea580c", "swimming", {
    cost: 500,
    age: "Under 6 with an adult",
    tags: [TAGS.shallow],
    description:
      "Warm, shallow water and toys out. One adult in the water per two children.",
  }),
  publicSwim: activity("Public swim", "#16a34a", "swimming", {
    cost: 650,
    tags: [TAGS.allAges],
    description:
      "Everyone welcome. Children under 8 need an adult within arm's reach.",
  }),
  familySwim: activity("Family swim", "#ea580c", "swimming", {
    cost: 500,
    tags: [TAGS.allAges],
    description:
      "Pool toys and the rope swing are out. Children must come with an adult.",
  }),
  youthBasketball: activity("Youth basketball", "#9333ea", "basketball", {
    age: "12–17",
    tags: [TAGS.youth],
    description:
      "Pickup games for teens. Bring a water bottle; balls are provided.",
  }),
  adultBasketball: activity("Adult basketball", "#7c3aed", "basketball", {
    cost: 600,
    age: "Adult",
    tags: [TAGS.adult],
    description:
      "Full-court pickup. Teams are picked at the start of each hour.",
  }),
  pickleball: activity("Pickleball", "#ea580c", "pickleball", {
    cost: 500,
    level: "All levels",
    tags: [TAGS.beginner],
    description:
      "Paddles and balls at the front desk. Rotate in by putting your paddle on the rack.",
  }),
  volleyball: activity("Drop-in volleyball", "#16a34a", "volleyball", {
    cost: 600,
    age: "Adult",
    tags: [TAGS.adult],
    description:
      "Nets go up across all three courts. Mixed teams, friendly pace.",
  }),
  dropInGym: activity("Drop-in gym", "#0066cc", "other", {
    tags: [TAGS.allAges],
    description:
      "The whole floor, any sport. Staff hand out equipment at the desk.",
  }),
  seniorsWalk: activity("Indoor walking", "#b45309", "other", {
    age: "55+",
    tags: [TAGS.seniors],
    description: "Laps of the gym at your own pace, with a stretch to finish.",
  }),
  yoga: activity("Yoga", "#16a34a", "fitness", {
    cost: 1000,
    level: "All levels",
    tags: [TAGS.beginner],
    description:
      "Mat-based flow with options for every level. Mats are provided.",
  }),
  zumba: activity("Zumba", "#ea580c", "fitness", {
    cost: 1000,
    description: "An hour of dance cardio. No experience needed.",
  }),
  seniorsFit: activity("Seniors' fitness", "#b45309", "fitness", {
    cost: 700,
    age: "55+",
    tags: [TAGS.seniors],
    description: "Strength and balance work, seated or standing.",
  }),
  stretch: activity("Stretch", "#0891b2", "fitness", {
    cost: 700,
    tags: [TAGS.beginner],
    description:
      "A slow half-hour of mobility work. A good cool-down after spin.",
  }),
  spin: activity("Spin", "#0066cc", "fitness", {
    cost: 1200,
    tags: [TAGS.adult],
    description:
      "Forty-five minutes on the bike. Arrive five minutes early to set up.",
  }),
  ballHockey: activity("Ball hockey", "#dc2626", "hockey", {
    age: "Adult",
    tags: [TAGS.adult],
    description:
      "Boards are up. Bring a stick and gloves; nets and balls are provided.",
  }),
  outdoorHoops: activity("Outdoor basketball", "#7c3aed", "basketball", {
    tags: [TAGS.allAges],
    description: "Half-court pickup on the outdoor hoops. Winners stay on.",
  }),
  futsal: activity("Futsal", "#16a34a", "soccer", {
    age: "12–17",
    tags: [TAGS.youth],
    description: "Small-sided soccer with a low-bounce ball. Pinnies provided.",
  }),
  publicSkate: activity("Public skate", "#0066cc", "skating", {
    cost: 450,
    tags: [TAGS.allAges],
    description:
      "Music on, everyone skating the same way. Helmets recommended for children.",
  }),
  parentTotSkate: activity("Parent and tot skate", "#ea580c", "skating", {
    cost: 350,
    age: "Under 6 with an adult",
    tags: [TAGS.beginner],
    description:
      "A quieter ice for first-time skaters. Skate aids are available at the door.",
  }),
  shinny: activity("Adult shinny", "#dc2626", "hockey", {
    cost: 1200,
    age: "Adult",
    tags: [TAGS.adult],
    description:
      "Pickup hockey, no contact. Full equipment and a helmet with a cage required.",
  }),
  stickPuck: activity("Stick and puck", "#475569", "hockey", {
    cost: 900,
    description:
      "Skills practice with pucks and nets. No games. Helmets required.",
  }),
  figureSkating: activity("Learn to skate", "#db2777", "skating", {
    kind: "program",
    age: "Children",
    tags: [TAGS.youth],
    description:
      "Registered lessons. This sheet is not open to public skating while they run.",
  }),
  dropInSoccer: activity("Drop-in soccer", "#16a34a", "soccer", {
    cost: 500,
    age: "Adult",
    tags: [TAGS.adult],
    description:
      "Seven-a-side pickup. Teams are picked on the field; bring a light and a dark shirt.",
  }),
  youthSoccer: activity("Youth soccer", "#9333ea", "soccer", {
    kind: "program",
    age: "8–12",
    tags: [TAGS.youth],
    description: "Registered skills sessions with coaches from the local club.",
  }),
  walkingSoccer: activity("Walking soccer", "#b45309", "soccer", {
    age: "55+",
    tags: [TAGS.seniors],
    description:
      "Soccer at a walk, no running and no contact. Everyone welcome.",
  }),
  ultimate: activity("Ultimate", "#0891b2", "other", {
    cost: 400,
    tags: [TAGS.beginner],
    description:
      "Pickup ultimate frisbee. Discs provided; new players shown the rules.",
  }),
  dropInTennis: activity("Drop-in tennis", "#15803d", "tennis", {
    cost: 600,
    level: "All levels",
    tags: [TAGS.beginner],
    description:
      "Doubles rotation, one hour per group. Racquets can be borrowed at the desk.",
  }),
  tennisLessons: activity("Tennis lessons", "#db2777", "tennis", {
    kind: "program",
    age: "Children",
    tags: [TAGS.youth],
    description:
      "Registered group lessons. Courts return to drop-in when they finish.",
  }),
  seniorsTennis: activity("Seniors' tennis", "#b45309", "tennis", {
    cost: 400,
    age: "55+",
    tags: [TAGS.seniors],
    description:
      "Social doubles at an easy pace. New players paired up on arrival.",
  }),
};

interface Slot {
  /** 0 = Sunday … 6 = Saturday, matching the schedule grid. */
  days: number[];
  activity: Activity;
  /** "HH:MM", 24-hour, wall clock at the building. */
  start: string;
  end: string;
  spaces: string[];
}

const WEEKDAYS = [1, 2, 3, 4, 5];
const MWF = [1, 3, 5];
const TTH = [2, 4];
const lanes = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `lane-${from + i}`);
const courts = (...n: number[]) => n.map((i) => `court-${i}`);
const sport = (...ids: string[]) => ids.map((id) => `sport-${id}`);
const tennis = (...n: number[]) => n.map((i) => `tennis-${i}`);
const pickle = (...n: number[]) => n.map((i) => `pickle-${i}`);

const PATTERNS: Record<DemoScope["id"], Slot[]> = {
  pool: [
    {
      days: WEEKDAYS,
      activity: RESERVED,
      start: "06:00",
      end: "08:00",
      spaces: lanes(1, 3),
    },
    {
      days: WEEKDAYS,
      activity: A.laneSwim,
      start: "06:00",
      end: "08:00",
      spaces: lanes(4, 8),
    },
    {
      days: MWF,
      activity: A.aquafit,
      start: "07:00",
      end: "07:45",
      spaces: ["leisure"],
    },
    {
      days: WEEKDAYS,
      activity: A.laneSwim,
      start: "08:00",
      end: "09:00",
      spaces: lanes(1, 4),
    },
    {
      days: WEEKDAYS,
      activity: A.lessons,
      start: "08:00",
      end: "09:00",
      spaces: lanes(5, 8),
    },
    {
      days: WEEKDAYS,
      activity: A.tots,
      start: "09:00",
      end: "10:30",
      spaces: ["leisure"],
    },
    {
      days: WEEKDAYS,
      activity: A.laneSwim,
      start: "11:30",
      end: "13:30",
      spaces: lanes(1, 8),
    },
    {
      days: TTH,
      activity: A.publicSwim,
      start: "13:00",
      end: "15:00",
      spaces: ["leisure"],
    },
    {
      days: WEEKDAYS,
      activity: A.lessons,
      start: "16:00",
      end: "18:00",
      spaces: lanes(1, 4),
    },
    {
      days: WEEKDAYS,
      activity: A.laneSwim,
      start: "16:00",
      end: "18:00",
      spaces: lanes(5, 8),
    },
    {
      days: TTH,
      activity: RESERVED,
      start: "18:00",
      end: "20:00",
      spaces: lanes(1, 3),
    },
    {
      days: TTH,
      activity: A.laneSwim,
      start: "18:00",
      end: "20:00",
      spaces: lanes(4, 8),
    },
    {
      days: TTH,
      activity: A.laneSwim,
      start: "20:00",
      end: "21:00",
      spaces: lanes(1, 8),
    },
    {
      days: MWF,
      activity: A.laneSwim,
      start: "18:00",
      end: "21:00",
      spaces: lanes(1, 8),
    },
    {
      days: MWF,
      activity: A.familySwim,
      start: "18:30",
      end: "19:30",
      spaces: ["leisure"],
    },
    {
      days: TTH,
      activity: A.aquafit,
      start: "19:30",
      end: "20:15",
      spaces: ["leisure"],
    },
    {
      days: [6],
      activity: A.laneSwim,
      start: "07:00",
      end: "09:00",
      spaces: lanes(1, 8),
    },
    {
      days: [6],
      activity: A.lessons,
      start: "09:00",
      end: "12:00",
      spaces: lanes(1, 4),
    },
    {
      days: [6],
      activity: A.laneSwim,
      start: "09:00",
      end: "12:00",
      spaces: lanes(5, 8),
    },
    {
      days: [6, 0],
      activity: A.publicSwim,
      start: "13:00",
      end: "16:00",
      spaces: ["leisure"],
    },
    {
      days: [6],
      activity: RESERVED,
      start: "16:00",
      end: "18:00",
      spaces: ["leisure"],
    },
    {
      days: [0],
      activity: A.laneSwim,
      start: "08:00",
      end: "11:00",
      spaces: lanes(1, 8),
    },
    {
      days: [0],
      activity: A.familySwim,
      start: "10:00",
      end: "12:00",
      spaces: ["leisure"],
    },
    {
      days: [0],
      activity: A.laneSwim,
      start: "16:00",
      end: "19:00",
      spaces: lanes(1, 8),
    },
  ],
  gym: [
    {
      days: MWF,
      activity: A.pickleball,
      start: "09:00",
      end: "12:00",
      spaces: courts(1, 2, 3),
    },
    {
      days: TTH,
      activity: A.seniorsWalk,
      start: "09:00",
      end: "10:00",
      spaces: courts(1, 2, 3),
    },
    {
      days: TTH,
      activity: A.pickleball,
      start: "10:00",
      end: "12:00",
      spaces: courts(2, 3),
    },
    {
      days: TTH,
      activity: RESERVED,
      start: "10:00",
      end: "12:00",
      spaces: courts(1),
    },
    {
      days: WEEKDAYS,
      activity: A.dropInGym,
      start: "12:00",
      end: "13:00",
      spaces: courts(1, 2, 3),
    },
    {
      days: WEEKDAYS,
      activity: A.youthBasketball,
      start: "15:30",
      end: "17:30",
      spaces: courts(1, 2),
    },
    {
      days: WEEKDAYS,
      activity: RESERVED,
      start: "15:30",
      end: "17:30",
      spaces: courts(3),
    },
    {
      days: MWF,
      activity: A.adultBasketball,
      start: "19:00",
      end: "21:00",
      spaces: courts(1, 2),
    },
    {
      days: MWF,
      activity: A.pickleball,
      start: "19:00",
      end: "21:00",
      spaces: courts(3),
    },
    {
      days: TTH,
      activity: A.volleyball,
      start: "19:00",
      end: "21:00",
      spaces: courts(1, 2, 3),
    },
    {
      days: [6],
      activity: A.youthBasketball,
      start: "09:00",
      end: "11:00",
      spaces: courts(1),
    },
    {
      days: [6],
      activity: A.pickleball,
      start: "09:00",
      end: "12:00",
      spaces: courts(2, 3),
    },
    {
      days: [6],
      activity: RESERVED,
      start: "11:00",
      end: "12:00",
      spaces: courts(1),
    },
    {
      days: [6, 0],
      activity: A.dropInGym,
      start: "12:00",
      end: "13:00",
      spaces: courts(1, 2, 3),
    },
    {
      days: [0],
      activity: A.pickleball,
      start: "13:00",
      end: "16:00",
      spaces: courts(1, 2, 3),
    },
  ],
  "sport-court": [
    {
      days: WEEKDAYS,
      activity: A.pickleball,
      start: "09:00",
      end: "12:00",
      spaces: sport("a", "b"),
    },
    {
      days: WEEKDAYS,
      activity: A.outdoorHoops,
      start: "12:00",
      end: "15:30",
      spaces: sport("a"),
    },
    {
      days: MWF,
      activity: A.futsal,
      start: "15:30",
      end: "17:30",
      spaces: sport("a", "b"),
    },
    {
      days: TTH,
      activity: A.outdoorHoops,
      start: "15:30",
      end: "17:30",
      spaces: sport("a"),
    },
    {
      days: TTH,
      activity: RESERVED,
      start: "15:30",
      end: "17:30",
      spaces: sport("b"),
    },
    {
      days: WEEKDAYS,
      activity: A.ballHockey,
      start: "18:00",
      end: "20:00",
      spaces: sport("a", "b"),
    },
    {
      days: [6, 0],
      activity: A.pickleball,
      start: "08:00",
      end: "11:00",
      spaces: sport("b"),
    },
    {
      days: [6, 0],
      activity: A.outdoorHoops,
      start: "08:00",
      end: "13:00",
      spaces: sport("a"),
    },
    {
      days: [6],
      activity: RESERVED,
      start: "11:00",
      end: "14:00",
      spaces: sport("b"),
    },
    {
      days: [6, 0],
      activity: A.ballHockey,
      start: "14:00",
      end: "17:00",
      spaces: sport("a", "b"),
    },
  ],
  arena: [
    {
      days: WEEKDAYS,
      activity: A.stickPuck,
      start: "06:30",
      end: "08:00",
      spaces: ["rink-1"],
    },
    {
      days: WEEKDAYS,
      activity: RESERVED,
      start: "06:00",
      end: "08:00",
      spaces: ["rink-2"],
    },
    {
      days: WEEKDAYS,
      activity: A.parentTotSkate,
      start: "09:30",
      end: "10:30",
      spaces: ["rink-1"],
    },
    {
      days: MWF,
      activity: A.shinny,
      start: "12:00",
      end: "13:30",
      spaces: ["rink-1"],
    },
    {
      days: WEEKDAYS,
      activity: A.publicSkate,
      start: "12:00",
      end: "13:30",
      spaces: ["rink-2"],
    },
    {
      days: WEEKDAYS,
      activity: A.figureSkating,
      start: "16:00",
      end: "17:30",
      spaces: ["rink-1"],
    },
    {
      days: WEEKDAYS,
      activity: RESERVED,
      start: "16:00",
      end: "22:00",
      spaces: ["rink-2"],
    },
    {
      days: WEEKDAYS,
      activity: A.publicSkate,
      start: "17:30",
      end: "19:00",
      spaces: ["rink-1"],
    },
    {
      days: WEEKDAYS,
      activity: RESERVED,
      start: "19:00",
      end: "22:00",
      spaces: ["rink-1"],
    },
    {
      days: [6, 0],
      activity: RESERVED,
      start: "07:00",
      end: "12:00",
      spaces: ["rink-1", "rink-2"],
    },
    {
      days: [6, 0],
      activity: A.publicSkate,
      start: "13:00",
      end: "15:00",
      spaces: ["rink-1"],
    },
    {
      days: [6, 0],
      activity: A.parentTotSkate,
      start: "13:00",
      end: "14:00",
      spaces: ["rink-2"],
    },
    {
      days: [6],
      activity: A.shinny,
      start: "20:00",
      end: "21:30",
      spaces: ["rink-2"],
    },
  ],
  field: [
    {
      days: TTH,
      activity: A.walkingSoccer,
      start: "10:00",
      end: "11:30",
      spaces: ["field-2"],
    },
    {
      days: MWF,
      activity: A.ultimate,
      start: "12:00",
      end: "13:00",
      spaces: ["field-1"],
    },
    {
      days: WEEKDAYS,
      activity: A.youthSoccer,
      start: "16:30",
      end: "18:00",
      spaces: ["field-2"],
    },
    {
      days: WEEKDAYS,
      activity: RESERVED,
      start: "18:00",
      end: "22:00",
      spaces: ["field-1"],
    },
    {
      days: MWF,
      activity: A.dropInSoccer,
      start: "18:30",
      end: "20:00",
      spaces: ["field-2"],
    },
    {
      days: TTH,
      activity: A.ultimate,
      start: "18:30",
      end: "20:00",
      spaces: ["field-2"],
    },
    {
      days: [6],
      activity: A.youthSoccer,
      start: "09:00",
      end: "12:00",
      spaces: ["field-1", "field-2"],
    },
    {
      days: [6, 0],
      activity: RESERVED,
      start: "12:00",
      end: "18:00",
      spaces: ["field-1"],
    },
    {
      days: [0],
      activity: A.dropInSoccer,
      start: "10:00",
      end: "12:00",
      spaces: ["field-1"],
    },
    {
      days: [6, 0],
      activity: A.dropInSoccer,
      start: "13:00",
      end: "15:00",
      spaces: ["field-2"],
    },
  ],
  racquets: [
    {
      days: WEEKDAYS,
      activity: A.dropInTennis,
      start: "07:00",
      end: "09:00",
      spaces: tennis(1, 2),
    },
    {
      days: TTH,
      activity: A.seniorsTennis,
      start: "09:00",
      end: "11:00",
      spaces: tennis(1, 2),
    },
    {
      days: MWF,
      activity: A.dropInTennis,
      start: "09:00",
      end: "11:00",
      spaces: tennis(1),
    },
    {
      days: MWF,
      activity: RESERVED,
      start: "09:00",
      end: "11:00",
      spaces: tennis(2),
    },
    {
      days: WEEKDAYS,
      activity: A.pickleball,
      start: "09:00",
      end: "12:00",
      spaces: pickle(1, 2, 3, 4),
    },
    {
      days: WEEKDAYS,
      activity: A.tennisLessons,
      start: "16:00",
      end: "18:00",
      spaces: tennis(1, 2),
    },
    {
      days: WEEKDAYS,
      activity: A.pickleball,
      start: "17:00",
      end: "20:00",
      spaces: pickle(1, 2),
    },
    {
      days: WEEKDAYS,
      activity: RESERVED,
      start: "18:00",
      end: "20:00",
      spaces: pickle(3, 4),
    },
    {
      days: WEEKDAYS,
      activity: A.dropInTennis,
      start: "18:00",
      end: "21:00",
      spaces: tennis(1, 2),
    },
    {
      days: [6, 0],
      activity: A.dropInTennis,
      start: "08:00",
      end: "12:00",
      spaces: tennis(1, 2),
    },
    {
      days: [6, 0],
      activity: A.pickleball,
      start: "08:00",
      end: "13:00",
      spaces: pickle(1, 2, 3, 4),
    },
    {
      days: [6],
      activity: RESERVED,
      start: "13:00",
      end: "16:00",
      spaces: tennis(1, 2),
    },
  ],
  studios: [
    {
      days: MWF,
      activity: A.yoga,
      start: "09:00",
      end: "10:00",
      spaces: ["studio-a"],
    },
    {
      days: MWF,
      activity: A.zumba,
      start: "10:30",
      end: "11:30",
      spaces: ["studio-a"],
    },
    {
      days: WEEKDAYS,
      activity: A.seniorsFit,
      start: "10:00",
      end: "11:00",
      spaces: ["studio-b"],
    },
    {
      days: MWF,
      activity: A.stretch,
      start: "12:00",
      end: "12:30",
      spaces: ["studio-b"],
    },
    {
      days: WEEKDAYS,
      activity: A.spin,
      start: "06:30",
      end: "07:15",
      spaces: ["cycle"],
    },
    {
      days: MWF,
      activity: A.spin,
      start: "09:30",
      end: "10:15",
      spaces: ["cycle"],
    },
    {
      days: WEEKDAYS,
      activity: A.spin,
      start: "12:00",
      end: "12:45",
      spaces: ["cycle"],
    },
    {
      days: [1],
      activity: RESERVED,
      start: "09:00",
      end: "12:00",
      spaces: ["hall"],
    },
    {
      days: TTH,
      activity: A.yoga,
      start: "18:00",
      end: "19:00",
      spaces: ["studio-a"],
    },
    {
      days: TTH,
      activity: A.zumba,
      start: "19:15",
      end: "20:15",
      spaces: ["hall"],
    },
    {
      days: WEEKDAYS,
      activity: A.spin,
      start: "17:30",
      end: "18:15",
      spaces: ["cycle"],
    },
    {
      days: [3, 5],
      activity: RESERVED,
      start: "18:00",
      end: "21:00",
      spaces: ["hall"],
    },
    {
      days: [6],
      activity: A.yoga,
      start: "09:00",
      end: "10:00",
      spaces: ["studio-a"],
    },
    {
      days: [6, 0],
      activity: A.spin,
      start: "09:30",
      end: "10:15",
      spaces: ["cycle"],
    },
    {
      days: [6],
      activity: RESERVED,
      start: "12:00",
      end: "16:00",
      spaces: ["hall"],
    },
    {
      days: [0],
      activity: A.stretch,
      start: "10:30",
      end: "11:00",
      spaces: ["studio-b"],
    },
  ],
};

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

/**
 * One scope's sessions for the week starting `weekStart` (a local Sunday, as
 * `getWeekStart` returns). Starts and ends follow the session-Date convention
 * — the building's wall clock written as UTC digits — so the views' own
 * formatters read them the way they read a real API response.
 */
export function demoSessionsForWeek(
  scopeId: string,
  weekStart: Date,
): ExpandedSession[] {
  const scope = DEMO_SCOPES.find((s) => s.id === scopeId) ?? DEMO_SCOPES[0];
  const out: ExpandedSession[] = [];

  for (let offset = 0; offset < 7; offset++) {
    const day = new Date(
      weekStart.getFullYear(),
      weekStart.getMonth(),
      weekStart.getDate() + offset,
    );
    const weekday = day.getDay();
    const dateKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;

    PATTERNS[scope.id].forEach((slot, index) => {
      if (!slot.days.includes(weekday)) return;
      const at = (hhmm: string) => {
        const [h, m] = hhmm.split(":").map(Number);
        return new Date(
          Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), h, m),
        );
      };
      const spaces = slot.spaces.map((id) => SPACES_BY_ID.get(id)!);
      const a = slot.activity;
      const isReserved = a === RESERVED;
      const sessionId = `${scope.id}-${index}`;

      out.push({
        key: `${sessionId}_${dateKey}`,
        sessionId,
        orgId: DEMO_ORG_ID,
        start: at(slot.start),
        end: at(slot.end),
        scheduleGroupId: `${scope.id}-${a.sport}`,
        scheduleGroupName: a.name,
        sportCategory: a.sport,
        activityType: "drop_in",
        costCents: a.cost,
        costNotes: null,
        ageGroup: a.age,
        skillLevel: a.level,
        maxParticipants: null,
        facilityId: scope.facilityId,
        facilityName: scope.facilityName,
        departmentId: `${scope.id}-department`,
        departmentName: scope.departmentName,
        spaceIds: spaces.map((s) => s.id),
        spaceNames: spaces.map((s) => s.name),
        spaceZones: spaces.map((s) => s.zone),
        spaceOrders: spaces.map((s) => s.order),
        templateId: isReserved ? null : `${scope.id}-${a.name}`,
        templateName: isReserved ? null : a.name,
        templateColor: a.color,
        templateDescription: a.description,
        templateTags: a.tags,
        templateLinks: [],
        occupancyKind: a.kind,
        disclosure: isReserved ? "reserved" : "public",
        holderName: null,
        setupNotes: null,
        locationDetail: null,
      });
    });
  }

  return out.sort((x, y) => x.start.getTime() - y.start.getTime());
}
