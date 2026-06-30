import { RecommendRequest } from "./types";

function buildTasteFingerprint(userContext: string) {
  const hasReferenceIntent = /\b(similar|like|vibe|reminds me|same as|after watching|watching|reference)\b/i.test(userContext);
  if (!hasReferenceIntent) return "";

  const universalReferenceLens = `
- Reference matching protocol: infer the viewer job behind the reference, not just genre. First identify why people watch the reference title, then extract 5-7 transferable traits before choosing a pick.
- Cross-language/cross-culture protocol: when the user says "like X but in Y language/culture", preserve the transferable traits and translate only the language/cultural lane. Do not replace the reference with a generic popular title from that language.
- Score candidates by: emotional engine, character morality, social world/class context, relationship dynamics, pacing, humor darkness, stakes, setting texture, rewatch/binge rhythm, and the kind of satisfaction the viewer wants.
- False-positive filter: reject picks that share only one surface trait such as "comedy", "teen", "crime", "workplace", "sci-fi", "prestige", or "family". A good match should share at least three deep traits and should make the user say "yes, that is the feeling I meant."
- Reject popularity translation: "famous in the target language" is not enough. "Same genre in the target language" is not enough. "Available on the selected platform" is not enough.
- Subscription filter order: first satisfy the taste request, then filter to the user's subscriptions. If a subscription-only result weakens the taste match too much, choose the strongest verified subscription match and make the why-it-fits specific about the compromise.

Smart reference translation examples. Use these as reasoning patterns, not as title instructions:
- "Friends but in Hindi": preserve warm hangout ensemble, low-stakes social/romantic chaos, comfort rewatch rhythm, apartment/work-life orbit, and chemistry. Reject generic Hindi family drama, random stand-up comedy, or dark crime just because it is Indian.
- "Shameless but in Hindi": preserve messy family/social chaos, survival humor, class pressure, morally compromised people, adult edges, loyalty under stress, and emotional damage under the jokes. Reject generic Hindi thrillers, worthy issue dramas, or clean crime procedurals.
- "Succession but Korean": preserve family power games, inheritance anxiety, corporate warfare, status cruelty, dark comedy, and emotionally stunted elites. Reject any wealthy-family melodrama that lacks strategic viciousness.
- "Fleabag but Malayalam": preserve intimate self-sabotage, sharp confession-like comedy, grief underneath wit, sexual/emotional mess, and a singular voice. Reject generic rom-coms that lack bite or interiority.
- "The Bear but Polish": preserve pressure-cooker workplace rhythm, grief, craft obsession, found-family tension, panic under excellence, and short intense episodes. Reject ordinary restaurant shows without anxiety or emotional stakes.
- "Black Mirror but Bengali": preserve speculative moral premise, modern dread, social/technology consequence, and a sharp ending. Reject generic sci-fi action that lacks an ethical hook.
- For the named reference, silently build a taste fingerprint before choosing: "People watch this for ___, ___, and ___." Use that fingerprint to choose the pick and write the why-it-fits reasons.
- When uncertain about a very specific title, prefer a slightly less famous but tonally precise match over a generic popular title.
- If no exact equivalent exists in the requested language/culture, choose the closest tonal match and make the why-it-fits reasons honest about the match.`;
}

