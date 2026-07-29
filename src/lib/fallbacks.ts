import { hasNegatedConcept, requestText } from "@/lib/recommendation-utils";
import { extractIntent } from "@/lib/intent";
import { IntentContract, RawRecommendation, RecommendRequest } from "@/lib/types";

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function recommendationText(rec: RawRecommendation): string {
  return [
    rec.title,
    rec.vibe,
    rec.oneLine,
    ...(rec.whyItFits ?? []),
    rec.hiddenLayer?.headline,
    rec.hiddenLayer?.insight,
  ].filter(Boolean).join(" ");
}

function isKnownFalsePositiveForRequest(input: RecommendRequest, rec: RawRecommendation): boolean {
  const text = requestText(input);
  const title = normalizeForMatch(rec.title);
  const recText = recommendationText(rec);

  if ((input.recentTitles ?? []).some((recentTitle) => normalizeForMatch(recentTitle) === title)) {
    return true;
  }

  if ((input.seenTitles ?? []).some((seenTitle) => normalizeForMatch(seenTitle) === title)) {
    return true;
  }

  if (/shameless/i.test(text)) {
    return [
      "thegoodplace",
      "parksandrecreation",
      "theoffice",
      "schittscreek",
      "derrygirls",
      "choked",
      "paatallok",
      "pataallok",
      "mimi",
      "kotafactory",
      "yehmerifamily",
      "gullak",
      "panchayat",
      "aakhrisafar",
    ].includes(title);
  }

  if (/\b(comedy|funny|laugh|comfort|light|sitcom)\b/i.test(text) && /\b(dark|crime|criminal|thriller|murder|killer|revenge|suspense|harsh|grim|haunting|tragic|war|documentary)\b/i.test(recText)) {
    return true;
  }

  if (/shameless/i.test(text) && !/\b(messy|chaos|chaotic|dysfunction|dysfunctional|survival|morally|flawed|adult|raunchy|class|poverty|pressure|desperate|bad choices|bad decisions|family wounds)\b/i.test(recText)) {
    return true;
  }

  if (/\bfriends\b/i.test(text) && !/\b(friend|friends|friendship|hangout|ensemble|group|comfort|warm|low-stakes|romantic|social|banter|chemistry|roommate|apartment)\b/i.test(recText)) {
    return true;
  }

  if (/\bfriends\b/i.test(text)) {
    return [
      "theironclaw",
      "maryandgeorge",
      "marryme",
      "kotafactory",
      "aakhrisafar",
    ].includes(title);
  }

  const wantsGore = /\b(gore|gory|bloody|splatter|body horror|extreme horror|violent horror)\b/i.test(text) &&
    !hasNegatedConcept(text, /\b(gore|gory|blood|bloody|violence|violent)\b/i);

  if (wantsGore) {
    return [
      "thefarewell",
      "longdaysjourneyintonight",
      "pastlives",
      "perfectdays",
      "aftersun",
      "theeternalmemory",
      "inthemoodforlove",
      "drivecar",
      "drivemycar",
    ].includes(title);
  }

  return false;
}

export function filterFalsePositiveRecommendations(input: RecommendRequest, batch: RawRecommendation[]): RawRecommendation[] {
  const filtered = batch.filter((rec) => !isKnownFalsePositiveForRequest(input, rec));
  const text = requestText(input);
  const wantsGore = /\b(gore|gory|bloody|splatter|body horror|extreme horror|violent horror)\b/i.test(text) &&
    !hasNegatedConcept(text, /\b(gore|gory|blood|bloody|violence|violent)\b/i);
  const hasRepeatExclusions = (input.recentTitles?.length ?? 0) > 0 || (input.seenTitles?.length ?? 0) > 0;
  if (hasRepeatExclusions) return filtered;
  if (wantsGore) return filtered;
  return filtered.length > 0 ? filtered : batch;
}

