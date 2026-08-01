export const PREVIEW_COUNTRY_CODES = [
  "PL",
  "GB",
  "DE",
  "FR",
  "NL",
  "SE",
  "DK",
  "BE",
  "AT",
  "IE",
] as const;

export function isPreviewCountry(code: string): boolean {
  return PREVIEW_COUNTRY_CODES.includes(code as (typeof PREVIEW_COUNTRY_CODES)[number]);
}
