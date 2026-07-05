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
  return universalReferenceLens;
}

const LANGUAGE_NAMES: Array<[RegExp, string]> = [
  [/\bhindi\b/i, "Hindi"],
  [/\bmalayalam\b/i, "Malayalam"],
  [/\btamil\b/i, "Tamil"],
  [/\btelugu\b/i, "Telugu"],
  [/\bbengali\b|\bbangla\b/i, "Bengali"],
  [/\bmarathi\b/i, "Marathi"],
  [/\bkannada\b/i, "Kannada"],
  [/\bkorean\b/i, "Korean"],
  [/\bjapanese\b/i, "Japanese"],
  [/\bfrench\b/i, "French"],
  [/\bpolish\b/i, "Polish"],
  [/\bspanish\b/i, "Spanish"],
  [/\bitalian\b/i, "Italian"],
  [/\bgerman\b/i, "German"],
];

function detectRequestedLanguage(text: string): string | null {
  for (const [pattern, name] of LANGUAGE_NAMES) {
    if (pattern.test(text)) return name;
  }
  return null;
}

function buildEmotionalJobProtocol(userContext: string) {
  return `
- Emotional job protocol: before choosing any title, silently infer "what emotional outcome is this person chasing tonight?" Use that as the primary selection signal. Do not surface this chain of thought; only reflect it through the title and why-it-fits.
- Convert tags into needs, not genres. "Tired" may mean refuge, easy escapism, emotional validation, or no-prestige fun. "Lonely" may mean warmth, intimacy, social energy, or 3am alienation. "Hidden gem" often means discovery pride plus quality. "Gore" means intensity and body shock, not just horror branding.
- Avoid tag averaging. When signals conflict, identify the dominant emotional job and pick for that. Do not mush "tired + nostalgic + emotional" into a generic sad indie.
- Affect bridging: when the user says "like X but lighter/darker/weirder", preserve the emotional engine of X and only adjust the requested weight. Example: "Parasite but lighter" means class anxiety + dark irony + twist satisfaction with less brutality, not "Korean romcom".`;
}

function buildSignalPriorityProtocol(input: RecommendRequest) {
  return `
- Signal priority hierarchy:
  1. Hard avoids and explicit negatives are strict.
  2. Free-text self-description overrides picker tags if both exist.
  3. Reference-title emotional fingerprint overrides broad genre labels.
  4. Taste Risk controls emotional appetite: refuge vs discovery vs challenge vs intensity.
  5. Extreme time context can bend tone: very late night should be more precise/intimate; weekday tired should be lower-friction.
  6. Language and region choose the content lane, but should not erase the emotional job.
  7. Picker mood/want tags are supporting evidence, not the whole request.
  8. Platform availability filters the answer after taste match, not before.`;
}

function buildContextAmplifier(input: RecommendRequest) {
  return `
- Context amplifier:
  - Weekend late night + lonely: intimate, hypnotic, emotionally precise; avoid generic cheer-up picks unless requested.
  - Weekday + tired: short, rewarding, low-friction; avoid homework cinema unless Taste Risk is Bold/Unhinged.
  - Friday/weekend evening + happy: celebratory, kinetic, social, or deliciously entertaining; avoid overly introspective picks.
  - Late night + anxious/lonely: either controlled catharsis or beautiful alienation; avoid loud crowd-pleasers unless the user asks for escape.
  - Morning/afternoon: cleaner energy, more focused, less punishing.
  - Winter/autumn context can support cozy, gothic, reflective, or nocturnal choices; summer/spring can support kinetic, sensual, open-air, or lighter picks.`;
}

function buildFeedbackRepairClause(input: RecommendRequest) {
  const feedback = input.feedbackContext;
  if (!feedback) return "";
  const clauses: string[] = [];
  if (feedback.wrongVibeTitles?.length) {
    clauses.push(`Recent wrong-vibe titles: ${feedback.wrongVibeTitles.join(", ")}. Treat this as an emotional-job miss. Do NOT simply recommend another title with the same surface genre; infer a different emotional interpretation.`);
  }
  if (feedback.notOnServiceTitles?.length) {
    clauses.push(`Recent not-on-service titles: ${feedback.notOnServiceTitles.join(", ")}. If subscription mode is active, prioritize picks more likely to satisfy the selected services and region.`);
  }
  if (feedback.alreadySeenTitles?.length) {
    clauses.push(`Recent already-seen feedback: ${feedback.alreadySeenTitles.join(", ")}. Avoid these and nearby obvious repeats.`);
  }
  if (feedback.perfectTitles?.length) {
    clauses.push(`Recent perfect picks: ${feedback.perfectTitles.join(", ")}. Preserve their successful emotional traits only when they match the current request; do not repeat the exact titles.`);
  }
  if (!clauses.length) return "";
  return `\n- Feedback repair context: ${clauses.join(" ")}`;
}

