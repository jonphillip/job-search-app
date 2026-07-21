// Shared normalization helpers for URLs and locations. Kept in their own module
// so both the display/list code and the role-creation code can use them without
// importing each other.

export function normalizeUrl(value: string): string {
  const v = value.trim();
  if (!v) return v;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
}

// Full US state (and DC) names → USPS two-letter abbreviations.
const US_STATES: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

const US_STATE_ABBRS = new Set(Object.values(US_STATES));

// Normalize freeform location text toward "City, ST". Split on the first comma,
// trim both parts, and map a full state name (or existing abbreviation) to its
// two-letter code. If the state segment isn't a recognized US state (e.g.
// "Remote", a country), it's left exactly as written rather than guessed at.
export function normalizeLocation(value: string): string {
  const v = value.trim();
  if (!v) return v;
  const comma = v.indexOf(",");
  if (comma === -1) return v;
  const city = v.slice(0, comma).trim();
  const state = v.slice(comma + 1).trim();
  const fromFullName = US_STATES[state.toLowerCase()];
  if (fromFullName) return `${city}, ${fromFullName}`;
  if (US_STATE_ABBRS.has(state.toUpperCase())) {
    return `${city}, ${state.toUpperCase()}`;
  }
  return `${city}, ${state}`;
}
