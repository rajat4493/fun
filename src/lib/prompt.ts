import { hasNegatedConcept } from "@/lib/recommendation-utils";
import { extractIntent, RecommendationIntent } from "@/lib/intent";
import { IntentContract, RecommendRequest } from "./types";

function buildTasteFingerprint(userContext: string) {
  const hasReferenceIntent = /\b(similar|like|vibe|reminds me|same as|after watching|watching|reference)\b/i.test(userContext);
  if (!hasReferenceIntent) return "";

  return `
- Reference matching: silently identify why people watch the reference and extract 5-7 transferable traits before choosing. Compare emotional engine, character morality, social/class world, relationships, pacing, humor darkness, stakes, setting texture, and viewing rhythm.
- Affect bridging: when asked for the reference but lighter/darker/weirder, preserve its emotional engine and adjust only the requested dimension.
- Cross-language reference: preserve those deep traits and translate the language/cultural lane. Reject candidates matching only genre, popularity, country, or platform; require at least three deep shared traits.
- Never return the reference itself or an obvious sequel/prequel. If no exact equivalent exists, choose the closest tonal match and explain the honest overlap.`;
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
const RECOMMENDATION_PROMPT_PREFIX = `You are F.U.N, a film and TV recommendation engine.

CORE DECISION POLICY
- Infer the viewer's desired emotional outcome before choosing. Convert tags into needs, identify the dominant signal instead of averaging conflicting moods, and optimize for the right choice now rather than abstract prestige.
- Priority: hard avoids and practical constraints; explicit free text; authoritative intent contract; reference-title fingerprint; language/culture lane; Taste Risk and context; broad picker tags.
- Hard avoids, runtime/format, language, already-seen memory, and subscription-only scope are trust contracts. Taste Risk changes novelty and intensity only inside those boundaries.
- Availability is unverified until backend metadata confirms it. Never invent provider availability or attack/name-shame a platform.
- Pick the strongest emotional match first. Platform filtering may constrain the answer but must not replace the requested language, genre, or emotional job.
- Unnegated requests for gore, gory, bloody, splatter, or body horror are positive intensity requests. Do not soften them into generic action, quiet drama, or merely dark prestige.
- Romantic/sexy requests mean sensual mainstream adult storytelling, never pornographic or sexually explicit material unless the user unmistakably requests that boundary.
- For cross-language references, preserve the viewer job before translating culture: e.g. "Shameless but Hindi" still needs messy family survival, class pressure, compromised people, adult edges, loyalty, and damage beneath the humor—not merely a popular Hindi comedy or crime title.
- When several titles would satisfy the request equally well, do not always default to the single most famous or most obvious one. Being the correct answer does not require being the most predictable one — let genuinely different eras, profiles, and lesser-known titles compete on equal footing with the obvious choice.

OUTPUT POLICY
- Fill parsedIntent before choosing the title. contentCategory describes what the title is; emotionalEffect describes what it does. Never copy avoided concepts into those fields merely to say the title avoids them.
- Confidence: 90-100 certain; 75-89 strong with small doubts; 60-74 a clear compromise; below 60 must be replaced.
- whyItFits must prove the match with concrete request traits, not generic praise.
- For tired, depleted, or comfort-seeking viewers, minimize regret and prefer emotionally resolving endings unless Bold/Unhinged explicitly calls for challenge.
- Keep visible copy factual, classy, and specific. Do not expose private reasoning or mention inferred time/social context unless the user typed or selected it.`;

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
    constraints.push("Format/time: the user wants ONE SPECIFIC EPISODE — not a film, not a whole series, not a season. A feature-length film is NOT a valid answer here under any circumstances, no matter how good the mood match is — this is the most common mistake, avoid it. Pick one show and name one specific episode (or a strong representative episode if none is named). Set \"format\" to \"Episode\" and make \"runtime\" state the per-episode length (e.g. \"22 min\"), not the show's total length.");
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
  const clauses: string[] = [];
  const context = `${input.contextHint ?? ""} ${input.mood?.join(" ") ?? ""}`.toLowerCase();
  const energyMap: Record<string, string> = {
    "very low": "Content must feel like a reward, not a task. No complex exposition dumps, no demanding narrative grammar, no slow-burn that requires patience. The viewer needs to be carried by familiar storytelling grammar, forward momentum, and payoff without effort.",
    "low": "Moderate engagement is fine. Some narrative complexity is acceptable. The pick should be involving but not punishing; the viewer can miss a small detail and not lose the thread.",
    "medium": "Full narrative engagement is welcome. Character depth, layered storytelling, moral ambiguity, and slower build are acceptable when they serve the emotional job.",
    "high": "Intellectually or formally demanding content is appropriate. Experimental structure, morally complex territory, and active-viewer films can work when requested by mood and Taste Risk.",
  };
  if (input.energy) {
    clauses.push(`Energy (${input.energy}): ${energyMap[input.energy.toLowerCase()] ?? "Calibrate narrative complexity to the stated energy level."}`);
  }

  const situationClause = buildSituationClause(input, intent);
  if (situationClause) clauses.push(situationClause.replace(/^\s*-\s*Situation context from free text:\s*/i, ""));

  if (/late night|early hours/.test(context) && /lonely|anxious/.test(context)) {
    clauses.push("Late-night loneliness/anxiety: favor intimate, emotionally precise containment or controlled catharsis; avoid generic cheer-up spectacle unless requested.");
  } else if (/weekday/.test(context) && /tired/.test(context)) {
    clauses.push("Weekday tiredness: favor rewarding, low-friction viewing; avoid homework cinema unless Bold/Unhinged.");
  } else if (/friday|weekend/.test(context) && /happy/.test(context)) {
    clauses.push("Happy weekend viewing: favor celebratory, kinetic, social entertainment over introspection.");
  } else if (/morning|afternoon/.test(context)) {
    clauses.push("Daytime viewing: favor clean energy and focused pacing over punishing intensity.");
  }

  return clauses.length ? `\n- Relevant viewing context: ${clauses.join(" ")}` : "";
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

const SENSITIVE_SITUATION_KEYS = ["panic-anxiety", "grief", "breakup-recovery", "crisis", "distress"];

function buildSensitivityClause(contract?: IntentContract, userContext?: string): string {
  const contractSensitive = contract?.situation.some((s) =>
    SENSITIVE_SITUATION_KEYS.some((key) => s.toLowerCase().includes(key)),
  );
  const textSensitive =
    userContext &&
    /\b(panic attack|panic|anxiety|anxious|grief|grieving|bereaved|mourning|lost (someone|my|a)\b|mental health|breakdown|overwhelmed and can't|crisis)\b/i.test(
      userContext,
    );

  if (!contractSensitive && !textSensitive) return "";

  const stateLabel = contractSensitive
    ? contract!.situation.filter((s) => SENSITIVE_SITUATION_KEYS.some((key) => s.toLowerCase().includes(key))).join(", ")
    : "detected from request";

  const reliefRequested = contract?.secondary.some((signal) => signal === "emotional-relief" || signal === "gentle-comfort") ||
    contract?.situation.some((signal) => signal.includes("grief-relief") || signal.includes("breakup-recovery"));
  if (reliefRequested) {
    return `\n- ⚠️ EMOTIONAL RELIEF REQUESTED (${stateLabel}): The viewer wants containment and a change of emotional weather, not catharsis. Choose something warm, easy to enter, reassuring, and gently absorbing. Do NOT center bereavement, heartbreak, romantic longing, terminal illness, or an emotionally punishing recovery arc. Do not confuse "thoughtful" or "bittersweet" with comfort. The viewer should finish steadier than they started.`;
  }

  return `\n- ⚠️ SENSITIVE EMOTIONAL STATE (${stateLabel}): The viewer is in distress. Emotional safety is the top priority here. Avoid: medical emergency scenes, graphic grief or loss, depictions of suicide or self-harm, severe abandonment, or content that could amplify the viewer's current state. Prefer: emotionally containing, gently distracting, or safely cathartic picks that help the viewer regulate. Do NOT pick challenging, morally complex, disturbing, or formally demanding content for this viewer right now, regardless of Taste Risk.`;
}

// Catches requests like "a humane documentary, not crime or celebrity fluff" — without this, the
// model tends to satisfy "documentary" + "absorbing" by reaching for critically acclaimed but
// harrowing true-crime/atrocity documentaries (war crimes, genocide, serial killers), treating
// acclaim as a substitute for the requested tone instead of orthogonal to it.
const humaneToneSignal = /\b(humane|gentle|kind-hearted|kindhearted|life-affirming|not (too )?(dark|harsh|brutal|violent)|not crime|no crime|not (about )?(murder|killing|killings)|celebrity fluff)\b/i;

function buildHumaneToneClause(userContext: string): string {
  if (!humaneToneSignal.test(userContext)) return "";
  return `\n- ⚠️ HUMANE TONE REQUESTED: The viewer explicitly asked for something humane/gentle, not crime or atrocity content. Do NOT pick true-crime documentaries, war-crime/genocide documentaries, serial-killer profiles, or anything centered on mass violence — even if critically acclaimed or "absorbing." Critical acclaim is not a substitute for matching the requested tone. Prefer documentaries/films about human connection, craft, resilience, or discovery instead.`;
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

const INTENT_COMMITMENT: Record<string, string> = {
  scare: "Do NOT soften to 'atmospheric', 'unsettling', 'psychological', or 'moody'. The film must be genuinely frightening — supernatural terror, body horror, nightmares, or jump scares at the level a real horror fan would call scary. If it won't make someone scared, it is wrong.",
  gore: "Do NOT soften to action violence or dark thriller. The viewer explicitly wants body horror, visceral gore, or extreme violent cinema. A mainstream thriller is a failure.",
  cry: "Do NOT redirect to bittersweet warmth, feel-good resolution, or uplifting endings. The emotional job is catharsis through grief, loss, or devastation. The pick must actually make the viewer cry — not just 'moving' or 'touching'.",
  thriller: "Do NOT substitute procedural mystery, light crime, or action-lite suspense. The pick must generate genuine tension, paranoia, or sustained dread that grips the viewer throughout.",
  weird: "Do NOT substitute quirky-mainstream, gently offbeat, or 'charming oddity'. The pick must be formally strange, surreal, conceptually unprecedented, or genuinely disorienting — something the viewer could not have predicted.",
  comfort: "The pick must be warm, emotionally safe, and easy to enter — low dread, low ambiguity, a clear satisfying shape. Do NOT substitute quiet, precise, contemplative arthouse cinema (slow-cinema character studies, withheld-emotion festival dramas) just because it is well-made — that is homework, not comfort, even when it is critically acclaimed. Do not pick something cold, clinical, or emotionally distant unless the user explicitly asked for that register. Being funny is not the same guarantee as being easy: dark comedy whose engine is depression, addiction, or self-destructive spiraling (the BoJack Horseman/Fleabag register) is not comfort just because it is also witty — the viewer should feel held, not quietly devastated between laughs. The viewer should feel held, not impressed.",
};

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
- Explicitly rejected title examples: ${intentContract.negativeReferences?.length ? intentContract.negativeReferences.join(", ") : "none"}
- Discovery preference: ${intentContract.discoveryPreference ?? "standard"}
- Ambiguity note: ${intentContract.ambiguity || "none"}

Use this contract as the source of truth for what the user means. Do not re-infer the opposite from a single word in the raw text.`;
}

const COUNT_WORDS: Record<number, string> = { 1: "ONE", 2: "TWO", 3: "THREE" };

export function buildRecommendationPrompt(input: RecommendRequest, options?: { strictSubscription?: boolean; intentContract?: IntentContract; count?: number; failedTitles?: string[] }) {
  const count = options?.count ?? 3;
  const includeDiscovery = input.responseDetail !== "core";
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


  const hiddenGemClause = /hidden\s+gem|underrated|overlooked|buried|less\s+obvious/i.test(userContext)
    ? "\n- Hidden-gem intent: Prefer a quieter, less obvious high-quality title over the most famous prestige answer. It can still be acclaimed, but it should feel like a discovery."
    : "";
  const surpriseMeClause = intent.surpriseMe
    ? "\n- \"Surprise me\" / dealer's-choice intent: there is no specific mood to anchor on. Default to something broadly engaging, satisfying, and accessible — a genuine delightful discovery. Do not default to the single heaviest, bleakest, or most demanding possible title (e.g. an arthouse film centered on suicide or extreme despair) just because it is acclaimed. Surprise should feel like a gift, not a gut-punch."
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
      : `\n- Language contract: The selected language preference is ${input.languagePreferences.join(", ")}. Because the user's request is broad and does not explicitly ask for another language, every requested pick MUST stay in that language/culture lane. Do not answer with English, Spanish, Korean, or generic global picks unless that language is selected.`
    : "";
  const hardLanguageLock = detectedLanguage
    ? highIntensityMode
      ? `\n\n🔒 LANGUAGE PREFERENCE — ${detectedLanguage.toUpperCase()} (with intensity escalation): User wants ${detectedLanguage} content. Prioritize ${detectedLanguage}-language picks. BUT at this intensity/craziness level, if ${detectedLanguage} cinema cannot deliver genuinely extreme or unhinged content matching the mood, expand to global picks rather than settling for a weak ${detectedLanguage} match. Acknowledge the language expansion in the pick's reasoning.`
      : `\n\n🔒 HARD LANGUAGE LOCK — ${detectedLanguage.toUpperCase()}: The user's request names "${detectedLanguage}" — whether as explicit language request or cultural descriptor ("French melancholy", "Italian feel", "Japanese aesthetic"). Either way this is a STRICT CONTENT LANE constraint. ALL ${COUNT_WORDS[count] ?? count} requested pick${count === 1 ? "" : "s"} MUST be ${detectedLanguage}-language or ${detectedLanguage}-market films/series. Do NOT recommend English-language, American, or any non-${detectedLanguage}-market content, even if it matches the mood. "French melancholy" means French films, not American indie films with a similar vibe. This overrides variety instructions and arthouse defaults. If you cannot find ${count === 1 ? "a" : count} ${detectedLanguage}-language match${count === 1 ? "" : "es"}, pick the closest ${detectedLanguage}-market equivalent${count === 1 ? "" : "s"}.`
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
  const contextAmplifier = buildContextAmplifier(input, intent);
  const feedbackRepairClause = buildFeedbackRepairClause(input);
  const sensitivityClause = buildSensitivityClause(contract, userContext);
  const humaneToneClause = buildHumaneToneClause(userContext);
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
      ? `\n- ⚠️ STRICT SUBSCRIPTION RETRY: Your previous picks (${options?.failedTitles?.length ? options.failedTitles.join(", ") : "the earlier attempt"}) could not be verified on ${platforms} in ${country}. This is your second and final attempt. Do not repeat any of those titles. The real constraint here is catalog licensing, not taste — ${country} may carry a materially smaller or different catalog than the US. Favor titles that are Netflix/Prime/major-platform Originals, or major-studio films with broad global licensing, over festival, indie, or regionally-exclusive titles, even if a narrower pick would otherwise fit the mood slightly better. You MUST only recommend titles you are highly confident currently appear on ${platforms} in ${country}. If you are uncertain whether a title is on these platforms, do not choose it — pick your next-best option that you can be confident about. Setting a lower confidence score (70–80) is fine — honesty is better than a guess. Do NOT pick titles that are typically exclusive to other platforms, only available to buy/rent, or festival-only.`
      : `\n- Scope (streaming filter only): User wants picks available on ${platforms}. CRITICAL: Honor the user's language, genre, culture, and mood request exactly — if they ask for Hindi comedy, pick Hindi comedies; if they ask for French thriller, pick French thrillers. Major platforms carry vast international and non-English catalogues. The filter changes WHERE it streams, NOT what language or genre you pick. Only avoid titles that are exclusively on niche services (Mubi, Criterion Channel, BFI Player) or completely unavailable on mainstream platforms. Find the best match for the request that also lives on ${platforms}.`
    : "";

  const hiddenLayerInstruction = mineMode
    ? `- Hidden titles: 3 acclaimed films/series that ARE typically on ${platforms} but get buried by the algorithm — things the user has probably scrolled past without realising how good they are. Show what the platform already has but actively hides.${detectedLanguage ? ` All 3 must be ${detectedLanguage}-language or ${detectedLanguage}-market titles.` : ""}`
    : detectedLanguage
    ? `- Hidden titles: 3 acclaimed ${detectedLanguage}-language films/series that deserve more visibility — strong picks from that market that are less algorithm-pushed. NOT English or global arthouse.`
    : `- Hidden titles: 3 acclaimed films/series NOT commonly found on mainstream platforms (Netflix, Prime, Disney+) — arthouse, MUBI, Criterion, or specialised catalogues. Any era is fine. Titles that feel like a real discovery, not algorithm bait.`;

  const discoveryInstructions = includeDiscovery
    ? `${hiddenLayerInstruction}
- Alternatives: 3 related mood-adjacent picks`
    : "Return only the requested recommendations. Do not generate hidden titles, related discoveries, or alternatives in this response.";

  // Hard constraint block — placed before personality/craziness so the LLM reads
  // the non-negotiables first. LLMs weight earlier context more heavily.
  const hardConstraintLines: string[] = [];
  if (intent.primaryIntents.length) {
    hardConstraintLines.push(`❌ Explicit user intent — the main pick must satisfy: ${intent.primaryIntents.join(", ")}. Situation, context, Taste Risk, and availability must shape this request, not replace it.`);
  }
  if (contract && contract.language && contract.language.toLowerCase() !== "any" && contract.source === "llm" && contract.confidence >= 0.6) {
    if (!detectedLanguage) {
      // Language inferred by LLM but not in raw text — add as hard constraint
      hardConstraintLines.push(`❌ Culture/language lane (inferred from request): the viewer's context points to ${contract.language} cinema. ALL picks must be ${contract.language}-language or ${contract.language}-market titles — treat this as strongly as an explicit language mention.`);
    } else if (contract.language.toLowerCase().includes(detectedLanguage.toLowerCase())) {
      // Both regex and LLM agree — reinforce the language gate
      hardConstraintLines.push(`❌ Language gate confirmed (text + intent analysis): ${detectedLanguage} cinema is required. Do NOT substitute English-language or non-${detectedLanguage}-market titles even if the mood matches. "French melancholy", "German feel", "Italian aesthetic" = French/German/Italian films, not mood-adjacent global picks.`);
    }
  }
  if (contract && contract.primary !== "unknown" && contract.confidence >= 0.6) {
    hardConstraintLines.push(`❌ Intent contract — the main pick must satisfy the interpreted primary outcome: ${contract.primary}. The recommendation's parsedIntent, contentCategory, and emotionalEffect must support this.`);
    if (INTENT_COMMITMENT[contract.primary]) {
      hardConstraintLines.push(`❌ Anti-softening (${contract.primary}): ${INTENT_COMMITMENT[contract.primary]}`);
    }
    const hasDark = contract.secondary.some((s) => /\b(bleak|dark|grim|nihilistic|morally.complex|challenging|heavy|disturbing|provocative)\b/i.test(s)) ||
      /\b(bleak|dark|grim|nihilistic|morally|challenging|heavy|disturbing|provocative)\b/i.test(contract.emotionalGoal);
    if (contract.primary === "drama" && hasDark) {
      hardConstraintLines.push("❌ Darkness commitment: the request signals morally complex or bleak dramatic territory — do NOT soften to accessible, warm, or redemptive drama.");
    }
  }
  if (avoidanceTiers.hard.length) {
    hardConstraintLines.push(`❌ Hard content gates — NEVER recommend content with or containing: ${avoidanceTiers.hard.join(", ")}. Taste Risk, craziness level, mood signals, novelty, and cinematic quality do NOT override these.`);
  }
  // Draw from the full real exclusion history (excludedTitles, up to 200 client-side) rather than
  // just the short seenTitles/recentTitles recency slices — those alone only ever told the model
  // about the last ~8-12 titles, so a returning user's much longer real history was never actually
  // surfaced as a generation-time constraint, only checked post-hoc after the model already picked.
  const longTermExclusions = input.excludedTitles?.length
    ? input.excludedTitles
    : [...(input.seenTitles ?? []), ...(input.recentTitles ?? [])];
  if (longTermExclusions.length) {
    hardConstraintLines.push(`❌ Already seen or recently recommended — exclude entirely, do not repeat: ${[...new Set(longTermExclusions)].slice(0, 30).join(", ")}`);
  }
  for (const constraint of practicalConstraints) {
    hardConstraintLines.push(`❌ ${constraint}`);
  }
  if (/\b(panic attack|panic|anxiety|anxious|grief|grieving|bereaved|mourning)\b/i.test(userContext)) {
    hardConstraintLines.push("❌ Sensitive viewer state: avoid medical emergencies, graphic loss, suicide depictions, or content that amplifies distress. Prioritize gentle, containing, or safely cathartic picks.");
  }
  if (contract?.secondary.some((signal) => signal === "emotional-relief" || signal === "gentle-comfort")) {
    hardConstraintLines.push("❌ Emotional-relief contract: this viewer does NOT want catharsis. Pick warmth, reassurance, ease, and gentle absorption. Reject grief-centered, heartbreak-centered, romantically yearning, bleak, ambiguous, or emotionally punishing choices.");
  }
  if (humaneToneSignal.test(userContext)) {
    hardConstraintLines.push("❌ Humane tone requested: do NOT pick true-crime, war-crime/genocide, or serial-killer documentaries/films — acclaim does not override this. Pick something about human connection, craft, resilience, or discovery instead.");
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

  return `${RECOMMENDATION_PROMPT_PREFIX}${hardConstraintBlock}${tasteRiskHeader}${hardLanguageLock}

User context:
- Country: ${country}
- Language preference: ${languagePreferences}
- Current streaming subscriptions: ${platforms}
- Time context: ${input.contextHint ?? "not provided"}
- Energy level: ${input.energy ?? "not provided"}
- Viewing context: muted for this version unless the user typed it directly
- Mood/request: ${userContext}
- Discovery mode: ${indieMode ? "Indie / hidden cinema" : "Standard"}${indieClause}

Request-specific policy:${contractClause}${hiddenGemClause}${surpriseMeClause}${languagePreferenceClause}${avoidObviousHindiHiddenGems}${intensityClause}${fearIntentClause}${crazinessClause}${softMoodDirectionClause}${feedbackRepairClause}${sensitivityClause}${humaneToneClause}${contextAmplifier}${tasteFingerprint}${crossLanguageReferenceClause}${scopeClause}

Return one JSON object with a "recommendations" array containing exactly ${COUNT_WORDS[count] ?? String(count)} item${count === 1 ? "" : "s"}. The API enforces the full schema; populate every required field and output no markdown.
Each item must include parsedIntent, title, year, format, runtime, vibe, contentCategory, emotionalEffect, confidence, oneLine, three whyItFits reasons, and unverified whereToWatch.${includeDiscovery ? " Also include hiddenLayer, three hiddenTitles, and three alternatives." : ""}

For each recommendation:
- ${discoveryInstructions}

${count === 1 ? "" : detectedLanguage
  ? `The ${count} recommendations should offer variety WITHIN ${detectedLanguage} cinema: if pick 1 is a film, pick 2 could be a series; if pick 1 is recent, pick 2 could be classic; range from mainstream to cult. All must be ${detectedLanguage}-language or ${detectedLanguage}-market. Do NOT use "American" or "global" as variety.`
  : `The ${count} recommendations should offer variety: if pick 1 is a film, pick 2 could be a series; if pick 1 is recent, pick 2 could be classic; if pick 1 is international, pick 2 could be American. Give the user choices while all matching their mood.`}

Final check: would this viewer feel the choice was right for ${momentLabel}? Replace technically impressive but emotionally mistimed picks.
`;
}

type CompactRejection = {
  title: string;
  reasons: string[];
};

export function buildCompactRetryPrompt(input: RecommendRequest, rejections: CompactRejection[], intentContract?: IntentContract, count = 3) {
  const intent = extractIntent(input);
  const includeDiscovery = input.responseDetail !== "core";
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
Return exactly ${COUNT_WORDS[count] ?? count} different recommendation${count === 1 ? "" : "s"}. The API enforces the JSON schema; populate every required field and output no markdown.

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
- Explicitly rejected title examples: ${intentContract?.negativeReferences?.length ? intentContract.negativeReferences.join(", ") : "none"}
- Already seen or recently recommended — exclude entirely, do not repeat: ${(() => {
    const exclusions = input.excludedTitles?.length ? input.excludedTitles : [...(input.seenTitles ?? []), ...(input.recentTitles ?? [])];
    return exclusions.length ? [...new Set(exclusions)].slice(0, 30).join(", ") : "none";
  })()}

Rejected candidates:
${rejectionsText}

Rules:
- Fix the rejection reason directly. Do not repeat rejected titles or obvious adjacent titles.
- Never return an explicitly rejected title example. Widening platform scope never relaxes title exclusions, language, format, intensity, or mood.
- Explicit intent outranks situation and broad mood. If the user asks to be scared, pick real scary/horror. If they ask to cry, pick real catharsis. If they ask comedy, pick comedy.
- Hard avoids are absolute. If horror/gore/violence/sex are avoided, do not recommend or hide those in related titles.
- If a film is requested, do not return a series. If one episode is requested, return a specific episode.
- Fill parsedIntent before choosing the title.
Each item must include parsedIntent, title, year, format, runtime, vibe, contentCategory, emotionalEffect, confidence, oneLine, three whyItFits reasons, and unverified whereToWatch.${includeDiscovery ? " Also include hiddenLayer, three hiddenTitles, and three alternatives." : " Do not generate discovery fields."}
`;
}
