// Studio knowledge, transcribed from services.md / qualified.md / pricing.md.
// Everything the gate engine decides with is in this file, so a rule change
// is a one-line edit here, not a prompt rewrite.

export const SCRIPTS = {
  // pricing.md — "The only acceptable response to a pricing question"
  pricingDeflection:
    "Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like.",
  // qualified.md — "Two or more criteria fail" (also used for any clear single failure)
  decline:
    "This sounds like it may not be the right fit for us right now — but feel free to reach out if your timeline or scope changes.",
} as const;

// One direct question per unclear gate (qualified.md: "ask one direct question").
export const FOLLOW_UP_QUESTIONS = {
  scope:
    "Are you looking for us to take on both the design and the execution, or mainly design advice?",
  geography: "Which area of Pune is the property in?",
  timeline: "When would you need the project complete?",
} as const;

// services.md — "Service area". Lower-case substrings matched against locality/city.
export const SERVICE_AREA = [
  // Pune city (listed)
  "kothrud", "baner", "aundh", "wakad", "koregaon park", "kalyani nagar", "viman nagar",
  "hadapsar", "magarpatta", "nibm", "kondhwa", "undri", "shivane", "warje", "erandwane", "deccan",
  // Pune city ("and adjoining areas")
  "kharadi", "nanded city", "bavdhan", "pashan", "sus road", "balewadi", "mundhwa", "yerwada",
  "dhanori", "lohegaon", "katraj", "bibwewadi", "sinhagad road", "dhayari", "camp", "shivajinagar",
  "model colony", "prabhat road", "sadashiv peth", "wanowrie", "fatima nagar", "sb road",
  "salunkhe vihar", "boat club road", "sopan baug", "karve nagar",
  // PCMC
  "pimpri", "chinchwad", "pimple saudagar", "pimple nilakh", "pimple gurav", "ravet", "hinjewadi",
  "akurdi", "nigdi", "bhosari", "moshi", "tathawade", "punawale", "thergaon", "sangvi", "dapodi",
  "kasarwadi", "pcmc",
];

// services.md — "We do not currently serve Talegaon, Lonavala, Nashik, Mumbai, or other cities"
export const OUT_OF_AREA = [
  "talegaon", "lonavala", "lonavla", "nashik", "mumbai", "thane", "navi mumbai", "satara",
  "kolhapur", "aurangabad", "sambhajinagar", "nagpur", "goa", "bangalore", "bengaluru",
  "hyderabad", "delhi", "chakan", "shirur", "baramati", "alibaug",
];

export const IN_AREA_CITIES = ["pune", "pcmc", "pimpri", "chinchwad", "pimpri-chinchwad"];

// services.md — "Restaurants, hotels, retail stores, gyms: out of scope."
export const OUT_OF_SCOPE_COMMERCIAL = [
  "restaurant", "cafe", "café", "bar", "hotel", "hospitality", "retail", "shop", "store",
  "showroom", "gym", "fitness", "salon", "spa", "banquet",
];

// services.md — offices "up to approximately 3,000 sq ft"; front desk (T18) treats <500 as too small.
export const COMMERCIAL_MIN_SQFT = 500;
export const COMMERCIAL_MAX_SQFT = 3000;
export const COMMERCIAL_HARD_MAX_SQFT = 3500; // "approximately" — above this we decline

// services.md — "cannot begin execution on a project that needs to be ready in under 6 weeks"
export const MIN_WEEKS_TO_COMPLETION = 6;
export const TIGHT_WEEKS_TO_COMPLETION = 10; // design 3–4 wks + execution 8+ — flag, don't fail

// pricing.md — INTERNAL ONLY. Used to spot a volunteered budget that is "clearly below"
// (qualified.md gate 4). These numbers must never reach the caller or the voice prompt.
export const BUDGET_FLOOR = {
  residentialPerSqft: 1800,
  commercialPerSqft: 1200,
  singleRoom: 350000,
  typicalCarpetByBhk: { 1: 550, 2: 900, 3: 1200, 4: 1900, 5: 2600 } as Record<number, number>,
  clearlyBelowRatio: 0.5, // only flag budgets under half the cheapest plausible spec
};

export const FRONT_DESK_HOURS_IST = { open: 10, close: 19 };