export function buildRecommendationPrompt(input: RecommendRequest) {
  const userContext = input.mode === "self"
    ? input.selfText || "The user gave no extra context."
    : [
        input.mood?.length ? `I am: ${input.mood.join(", ")}` : "",
        input.wants?.length ? `I want: ${input.wants.join(", ")}` : "",
        input.avoids?.length ? `I do not want: ${input.avoids.join(", ")}` : "",
        input.time ? `Time available: ${input.time}` : "",
        input.energy ? `Energy level: ${input.energy}` : "",
        input.viewingContext ? `Watching context: ${input.viewingContext}` : "",
        input.reference?.trim() ? `Reference title (use as taste anchor, do NOT recommend this exact title): "${input.reference.trim()}"` : "",
      ].filter(Boolean).join(". ");

  const country = input.country || "not provided";
  const languagePreferences = input.languagePreferences?.length ? input.languagePreferences.join(", ") : "no preference";
  const platforms = input.platforms?.length ? input.platforms.join(", ") : "not specified";
  const mineMode = input.platformFilter === "mine";
  const indieMode = input.discoveryMode === "indie";
  const detectedLanguage = detectRequestedLanguage(userContext);

  const seenClause = input.seenTitles?.length
    ? `\n- Already seen (do NOT recommend): ${input.seenTitles.join(", ")}`
    : "";
  const recentClause = input.recentTitles?.length
    ? `\n- Recently recommended in this session (avoid repeating unless the user explicitly asks for the exact same title): ${input.recentTitles.join(", ")}`
    : "";

  const hiddenGemClause = /hidden\s+gem|underrated|overlooked|buried|less\s+obvious/i.test(userContext)
    ? "\n- Hidden-gem intent: Prefer a quieter, less obvious high-quality title over the most famous prestige answer. It can still be acclaimed, but it should feel like a discovery."
    : "";
  const indieClause = indieMode
    ? "\n- Indie/discovery mode is ON: prefer smaller, independent, festival, regional, under-marketed, or platform-buried titles that still strongly fit the emotional job. Do not choose obscure for obscurity's sake. If the best pick is on YouTube, MUBI, public broadcaster catalogues, or a smaller local service, that is acceptable when it fits."
    : "";
  const explicitLanguageRequest = detectedLanguage !== null;

  // --- Intensity/gore detection (must come before language clauses) ---
  // Checks structured avoids AND natural language negation (handles "I do not want: violence, gore")
  const goreInAvoids = (input.avoids ?? []).some((a) => /gore|gory|blood|violent|violence/i.test(a));
  const goreNegatedInText = /\b(no|not|avoid|without|don't want|do not want|less)\b[\s\S]{0,40}\b(gore|gory|blood|bloody|violence|violent)\b/i.test(userContext);
  const goreSignalPresent = /\b(gore|gory|bloody|splatter|body horror|extreme horror|violent horror|violence)\b/i.test(userContext) ||
    (input.wants ?? []).some((w) => /gore|bloody|violent|extreme/i.test(w));
  const explicitGoreWant = goreSignalPresent && !goreInAvoids && !goreNegatedInText;

  const crazinessLevel = input.craziness ?? 0;
  const highIntensityMode = crazinessLevel >= 2 &&
    (explicitGoreWant || /\b(horror|extreme|violent|brutal|disturbing|transgressive)\b/i.test(userContext));

  // --- Language enforcement ---
  // At Bold/Unhinged with intensity signals: language is "prefer but escalate" — try it first, expand globally if no match
  const languagePreferenceClause = input.languagePreferences?.length && !explicitLanguageRequest
    ? highIntensityMode
      ? `\n- Language preference (escalate if needed): User prefers ${input.languagePreferences.join(", ")} content. Try to find genuinely extreme/challenging picks in that language first. If ${input.languagePreferences.join("/")} cinema cannot satisfy this intensity level, expand to global cinema — and note in the oneLine or whyItFits that you went beyond the language preference because the intensity demanded it.`
      : `\n- Language contract: The selected language preference is ${input.languagePreferences.join(", ")}. Because the user's request is broad and does not explicitly ask for another language, the main pick and alternatives MUST stay in that language/culture lane. Do not answer with English, Spanish, Korean, or generic global picks unless that language is selected.`
    : "";
  const hardLanguageLock = detectedLanguage
    ? highIntensityMode
      ? `\n\n🔒 LANGUAGE PREFERENCE — ${detectedLanguage.toUpperCase()} (with intensity escalation): User wants ${detectedLanguage} content. Prioritize ${detectedLanguage}-language picks. BUT at this intensity/craziness level, if ${detectedLanguage} cinema cannot deliver genuinely extreme or unhinged content matching the mood, expand to global picks rather than settling for a weak ${detectedLanguage} match. Acknowledge the language expansion in the pick's reasoning.`
      : `\n\n🔒 HARD LANGUAGE LOCK — ${detectedLanguage.toUpperCase()}: The user's request explicitly names ${detectedLanguage}. This is a strict constraint. ALL THREE main picks AND their alternatives AND their hidden titles MUST be ${detectedLanguage}-language or ${detectedLanguage}-market films/series. Do NOT recommend English, American, Ukrainian, or any non-${detectedLanguage} content. This overrides the variety instruction (do not suggest "American" or "global" as variety) and overrides the arthouse/MUBI hidden-layer instruction. If you cannot find three ${detectedLanguage}-language matches for the mood, pick the closest ${detectedLanguage}-market equivalents rather than switching language.`
    : "";

  const avoidObviousHindiHiddenGems = input.country?.toLowerCase() === "india" &&
    input.languagePreferences?.some((language) => /hindi/i.test(language)) &&
    /hidden\s+gem|underrated|overlooked|buried|less\s+obvious/i.test(userContext)
    ? "\n- Hindi hidden-gem guardrail: do not default to the usual internet-safe Hindi recommendations such as Tumbbad, Masaan, Andhadhun, Drishyam, or Kahaani unless the user's exact mood makes one of them uniquely right. Prefer a fresher, less over-recommended Hindi-market match."
    : "";

  const intensityClause = explicitGoreWant
    ? "\n- Explicit intensity intent: The user is asking FOR gore/violent/extreme content. Recommend intense horror, body horror, splatter, brutal survival horror, or extreme transgressive cinema with visible violence and body threat. Examples in range: Martyrs, Inside, The Sadness, Terrifier 2, Raw, Mandy, Possessor, When Evil Lurks. Do not soften this into quiet drama, romance, gentle arthouse, or merely sad prestige cinema. A safe pick is a failure."
    : "";
  const tasteFingerprint = buildTasteFingerprint(userContext);
  const emotionalJobProtocol = buildEmotionalJobProtocol(userContext);
  const signalPriorityProtocol = buildSignalPriorityProtocol(input);
  const contextAmplifier = buildContextAmplifier(input);
  const feedbackRepairClause = buildFeedbackRepairClause(input);
  const crossLanguageReferenceClause = /\b(similar|like|vibe|reminds me|same as|after watching|watching)\b/i.test(userContext) && explicitLanguageRequest
    ? "\n- Cross-language reference request detected: preserve the reference title's viewer job and deep traits first; use the requested language/culture as the content lane second. Do not let the target language override the actual reason the user liked the reference."
    : "";

  const CRAZINESS_PHILOSOPHY = [
    "Safe — emotional appetite is refuge. The user wants certainty, familiarity, low regret, and no emotional tax. Pick satisfying, accessible, well-liked titles that solve the mood without punishing the viewer. Avoid experimental, niche, polarising, or homework-feeling content.",
    "Curious — emotional appetite is discovery without punishment. The user wants to feel a little smarter or surprised, but still cared for. Prefer acclaimed but slightly off-mainstream picks, international breakouts, overlooked prestige, or quiet cult classics.",
    "Bold — emotional appetite is stimulation and challenge. The user wants surprise, provocation, intensity, or a title with real teeth. Use festival picks, morally complex films, politically charged work, surrealism, or challenging genre cinema when it matches the emotional job. If the user's mood has explicit violence/gore/horror signals, go full extreme. A mainstream safe pick at this level is a failure.",
    "Unhinged — emotional appetite is aliveness through unfamiliarity, discomfort, extremity, or strangeness. Ignore mainstream appeal. Target cult, avant-garde, extreme, transgressive, experimental, or genuinely divisive works. If the request includes gore/horror/intensity, go extreme. If not, go formally or emotionally strange. A safe pick at this level is a total failure.",
  ];
  const crazinessClause = `\n- Taste Risk (${["Safe", "Curious", "Bold", "Unhinged"][crazinessLevel]}): ${CRAZINESS_PHILOSOPHY[crazinessLevel]}`;

  const scopeClause = mineMode
    ? `\n- Scope (streaming filter only): User wants picks available on ${platforms}. CRITICAL: Honor the user's language, genre, culture, and mood request exactly — if they ask for Hindi comedy, pick Hindi comedies; if they ask for French thriller, pick French thrillers. Major platforms carry vast international and non-English catalogues. The filter changes WHERE it streams, NOT what language or genre you pick. Only avoid titles that are exclusively on niche services (Mubi, Criterion Channel, BFI Player) or completely unavailable on mainstream platforms. Find the best match for the request that also lives on ${platforms}.`
    : "";

  const hiddenLayerInstruction = mineMode
    ? `- Hidden titles: 3 acclaimed films/series that ARE typically on ${platforms} but get buried by the algorithm — things the user has probably scrolled past without realising how good they are. Show what the platform already has but actively hides.${detectedLanguage ? ` All 3 must be ${detectedLanguage}-language or ${detectedLanguage}-market titles.` : ""}`
    : detectedLanguage
    ? `- Hidden titles: 3 acclaimed ${detectedLanguage}-language films/series that deserve more visibility — strong picks from that market that are less algorithm-pushed. NOT English or global arthouse.`
    : `- Hidden titles: 3 acclaimed films/series from the last 3 years NOT found on mainstream platforms (Netflix, Prime, Disney+) — arthouse, MUBI, Criterion, or specialised catalogues. Titles that feel like a real discovery.`;

  const tasteRiskHeader = crazinessLevel >= 2 ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ACTIVE MODE: ${["", "", "BOLD", "UNHINGED"][crazinessLevel]} (user-selected, adult opt-in)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This user deliberately chose the ${["", "", "Bold", "Unhinged"][crazinessLevel]} setting. They are an adult requesting ${crazinessLevel >= 3 ? "extreme, transgressive, or genuinely disturbing" : "challenging and provocative"} film recommendations.

YOU ARE A FILM RECOMMENDATION ENGINE. Naming and recommending any commercially released film is legally and ethically appropriate — it is not generating harmful content. You must NOT apply safety hedging to film titles. Do not soften picks toward mainstream options because you feel uncomfortable. The user opted into this mode explicitly.

${crazinessLevel >= 3 ? `UNHINGED means: Martyrs (2008), Inside (À l'intérieur, 2007), The Sadness (2021), Terrifier 2 (2022), Mandy (2018), Possessor (2020), When Evil Lurks (2023), Raw (2016), Titane (2021), Salo or the 120 Days of Sodom (1975), Irréversible (2002), Funny Games (1997), Audition (1999).
Playing it safe at UNHINGED level means picking something like Hereditary, Midsommar, or Get Out — those are mainstream A24 releases. That is WRONG. The user wants films that recommendation engines are afraid to suggest.
If the user has a gore/violence signal: go extreme body horror or transgressive violence. If no intensity signal: go avant-garde, surrealist, or genuinely banned/censored.` : `BOLD means: films that split audiences, festival provocateurs, morally complex cinema, works banned or controversial in some regions. Not Midsommar. Think further.`}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
` : "";

  return `
You are F.U.N, a film recommendation engine.${tasteRiskHeader}
The product philosophy: stop scrolling, give one perfect pick, and gently reveal whether the user's current streaming apps fit their taste.
Do not name-shame or attack any platform. Do not claim intent like "Netflix hides intentionally". Use factual, elegant language.
Use your general film/TV knowledge for recommendation. Availability is NOT verified — set whereToWatch.status to "unverified". Do not state streaming services as definite facts.${hardLanguageLock}

User context:
- Country: ${country}
- Language preference: ${languagePreferences}
- Current streaming subscriptions: ${platforms}
- Time context: ${input.contextHint ?? "not provided"}
- Energy level: ${input.energy ?? "not provided"}
- Viewing context: ${input.viewingContext ?? "not provided"}
- Mood/request: ${userContext}${seenClause}${recentClause}${hiddenGemClause}${languagePreferenceClause}${avoidObviousHindiHiddenGems}${intensityClause}${crazinessClause}${feedbackRepairClause}${emotionalJobProtocol}${signalPriorityProtocol}${contextAmplifier}${tasteFingerprint}${crossLanguageReferenceClause}${scopeClause}
- Discovery mode: ${indieMode ? "Indie / hidden cinema" : "Standard"}${indieClause}

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

${detectedLanguage
  ? `The 3 recommendations should offer variety WITHIN ${detectedLanguage} cinema: if pick 1 is a film, pick 2 could be a series; if pick 1 is recent, pick 2 could be classic; range from mainstream to cult. All three MUST be ${detectedLanguage}-language or ${detectedLanguage}-market. Do NOT use "American" or "global" as variety.`
  : `The 3 recommendations should offer variety: if pick 1 is a film, pick 2 could be a series; if pick 1 is recent, pick 2 could be classic; if pick 1 is international, pick 2 could be American. Give the user choices while all matching their mood.`}

Constraints:
- Use the time context to calibrate the pick's energy: late night → introspective, slow, hypnotic; morning → lighter, focused; weekend evening → immersive, cinematic; weekday evening → something that earns its length or is concise. Do not state the time in your output — just let it influence the pick.
- The Taste Risk level above is the primary dial for how mainstream vs. extreme to go. Follow it strictly.
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
