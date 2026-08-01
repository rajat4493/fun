// Affiliate tagging for outbound "watch on X" links. Disabled until real affiliate credentials
// exist for a given provider — with no config, every function here is a no-op passthrough, so
// this can ship long before any affiliate program approval without changing any link or behavior.
//
// Config is one JSON blob (NEXT_PUBLIC_ because the final URL is client-constructed and the tag
// is visible in the resulting link the moment someone clicks anyway — there is no secret to keep
// server-side), keyed by normalized provider name:
//
//   NEXT_PUBLIC_FUN_AFFILIATE_LINKS={
//     "amazonprimevideo": { "type": "param", "param": "tag", "value": "yourtag-20" },
//     "hulu": { "type": "wrap", "template": "https://www.dpbolvw.net/click-XXXXX?url={url}" }
//   }
//
// "param" appends a tracking query parameter to the existing destination URL (how Amazon
// Associates and many direct programs work). "wrap" substitutes the encoded destination URL into
// a network-provided redirect template (how Rakuten Advertising / Impact / CJ deep links work).
type AffiliateRule =
  | { type: "param"; param: string; value: string }
  | { type: "wrap"; template: string };

type AffiliateConfig = Record<string, AffiliateRule>;

let cachedConfig: AffiliateConfig | null = null;

function loadConfig(): AffiliateConfig {
  if (cachedConfig) return cachedConfig;
  cachedConfig = {};
  const raw = process.env.NEXT_PUBLIC_FUN_AFFILIATE_LINKS;
  if (!raw) return cachedConfig;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      cachedConfig = parsed as AffiliateConfig;
    }
  } catch {
    // A malformed env var must never break a watch link — fail closed to "no tagging".
  }
  return cachedConfig;
}

function normalizeProviderKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function hasAffiliateTag(providerName: string): boolean {
  return Boolean(loadConfig()[normalizeProviderKey(providerName)]);
}

export function applyAffiliateTag(providerName: string, url: string): string {
  const rule = loadConfig()[normalizeProviderKey(providerName)];
  if (!rule || !url) return url;

  try {
    if (rule.type === "param" && rule.param && rule.value) {
      const joiner = url.includes("?") ? "&" : "?";
      return `${url}${joiner}${encodeURIComponent(rule.param)}=${encodeURIComponent(rule.value)}`;
    }
    if (rule.type === "wrap" && rule.template.includes("{url}")) {
      return rule.template.replace("{url}", encodeURIComponent(url));
    }
  } catch {
    // Same fail-closed guarantee: a bad rule returns the original, unmodified link.
  }
  return url;
}
