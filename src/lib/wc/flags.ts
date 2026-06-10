// FIFA trigram → flag emoji for the 48 qualified teams (2026 feed abbrs).
// Emoji flags render everywhere without image requests — ideal for cards.

const ISO2: Record<string, string> = {
  ALG: "DZ", ARG: "AR", AUS: "AU", AUT: "AT", BEL: "BE", BIH: "BA", BRA: "BR",
  CAN: "CA", CIV: "CI", COD: "CD", COL: "CO", CPV: "CV", CRO: "HR", CUW: "CW",
  CZE: "CZ", ECU: "EC", EGY: "EG", ENG: "GB", ESP: "ES", FRA: "FR", GER: "DE",
  GHA: "GH", HAI: "HT", IRN: "IR", IRQ: "IQ", JOR: "JO", JPN: "JP", KOR: "KR",
  KSA: "SA", MAR: "MA", MEX: "MX", NED: "NL", NOR: "NO", NZL: "NZ", PAN: "PA",
  PAR: "PY", POR: "PT", QAT: "QA", RSA: "ZA", SCO: "GB", SEN: "SN", SUI: "CH",
  SWE: "SE", TUN: "TN", TUR: "TR", URU: "UY", USA: "US", UZB: "UZ",
};

// England/Scotland have dedicated emoji (tag sequences).
const SPECIAL: Record<string, string> = {
  ENG: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  SCO: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
};

export function flagEmoji(abbr: string): string {
  if (SPECIAL[abbr]) return SPECIAL[abbr];
  const iso = ISO2[abbr];
  if (!iso) return "🏳️";
  return iso.replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}
