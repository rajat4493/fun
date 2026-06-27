import availabilityData from "@/data/availability.json";
import { WatchProvider } from "@/lib/types";

type AvailabilityRecord = {
  title: string;
  year: string;
  countries: string[];
  providers: WatchProvider[];
  source: string;
  verifiedAt: string;
};

export type AvailabilityResult = {
  status: "verified" | "unverified";
  title: string;
  year: string;
  country: string;
  providers: WatchProvider[];
  primary: string;
  note: string;
  verifiedAt?: string;
  source?: string;
};

const countryCodeMap: Record<string, string> = {
  poland: "PL", pl: "PL",
  "united kingdom": "GB", gb: "GB", uk: "GB",
  germany: "DE", de: "DE",
  france: "FR", fr: "FR",
  spain: "ES", es: "ES",
  italy: "IT", it: "IT",
  netherlands: "NL", nl: "NL",
  "united states": "US", usa: "US", us: "US",
  india: "IN", in: "IN",
  portugal: "PT", pt: "PT",
  sweden: "SE", se: "SE",
  denmark: "DK", dk: "DK",
  belgium: "BE", be: "BE",
  austria: "AT", at: "AT",
  ireland: "IE", ie: "IE",
};

function normalizeCountry(country: string): string {
  return countryCodeMap[country.trim().toLowerCase()] ?? country.trim().toUpperCase();
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}

export function checkAvailability(title: string, year: string, country: string): AvailabilityResult {
  const countryCode = normalizeCountry(country || "US");
  const titleKey = normalizeTitle(title);
  const yearValue = String(year || "").trim();

  const match = (availabilityData as AvailabilityRecord[]).find((record) => {
    const sameTitle = normalizeTitle(record.title) === titleKey;
    const sameYear = !yearValue || !record.year || record.year === yearValue;
    const inCountry = record.countries.map((c) => c.toUpperCase()).includes(countryCode);
    return sameTitle && sameYear && inCountry;
  });

  if (!match) {
    return {
      status: "unverified",
      title,
      year,
      country: countryCode,
      providers: [],
      primary: "Availability not verified yet",
      note: "Availability not verified yet.",
    };
  }

  const subscriptionProviders = match.providers.filter((p) => p.access === "subscription");
  const primary = subscriptionProviders[0]?.name ?? match.providers[0]?.name ?? "Availability verified";
  const note = subscriptionProviders.length > 0
    ? `Verified on ${subscriptionProviders.map((p) => p.name).join(" · ")}`
    : "Verified, but not included with a subscription.";

  return {
    status: "verified",
    title: match.title,
    year: match.year,
    country: countryCode,
    providers: match.providers,
    primary,
    note,
    verifiedAt: match.verifiedAt,
    source: match.source,
  };
}