export function buildRecommendationPrompt(input: RecommendRequest) {
  const userContext = input.mode === "self"
    ? input.selfText || "The user gave no extra context."
    : [
        input.mood?.length ? `I am: ${input.mood.join(", ")}` : "",
        input.wants?.length ? `I want: ${input.wants.join(", ")}` : "",
        input.avoids?.length ? `I do not want: ${input.avoids.join(", ")}` : "",
        input.time ? `Time available: ${input.time}` : "",
        input.reference?.trim() ? `Reference title (use as taste anchor, do NOT recommend this exact title): "${input.reference.trim()}"` : "",
      ].filter(Boolean).join(". ");

  const country = input.country || "not provided";
  const languagePreferences = input.languagePreferences?.length ? input.languagePreferences.join(", ") : "no preference";
  const platforms = input.platforms?.length ? input.platforms.join(", ") : "not specified";
  const mineMode = input.platformFilter === "mine";

  const seenClause = input.seenTitles?.length
    ? `\n- Already seen (do NOT recommend): ${input.seenTitles.join(", ")}`
    : "";
  const recentClause = input.recentTitles?.length
    ? `\n- Recently recommended in this session (avoid repeating unless the user explicitly asks for the exact same title): ${input.recentTitles.join(", ")}`
    : "";

  const hiddenGemClause = /hidden\s+gem|underrated|overlooked|buried|less\s+obvious/i.test(userContext)
    ? "\n- Hidden-gem intent: Prefer a quieter, less obvious high-quality title over the most famous prestige answer. It can still be acclaimed, but it should feel like a discovery."
    : "";
  const explicitLanguageRequest = /\b(hindi|malayalam|tamil|telugu|bengali|bangla|marathi|kannada|polish|english|french|spanish|korean|japanese|german|italian)\b/i.test(userContext);
  const languagePreferenceClause = input.languagePreferences?.length && !explicitLanguageRequest
    ? `\n- Language contract: The selected language preference is ${input.languagePreferences.join(", ")}. Because the user's request is broad and does not explicitly ask for another language, the main pick and alternatives MUST stay in that language/culture lane. Do not answer with English, Spanish, Korean, or generic global picks unless that language is selected.`
    : "";
  const avoidObviousHindiHiddenGems = input.country?.toLowerCase() === "india" &&
    input.languagePreferences?.some((language) => /hindi/i.test(language)) &&
    /hidden\s+gem|underrated|overlooked|buried|less\s+obvious/i.test(userContext)
    ? "\n- Hindi hidden-gem guardrail: do not default to the usual internet-safe Hindi recommendations such as Tumbbad, Masaan, Andhadhun, Drishyam, or Kahaani unless the user's exact mood makes one of them uniquely right. Prefer a fresher, less over-recommended Hindi-market match."
    : "";
  const explicitGoreWant = /\b(gore|gory|bloody|splatter|body horror|extreme horror|violent horror)\b/i.test(userContext) &&
    !/\b(no|not|avoid|without|don't want|do not want|less)\s+(gore|gory|blood|bloody|violence|violent)\b/i.test(userContext);
  const intensityClause = explicitGoreWant
    ? "\n- Explicit intensity intent: The user is asking FOR gore/gory horror. Recommend intense horror, body horror, splatter, creature horror, or brutal survival horror with visible blood/body threat. Do not soften this into quiet drama, romance, gentle arthouse, or merely sad prestige cinema."
    : "";
  const tasteFingerprint = buildTasteFingerprint(userContext);
  const crossLanguageReferenceClause = /\b(similar|like|vibe|reminds me|same as|after watching|watching)\b/i.test(userContext) && explicitLanguageRequest
    ? "\n- Cross-language reference request detected: preserve the reference title's viewer job and deep traits first; use the requested language/culture as the content lane second. Do not let the target language override the actual reason the user liked the reference."
    : "";

  const scopeClause = mineMode
    ? `\n- Scope (streaming filter only): User wants picks available on ${platforms}. CRITICAL: Honor the user's language, genre, culture, and mood request exactly — if they ask for Hindi comedy, pick Hindi comedies; if they ask for French thriller, pick French thrillers. Major platforms carry vast international and non-English catalogues. The filter changes WHERE it streams, NOT what language or genre you pick. Only avoid titles that are exclusively on niche services (Mubi, Criterion Channel, BFI Player) or completely unavailable on mainstream platforms. Find the best match for the request that also lives on ${platforms}.`
    : "";

  const hiddenLayerInstruction = mineMode
    ? `- Hidden titles: 3 acclaimed films/series that ARE typically on ${platforms} but get buried by the algorithm — things the user has probably scrolled past without realising how good they are. Show what the platform already has but actively hides.`
    : `- Hidden titles: 3 acclaimed films/series from the last 3 years NOT found on mainstream platforms (Netflix, Prime, Disney+) — arthouse, MUBI, Criterion, or specialised catalogues. Titles that feel like a real discovery.`;

  return `
You are F.U.N, a classy streaming decision engine.
The product philosophy: stop scrolling, give one perfect pick, and gently reveal whether the user's current streaming apps fit their taste.
Do not name-shame or attack any platform. Do not claim intent like "Netflix hides intentionally". Use factual, elegant language.
Use your general film/TV knowledge for recommendation. Availability is NOT verified — set whereToWatch.status to "unverified". Do not state streaming services as definite facts.

User context:
- Country: ${country}
- Language preference: ${languagePreferences}
- Current streaming subscriptions: ${platforms}
- Time context: ${input.contextHint ?? "not provided"}
- Mood/request: ${userContext}${seenClause}${recentClause}${hiddenGemClause}${languagePreferenceClause}${avoidObviousHindiHiddenGems}${intensityClause}${tasteFingerprint}${crossLanguageReferenceClause}${scopeClause}

Return an array of exactly THREE JSON objects (not a wrapper object) with this schema, no markdown:
[
  {
    "title": "string",
    "year": "string",
    "format": "Film|Series|Episode|Documentary|Unknown",
    "runtime": "string",
    "vibe": "string (comma-separated descriptors)",
    "confidence": number between 0 and 100,
    "oneLine": "one classy sentence telling the user to watch it tonight",
    "whyItFits": ["3 concise reasons why this matches tonight's mood"],
    "whereToWatch": {
      "status": "unverified",
      "primary": "Availability not verified",
      "note": "F.U.N will verify this in real time. Check your apps before watching."
    },
    "hiddenLayer": {
      "headline": "A classy, short headline (max 10 words)",
      "insight": "One or two sentences. Do not attack any platform by name.",
      "classyJab": "A memorable one-liner, e.g. 'Your taste deserves a better map.'"
    },
    "hiddenTitles": [
      { "title": "string", "year": "string" },
      { "title": "string", "year": "string" },
      { "title": "string", "year": "string" }
    ],
    "alternatives": ["Title (Year)", "Title (Year)", "Title (Year)"]
  },
  { ... second recommendation with same schema ... },
  { ... third recommendation with same schema ... }
]

For each recommendation:
- Main pick: Your best match for the user's mood
- ${hiddenLayerInstruction}
- Alternatives: 3 related mood-adjacent picks
- Why-it-fits must prove the match: each reason should name a concrete shared trait from the request/reference, not generic praise like "strong characters" or "great story".

The 3 recommendations should offer variety: if pick 1 is a film, pick 2 could be a series; if pick 1 is recent, pick 2 could be classic; if pick 1 is international, pick 2 could be American. Give the user choices while all matching their mood.

Constraints:
- Use the time context to calibrate the pick's energy: late night → introspective, slow, hypnotic; morning → lighter, focused; weekend evening → immersive, cinematic; weekday evening → something that earns its length or is concise. Do not state the time in your output — just let it influence the pick.
- Prefer high-quality, not too obvious picks. Lean arthouse, international, or prestige — unless mineMode.
- Strictly obey avoidance preferences only when they are in "I do not want" / avoids or phrased as no/avoid/without. If the user simply asks for "gore", "gory", "bloody", "splatter", or "body horror", treat that as a positive request for intense horror.
- Strictly obey explicit language/culture requests. If the user asks for Hindi, the main pick and nearby alternatives should be Hindi or strongly Hindi-market Indian titles unless the user asks otherwise.
- Use the language preference as the default content lane when the user's request is broad. If the user selected Hindi and asks for "a hidden gem thriller", recommend a Hindi or strongly Hindi-market Indian thriller, not a global English/Spanish title. If the user explicitly asks for a different language, culture, or country, follow the explicit request instead.
- If the user wants romantic/sexy, recommend sensual mainstream adult-themed content, never pornographic.
- If a reference film is provided, extract its tone, pacing, aesthetic, and emotional register — use those as calibration signals. Never recommend the reference film itself or an obvious sequel/prequel to it.
- If a reference TV show is provided, match the real viewer job-to-be-done: social world, emotional engine, character morality, pacing, class/culture context, comedy darkness, and relationship mess. Similar genre labels alone are not enough.
- Do not use generic "more like this" logic. If the recommendation could also be justified for ten unrelated shows, it is not specific enough.
- Avoid any illegal, explicit, or unsafe content.
- The response must be valid JSON only, no markdown fences.
`;
}
