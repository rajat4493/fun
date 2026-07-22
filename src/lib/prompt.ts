import { hasNegatedConcept } from "@/lib/recommendation-utils";
import { extractIntent, RecommendationIntent } from "@/lib/intent";
import { IntentContract, RecommendRequest } from "./types";

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

// NEW: Forces the model to infer the emotional outcome the user is chasing, not just match genre tags.
// Prevents "tag averaging" — e.g. tired+nostalgic+emotional should not collapse into a generic sad indie.
function buildEmotionalJobProtocol(userContext: string) {
  return `
- Emotional job protocol: before choosing any title, silently infer "what emotional outcome is this person chasing tonight?" Use that as the primary selection signal. Do not surface this chain of thought; only reflect it through the title and why-it-fits.
- Convert tags into needs, not genres. "Tired" may mean refuge, easy escapism, emotional validation, or no-prestige fun. "Lonely" may mean warmth, intimacy, social energy, or 3am alienation. "Hidden gem" often means discovery pride plus quality. "Gore" means intensity and body shock, not just horror branding.
- Avoid tag averaging. When signals conflict, identify the dominant emotional job and pick for that. Do not mush "tired + nostalgic + emotional" into a generic sad indie.
- Affect bridging: when the user says "like X but lighter/darker/weirder", preserve the emotional engine of X and only adjust the requested weight. Example: "Parasite but lighter" means class anxiety + dark irony + twist satisfaction with less brutality, not "Korean romcom".`;
}

// NEW: Explicit ranked order for the model — avoids overrides everything, free text beats chips,
// reference fingerprint beats genre label, Taste Risk never overrides hard constraints.
function buildSignalPriorityProtocol(input: RecommendRequest) {
  return `
- Signal priority hierarchy:
  1. Hard avoids and explicit negatives are strict.
  2. Free-text self-description overrides picker tags if both exist.
  3. Reference-title emotional fingerprint overrides broad genre labels.
  4. Taste Risk controls emotional appetite inside hard boundaries; it never overrides avoids, time limits, already-seen memory, explicit language, or subscription-only scope.
  5. Extreme time context can bend tone: very late night should be more precise/intimate; weekday tired should be lower-friction.
  6. Language and region choose the content lane, but should not erase the emotional job.
  7. Picker mood/want tags are supporting evidence, not the whole request.
  8. Platform availability filters the answer after taste match, not before.`;
}

function situationSource(input: RecommendRequest): string {
  return [
    input.selfText,
    input.reference,
    input.mood?.join(" "),
    input.wants?.join(" "),
    input.avoids?.join(" "),
    input.time,
    input.energy,
    input.contextHint,
  ].filter(Boolean).join(" ").toLowerCase();
}