export function localFallback(input: RecommendRequest, intentContract?: IntentContract): RawRecommendation[] {
  const intent = extractIntent(input);
  const text = requestText(input);
  const contractIntents = new Set(
    [
      intentContract?.primary,
      ...(intentContract?.secondary ?? []),
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-")),
  );
  const contractHas = (...values: string[]) => values.some((value) => contractIntents.has(value));
  const wantsShameless = /shameless/i.test(text);
  const wantsFriends = /\bfriends\b/i.test(text);
  const wantsHindi = /\bhindi\b/i.test(text) || (input.languagePreferences ?? []).some((language) => /hindi/i.test(language));
  const wantsKorean = /\bkorean\b/i.test(text) || (input.languagePreferences ?? []).some((language) => /korean/i.test(language));
  const wantsFrench = /\bfrench\b/i.test(text) || (input.languagePreferences ?? []).some((language) => /french/i.test(language));
  const wantsGerman = /\bgerman\b/i.test(text) || (input.languagePreferences ?? []).some((language) => /german/i.test(language));
  const wantsThriller = contractHas("thriller") || /\b(thriller|tense|suspense|mystery|crime)\b/i.test(text);
  const wantsComedy = contractHas("comedy") || /\b(comedy|funny|laugh|comfort|sitcom|light)\b/i.test(text);
  const wantsRomance = contractHas("romance") || /\b(romance|romantic|love|date)\b/i.test(text);
  const wantsEmotional = contractHas("cry", "drama", "comfort") || /\b(emotional|moving|heartfelt|feel|feeling|sad|bittersweet)\b/i.test(text);
  const wantsGore = (contractHas("gore") || intent.primaryIntents.includes("gore") || /\b(gore|gory|bloody|splatter|body horror|extreme horror|violent horror)\b/i.test(text)) &&
    !hasNegatedConcept(text, /\b(gore|gory|blood|bloody|violence|violent)\b/i);
  const wantsScare = (contractHas("scare") || intent.primaryIntents.includes("scare") || /\b(shit scared|scare|scared|scary|terrify|terrified|terrifying|frighten|frightened|frightening|creep out|creepy|horror|dread|nightmare|haunted|ghost|possession|demonic|jump scare|jumpscare)\b/i.test(text)) &&
    !hasNegatedConcept(text, /\b(scary|scare|scared|terrify|terrified|frighten|frightened|horror|dread|nightmare|haunted|ghost|possession|demonic|jump scare|jumpscare)\b/i);
  const wantsCry = contractHas("cry") || intent.primaryIntents.includes("cry");

  if (wantsFriends && wantsHindi) {
    const baseRec = {
      format: "Series" as const,
      whereToWatch: {
        status: "unverified" as const,
        primary: "Availability not verified",
        note: "F.U.N will verify this in real time. Check your apps before watching.",
      },
      hiddenLayer: {
        headline: "Hindi hangout comfort",
        insight: "The match should feel like people you can sit with for hours, not just a comedy label.",
        classyJab: "Comfort works when the room feels alive.",
      },
    };

    return [
      {
        title: "College Romance",
        year: "2018",
        runtime: "35 min per episode",
        vibe: "hangout, youthful, romantic-comic",
        confidence: 82,
        oneLine: "Watch College Romance for Hindi friend-group comfort, crushes, banter, and low-stakes chaos.",
        whyItFits: [
          "It keeps the friend-group hangout engine that makes Friends easy to return to.",
          "The pleasure is chemistry, romantic confusion, and everyday social mess rather than plot heaviness.",
          "It sits in a Hindi youth-comedy lane instead of becoming a dark or prestige detour.",
        ],
        hiddenTitles: [
          { title: "Hostel Daze", year: "2019" },
          { title: "Permanent Roommates", year: "2014" },
          { title: "Flames", year: "2018" },
        ],
        alternatives: ["Hostel Daze (2019)", "Permanent Roommates (2014)", "Flames (2018)"],
        ...baseRec,
      },
      {
        title: "Hostel Daze",
        year: "2019",
        runtime: "35 min per episode",
        vibe: "ensemble, campus, comfort-comedy",
        confidence: 80,
        oneLine: "Watch Hostel Daze if you want a Hindi ensemble comedy built around shared spaces and everyday friendship.",
        whyItFits: [
          "It translates Friends' shared-apartment rhythm into a campus/hostel social world.",
          "The hook is the group dynamic, not a single hero or heavy plot.",
          "It keeps the stakes light enough for comfort watching.",
        ],
        hiddenTitles: [
          { title: "College Romance", year: "2018" },
          { title: "Permanent Roommates", year: "2014" },
          { title: "Flames", year: "2018" },
        ],
        alternatives: ["College Romance (2018)", "Permanent Roommates (2014)", "Flames (2018)"],
        ...baseRec,
      },
      {
        title: "Permanent Roommates",
        year: "2014",
        runtime: "30 min per episode",
        vibe: "relationship, warm, conversational",
        confidence: 77,
        oneLine: "Watch Permanent Roommates for relaxed Hindi relationship comedy with familiar, rewatchable warmth.",
        whyItFits: [
          "It shares Friends' conversational comfort and romantic-social confusion.",
          "The tone is warm and easygoing rather than dark or plot-heavy.",
          "It works best when you want people and chemistry more than spectacle.",
        ],
        hiddenTitles: [
          { title: "College Romance", year: "2018" },
          { title: "Hostel Daze", year: "2019" },
          { title: "Flames", year: "2018" },
        ],
        alternatives: ["College Romance (2018)", "Hostel Daze (2019)", "Flames (2018)"],
        ...baseRec,
      },
    ];
  }

  if (wantsShameless && wantsHindi) {
    const baseRec = {
      format: "Series" as const,
      whereToWatch: {
        status: "unverified" as const,
        primary: "Availability not verified",
        note: "F.U.N will verify this in real time. Check your apps before watching.",
      },
      hiddenLayer: {
        headline: "Hindi chaos, not comfort",
        insight: "The closest match should have messy people, bad choices, and survival energy rather than a clean thriller shell.",
        classyJab: "The right mess has its own rhythm.",
      },
    };

    return [
      {
        title: "Tribhuvan Mishra CA Topper",
        year: "2024",
        runtime: "45 min per episode",
        vibe: "raunchy, desperate, social-comedy",
        confidence: 83,
        oneLine: "Watch Tribhuvan Mishra CA Topper if you want a messy Hindi adult comedy built on pressure and survival.",
        whyItFits: [
          "It is closer to Shameless' raunchy survival-comedy lane than a prestige thriller.",
          "The premise turns money pressure and social judgment into escalating personal chaos.",
          "It keeps flawed people at the center instead of offering clean moral comfort.",
        ],
        hiddenTitles: [
          { title: "Choona", year: "2023" },
          { title: "Yeh Kaali Kaali Ankhein", year: "2022" },
          { title: "Rana Naidu", year: "2023" },
        ],
        alternatives: ["Choona (2023)", "Yeh Kaali Kaali Ankhein (2022)", "Rana Naidu (2023)"],
        ...baseRec,
      },
      {
        title: "Choona",
        year: "2023",
        runtime: "40 min per episode",
        vibe: "scheming, comic, desperate",
        confidence: 79,
        oneLine: "Watch Choona for Hindi ensemble scheming where desperation keeps turning into comedy.",
        whyItFits: [
          "It has flawed people making increasingly bad plans under pressure.",
          "The ensemble chaos matters more than clean heroism.",
          "The tone lets desperation and comedy sit in the same room.",
        ],
        hiddenTitles: [
          { title: "Tribhuvan Mishra CA Topper", year: "2024" },
          { title: "Rana Naidu", year: "2023" },
          { title: "Yeh Kaali Kaali Ankhein", year: "2022" },
        ],
        alternatives: ["Tribhuvan Mishra CA Topper (2024)", "Rana Naidu (2023)", "Yeh Kaali Kaali Ankhein (2022)"],
        ...baseRec,
      },
      {
        title: "Rana Naidu",
        year: "2023",
        runtime: "45 min per episode",
        vibe: "messy, adult, family-crime",
        confidence: 75,
        oneLine: "Watch Rana Naidu if you want the darker family-dysfunction side of a Shameless-like Hindi-market match.",
        whyItFits: [
          "It keeps damaged family history and morally compromised people in the center.",
          "The adult edges and family wounds are closer than a clean thriller would be.",
          "It is a darker compromise, but still better aligned than a generic crime procedural.",
        ],
        hiddenTitles: [
          { title: "Tribhuvan Mishra CA Topper", year: "2024" },
          { title: "Choona", year: "2023" },
          { title: "Yeh Kaali Kaali Ankhein", year: "2022" },
        ],
        alternatives: ["Tribhuvan Mishra CA Topper (2024)", "Choona (2023)", "Yeh Kaali Kaali Ankhein (2022)"],
        ...baseRec,
      },
    ];
  }

  if (wantsHindi && wantsComedy) {
    const baseRec = {
      format: "Film" as const,
      whereToWatch: {
        status: "unverified" as const,
        primary: "Availability not verified",
        note: "F.U.N will verify this in real time. Check your apps before watching.",
      },
      hiddenLayer: {
        headline: "Hindi comfort with timing",
        insight: "The right light pick should still have comic shape, not just a harmless label.",
        classyJab: "Easy can still be sharp.",
      },
    };

    return [
      {
        title: "Hera Pheri",
        year: "2000",
        runtime: "156 min",
        vibe: "slapstick, classic, chaotic-comic",
        confidence: 85,
        oneLine: "Watch Hera Pheri if you want Hindi comedy that is genuinely unhinged and endlessly rewatchable.",
        whyItFits: [
          "It has one of the tightest comic trio dynamics in Hindi cinema.",
          "The escalating chaos is built from character, not darkness.",
          "It is light without feeling empty.",
        ],
        hiddenTitles: [
          { title: "Andaz Apna Apna", year: "1994" },
          { title: "Lootcase", year: "2020" },
          { title: "Fukrey", year: "2013" },
        ],
        alternatives: ["Andaz Apna Apna (1994)", "Lootcase (2020)", "Fukrey (2013)"],
        ...baseRec,
      },
      {
        title: "Lootcase",
        year: "2020",
        runtime: "130 min",
        vibe: "caper, comedy, light chaos",
        confidence: 82,
        oneLine: "Watch Lootcase for a breezy Hindi caper with warmth, timing, and low-stakes chaos.",
        whyItFits: [
          "It is funny through situation and character rather than dark shock.",
          "The caper setup gives it momentum without heaviness.",
          "It feels relaxed but still specific.",
        ],
        hiddenTitles: [
          { title: "Hera Pheri", year: "2000" },
          { title: "Fukrey", year: "2013" },
          { title: "Do Dooni Chaar", year: "2010" },
        ],
        alternatives: ["Hera Pheri (2000)", "Fukrey (2013)", "Do Dooni Chaar (2010)"],
        ...baseRec,
      },
      {
        title: "Fukrey",
        year: "2013",
        runtime: "139 min",
        vibe: "buddy-comedy, silly, Delhi-chaos",
        confidence: 78,
        oneLine: "Watch Fukrey if you want Hindi buddy chaos that stays light on its feet.",
        whyItFits: [
          "The appeal is group chemistry and ridiculous plans.",
          "It keeps the mood comic rather than punishing.",
          "It has enough local texture to feel less generic.",
        ],
        hiddenTitles: [
          { title: "Lootcase", year: "2020" },
          { title: "Hera Pheri", year: "2000" },
          { title: "Khosla Ka Ghosla!", year: "2006" },
        ],
        alternatives: ["Lootcase (2020)", "Hera Pheri (2000)", "Khosla Ka Ghosla! (2006)"],
        ...baseRec,
      },
    ];
  }

  if (wantsHindi && wantsEmotional) {
    const baseRec = {
      format: "Film" as const,
      whereToWatch: {
        status: "unverified" as const,
        primary: "Availability not verified",
        note: "F.U.N will verify this in real time. Check your apps before watching.",
      },
      hiddenLayer: {
        headline: "Feeling without the lecture",
        insight: "The right Hindi emotional pick should move cleanly, not sink into homework cinema.",
        classyJab: "The heart can have rhythm.",
      },
    };

    return [
      {
        title: "Udaan",
        year: "2010",
        runtime: "138 min",
        vibe: "coming-of-age, wounded, quietly defiant",
        confidence: 84,
        oneLine: "Watch Udaan for Hindi emotional cinema that hurts without becoming dull.",
        whyItFits: [
          "It is deeply felt but driven by conflict and momentum.",
          "The emotion comes from character pressure rather than melodrama.",
          "It remains specific, sharp, and hard to shake.",
        ],
        hiddenTitles: [
          { title: "Kapoor & Sons", year: "2016" },
          { title: "Queen", year: "2013" },
          { title: "Margarita with a Straw", year: "2014" },
        ],
        alternatives: ["Kapoor & Sons (2016)", "Queen (2013)", "Margarita with a Straw (2014)"],
        ...baseRec,
      },
      {
        title: "Kapoor & Sons",
        year: "2016",
        runtime: "132 min",
        vibe: "family, bittersweet, sharp",
        confidence: 82,
        oneLine: "Watch Kapoor & Sons for family emotion with enough secrets and bite to stay awake.",
        whyItFits: [
          "It gives emotional payoff without flattening everyone into saints.",
          "The family tension keeps the story moving.",
          "It balances warmth, resentment, and reveal-driven drama.",
        ],
        hiddenTitles: [
          { title: "Udaan", year: "2010" },
          { title: "Queen", year: "2013" },
          { title: "Margarita with a Straw", year: "2014" },
        ],
        alternatives: ["Udaan (2010)", "Queen (2013)", "Margarita with a Straw (2014)"],
        ...baseRec,
      },
      {
        title: "Queen",
        year: "2013",
        runtime: "146 min",
        vibe: "warm, self-discovery, funny-emotional",
        confidence: 80,
        oneLine: "Watch Queen if you want Hindi emotion that feels alive, funny, and freeing.",
        whyItFits: [
          "It is emotional without turning heavy or static.",
          "The character arc has clear momentum and charm.",
          "It stays accessible while still feeling personal.",
        ],
        hiddenTitles: [
          { title: "Udaan", year: "2010" },
          { title: "Kapoor & Sons", year: "2016" },
          { title: "Margarita with a Straw", year: "2014" },
        ],
        alternatives: ["Udaan (2010)", "Kapoor & Sons (2016)", "Margarita with a Straw (2014)"],
        ...baseRec,
      },
    ];
  }

  if (wantsShameless && (input.platforms ?? []).some((platform) => /netflix/i.test(platform))) {
    const baseRec = {
      format: "Series" as const,
      whereToWatch: {
        status: "unverified" as const,
        primary: "Availability not verified",
        note: "F.U.N will verify this in real time. Check your apps before watching.",
      },
      hiddenLayer: {
        headline: "Messy families, sharper edges",
        insight: "The match is not sitcom comfort. It is flawed people making bad choices, then somehow remaining worth following.",
        classyJab: "Chaos works best when it has a pulse.",
      },
    };

    return [
      {
        title: "Ginny & Georgia",
        year: "2021",
        runtime: "50 min per episode",
        vibe: "messy, fast, family-driven",
        confidence: 86,
        oneLine: "Watch Ginny & Georgia tonight for family chaos, secrets, and bad decisions with a glossy sting.",
        whyItFits: [
          "It keeps the unstable parent-child engine that makes Shameless addictive.",
          "The comedy has consequences instead of feeling purely cozy.",
          "It has secrets, survival energy, and people you root for while questioning them.",
        ],
        hiddenTitles: [
          { title: "Good Girls", year: "2018" },
          { title: "Orange Is the New Black", year: "2013" },
          { title: "Maid", year: "2021" },
        ],
        alternatives: ["Good Girls (2018)", "Orange Is the New Black (2013)", "Maid (2021)"],
        ...baseRec,
      },
      {
        title: "Good Girls",
        year: "2018",
        runtime: "43 min per episode",
        vibe: "criminal, desperate, funny",
        confidence: 84,
        oneLine: "Watch Good Girls if you want ordinary people cornered into outrageous choices.",
        whyItFits: [
          "It shares the survival-through-schemes rhythm of Shameless.",
          "The humor comes from pressure, not polished sitcom setups.",
          "Its characters keep making things worse in ways that are easy to binge.",
        ],
        hiddenTitles: [
          { title: "Ginny & Georgia", year: "2021" },
          { title: "Orange Is the New Black", year: "2013" },
          { title: "Maid", year: "2021" },
        ],
        alternatives: ["Ginny & Georgia (2021)", "Orange Is the New Black (2013)", "Maid (2021)"],
        ...baseRec,
      },
      {
        title: "Orange Is the New Black",
        year: "2013",
        runtime: "55 min per episode",
        vibe: "raucous, wounded, ensemble",
        confidence: 82,
        oneLine: "Watch Orange Is the New Black for a sprawling ensemble of flawed people under pressure.",
        whyItFits: [
          "It has the same comic-dramatic swing between absurdity and real damage.",
          "The ensemble is morally messy without becoming bland.",
          "It turns institutional pressure into character chaos.",
        ],
        hiddenTitles: [
          { title: "Good Girls", year: "2018" },
          { title: "Ginny & Georgia", year: "2021" },
          { title: "Maid", year: "2021" },
        ],
        alternatives: ["Good Girls (2018)", "Ginny & Georgia (2021)", "Maid (2021)"],
        ...baseRec,
      },
    ];
  }

  // Guarded off for the 4 gated languages: their scare/gore fallback is handled by the
  // language-specific blocks below, so an English horror pick never gets generated here
  // only to be rejected by the hard language gate downstream.
  const wantsGatedLanguage = wantsHindi || wantsKorean || wantsFrench || wantsGerman;
  if ((wantsScare || wantsGore) && !wantsGatedLanguage) {
    if (input.platformFilter === "mine" && (input.platforms ?? []).some((platform) => /netflix/i.test(platform))) {
      const netflixRec = {
        format: "Film" as const,
        whereToWatch: {
          status: "unverified" as const,
          primary: "Availability not verified",
          note: "F.U.N will verify this in real time. Check your apps before watching.",
        },
        hiddenLayer: {
          headline: wantsGore ? "Gore inside your queue" : "Fear inside your queue",
          insight: wantsGore
            ? "The right match should be bloody, direct, and recognisably horror, not a quiet prestige detour."
            : "The right match should create real dread and shared nerves, not just a clever surreal mood.",
          classyJab: wantsGore ? "Your night asked for blood, not whispers." : "A good scare should not feel like homework.",
        },
      };

      const netflixScares: RawRecommendation[] = [
        {
          title: "Apostle",
          year: "2018",
          runtime: "130 min",
          vibe: wantsGore ? "folk horror, gory, violent" : "folk horror, dread, cult terror",
          confidence: wantsGore ? 82 : 84,
          oneLine: wantsGore
            ? "Watch Apostle if you want folk-horror dread that eventually turns properly brutal."
            : "Watch Apostle if you want your partner properly tense, uneasy, and waiting for the island to turn nasty.",
          whyItFits: [
            wantsGore ? "It has explicit violence and gore rather than implied menace only." : "It is recognisably horror, not just a surreal drama wearing a scary coat.",
            "The cult-island setting gives the fear a nasty ritual texture.",
            wantsGore ? "It is darker and more physical than a standard mystery thriller." : "It gives a partner-watch night real dread and reaction moments.",
          ],
          hiddenTitles: [
            { title: "Fear Street Part 2: 1978", year: "2021" },
            { title: "Nobody Sleeps in the Woods Tonight", year: "2020" },
            { title: "Demons", year: "1985" },
          ],
          alternatives: ["Fear Street Part 2: 1978 (2021)", "Nobody Sleeps in the Woods Tonight (2020)", "Demons (1985)"],
          ...netflixRec,
        },
        {
          title: "Fear Street Part 2: 1978",
          year: "2021",
          runtime: "111 min",
          vibe: "slasher, scary, summer-camp horror",
          confidence: wantsGore ? 80 : 82,
          oneLine: "Watch Fear Street Part 2: 1978 for an accessible slasher night that is built for shared jumps and nervous fun.",
          whyItFits: [
            "It answers the scare request directly with slasher momentum and clear horror stakes.",
            "The summer-camp setup makes it easy to watch together without needing arthouse patience.",
            "It creates reaction moments a partner can actually feel in the room.",
          ],
          hiddenTitles: [
            { title: "Apostle", year: "2018" },
            { title: "Nobody Sleeps in the Woods Tonight", year: "2020" },
            { title: "Demons", year: "1985" },
          ],
          alternatives: ["Apostle (2018)", "Nobody Sleeps in the Woods Tonight (2020)", "Demons (1985)"],
          ...netflixRec,
        },
        {
          title: "Nobody Sleeps in the Woods Tonight",
          year: "2020",
          runtime: "103 min",
          vibe: "Polish horror, forest dread, slasher",
          confidence: 80,
          oneLine: "Watch Nobody Sleeps in the Woods Tonight for a Polish forest-horror pick that is blunt, scary, and easy to react to together.",
          whyItFits: [
            "It is built as horror first, so the scare request does not get diluted into surreal mood.",
            "The forest setup gives the partner-watch a clear threat and fast tension.",
            "It fits Poland/Netflix better than a random global scare pick.",
          ],
          hiddenTitles: [
            { title: "Apostle", year: "2018" },
            { title: "Fear Street Part 2: 1978", year: "2021" },
            { title: "Demons", year: "1985" },
          ],
          alternatives: ["Apostle (2018)", "Fear Street Part 2: 1978 (2021)", "Demons (1985)"],
          ...netflixRec,
        },
      ];

      return netflixScares;
    }

    const baseRec = {
      format: "Film" as const,
      whereToWatch: {
        status: "unverified" as const,
        primary: "Availability not verified",
        note: "F.U.N will verify this in real time. Check your apps before watching.",
      },
      hiddenLayer: {
        headline: "Blood with real craft",
        insight: "The match should deliver impact, texture, and body-level dread, not just a horror label.",
        classyJab: "Some nights call for sharper teeth.",
      },
    };

    return [
      {
        title: "The Sadness",
        year: "2021",
        runtime: "99 min",
        vibe: "feral, bloody, extreme",
        confidence: 88,
        oneLine: "Watch The Sadness if you want gore that is genuinely nasty, fast, and hard to shake.",
        whyItFits: [
          "It treats gore as the main event rather than a decorative horror beat.",
          "The violence is relentless, physical, and survival-driven.",
          "It has the shock intensity a plain thriller or quiet drama cannot satisfy.",
        ],
        hiddenTitles: [
          { title: "Inside", year: "2007" },
          { title: "Terrifier 2", year: "2022" },
          { title: "Project Wolf Hunting", year: "2022" },
        ],
        alternatives: ["Inside (2007)", "Terrifier 2 (2022)", "Project Wolf Hunting (2022)"],
        ...baseRec,
      },
      {
        title: "Evil Dead Rise",
        year: "2023",
        runtime: "96 min",
        vibe: "bloody, demonic, nasty-fun",
        confidence: 84,
        oneLine: "Watch Evil Dead Rise for a lean, bloody possession nightmare with proper splatter energy.",
        whyItFits: [
          "It delivers visible gore and body threat quickly.",
          "The pacing is aggressive instead of contemplative.",
          "It balances polished production with nasty practical-horror impact.",
        ],
        hiddenTitles: [
          { title: "The Void", year: "2016" },
          { title: "When Evil Lurks", year: "2023" },
          { title: "Deadstream", year: "2022" },
        ],
        alternatives: ["When Evil Lurks (2023)", "The Void (2016)", "Deadstream (2022)"],
        ...baseRec,
      },
      {
        title: "Raw",
        year: "2016",
        runtime: "99 min",
        vibe: "body horror, sensual, gruesome",
        confidence: 82,
        oneLine: "Watch Raw if you want gore with body-horror elegance and a disturbing coming-of-age bite.",
        whyItFits: [
          "It is explicitly about appetite, flesh, and bodily transformation.",
          "The gore is tied to character psychology instead of random shock.",
          "It keeps arthouse control without becoming soft or bloodless.",
        ],
        hiddenTitles: [
          { title: "Titane", year: "2021" },
          { title: "Saint Maud", year: "2019" },
          { title: "Hatching", year: "2022" },
        ],
        alternatives: ["Titane (2021)", "Martyrs (2008)", "Possessor (2020)"],
        ...baseRec,
      },
    ];
  }

  if (wantsCry) {
    const baseRec = {
      format: "Film" as const,
      whereToWatch: {
        status: "unverified" as const,
        primary: "Availability not verified",
        note: "F.U.N will verify this in real time. Check your apps before watching.",
      },
      hiddenLayer: {
        headline: "Catharsis, not comfort filler",
        insight: "A tearjerker should create emotional release, not just warm vibes.",
        classyJab: "Some nights need the quiet flood.",
      },
    };

    return [
      {
        title: "Past Lives",
        year: "2023",
        runtime: "106 min",
        vibe: "romantic, devastating, restrained",
        confidence: 86,
        oneLine: "Watch Past Lives when you want quiet heartbreak that can make two people go very still together.",
        whyItFits: [
          "It is built for emotional catharsis rather than generic feel-good warmth.",
          "The ache is intimate enough for a partner watch.",
          "It earns tears through restraint, memory, and impossible timing.",
        ],
        hiddenTitles: [
          { title: "Blue Jay", year: "2016" },
          { title: "Aftersun", year: "2022" },
          { title: "A Ghost Story", year: "2017" },
        ],
        alternatives: ["Blue Jay (2016)", "Aftersun (2022)", "A Ghost Story (2017)"],
        ...baseRec,
      },
      {
        title: "Aftersun",
        year: "2022",
        runtime: "102 min",
        vibe: "grief, memory, devastating",
        confidence: 84,
        oneLine: "Watch Aftersun if you want a film whose emotional weight arrives quietly and then stays.",
        whyItFits: [
          "It is a true catharsis pick, not a soft comedy with sentimental edges.",
          "The emotional reveal has the kind of delayed force that can break the room open.",
          "It is intimate and shared without becoming manipulative.",
        ],
        hiddenTitles: [
          { title: "Past Lives", year: "2023" },
          { title: "Blue Jay", year: "2016" },
          { title: "Close", year: "2022" },
        ],
        alternatives: ["Past Lives (2023)", "Blue Jay (2016)", "Close (2022)"],
        ...baseRec,
      },
      {
        title: "Blue Jay",
        year: "2016",
        runtime: "80 min",
        vibe: "intimate, bittersweet, heartbreaking",
        confidence: 80,
        oneLine: "Watch Blue Jay for a short, intimate two-hander that turns old love into real ache.",
        whyItFits: [
          "It is compact but emotionally direct.",
          "The partner-watch fit comes from memory, tenderness, and regret.",
          "It aims for tears without needing melodrama or a huge runtime.",
        ],
        hiddenTitles: [
          { title: "Past Lives", year: "2023" },
          { title: "Aftersun", year: "2022" },
          { title: "A Ghost Story", year: "2017" },
        ],
        alternatives: ["Past Lives (2023)", "Aftersun (2022)", "A Ghost Story (2017)"],
        ...baseRec,
      },
    ];
  }

  if (wantsHindi && wantsThriller) {
    const baseRec = {
      format: "Film" as const,
      whereToWatch: {
        status: "unverified" as const,
        primary: "Availability not verified",
        note: "F.U.N will verify this in real time. Check your apps before watching.",
      },
      hiddenLayer: {
        headline: "Hindi suspense beyond the obvious",
        insight: "The right discovery thriller should stay tense and specific, not drift into generic family drama.",
        classyJab: "A sharper map finds quieter danger.",
      },
    };

    return [
      {
        title: "Aamir",
        year: "2008",
        runtime: "99 min",
        vibe: "Hindi thriller, tense, compact",
        confidence: 78,
        oneLine: "Watch Aamir for a lean Hindi thriller built around pressure, movement, and moral panic.",
        whyItFits: [
          "It stays in the Hindi thriller lane instead of drifting into family drama.",
          "The runtime is compact enough for a focused night.",
          "It feels less over-recommended than the usual discovery-thriller defaults.",
        ],
        hiddenTitles: [
          { title: "Kaun", year: "1999" },
          { title: "A Death in the Gunj", year: "2017" },
          { title: "Ek Hasina Thi", year: "2004" },
        ],
        alternatives: ["Kaun (1999)", "A Death in the Gunj (2017)", "Ek Hasina Thi (2004)"],
        ...baseRec,
      },
      {
        title: "Kaun",
        year: "1999",
        runtime: "90 min",
        vibe: "Hindi thriller, claustrophobic, tense",
        confidence: 76,
        oneLine: "Watch Kaun for a tight Hindi suspense chamber piece that keeps the mood sharp.",
        whyItFits: [
          "It is unmistakably a thriller, not a broad emotional serial.",
          "The contained setup keeps the watch focused and direct.",
          "Its cult reputation makes it feel like a real discovery pick.",
        ],
        hiddenTitles: [
          { title: "Aamir", year: "2008" },
          { title: "A Death in the Gunj", year: "2017" },
          { title: "404: Error Not Found", year: "2011" },
        ],
        alternatives: ["Aamir (2008)", "A Death in the Gunj (2017)", "404: Error Not Found (2011)"],
        ...baseRec,
      },
      {
        title: "A Death in the Gunj",
        year: "2017",
        runtime: "110 min",
        vibe: "Indian thriller, uneasy, intimate",
        confidence: 74,
        oneLine: "Watch A Death in the Gunj for an Indian slow-burn thriller with quiet menace and real emotional control.",
        whyItFits: [
          "It is an Indian-market thriller with unease built into the social setting.",
          "The tension is character-led rather than generic crime noise.",
          "It is acclaimed without being the default Hindi-thriller answer.",
        ],
        hiddenTitles: [
          { title: "Aamir", year: "2008" },
          { title: "Kaun", year: "1999" },
          { title: "Ek Hasina Thi", year: "2004" },
        ],
        alternatives: ["Aamir (2008)", "Kaun (1999)", "Ek Hasina Thi (2004)"],
        ...baseRec,
      },
    ];
  }

  if (wantsHindi) {
    const baseRec = {
      format: "Film" as const,
      whereToWatch: {
        status: "unverified" as const,
        primary: "Availability not verified",
        note: "F.U.N will verify this in real time. Check your apps before watching.",
      },
      hiddenLayer: {
        headline: "Hindi cinema beyond the obvious",
        insight: "The best Hindi picks often sit just outside what the homepage surfaces first.",
        classyJab: "Your taste deserves a better map.",
      },
    };

    return [
      {
        title: "Stree",
        year: "2018",
        runtime: "128 min",
        vibe: "horror-comedy, quirky, ensemble",
        confidence: 87,
        oneLine: "Watch Stree for a genuinely funny Hindi horror-comedy with a sharp small-town ensemble.",
        whyItFits: [
          "It blends comedy and horror with real craft, not just genre labeling.",
          "The ensemble chemistry and local flavour make it instantly rewatchable.",
          "It is funny, surprising, and never outstays its welcome.",
        ],
        hiddenTitles: [
          { title: "Lootcase", year: "2020" },
          { title: "Fukrey", year: "2013" },
          { title: "Mard Ko Dard Nahi Hota", year: "2019" },
        ],
        alternatives: ["Lootcase (2020)", "Fukrey (2013)", "Mard Ko Dard Nahi Hota (2019)"],
        ...baseRec,
      },
      {
        title: "Hera Pheri",
        year: "2000",
        runtime: "156 min",
        vibe: "slapstick, classic, chaotic-comic",
        confidence: 85,
        oneLine: "Watch Hera Pheri if you want a Hindi comedy that is genuinely unhinged and endlessly rewatchable.",
        whyItFits: [
          "It has one of the tightest comic trio dynamics in Hindi cinema.",
          "The escalating chaos is built from character, not just gags.",
          "It holds up completely — the timing and energy haven't aged.",
        ],
        hiddenTitles: [
          { title: "Phir Hera Pheri", year: "2006" },
          { title: "Andaz Apna Apna", year: "1994" },
          { title: "Jaane Bhi Do Yaaron", year: "1983" },
        ],
        alternatives: ["Andaz Apna Apna (1994)", "Phir Hera Pheri (2006)", "Jaane Bhi Do Yaaron (1983)"],
        ...baseRec,
      },
      {
        title: "Lootcase",
        year: "2020",
        runtime: "130 min",
        vibe: "caper, comedy, light chaos",
        confidence: 80,
        oneLine: "Watch Lootcase for a low-stakes Hindi caper with relaxed pacing and genuine warmth.",
        whyItFits: [
          "It is a proper comedy caper — everyone wants the same suitcase, nobody is competent.",
          "The tone stays breezy without becoming brainless.",
          "It is comfort-watching with enough story to stay engaged.",
        ],
        hiddenTitles: [
          { title: "Stree", year: "2018" },
          { title: "Fukrey Returns", year: "2017" },
          { title: "Kaalakaandi", year: "2018" },
        ],
        alternatives: ["Stree (2018)", "Fukrey Returns (2017)", "Kaalakaandi (2018)"],
        ...baseRec,
      },
    ];
  }

  // Korean/French/German fallback lanes exist because the hard language gate (matchesLanguageRequest)
  // will reject any English pick for these 4 languages. Without a curated set here, a wrong-language
  // LLM batch falls through to the generic English blocks below, gets rejected, and the user is left
  // with nothing. Only scoped to languages proven end-to-end — see src/lib/language-lane.ts.
  if (wantsKorean && (wantsScare || wantsGore || wantsThriller)) {
    const baseRec = {
      format: "Film" as const,
      whereToWatch: {
        status: "unverified" as const,
        primary: "Availability not verified",
        note: "F.U.N will verify this in real time. Check your apps before watching.",
      },
      hiddenLayer: {
        headline: "Korean tension beyond the obvious",
        insight: "Korean thriller and horror rarely need to borrow dread from anywhere else.",
        classyJab: "Your taste deserves a better map.",
      },
    };
    return [
      {
        title: "Midnight",
        year: "2021",
        runtime: "104 min",
        vibe: "Korean thriller, tense, propulsive",
        confidence: 81,
        oneLine: "Watch Midnight for a lean Korean pursuit thriller that keeps moving without overrunning the night.",
        whyItFits: [
          "It stays firmly in the Korean thriller lane.",
          "The pursuit structure creates momentum without relying on a slow dramatic build.",
          "Its runtime fits a strict under-two-hour request.",
        ],
        hiddenTitles: [{ title: "The Call", year: "2020" }, { title: "Forgotten", year: "2017" }, { title: "Montage", year: "2013" }],
        alternatives: ["The Call (2020)", "Forgotten (2017)", "Montage (2013)"],
        ...baseRec,
      },
      {
        title: "The Wailing",
        year: "2016",
        runtime: "156 min",
        vibe: "Korean folk horror, dread, unrelenting",
        confidence: 84,
        oneLine: "Watch The Wailing for a Korean horror-thriller that keeps escalating dread without ever letting go.",
        whyItFits: [
          "It stays firmly in Korean horror rather than drifting into generic global scare tropes.",
          "The atmosphere builds through sustained unease, not cheap jump scares alone.",
          "It rewards patience with a genuinely unsettling back half.",
        ],
        hiddenTitles: [{ title: "I Saw the Devil", year: "2010" }, { title: "The Chaser", year: "2008" }, { title: "A Tale of Two Sisters", year: "2003" }],
        alternatives: ["I Saw the Devil (2010)", "The Chaser (2008)", "A Tale of Two Sisters (2003)"],
        ...baseRec,
      },
      {
        title: "I Saw the Devil",
        year: "2010",
        runtime: "144 min",
        vibe: "Korean revenge thriller, brutal, relentless",
        confidence: 82,
        oneLine: "Watch I Saw the Devil for a genuinely brutal Korean revenge thriller with real teeth.",
        whyItFits: [
          "It delivers real intensity rather than softened suspense.",
          "The cat-and-mouse structure keeps tension sustained throughout.",
          "It stays honest to the Korean thriller/extreme-cinema lane.",
        ],
        hiddenTitles: [{ title: "The Chaser", year: "2008" }, { title: "The Wailing", year: "2016" }, { title: "Oldboy", year: "2003" }],
        alternatives: ["The Chaser (2008)", "Oldboy (2003)", "The Wailing (2016)"],
        ...baseRec,
      },
      {
        title: "The Chaser",
        year: "2008",
        runtime: "125 min",
        vibe: "Korean thriller, tense, procedural dread",
        confidence: 80,
        oneLine: "Watch The Chaser for a taut Korean thriller where the horror is in the ticking clock.",
        whyItFits: [
          "It is thriller-first: tension from pursuit and time pressure, not spectacle.",
          "Its pacing is relentless without needing gore to stay gripping.",
          "It is a real discovery pick rather than the default Parasite answer.",
        ],
        hiddenTitles: [{ title: "I Saw the Devil", year: "2010" }, { title: "The Wailing", year: "2016" }, { title: "Memories of Murder", year: "2003" }],
        alternatives: ["I Saw the Devil (2010)", "Memories of Murder (2003)", "The Wailing (2016)"],
        ...baseRec,
      },
    ];
  }

  if (wantsKorean) {
    const baseRec = {
      format: "Film" as const,
      whereToWatch: {
        status: "unverified" as const,
        primary: "Availability not verified",
        note: "F.U.N will verify this in real time. Check your apps before watching.",
      },
      hiddenLayer: {
        headline: "Korean cinema beyond the obvious",
        insight: "The best Korean picks often sit just outside what the homepage surfaces first.",
        classyJab: "Your taste deserves a better map.",
      },
    };
    return [
      {
        title: "Burning",
        year: "2018",
        runtime: "148 min",
        vibe: "Korean slow-burn mystery, ambiguous, absorbing",
        confidence: 83,
        oneLine: "Watch Burning for a hypnotic Korean slow-burn that turns ambiguity into real tension.",
        whyItFits: [
          "It stays deliberately unresolved rather than tying things up for comfort.",
          "The mood is precise and controlled throughout.",
          "It rewards attention with a genuinely unsettling final act.",
        ],
        hiddenTitles: [{ title: "Decision to Leave", year: "2022" }, { title: "Parasite", year: "2019" }, { title: "Poetry", year: "2010" }],
        alternatives: ["Decision to Leave (2022)", "Parasite (2019)", "Poetry (2010)"],
        ...baseRec,
      },
      {
        title: "Decision to Leave",
        year: "2022",
        runtime: "138 min",
        vibe: "Korean romantic mystery, elegant, melancholic",
        confidence: 81,
        oneLine: "Watch Decision to Leave for a sophisticated Korean mystery with real romantic ache underneath.",
        whyItFits: [
          "It blends genre precision with genuine emotional complexity.",
          "The craft is meticulous without feeling cold.",
          "It is acclaimed but still feels like a discovery outside the obvious picks.",
        ],
        hiddenTitles: [{ title: "Burning", year: "2018" }, { title: "Poetry", year: "2010" }, { title: "Parasite", year: "2019" }],
        alternatives: ["Burning (2018)", "Poetry (2010)", "Parasite (2019)"],
        ...baseRec,
      },
      {
        title: "Poetry",
        year: "2010",
        runtime: "139 min",
        vibe: "Korean drama, quiet, devastating",
        confidence: 78,
        oneLine: "Watch Poetry for a quietly devastating Korean drama built on restraint rather than spectacle.",
        whyItFits: [
          "It carries real emotional weight without manipulative pacing.",
          "The performance and structure are precise and unhurried.",
          "It is a genuine discovery pick beyond the default Korean-cinema answers.",
        ],
        hiddenTitles: [{ title: "Burning", year: "2018" }, { title: "Decision to Leave", year: "2022" }, { title: "A Moment to Remember", year: "2004" }],
        alternatives: ["Burning (2018)", "Decision to Leave (2022)", "A Moment to Remember (2004)"],
        ...baseRec,
      },
    ];
  }

  if (wantsFrench && (wantsScare || wantsGore || wantsThriller)) {
    const baseRec = {
      format: "Film" as const,
      whereToWatch: {
        status: "unverified" as const,
        primary: "Availability not verified",
        note: "F.U.N will verify this in real time. Check your apps before watching.",
      },
      hiddenLayer: {
        headline: "French suspense beyond the obvious",
        insight: "French thriller cinema builds dread through precision, not noise.",
        classyJab: "Your taste deserves a better map.",
      },
    };
    return [
      {
        title: "Tell No One",
        year: "2006",
        runtime: "131 min",
        vibe: "French thriller, twisty, propulsive",
        confidence: 82,
        oneLine: "Watch Tell No One for a genuinely twisty French thriller that never loosens its grip.",
        whyItFits: [
          "It stays firmly in French thriller territory rather than drifting into drama.",
          "The plotting rewards close attention with real payoff.",
          "It is acclaimed without being the obvious default pick.",
        ],
        hiddenTitles: [{ title: "Caché", year: "2005" }, { title: "A Prophet", year: "2009" }, { title: "Point Blank", year: "2010" }],
        alternatives: ["Caché (2005)", "A Prophet (2009)", "Point Blank (2010)"],
        ...baseRec,
      },
      {
        title: "Caché",
        year: "2005",
        runtime: "117 min",
        vibe: "French thriller, paranoid, dread-filled",
        confidence: 80,
        oneLine: "Watch Caché for a French thriller that turns quiet dread into sustained unease.",
        whyItFits: [
          "The tension is psychological and controlled, not spectacle-driven.",
          "Haneke's precision keeps the dread genuinely uncomfortable.",
          "It stays in the thriller lane without softening into drama.",
        ],
        hiddenTitles: [{ title: "Tell No One", year: "2006" }, { title: "A Prophet", year: "2009" }, { title: "Elle", year: "2016" }],
        alternatives: ["Tell No One (2006)", "A Prophet (2009)", "Elle (2016)"],
        ...baseRec,
      },
      {
        title: "A Prophet",
        year: "2009",
        runtime: "155 min",
        vibe: "French crime thriller, brutal, immersive",
        confidence: 80,
        oneLine: "Watch A Prophet for an intense French crime thriller with real stakes and no softening.",
        whyItFits: [
          "It delivers genuine tension and danger inside a prison-crime structure.",
          "It is critically major while still feeling like a discovery.",
          "It stays honest to a hard thriller/crime lane throughout.",
        ],
        hiddenTitles: [{ title: "Tell No One", year: "2006" }, { title: "Caché", year: "2005" }, { title: "Point Blank", year: "2010" }],
        alternatives: ["Tell No One (2006)", "Caché (2005)", "Point Blank (2010)"],
        ...baseRec,
      },
    ];
  }

  if (wantsFrench) {
    const baseRec = {
      format: "Film" as const,
      whereToWatch: {
        status: "unverified" as const,
        primary: "Availability not verified",
        note: "F.U.N will verify this in real time. Check your apps before watching.",
      },
      hiddenLayer: {
        headline: "French cinema beyond the obvious",
        insight: "The best French picks often sit just outside what the homepage surfaces first.",
        classyJab: "Your taste deserves a better map.",
      },
    };
    return [
      {
        title: "Amélie",
        year: "2001",
        runtime: "122 min",
        vibe: "French romance-comedy, whimsical, warm",
        confidence: 85,
        oneLine: "Watch Amélie for whimsical, warm French storytelling that never tips into saccharine.",
        whyItFits: [
          "It is unmistakably French in texture, humor, and rhythm.",
          "The warmth is earned through specific, inventive detail, not cliché.",
          "It stays charming without becoming empty comfort food.",
        ],
        hiddenTitles: [{ title: "The Intouchables", year: "2011" }, { title: "The Class", year: "2008" }, { title: "Delicatessen", year: "1991" }],
        alternatives: ["The Intouchables (2011)", "The Class (2008)", "Delicatessen (1991)"],
        ...baseRec,
      },
      {
        title: "The Intouchables",
        year: "2011",
        runtime: "112 min",
        vibe: "French comedy-drama, warm, feel-good",
        confidence: 84,
        oneLine: "Watch The Intouchables for genuine warmth and humor with real emotional grounding.",
        whyItFits: [
          "The chemistry and humor feel earned rather than manufactured.",
          "It balances comedy and real feeling without tipping into melodrama.",
          "It is broadly loved while still feeling specific and French.",
        ],
        hiddenTitles: [{ title: "Amélie", year: "2001" }, { title: "The Class", year: "2008" }, { title: "Delicatessen", year: "1991" }],
        alternatives: ["Amélie (2001)", "The Class (2008)", "Delicatessen (1991)"],
        ...baseRec,
      },
      {
        title: "The Class",
        year: "2008",
        runtime: "128 min",
        vibe: "French drama, immersive, unresolved",
        confidence: 78,
        oneLine: "Watch The Class for an immersive French drama that stays honest instead of neatly resolving.",
        whyItFits: [
          "It captures social and cultural texture with real precision.",
          "The naturalistic approach avoids sentimentality.",
          "It is a genuine discovery pick beyond the obvious French default.",
        ],
        hiddenTitles: [{ title: "Amélie", year: "2001" }, { title: "The Intouchables", year: "2011" }, { title: "A Prophet", year: "2009" }],
        alternatives: ["Amélie (2001)", "The Intouchables (2011)", "A Prophet (2009)"],
        ...baseRec,
      },
    ];
  }

  if (wantsGerman && (wantsScare || wantsGore || wantsThriller)) {
    const baseRec = {
      format: "Film" as const,
      whereToWatch: {
        status: "unverified" as const,
        primary: "Availability not verified",
        note: "F.U.N will verify this in real time. Check your apps before watching.",
      },
      hiddenLayer: {
        headline: "German tension beyond the obvious",
        insight: "German thriller and horror lean into dread through control, not chaos.",
        classyJab: "Your taste deserves a better map.",
      },
    };
    return [
      {
        title: "Goodnight Mommy",
        year: "2014",
        runtime: "99 min",
        vibe: "German-language psychological horror, unsettling, controlled",
        confidence: 80,
        oneLine: "Watch Goodnight Mommy for genuinely unsettling German-language psychological horror.",
        whyItFits: [
          "It stays in real horror territory rather than softening into family drama.",
          "The dread builds through restraint and ambiguity, not jump scares.",
          "It delivers a real gut-punch rather than a comfortable ending.",
        ],
        hiddenTitles: [{ title: "The Lives of Others", year: "2006" }, { title: "The Wave", year: "2008" }, { title: "Funny Games", year: "1997" }],
        alternatives: ["The Lives of Others (2006)", "The Wave (2008)", "Funny Games (1997)"],
        ...baseRec,
      },
      {
        title: "The Lives of Others",
        year: "2006",
        runtime: "137 min",
        vibe: "German surveillance thriller, tense, dread-filled",
        confidence: 82,
        oneLine: "Watch The Lives of Others for a tense German thriller built on paranoia and moral pressure.",
        whyItFits: [
          "The tension is sustained through surveillance dread rather than spectacle.",
          "It stays honest to the thriller lane while carrying real moral weight.",
          "It is acclaimed without being an over-obvious default.",
        ],
        hiddenTitles: [{ title: "Goodnight Mommy", year: "2014" }, { title: "The Wave", year: "2008" }, { title: "Funny Games", year: "1997" }],
        alternatives: ["Goodnight Mommy (2014)", "The Wave (2008)", "Funny Games (1997)"],
        ...baseRec,
      },
      {
        title: "The Wave",
        year: "2008",
        runtime: "107 min",
        vibe: "German social thriller, disturbing, tense",
        confidence: 78,
        oneLine: "Watch The Wave for a disturbing German thriller that escalates with real menace.",
        whyItFits: [
          "It stays tense and unsettling throughout rather than resolving comfortably.",
          "The premise builds real dread through plausibility.",
          "It is a sharper discovery pick than the default German answers.",
        ],
        hiddenTitles: [{ title: "The Lives of Others", year: "2006" }, { title: "Goodnight Mommy", year: "2014" }, { title: "Funny Games", year: "1997" }],
        alternatives: ["The Lives of Others (2006)", "Goodnight Mommy (2014)", "Funny Games (1997)"],
        ...baseRec,
      },
    ];
  }

  if (wantsGerman) {
    const baseRec = {
      format: "Film" as const,
      whereToWatch: {
        status: "unverified" as const,
        primary: "Availability not verified",
        note: "F.U.N will verify this in real time. Check your apps before watching.",
      },
      hiddenLayer: {
        headline: "German cinema beyond the obvious",
        insight: "The best German picks often sit just outside what the homepage surfaces first.",
        classyJab: "Your taste deserves a better map.",
      },
    };
    return [
      {
        title: "Good Bye, Lenin!",
        year: "2003",
        runtime: "121 min",
        vibe: "German comedy-drama, warm, inventive",
        confidence: 84,
        oneLine: "Watch Good Bye, Lenin! for warm, inventive German storytelling with real historical texture.",
        whyItFits: [
          "It is unmistakably German in setting, humor, and emotional register.",
          "The warmth is earned through a genuinely clever premise, not cliché.",
          "It balances comedy and real feeling without tipping into either extreme.",
        ],
        hiddenTitles: [{ title: "Toni Erdmann", year: "2016" }, { title: "Run Lola Run", year: "1998" }, { title: "The Lives of Others", year: "2006" }],
        alternatives: ["Toni Erdmann (2016)", "Run Lola Run (1998)", "The Lives of Others (2006)"],
        ...baseRec,
      },
      {
        title: "Run Lola Run",
        year: "1998",
        runtime: "81 min",
        vibe: "German thriller-drama, kinetic, propulsive",
        confidence: 81,
        oneLine: "Watch Run Lola Run for kinetic, propulsive German storytelling that never lets up.",
        whyItFits: [
          "Its structure and pace feel genuinely inventive rather than formulaic.",
          "It stays tense and alive throughout a tight runtime.",
          "It is iconic while still feeling like a real discovery to newer viewers.",
        ],
        hiddenTitles: [{ title: "Good Bye, Lenin!", year: "2003" }, { title: "Toni Erdmann", year: "2016" }, { title: "The Lives of Others", year: "2006" }],
        alternatives: ["Good Bye, Lenin! (2003)", "Toni Erdmann (2016)", "The Lives of Others (2006)"],
        ...baseRec,
      },
      {
        title: "Toni Erdmann",
        year: "2016",
        runtime: "162 min",
        vibe: "German comedy-drama, awkward, precise",
        confidence: 78,
        oneLine: "Watch Toni Erdmann for a precise German comedy-drama that finds real feeling in awkwardness.",
        whyItFits: [
          "It carries real emotional truth beneath its uncomfortable comedy.",
          "The pacing and tone are distinctly unresolved rather than tidy.",
          "It is acclaimed while still feeling like a genuine discovery.",
        ],
        hiddenTitles: [{ title: "Good Bye, Lenin!", year: "2003" }, { title: "Run Lola Run", year: "1998" }, { title: "The Lives of Others", year: "2006" }],
        alternatives: ["Good Bye, Lenin! (2003)", "Run Lola Run (1998)", "The Lives of Others (2006)"],
        ...baseRec,
      },
    ];
  }

  const avoids = new Set((input.avoids ?? []).map((avoid) => avoid.toLowerCase()));
  if (hasNegatedConcept(text, /\bgore|gory|blood|bloody|splatter|body horror\b/i)) avoids.add("gore");
  if (hasNegatedConcept(text, /\bviolence|violent|brutal|action\b/i)) avoids.add("violence");
  if (hasNegatedConcept(text, /\bhorror|scary|ghost|haunted|supernatural\b/i)) avoids.add("horror");
  if (hasNegatedConcept(text, /\bheavy drama|heavy|trauma|depressing|bleak\b/i)) avoids.add("heavy drama");
  if (hasNegatedConcept(text, /\bslow|slow burn|slow-burn\b/i)) avoids.add("slow");
  const wantsEmotionalRelief = contractHas("emotional-relief", "gentle-comfort") ||
    (intentContract?.situation ?? []).some((signal) => signal.includes("grief-relief") || signal.includes("breakup-recovery"));
  const light = avoids.has("violence") || avoids.has("gore") || avoids.has("heavy drama") || wantsComedy || wantsRomance;
  const strictNoDarkness = avoids.has("violence") || avoids.has("gore") || avoids.has("horror");
  const wantsWeird = /\b(weird|strange|unusual|offbeat|quirky|absurd|surreal|unhinged)\b/i.test(text) || (input.craziness ?? 0) >= 2;
  const baseRec = {
    format: "Film" as const,
    whereToWatch: {
      status: "unverified" as const,
      primary: "Availability needs verification",
      note: "Check your apps - F.U.N will verify availability in real time shortly.",
    },
    hiddenLayer: {
      headline: "Your taste may be bigger than your homepage.",
      insight: "The apps you open first may not be the apps that best match tonight's mood.",
      classyJab: "Your taste deserves a better map.",
    },
  };

  if (wantsEmotionalRelief) {
    const reliefIntent = {
      primary: "comfort",
      secondary: ["emotional-relief", "gentle-comfort"],
      hardAvoids: intent.hardAvoids,
      softAvoids: intent.softAvoids,
      format: "film" as const,
      language: "any",
      situation: intentContract?.situation ?? [],
      intensity: "safe" as const,
      ambiguity: "",
    };
    return [
      {
        title: "Paddington 2",
        year: "2017",
        runtime: "103 min",
        vibe: "warm, funny, reassuring",
        confidence: 84,
        oneLine: "Watch Paddington 2 for sincere warmth that lifts the room without asking you to process more pain.",
        whyItFits: [
          "Its kindness is active and funny rather than sentimental or grief-centered.",
          "The story is easy to enter and gives the viewer a clean emotional landing.",
          "It offers relief without turning romance or loss into the main event.",
        ],
        parsedIntent: reliefIntent,
        contentCategory: ["comfort", "comedy", "family"],
        emotionalEffect: ["warmth", "reassurance", "laughter"],
        hiddenTitles: [
          { title: "School of Rock", year: "2003" },
          { title: "Kiki's Delivery Service", year: "1989" },
          { title: "Chef", year: "2014" },
        ],
        alternatives: ["School of Rock (2003)", "Kiki's Delivery Service (1989)", "Chef (2014)"],
        ...baseRec,
      },
      {
        title: "School of Rock",
        year: "2003",
        runtime: "109 min",
        vibe: "joyful, energetic, easy",
        confidence: 82,
        oneLine: "Watch School of Rock when you need uncomplicated momentum, laughter, and people finding their spark.",
        whyItFits: [
          "It redirects attention through music and comic energy without becoming emotionally demanding.",
          "The warmth comes from belonging and play, not romance or heartbreak.",
          "Its familiar shape makes it easy to trust on a low-reserve night.",
        ],
        parsedIntent: reliefIntent,
        contentCategory: ["comfort", "comedy", "music"],
        emotionalEffect: ["laughter", "warmth", "uplifting"],
        hiddenTitles: [
          { title: "Paddington 2", year: "2017" },
          { title: "Kiki's Delivery Service", year: "1989" },
          { title: "Chef", year: "2014" },
        ],
        alternatives: ["Paddington 2 (2017)", "Kiki's Delivery Service (1989)", "Chef (2014)"],
        ...baseRec,
      },
      {
        title: "Kiki's Delivery Service",
        year: "1989",
        runtime: "103 min",
        vibe: "gentle, restorative, hopeful",
        confidence: 81,
        oneLine: "Watch Kiki's Delivery Service for a gentle reset built on friendship, purpose, and regained confidence.",
        whyItFits: [
          "It is emotionally soft without being empty or artificially cheerful.",
          "The central recovery arc is hopeful and containing rather than punishing.",
          "It leaves grief and romantic longing outside the center of the experience.",
        ],
        parsedIntent: reliefIntent,
        contentCategory: ["comfort", "animation", "family"],
        emotionalEffect: ["soothing", "reassurance", "hopeful"],
        hiddenTitles: [
          { title: "Paddington 2", year: "2017" },
          { title: "School of Rock", year: "2003" },
          { title: "Chef", year: "2014" },
        ],
        alternatives: ["Paddington 2 (2017)", "School of Rock (2003)", "Chef (2014)"],
        ...baseRec,
      },
    ];
  }

  if (strictNoDarkness && (wantsComedy || wantsWeird)) {
    return [
      {
        title: "Hundreds of Beavers",
        year: "2022",
        runtime: "108 min",
        vibe: "absurd, slapstick, wildly inventive",
        confidence: 82,
        oneLine: "Watch Hundreds of Beavers when you want something genuinely strange that stays in absurdist slapstick territory.",
        whyItFits: [
          "It gives Taste Risk a wild formal shape while staying entirely in comedy territory.",
          "The energy is group-reactive and funny, so it works better for friends than a quiet prestige pick.",
          "It is weird enough to feel like a real discovery while keeping the mood light.",
        ],
        hiddenTitles: [
          { title: "Marcel the Shell with Shoes On", year: "2021" },
          { title: "Dave Made a Maze", year: "2017" },
          { title: "Brigsby Bear", year: "2017" },
        ],
        alternatives: ["Marcel the Shell with Shoes On (2021)", "Dave Made a Maze (2017)", "Brigsby Bear (2017)"],
        ...baseRec,
      },
      {
        title: "Marcel the Shell with Shoes On",
        year: "2021",
        runtime: "90 min",
        vibe: "odd, tender, low-effort",
        confidence: 80,
        oneLine: "Watch Marcel the Shell with Shoes On for a tiny, strange comfort film that does not punish the mood.",
        whyItFits: [
          "It is unusual without ever demanding emotional toughness from the viewer.",
          "The emotional payoff is gentle and easy to receive when energy is low.",
          "It feels specific enough to avoid the generic comfort-pick trap.",
        ],
        hiddenTitles: [
          { title: "Brigsby Bear", year: "2017" },
          { title: "Hundreds of Beavers", year: "2022" },
          { title: "Brian and Charles", year: "2022" },
        ],
        alternatives: ["Brigsby Bear (2017)", "Brian and Charles (2022)", "Hundreds of Beavers (2022)"],
        ...baseRec,
      },
      {
        title: "Brigsby Bear",
        year: "2017",
        runtime: "97 min",
        vibe: "offbeat, sweet, creative",
        confidence: 77,
        oneLine: "Watch Brigsby Bear for offbeat sweetness when you want weirdness with a human center.",
        whyItFits: [
          "It channels strangeness through imagination rather than shock.",
          "It keeps the experience emotionally safe without becoming bland.",
          "The runtime and tone make it easier to say yes tonight.",
        ],
        hiddenTitles: [
          { title: "Marcel the Shell with Shoes On", year: "2021" },
          { title: "Brian and Charles", year: "2022" },
          { title: "Dave Made a Maze", year: "2017" },
        ],
        alternatives: ["Marcel the Shell with Shoes On (2021)", "Brian and Charles (2022)", "Dave Made a Maze (2017)"],
        ...baseRec,
      },
    ];
  }

  if (wantsThriller) {
    return [
      {
        title: "Blue Ruin",
        year: "2013",
        runtime: "90 min",
        vibe: "lean, tense, revenge-thriller",
        confidence: 80,
        oneLine: "Watch Blue Ruin for a stripped-down thriller that stays tense without turning glossy.",
        whyItFits: [
          "It delivers suspense through pressure and bad choices, not franchise noise.",
          "The runtime is lean enough for a focused night.",
          "It feels discovered rather than algorithmically obvious.",
        ],
        hiddenTitles: [
          { title: "Calibre", year: "2018" },
          { title: "The Clovehitch Killer", year: "2018" },
          { title: "The Invitation", year: "2015" },
        ],
        alternatives: ["Calibre (2018)", "The Invitation (2015)", "The Guilty (2018)"],
        ...baseRec,
      },
      {
        title: "Calibre",
        year: "2018",
        runtime: "101 min",
        vibe: "grim, moral-pressure, thriller",
        confidence: 78,
        oneLine: "Watch Calibre if you want a tight thriller where one mistake keeps tightening the room.",
        whyItFits: [
          "It is built around consequence and dread rather than spectacle.",
          "The tension escalates from character decisions.",
          "It is underseen enough to feel like a proper find.",
        ],
        hiddenTitles: [
          { title: "Blue Ruin", year: "2013" },
          { title: "The Invitation", year: "2015" },
          { title: "The Guilty", year: "2018" },
        ],
        alternatives: ["Blue Ruin (2013)", "The Guilty (2018)", "The Invitation (2015)"],
        ...baseRec,
      },
      {
        title: "The Invitation",
        year: "2015",
        runtime: "100 min",
        vibe: "paranoid, dinner-party, slow-burn",
        confidence: 77,
        oneLine: "Watch The Invitation for a slow-burn thriller that turns politeness into dread.",
        whyItFits: [
          "It has a clean, escalating social tension hook.",
          "The suspense comes from mood and suspicion.",
          "It is compact, sharp, and easy to recommend without overexplaining.",
        ],
        hiddenTitles: [
          { title: "Blue Ruin", year: "2013" },
          { title: "Calibre", year: "2018" },
          { title: "Coherence", year: "2013" },
        ],
        alternatives: ["Coherence (2013)", "Calibre (2018)", "Blue Ruin (2013)"],
        ...baseRec,
      },
    ];
  }

  const wantsBleak = !avoids.has("heavy drama") && !strictNoDarkness &&
    (contractHas("bleak") || (intentContract?.secondary ?? []).some((s) => s.toLowerCase() === "bleak") ||
      /\b(bleak|grim|nihilistic|morally (complex|complicated|messy)|unflinching|no (hope|mercy)|zero mercy|doesn't blink|merciless)\b/i.test(text));
  if (wantsBleak) {
    const bleakIntent = { primary: "drama", secondary: ["bleak"], hardAvoids: [], softAvoids: [], format: "film" as const, language: "any", situation: [], intensity: "bold" as const, ambiguity: "" };
    return [
      {
        title: "The Hunt",
        year: "2012",
        runtime: "115 min",
        vibe: "bleak, morally devastating, unflinching",
        confidence: 82,
        oneLine: "Watch The Hunt for a morally devastating drama that refuses easy resolution.",
        whyItFits: [
          "It stays inside dark, morally complex territory without softening into redemption.",
          "The tension comes from social cruelty and injustice, not genre mechanics.",
          "It leaves a mark — exactly what a bleak-by-choice request is asking for.",
        ],
        parsedIntent: bleakIntent,
        hiddenTitles: [
          { title: "The Father", year: "2020" },
          { title: "Nightcrawler", year: "2014" },
          { title: "Incendies", year: "2010" },
        ],
        alternatives: ["Incendies (2010)", "Nightcrawler (2014)", "The Father (2020)"],
        ...baseRec,
      },
      {
        title: "Nightcrawler",
        year: "2014",
        runtime: "117 min",
        vibe: "dark, morally hollow, magnetic",
        confidence: 79,
        oneLine: "Watch Nightcrawler for a pitch-dark character study with no moral safety net.",
        whyItFits: [
          "Its protagonist is genuinely amoral — the film never asks you to forgive him.",
          "The darkness is the point, not a detour on the way to uplift.",
          "It is gripping without offering comfort, which honors the request.",
        ],
        parsedIntent: bleakIntent,
        hiddenTitles: [
          { title: "The Hunt", year: "2012" },
          { title: "Incendies", year: "2010" },
          { title: "A Prophet", year: "2009" },
        ],
        alternatives: ["A Prophet (2009)", "The Hunt (2012)", "Incendies (2010)"],
        ...baseRec,
      },
      {
        title: "Incendies",
        year: "2010",
        runtime: "131 min",
        vibe: "harrowing, devastating, unforgettable",
        confidence: 80,
        oneLine: "Watch Incendies for a harrowing family mystery that goes to genuinely dark places.",
        whyItFits: [
          "Its revelations are brutal and the film does not flinch from them.",
          "The emotional weight is earned through structure, not manipulation.",
          "It satisfies a bleak request with craft rather than shock alone.",
        ],
        parsedIntent: bleakIntent,
        hiddenTitles: [
          { title: "A Prophet", year: "2009" },
          { title: "The Hunt", year: "2012" },
          { title: "Nightcrawler", year: "2014" },
        ],
        alternatives: ["The Hunt (2012)", "A Prophet (2009)", "Nightcrawler (2014)"],
        ...baseRec,
      },
    ];
  }

  return [
    {
      title: light ? "The Forty-Year-Old Version" : "The Worst Person in the World",
      year: light ? "2020" : "2021",
      runtime: light ? "124 min" : "128 min",
      vibe: light ? "wry, warm, creative" : "restless, romantic, bittersweet",
      confidence: 78,
      oneLine: light
        ? "Watch The Forty-Year-Old Version if you want wit, warmth, and a real point of view."
        : "Watch The Worst Person in the World if you want sharp feeling without a boring prestige shell.",
      whyItFits: [
        "It matches the mood-first request instead of forcing a genre.",
        "It is strong enough to feel special, but not mentally exhausting.",
        "Its humor and self-reinvention arc give the night a clear, satisfying shape.",
      ],
      hiddenTitles: [
        { title: "Columbus", year: "2017" },
        { title: "Support the Girls", year: "2018" },
        { title: "Paterson", year: "2016" },
      ],
      alternatives: ["Columbus (2017)", "Support the Girls (2018)", "Paterson (2016)"],
      ...baseRec,
    },
    {
      title: light ? "Support the Girls" : "Columbus",
      year: light ? "2018" : "2017",
      runtime: light ? "93 min" : "100 min",
      vibe: light ? "workplace, humane, funny-sad" : "quiet, architectural, intimate",
      confidence: 72,
      oneLine: light ? "Watch Support the Girls for humane comedy that sneaks up on you." : "Watch Columbus for quiet beauty and unusually precise feeling.",
      whyItFits: [
        "It finds humor in everyday pressure rather than big set-piece comedy.",
        "The storytelling is specific rather than broadly generic.",
        "It gives the night a clear mood instead of another scroll.",
      ],
      hiddenTitles: [
        { title: "The Forty-Year-Old Version", year: "2020" },
        { title: "Paterson", year: "2016" },
        { title: "The Rider", year: "2017" },
      ],
      alternatives: ["Paterson (2016)", "The Rider (2017)", "The Forty-Year-Old Version (2020)"],
      ...baseRec,
    },
    {
      title: light ? "Paterson" : "Leave No Trace",
      year: light ? "2016" : "2018",
      runtime: light ? "118 min" : "109 min",
      vibe: light ? "gentle, poetic, everyday" : "quiet, humane, haunting",
      confidence: 75,
      oneLine: light ? "Watch Paterson for calm that still has texture." : "Watch Leave No Trace for a deeply felt film that never begs for attention.",
      whyItFits: [
        "It is distinctive without being difficult for the sake of it.",
        "The emotional register is clear and controlled.",
        "Its quiet rhythm creates feeling through behavior, place, and small choices.",
      ],
      hiddenTitles: [
        { title: "Columbus", year: "2017" },
        { title: "The Rider", year: "2017" },
        { title: "Support the Girls", year: "2018" },
      ],
      alternatives: ["The Rider (2017)", "Columbus (2017)", "Support the Girls (2018)"],
      ...baseRec,
    },
  ];
}
