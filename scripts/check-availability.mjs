import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync(new URL("../src/data/availability.json", import.meta.url), "utf8"));

const countryCodeMap = {
  poland: "PL",
  pl: "PL",
  "united states": "US",
  us: "US",
  india: "IN",
  in: "IN",
  "united kingdom": "GB",
  gb: "GB",
  uk: "GB",
};

function normalizeCountry(country) {
  return countryCodeMap[country.trim().toLowerCase()] ?? country.trim().toUpperCase();
}

function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/\bf\*+\w*/g, "fucking")
    .replace(/\bf\.+\w*/g, "fucking")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function checkAvailability(title, year, country) {
  const countryCode = normalizeCountry(country || "US");
  const titleKey = normalizeTitle(title);
  const yearValue = String(year || "").trim();

  return data.find((record) => {
    const titleKeys = [record.title, ...(record.aliases ?? [])].map(normalizeTitle);
    const yearKeys = [record.year, ...(record.years ?? [])].filter(Boolean);
    return titleKeys.includes(titleKey) &&
      (!yearValue || yearKeys.length === 0 || yearKeys.includes(yearValue)) &&
      record.countries.map((value) => value.toUpperCase()).includes(countryCode);
  });
}

const cases = [
  ["The End of the F***ing World", "2017", "Poland", "Netflix"],
  ["The End of the Fucking World", "2019", "PL", "Netflix"],
  ["The End of the F...ing World", "", "PL", "Netflix"],
  ["The Sadness", "2021", "PL", "CDA Premium"],
];

for (const [title, year, country, provider] of cases) {
  const match = checkAvailability(title, year, country);
  if (!match) {
    console.error(`Missing availability: ${title} ${year} ${country}`);
    process.exitCode = 1;
    continue;
  }
  const hasProvider = match.providers.some((entry) => entry.name === provider);
  if (!hasProvider) {
    console.error(`Wrong provider for ${title}: expected ${provider}`);
    process.exitCode = 1;
  }
}