function buildSituationClause(input: RecommendRequest, intent: RecommendationIntent): string {
  const text = situationSource(input);
  const clauses: string[] = [];
  const explicitIntents = new Set(intent.primaryIntents);

  if (/\b(journey|travel|travelling|traveling|train|flight|plane|airport|bus|cab|taxi|uber|commute|road trip|on the way|in transit)\b/i.test(text)) {
    clauses.push("In-transit viewing detected: favor interruption-tolerant, easy re-entry stories that work on a smaller screen. Prefer clear momentum, strong premise, and moderate runtime. Avoid subtitle-heavy visual slow burns, films that require perfect silence, or dense plots where missing two minutes ruins the experience.");
  }

  if (/\b(lunch break|work break|at work|office break|between meetings|quick break)\b/i.test(text)) {
    clauses.push("Work-break viewing detected: treat time and social safety as hard practical constraints. Favor short episodes, cleanly contained films, or low-awkwardness comedy/drama. Avoid sexually awkward, graphically violent, or emotionally wrecking picks.");
  }

  if (/\b(before (a |an |the )?(meeting|interview|exam|presentation|call)|calm down|need to calm|anxious before)\b/i.test(text)) {
    clauses.push("Pre-event calming detected: the pick should regulate the viewer, not spike adrenaline. Favor soothing structure, warmth, gentle humor, or focused beauty. Avoid cliffhangers, frantic pacing, dread, and unresolved endings.");
  }

  if (/\b(waiting|delayed|delay|waiting room|station|gate|layover|queue)\b/i.test(text)) {
    clauses.push("Waiting-time viewing detected: the session length may be uncertain. Favor absorbing but interruptible stories with quick hooks. Avoid very slow setup, emotionally punishing arcs, or films that only pay off after a long final act.");
  }

  if (
    /\b(date night|date-night|with my date|romantic night|watching with (my )?(partner|boyfriend|girlfriend|wife|husband))\b/i.test(text) &&
    !["scare", "cry", "gore", "thriller"].some(i => explicitIntents.has(i))
  ) {
    clauses.push("Date-night viewing detected: favor shared chemistry, emotional readability, conversational aftertaste, and endings that do not sour the room. If the user asks for romance or funny, avoid bleak endings and awkwardly explicit content unless explicitly requested.");
  }

  if (/\b(parents|parent|family|with family|mom|mum|mother|dad|father|in-laws|kids|children)\b/i.test(text)) {
    clauses.push("Family/parents viewing detected: prioritize cross-generational comfort and avoid awkward sexual content, graphic violence, excessive profanity, or nihilistic heaviness unless explicitly requested. The pick should feel safe to watch in a shared living room.");
  }

  if (/\b(before bed|bedtime|late night|can't sleep|cant sleep|insomnia|lonely before bed|sleepy)\b/i.test(text)) {
    clauses.push("Bedtime/late-night viewing detected: favor emotionally settling, intimate, or hypnotic picks with low start-up friction. Avoid noisy chaos, punishing endings, or anything likely to leave the viewer agitated unless Bold/Unhinged is explicitly selected.");
  }

  if (/\b(with friends|friends over|group watch|movie night|party|hangout|hanging out)\b/i.test(text)) {
    clauses.push("Group/friends viewing detected: favor social energy, quotable moments, fast hooks, and shared reactions. Avoid quiet internal character studies or films that need total silence to work.");
  }

  if (!clauses.length) return "";

  return `\n  - Situation context from free text: ${clauses.join(" ")} Why-it-fits reasons must reference this situation when it is central to the request.`;
}

function buildPracticalConstraints(input: RecommendRequest, userContext: string, intent: RecommendationIntent): string[] {
  const constraints: string[] = [];
  const text = userContext.toLowerCase();
  const minuteLimit = text.match(/\b(?:under|less than|within|up to|max(?:imum)?|no more than)\s+(\d{1,3})\s*(?:min|mins|minutes)\b/);
  const plainMinutes = text.match(/\b(\d{1,3})\s*(?:min|mins|minutes)\b/);

  if (intent.requestedFormat === "episode" || /\b(one|1)\s+episode\b|\ban episode\b/i.test(text) || input.time?.toLowerCase().includes("one episode")) {
    constraints.push("Format/time: recommend a specific one-episode watch. Set format to Episode or make runtime clearly say per episode. Do not return a general series/binge recommendation.");
  } else if (intent.requestedFormat === "film") {
    constraints.push("Format: recommend a movie/film, not a series or full-season suggestion.");
  } else if (intent.requestedFormat === "series") {
    constraints.push("Format: recommend a series/show, not a film, unless availability makes a film the only honest fit.");
  }

  const limit = intent.runtimeLimitMinutes ?? (minuteLimit ? Number(minuteLimit[1]) : plainMinutes ? Number(plainMinutes[1]) : null);
  if (limit && limit >= 10 && limit <= 240) {
    constraints.push(`Runtime: stay within ${limit} minutes.`);
  } else if (/\b(?:under|less than|within|up to|max(?:imum)?|no more than)\s+(?:two|2)\s+hours?\b/i.test(text) || input.time?.toLowerCase().includes("under 2")) {
    constraints.push("Runtime: stay under two hours.");
  }

  if (intent.familySafe || /\b(family safe|family-safe|with family|with parents|parents|kids|children)\b/i.test(text)) {
    constraints.push("Content safety: suitable for family/parents; avoid explicit sex, graphic violence, horror, and awkward adult content.");
  }
  if (intent.workSafe || /\b(work safe|work-safe|at work|office|lunch break|between meetings)\b/i.test(text)) {
    constraints.push("Content safety: work-safe; avoid explicit sex, graphic violence, and socially awkward material.");
  }

  return constraints;
}

// Time/day context and typed situation still shape the pick. Structured viewingContext is muted for this version
// because QA showed it can override explicit typed intent.
function buildContextAmplifier(input: RecommendRequest, intent: RecommendationIntent) {
  const energyMap: Record<string, string> = {
    "very low": "Content must feel like a reward, not a task. No complex exposition dumps, no demanding narrative grammar, no slow-burn that requires patience. The viewer needs to be carried by familiar storytelling grammar, forward momentum, and payoff without effort.",
    "low": "Moderate engagement is fine. Some narrative complexity is acceptable. The pick should be involving but not punishing; the viewer can miss a small detail and not lose the thread.",
    "medium": "Full narrative engagement is welcome. Character depth, layered storytelling, moral ambiguity, and slower build are acceptable when they serve the emotional job.",
    "high": "Intellectually or formally demanding content is appropriate. Experimental structure, morally complex territory, and active-viewer films can work when requested by mood and Taste Risk.",
  };
  const energyClause = input.energy
    ? `\n  - Energy mapping (${input.energy}): ${energyMap[input.energy.toLowerCase()] ?? "Calibrate narrative complexity to the stated energy level."}`
    : "";

  const situationClause = buildSituationClause(input, intent);

  return `
- Context amplifier:
  - Weekend late night + lonely: intimate, hypnotic, emotionally precise; avoid generic cheer-up picks unless requested.
  - Weekday + tired: short, rewarding, low-friction; avoid homework cinema unless Taste Risk is Bold/Unhinged.
  - Friday/weekend evening + happy: celebratory, kinetic, social, or deliciously entertaining; avoid overly introspective picks.
  - Late night + anxious/lonely: either controlled catharsis or beautiful alienation; avoid loud crowd-pleasers unless the user asks for escape.
  - Morning/afternoon: cleaner energy, more focused, less punishing.
  - Winter/autumn context can support cozy, gothic, reflective, or nocturnal choices; summer/spring can support kinetic, sensual, open-air, or lighter picks.${energyClause}${situationClause}`;
}

// UPDATED: Added good-not-perfect (emotional register slightly off → adjust precision)
// and too-much-effort (cognitive tax too high → lower complexity next pick).
// These were captured in the UI but previously discarded before reaching the model.
function buildFeedbackRepairClause(input: RecommendRequest) {
  const feedback = input.feedbackContext;
  if (!feedback) return "";
  const clauses: string[] = [];
  if (feedback.wrongVibeTitles?.length) {
    clauses.push(`Wrong-vibe titles: ${feedback.wrongVibeTitles.join(", ")}. This was an emotional-job miss — the surface genre may have matched but the feeling did not. Infer a different emotional interpretation. Consider trying a different format (film vs. series), a different emotional register (lighter/darker/weirder), or a completely different genre that serves the same underlying need.`);
  }
  if (feedback.notOnServiceTitles?.length) {
    clauses.push(`Not-on-service titles: ${feedback.notOnServiceTitles.join(", ")}. Prioritize picks with higher regional availability likelihood for this country and subscription set.`);
  }
  if (feedback.alreadySeenTitles?.length) {
    clauses.push(`Already-seen titles: ${feedback.alreadySeenTitles.join(", ")}. Avoid these and their obvious adjacents.`);
  }
  if (feedback.perfectTitles?.length) {
    clauses.push(`Perfect picks: ${feedback.perfectTitles.join(", ")}. Extract the emotional traits that made these work and carry them forward — but do not repeat the titles or their closest sequels.`);
  }
  if (feedback.goodButNotPerfectTitles?.length) {
    clauses.push(`Good-but-not-perfect watched picks: ${feedback.goodButNotPerfectTitles.join(", ")}. The emotional direction was close, but the pick lacked precision. Preserve the underlying need, then adjust tone, pacing, or specificity instead of repeating the same lane.`);
  }
  if (feedback.notForMeTitles?.length) {
    clauses.push(`Watched but not-for-me titles: ${feedback.notForMeTitles.join(", ")}. Treat these as completed-watch taste misses, not obvious pre-watch mismatches. Avoid their emotional texture, pacing, and appeal pattern unless the new request explicitly asks for it.`);
  }
  if (feedback.quitHalfwayTitles?.length) {
    clauses.push(`Quit-halfway titles: ${feedback.quitHalfwayTitles.join(", ")}. Reduce friction: less setup burden, clearer momentum, and a stronger early hook unless the user explicitly asks for slow or demanding cinema.`);
  }
  // New signals from expanded feedback UI
  if (feedback.lastReason === "good-not-perfect") {
    clauses.push(`Last pick was "good but not perfect" — the user was close but not satisfied. Adjust the emotional register: try something sharper, softer, shorter, longer, or more specific. The emotional job is right; the execution or precision of the pick was slightly off. Do not pick the same tone or genre lane again.`);
  }
  if (feedback.lastReason === "too-much-effort") {
    clauses.push(`Last pick felt like "too much effort" — cognitive/emotional tax was too high. The user wants something that feels like a reward, not homework. Lower the narrative complexity, avoid slow-burn or demanding pacing, and prefer content with satisfying forward momentum and a familiar enough grammar that the viewer does not have to work to follow it.`);
  }
  if (feedback.lastReason === "not-for-me") {
    clauses.push(`Last watched pick was "not for me" — do not overfit to its genre label. Reinterpret the emotional job and choose a different appeal pattern.`);
  }
  if (feedback.lastReason === "quit-halfway") {
    clauses.push(`Last watched pick was quit halfway — the next pick needs a cleaner early hook and lower start-up friction.`);
  }
  if (!clauses.length) return "";
  return `\n- Feedback repair context: ${clauses.join(" ")}`;
}

function timeLabel(contextHint?: string): string {
  if (contextHint) {
    if (/late night|early hours/i.test(contextHint)) return "tonight";
    if (/morning/i.test(contextHint)) return "this morning";
    if (/afternoon/i.test(contextHint)) return "this afternoon";
    if (/evening/i.test(contextHint)) return "this evening";
  }
  return "right now";
}

function intentContractClause(intentContract?: IntentContract): string {
  if (!intentContract) return "";
  return `

AUTHORITATIVE INTENT CONTRACT
- Primary emotional outcome: ${intentContract.primary}
- Secondary signals: ${intentContract.secondary.length ? intentContract.secondary.join(", ") : "none"}
- Hard avoids: ${intentContract.hardAvoids.length ? intentContract.hardAvoids.join(", ") : "none"}
- Soft avoids: ${intentContract.softAvoids.length ? intentContract.softAvoids.join(", ") : "none"}
- Format: ${intentContract.format}
- Language/culture lane: ${intentContract.language}
- Situation: ${intentContract.situation.length ? intentContract.situation.join(", ") : "none"}
- Intensity: ${intentContract.intensity}
- Emotional goal: ${intentContract.emotionalGoal}
- Ambiguity note: ${intentContract.ambiguity || "none"}

Use this contract as the source of truth for what the user means. Do not re-infer the opposite from a single word in the raw text.`;
}

export function buildRecommendationPrompt(input: RecommendRequest, options?: { strictSubscription?: boolean; intentContract?: IntentContract }) {
  const momentLabel = timeLabel(input.contextHint);
  const userContext = input.mode === "self"
    ? input.selfText || "The user gave no extra context."
    : [
        input.mood?.length ? `I am: ${input.mood.join(", ")}` : "",
        input.wants?.length ? `I want: ${input.wants.join(", ")}` : "",
        input.avoids?.length ? `I do not want: ${input.avoids.join(", ")}` : "",
        input.time ? `Time available: ${input.time}` : "",
        input.energy ? `Energy level: ${input.energy}` : "",
        // Structured viewingContext is intentionally muted for this version.
        input.reference?.trim() ? `Reference title (use as taste anchor, do NOT recommend this exact title): "${input.reference.trim()}"` : "",
      ].filter(Boolean).join(". ");

  const intent = extractIntent(input);
  const contract = options?.intentContract;
  const contractClause = intentContractClause(contract);
  const country = input.country || "not provided";
  const languagePreferences = input.languagePreferences?.length ? input.languagePreferences.join(", ") : "no preference";
  const platforms = input.platforms?.length ? input.platforms.join(", ") : "not specified";
  const mineMode = input.platformFilter === "mine";
  const indieMode = input.discoveryMode === "indie";
  const detectedLanguage = detectRequestedLanguage(userContext);
  const avoidanceTiers = { hard: intent.hardAvoids, soft: intent.softAvoids };
  const practicalConstraints = buildPracticalConstraints(input, userContext, intent);

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
  const goreInAvoids = intent.hardAvoids.some((a) => /gore|gory|blood|violent|violence/i.test(a));
  const goreNegatedInText = hasNegatedConcept(userContext, /\b(gore|gory|blood|bloody|violence|violent)\b/i);
  const goreSignalPresent = /\b(gore|gory|bloody|splatter|body horror|extreme horror|violent horror|violence)\b/i.test(userContext) ||
    (input.wants ?? []).some((w) => /gore|bloody|violent|extreme/i.test(w));
  const explicitGoreWant = intent.primaryIntents.includes("gore") || (goreSignalPresent && !goreInAvoids && !goreNegatedInText);

  const selectedCrazinessLevel = typeof input.craziness === "number" ? input.craziness : null;
  const crazinessLevel = selectedCrazinessLevel ?? 1;
  const fearSignalPresent = /\b(shit scared|scare|scared|scary|terrify|terrified|terrifying|frighten|frightened|frightening|creep out|creepy|horror|dread|nightmare|haunted|ghost|possession|demonic|jump scare|jumpscare)\b/i.test(userContext);
  const fearNegatedOrAvoided = hasNegatedConcept(userContext, /\b(scary|scare|scared|terrify|terrified|frighten|frightened|horror|dread|nightmare|haunted|ghost|possession|demonic|jump scare|jumpscare)\b/i) ||
    (input.avoids ?? []).some((a) => /\b(horror|scary|scare|ghost|haunted|supernatural)\b/i.test(a));
  const explicitFearWant = intent.primaryIntents.includes("scare") || (fearSignalPresent && !fearNegatedOrAvoided);
  const intensityKeywordInText = /\b(horror|extreme|violent|brutal|disturbing|transgressive)\b/i.test(userContext);
  const intensityNegatedOrAvoided =
    hasNegatedConcept(userContext, /\b(horror|extreme|violent|brutal|disturbing|transgressive)\b/i) ||
    (input.avoids ?? []).some((a) => /\b(horror|extreme|violent|brutal|disturbing|transgressive)\b/i.test(a));
  const highIntensityMode = crazinessLevel >= 2 &&
    (explicitGoreWant || (intensityKeywordInText && !intensityNegatedOrAvoided));

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
  const fearIntentClause = explicitFearWant
    ? "\n- Explicit fear intent: The user wants to genuinely scare someone. Prioritize frightening horror, dread, supernatural terror, psychological fear, or high-tension nightmare cinema. Do NOT soften this into merely surreal, quirky, thoughtful, romantic, or gently unsettling drama. The oneLine and why-it-fits must make clear why it will actually scare the viewing partner while still respecting any hard avoidances."
    : "";
  const tasteFingerprint = buildTasteFingerprint(userContext);
  const emotionalJobProtocol = buildEmotionalJobProtocol(userContext);
  const signalPriorityProtocol = buildSignalPriorityProtocol(input);
  const contextAmplifier = buildContextAmplifier(input, intent);
  const feedbackRepairClause = buildFeedbackRepairClause(input);
  const crossLanguageReferenceClause = /\b(similar|like|vibe|reminds me|same as|after watching|watching)\b/i.test(userContext) && explicitLanguageRequest
    ? "\n- Cross-language reference request detected: preserve the reference title's viewer job and deep traits first; use the requested language/culture as the content lane second. Do not let the target language override the actual reason the user liked the reference."
    : "";

  const CRAZINESS_PHILOSOPHY = [
    "Safe — emotional appetite is refuge. The user wants certainty, familiarity, low regret, and no emotional tax. Pick satisfying, accessible, well-liked titles that solve the mood without punishing the viewer. Avoid experimental, niche, polarising, or homework-feeling content.",
    "Curious — emotional appetite is discovery without punishment. The user wants to feel a little smarter or surprised, but still cared for. Prefer acclaimed but slightly off-mainstream picks, international breakouts, overlooked prestige, or quiet cult classics.",
    "Bold — emotional appetite is stimulation and challenge. The user wants surprise, provocation, intensity, or a title with real teeth. Use festival picks, morally complex films, politically charged work, surrealism, or challenging genre cinema when it matches the emotional job. If the user's mood has explicit violence/gore/horror signals, go full extreme. A mainstream safe pick at this level is a failure.",
    `Unhinged — emotional appetite is aliveness through unfamiliarity and strangeness. Ignore mainstream appeal, but STAY INSIDE ALL HARD AVOIDANCES AND MOOD SIGNALS. The direction depends entirely on what the user actually asked for: ${highIntensityMode ? "(INTENSITY PATH) The user has explicit gore/horror/extreme signals — go transgressive, body horror, extreme cinema. A safe pick here is a failure." : "(STRANGE PATH) The user has NO gore or intensity signals. Go formally bizarre, avant-garde, absurdist, surrealist, or conceptually unprecedented. A film can be Unhinged without any darkness — it should make the user think 'I would never have found this myself.' A gore film when the user wanted funny or comforting is as much a failure as a safe mainstream pick."}`,
  ];
  const crazinessClause = selectedCrazinessLevel === null
    ? ""
    : `\n- Taste Risk (${["Safe", "Curious", "Bold", "Unhinged"][crazinessLevel]}): ${CRAZINESS_PHILOSOPHY[crazinessLevel]}`;

  const scopeClause = mineMode
    ? options?.strictSubscription
      ? `\n- ⚠️ STRICT SUBSCRIPTION RETRY: Your previous picks could not be verified on ${platforms} in ${country}. This is your second and final attempt. You MUST only recommend titles you are highly confident currently appear on ${platforms} in ${country}. If you are uncertain whether a title is on these platforms, do not choose it — pick your next-best option that you can be confident about. Setting a lower confidence score (70–80) is fine — honesty is better than a guess. Do NOT pick titles that are typically exclusive to other platforms, only available to buy/rent, or festival-only.`
      : `\n- Scope (streaming filter only): User wants picks available on ${platforms}. CRITICAL: Honor the user's language, genre, culture, and mood request exactly — if they ask for Hindi comedy, pick Hindi comedies; if they ask for French thriller, pick French thrillers. Major platforms carry vast international and non-English catalogues. The filter changes WHERE it streams, NOT what language or genre you pick. Only avoid titles that are exclusively on niche services (Mubi, Criterion Channel, BFI Player) or completely unavailable on mainstream platforms. Find the best match for the request that also lives on ${platforms}.`
    : "";

  const hiddenLayerInstruction = mineMode
    ? `- Hidden titles: 3 acclaimed films/series that ARE typically on ${platforms} but get buried by the algorithm — things the user has probably scrolled past without realising how good they are. Show what the platform already has but actively hides.${detectedLanguage ? ` All 3 must be ${detectedLanguage}-language or ${detectedLanguage}-market titles.` : ""}`
    : detectedLanguage
    ? `- Hidden titles: 3 acclaimed ${detectedLanguage}-language films/series that deserve more visibility — strong picks from that market that are less algorithm-pushed. NOT English or global arthouse.`
    : `- Hidden titles: 3 acclaimed films/series NOT commonly found on mainstream platforms (Netflix, Prime, Disney+) — arthouse, MUBI, Criterion, or specialised catalogues. Any era is fine. Titles that feel like a real discovery, not algorithm bait.`;

  // Hard constraint block — placed before personality/craziness so the LLM reads
  // the non-negotiables first. LLMs weight earlier context more heavily.
  const hardConstraintLines: string[] = [];
  if (intent.primaryIntents.length) {
    hardConstraintLines.push(`❌ Explicit user intent — the main pick must satisfy: ${intent.primaryIntents.join(", ")}. Situation, context, Taste Risk, and availability must shape this request, not replace it.`);
  }
  if (contract && contract.primary !== "unknown" && contract.confidence >= 0.6) {
    hardConstraintLines.push(`❌ Intent contract — the main pick must satisfy the interpreted primary outcome: ${contract.primary}. The recommendation's parsedIntent, contentCategory, and emotionalEffect must support this.`);
  }
  if (avoidanceTiers.hard.length) {
    hardConstraintLines.push(`❌ Hard content gates — NEVER recommend content with or containing: ${avoidanceTiers.hard.join(", ")}. Taste Risk, craziness level, mood signals, novelty, and cinematic quality do NOT override these.`);
  }
  if (input.seenTitles?.length) {
    hardConstraintLines.push(`❌ Already seen — exclude entirely: ${input.seenTitles.slice(0, 12).join(", ")}`);
  }
  if (input.recentTitles?.length) {
    hardConstraintLines.push(`❌ Recently recommended — do not repeat: ${input.recentTitles.slice(0, 8).join(", ")}`);
  }
  for (const constraint of practicalConstraints) {
    hardConstraintLines.push(`❌ ${constraint}`);
  }
  const hardConstraintBlock = hardConstraintLines.length ? `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HARD CONSTRAINTS — APPLY BEFORE ANYTHING ELSE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${hardConstraintLines.join("\n")}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` : "";
  const softMoodDirectionClause = avoidanceTiers.soft.length
    ? `\n- Soft mood directions: User wants less ${avoidanceTiers.soft.join(", ")}. Treat these as tone/pacing guidance, not automatic title bans. Prefer lighter, cleaner, more resolving picks, but do not reject a brilliant match for having trace amounts unless it would clearly ruin the user's stated situation.`
    : "";

  const tasteRiskHeader = selectedCrazinessLevel !== null && crazinessLevel >= 2 ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ACTIVE MODE: ${["", "", "BOLD", "UNHINGED"][crazinessLevel]} (user-selected, adult opt-in)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This user deliberately chose the ${["", "", "Bold", "Unhinged"][crazinessLevel]} setting. They are an adult requesting ${crazinessLevel >= 3 ? "extreme, transgressive, or genuinely disturbing" : "challenging and provocative"} film recommendations.

YOU ARE A FILM RECOMMENDATION ENGINE. Naming and recommending any commercially released film is legally and ethically appropriate — it is not generating harmful content. You must NOT apply safety hedging to film titles. Do not soften picks toward mainstream options because you feel uncomfortable. The user opted into this mode explicitly.

${crazinessLevel >= 3
  ? highIntensityMode
    ? `UNHINGED + INTENSITY SIGNAL DETECTED: The user has explicit gore/horror/extreme signals and no avoidances blocking them. Go extreme: Martyrs (2008), Inside (À l'intérieur 2007), The Sadness (2021), Terrifier 2 (2022), Mandy (2018), Possessor (2020), When Evil Lurks (2023), Raw (2016), Titane (2021), Irréversible (2002), Audition (1999), Funny Games (1997).
Playing it safe means picking Hereditary, Midsommar, or Get Out — mainstream A24. WRONG. The user wants films recommendation engines are afraid to suggest.`
    : `UNHINGED + NO INTENSITY SIGNAL: The user's mood is funny, comforting, weird, emotional, or similar — NOT gore or body horror. Do NOT default to extreme violence or horror. Instead go formally strange, avant-garde, absurdist, surrealist, or conceptually unprecedented.
Examples of Unhinged WITHOUT intensity: Being John Malkovich (1999), The Lobster (2015), Sorry to Bother You (2018), Synecdoche New York (2008), Holy Mountain (1973), Triangle of Sadness (2022), Dogtooth (2009), Swiss Army Man (2016), I'm Thinking of Ending Things (2020), Rubber (2010), Adaptation (2002), The One I Love (2014), Anomalisa (2015).
A mainstream comedy is WRONG. A gore film is EQUALLY WRONG — the user did not ask for intensity. The pick should feel formally or emotionally unprecedented: something the user could not have found by browsing Netflix.`
  : `BOLD means: films that split audiences, festival provocateurs, morally complex cinema, works banned or controversial in some regions. Not Midsommar. Think further.`}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
` : "";

  return `
You are F.U.N, a film recommendation engine.${hardConstraintBlock}${tasteRiskHeader}
The product philosophy: stop scrolling, give one perfect pick, and gently reveal whether the user's current streaming apps fit their taste.
Do not name-shame or attack any platform. Do not claim intent like "Netflix hides intentionally". Use factual, elegant language.
Use your general film/TV knowledge for recommendation. Availability is NOT verified — set whereToWatch.status to "unverified". Do not state streaming services as definite facts.${hardLanguageLock}

User context:
- Country: ${country}
- Language preference: ${languagePreferences}
- Current streaming subscriptions: ${platforms}
- Time context: ${input.contextHint ?? "not provided"}
- Energy level: ${input.energy ?? "not provided"}
- Viewing context: muted for this version unless the user typed it directly
  - Mood/request: ${userContext}${contractClause}${seenClause}${recentClause}${hiddenGemClause}${languagePreferenceClause}${avoidObviousHindiHiddenGems}${intensityClause}${fearIntentClause}${crazinessClause}${softMoodDirectionClause}${feedbackRepairClause}${emotionalJobProtocol}${signalPriorityProtocol}${contextAmplifier}${tasteFingerprint}${crossLanguageReferenceClause}${scopeClause}
- Discovery mode: ${indieMode ? "Indie / hidden cinema" : "Standard"}${indieClause}

Return an array of exactly THREE JSON objects (not a wrapper object) with this schema, no markdown:
[
  {
    "parsedIntent": {
      "primary": "one of: scare|cry|comedy|thriller|romance|weird|comfort|gore|drama|discovery|unknown",
      "secondary": ["optional short intent labels"],
      "hardAvoids": ["content boundaries the user clearly rejects"],
      "softAvoids": ["tone/pacing directions the user prefers less of"],
      "format": "film|series|episode|any",
      "language": "requested language/culture lane or 'any'",
      "situation": ["typed situation signals, e.g. partner, friends, bedtime, transit"],
      "intensity": "safe|curious|bold|unhinged",
      "ambiguity": "short note when text and selected controls conflict, otherwise empty string"
    },
    "title": "string",
    "year": "string",
    "format": "Film|Series|Episode|Documentary|Unknown",
    "runtime": "string",
    "vibe": "string (comma-separated descriptors)",
    "contentCategory": ["structured labels for what the title IS, e.g. horror, romance, comedy, drama, thriller, comfort"],
    "emotionalEffect": ["structured labels for what the title DOES to the viewer, e.g. fear, dread, catharsis, warmth, laughter, tension"],
    "confidence": number between 0 and 100,
    "oneLine": "one classy sentence telling the user why this is the right pick",
    "whyItFits": ["3 concise reasons why this matches the user's stated mood, constraints, and situation"],
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
- Fill parsedIntent BEFORE choosing the title. It is the contract you are satisfying, not post-rationalization. If the user says someone hates horror or does not want scary content, do NOT set primary to scare.
- Fill contentCategory and emotionalEffect as factual structured labels for the chosen title. These fields describe the title, not the user's avoidances. Do not include avoided labels just to say the film avoids them.
- Main pick: Your best match for the user's mood
- ${hiddenLayerInstruction}
- Alternatives: 3 related mood-adjacent picks
- Why-it-fits must prove the match: each reason should name a concrete shared trait from the request/reference, not generic praise like "strong characters" or "great story".
- Do not mention morning, afternoon, evening, late night, low energy, high energy, alone, partner, friends, or family in visible copy unless the user explicitly typed it or the selected control clearly makes it relevant. Never contradict a typed situation such as bedtime by saying afternoon.

${detectedLanguage
  ? `The 3 recommendations should offer variety WITHIN ${detectedLanguage} cinema: if pick 1 is a film, pick 2 could be a series; if pick 1 is recent, pick 2 could be classic; range from mainstream to cult. All three MUST be ${detectedLanguage}-language or ${detectedLanguage}-market. Do NOT use "American" or "global" as variety.`
  : `The 3 recommendations should offer variety: if pick 1 is a film, pick 2 could be a series; if pick 1 is recent, pick 2 could be classic; if pick 1 is international, pick 2 could be American. Give the user choices while all matching their mood.`}

Constraints:
- Hard boundaries are trust contracts. Hard content gates, already-seen titles, explicit language/culture requests, subscription-only scope, and time/format/content-safety constraints outrank Taste Risk, novelty, hidden-gem intent, and cinematic quality. "Unhinged" means unusual inside the boundaries, not boundary-breaking.
- Confidence score definition: 90–100 = you are certain this matches the emotional job and would surprise no one who knows the user's request. 75–89 = strong match with one or two small question marks. 60–74 = reasonable match but a clear compromise somewhere. Below 60 = do not include this pick; find a better one. Do not inflate confidence to seem authoritative.
- Regret minimization: before finalising a pick, run this silent check — "Would this person, after watching, feel this was the right choice for ${momentLabel}?" A technically good film that mismatches the user's current energy creates regret. A B+ film that perfectly matches their need creates satisfaction. Optimise for the latter.
- Peak-end rule: people remember how a film/series made them feel at its peak moment and at the end — not the average. For tired, low-energy, or emotionally depleted users, prioritise picks with emotionally satisfying or resolving endings. Avoid tonally ambiguous, punishing, or unresolved endings for these users unless Bold/Unhinged is selected.
- Use the time context to calibrate the pick's energy: late night → introspective, slow, hypnotic; morning → lighter, focused; weekend evening → immersive, cinematic; weekday evening → something that earns its length or is concise. Do not state the time in your output — just let it influence the pick.
- The Taste Risk level above is the primary dial for how mainstream vs. extreme to go after hard boundaries are satisfied. Follow it strictly within those boundaries.
- Strictly obey hard content avoidances only when they are in "I do not want" / avoids or phrased as no/avoid/without. Soft mood directions like less slow, less heavy, or no sad ending should guide tone unless the user's situation makes them practically hard. If the user simply asks for "gore", "gory", "bloody", "splatter", or "body horror", treat that as a positive request for intense horror.
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

type CompactRejection = {
  title: string;
  reasons: string[];
};

export function buildCompactRetryPrompt(input: RecommendRequest, rejections: CompactRejection[], intentContract?: IntentContract) {
  const intent = extractIntent(input);
  const country = input.country || "not provided";
  const platforms = input.platforms?.length ? input.platforms.join(", ") : "not specified";
  const languagePreferences = input.languagePreferences?.length ? input.languagePreferences.join(", ") : "no preference";
  const platformScope = input.platformFilter === "mine"
    ? `Only recommend titles you are highly confident are available on the user's subscriptions: ${platforms} in ${country}.`
    : "Availability will be checked after recommendation; do not claim verified streaming.";
  const rejectionsText = rejections.length
    ? rejections.slice(0, 8).map((item) => `- ${item.title}: ${item.reasons.join("; ")}`).join("\n")
    : "- none";

  return `
You are F.U.N. The first recommendation attempt failed backend trust checks.
Return exactly THREE different recommendations as valid JSON only. No markdown.

User contract:
- Request text: ${intent.requestText || "not provided"}
- Country: ${country}
- Language preference: ${languagePreferences}
- Platform scope: ${platformScope}
- Primary intent(s): ${intent.primaryIntents.length ? intent.primaryIntents.join(", ") : "infer from request"}
- Interpreted intent contract: ${intentContract ? `${intentContract.primary} — ${intentContract.emotionalGoal}` : "not available"}
- Hard avoids: ${intent.hardAvoids.length ? intent.hardAvoids.join(", ") : "none"}
- Soft avoids: ${intent.softAvoids.length ? intent.softAvoids.join(", ") : "none"}
- Requested format: ${intent.requestedFormat ?? "any"}
- Runtime limit: ${intent.runtimeLimitMinutes ? `${intent.runtimeLimitMinutes} minutes` : "none"}
- Hidden-gem intent: ${intent.hiddenGem ? "yes" : "no"}
- Recent titles to avoid: ${input.recentTitles?.slice(0, 10).join(", ") || "none"}
- Already seen to avoid: ${input.seenTitles?.slice(0, 10).join(", ") || "none"}

Rejected candidates:
${rejectionsText}

Rules:
- Fix the rejection reason directly. Do not repeat rejected titles or obvious adjacent titles.
- Explicit intent outranks situation and broad mood. If the user asks to be scared, pick real scary/horror. If they ask to cry, pick real catharsis. If they ask comedy, pick comedy.
- Hard avoids are absolute. If horror/gore/violence/sex are avoided, do not recommend or hide those in related titles.
- If a film is requested, do not return a series. If one episode is requested, return a specific episode.
- Fill parsedIntent before choosing the title.

Schema:
[
  {
    "parsedIntent": {
      "primary": "scare|cry|comedy|thriller|romance|weird|comfort|gore|drama|discovery|unknown",
      "secondary": [],
      "hardAvoids": [],
      "softAvoids": [],
      "format": "film|series|episode|any",
      "language": "requested language/culture lane or 'any'",
      "situation": [],
      "intensity": "safe|curious|bold|unhinged",
      "ambiguity": ""
    },
    "title": "string",
    "year": "string",
    "format": "Film|Series|Episode|Documentary|Unknown",
    "runtime": "string",
    "vibe": "string",
    "contentCategory": ["structured labels for what the title is"],
    "emotionalEffect": ["structured labels for what the title does emotionally"],
    "confidence": 75,
    "oneLine": "one sentence",
    "whyItFits": ["reason 1", "reason 2", "reason 3"],
    "whereToWatch": {
      "status": "unverified",
      "primary": "Availability not verified",
      "note": "F.U.N will verify this in real time. Check your apps before watching."
    },
    "hiddenLayer": {
      "headline": "short headline",
      "insight": "factual taste insight",
      "classyJab": "short tasteful line"
    },
    "hiddenTitles": [
      { "title": "string", "year": "string" },
      { "title": "string", "year": "string" },
      { "title": "string", "year": "string" }
    ],
    "alternatives": ["Title (Year)", "Title (Year)", "Title (Year)"]
  }
]
`;
}
