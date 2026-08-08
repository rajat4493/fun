export const PREVIEW_COUNTRY_CODES = [
  "GB",
  "IE",
  "IN",
] as const;

export function isPreviewCountry(code: string): boolean {
  return PREVIEW_COUNTRY_CODES.includes(code as (typeof PREVIEW_COUNTRY_CODES)[number]);
}
