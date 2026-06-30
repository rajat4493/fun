import { requestText } from "@/lib/recommendation-utils";
import { RawRecommendation, RecommendRequest } from "@/lib/types";

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

  if ((input.recentTitles ?? []).some((recentTitle) => normalizeForMatch(recentTitle) === title)) {
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

  if (/shameless/i.test(text) && !/\b(messy|chaos|chaotic|dysfunction|dysfunctional|survival|morally|flawed|adult|raunchy|class|poverty|pressure|desperate|bad choices|bad decisions|family wounds)\b/i.test(recommendationText(rec))) {
    return true;
  }

  if (/\bfriends\b/i.test(text) && !/\b(friend|friends|friendship|hangout|ensemble|group|comfort|warm|low-stakes|romantic|social|banter|chemistry|roommate|apartment)\b/i.test(recommendationText(rec))) {
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
    !/\b(no|not|avoid|without|don't want|do not want|less)\s+(gore|gory|blood|bloody|violence|violent)\b/i.test(text);

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
    !/\b(no|not|avoid|without|don't want|do not want|less)\s+(gore|gory|blood|bloody|violence|violent)\b/i.test(text);
  if (wantsGore) return filtered;
  if ((input.recentTitles ?? []).length > 0 && filtered.length > 0) return filtered;
  return filtered.length > 0 ? filtered : batch;
}

export function localFallback(input: RecommendRequest): RawRecommendation[] {
  const text = requestText(input);
  const wantsShameless = /shameless/i.test(text);
  const wantsFriends = /\bfriends\b/i.test(text);
  const wantsHindi = /\bhindi\b/i.test(text) || (input.languagePreferences ?? []).some((language) => /hindi/i.test(language));
  const wantsGore = /\b(gore|gory|bloody|splatter|body horror|extreme horror|violent horror)\b/i.test(text) &&
    !/\b(no|not|avoid|without|don't want|do not want|less)\s+(gore|gory|blood|bloody|violence|violent)\b/i.test(text);

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

  if (wantsGore) {
    if (input.platformFilter === "mine" && (input.platforms ?? []).some((platform) => /netflix/i.test(platform))) {
      const netflixRec = {
        format: "Film" as const,
        whereToWatch: {
          status: "unverified" as const,
          primary: "Availability not verified",
          note: "F.U.N will verify this in real time. Check your apps before watching.",
        },
        hiddenLayer: {
          headline: "Gore inside your queue",
          insight: "The right match should be bloody, direct, and recognisably horror, not a quiet prestige detour.",
          classyJab: "Your night asked for blood, not whispers.",
        },
      };

      return [
        {
          title: "Evil Dead Rise",
          year: "2023",
          runtime: "96 min",
          vibe: "bloody, demonic, survival horror",
          confidence: 88,
          oneLine: "Watch Evil Dead Rise for a tight, blood-soaked possession nightmare that gets straight to the point.",
          whyItFits: [
            "It is explicitly gory and built around physical horror.",
            "The runtime is lean, so it does not waste the mood.",
            "It has the splatter energy a quiet drama completely misses.",
          ],
          hiddenTitles: [
            { title: "Apostle", year: "2018" },
            { title: "Fear Street Part 2: 1978", year: "2021" },
            { title: "Nobody Sleeps in the Woods Tonight", year: "2020" },
          ],
          alternatives: ["Apostle (2018)", "Fear Street Part 2: 1978 (2021)", "Nobody Sleeps in the Woods Tonight (2020)"],
          ...netflixRec,
        },
        {
          title: "Apostle",
          year: "2018",
          runtime: "130 min",
          vibe: "folk horror, gory, violent",
          confidence: 82,
          oneLine: "Watch Apostle if you want folk-horror dread that eventually turns properly brutal.",
          whyItFits: [
            "It has explicit violence and gore rather than implied menace only.",
            "The cult-island setting gives the bloodshed a nasty ritual texture.",
            "It is darker and more physical than a standard mystery thriller.",
          ],
          hiddenTitles: [
            { title: "Evil Dead Rise", year: "2023" },
            { title: "Demons", year: "1985" },
            { title: "Slasher", year: "2019" },
          ],
          alternatives: ["Evil Dead Rise (2023)", "Demons (1985)", "Slasher (2019)"],
          ...netflixRec,
        },
        {
          title: "Fear Street Part 2: 1978",
          year: "2021",
          runtime: "111 min",
          vibe: "gory, slasher, summer-camp horror",
          confidence: 80,
          oneLine: "Watch Fear Street Part 2: 1978 for clean slasher momentum and visible camp-night carnage.",
          whyItFits: [
            "It is a slasher built around bloody kills, not just eerie atmosphere.",
            "The summer-camp setup gives the gore a classic horror shape.",
            "It stays accessible while still satisfying the gory brief.",
          ],
          hiddenTitles: [
            { title: "Nobody Sleeps in the Woods Tonight", year: "2020" },
            { title: "Demons", year: "1985" },
            { title: "Apostle", year: "2018" },
          ],
          alternatives: ["Nobody Sleeps in the Woods Tonight (2020)", "Demons (1985)", "Apostle (2018)"],
          ...netflixRec,
        },
      ];
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

  const avoids = new Set((input.avoids ?? []).map((avoid) => avoid.toLowerCase()));
  const light = avoids.has("violence") || avoids.has("gore") || avoids.has("heavy drama");
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

  return [
    {
      title: light ? "Perfect Days" : "Past Lives",
      year: "2023",
      runtime: light ? "124 min" : "106 min",
      vibe: light ? "quiet, warm, reflective" : "emotional, elegant, bittersweet",
      confidence: 78,
      oneLine: light
        ? "Tonight, watch Perfect Days if you want calm without boredom."
        : "Tonight, watch Past Lives if you want emotion without noise.",
      whyItFits: [
        "It matches the mood-first request instead of forcing a genre.",
        "It is strong enough to feel special, but not mentally exhausting.",
        "It fits F.U.N's promise: one decision, not another endless list.",
      ],
      hiddenTitles: [
        { title: "Aftersun", year: "2022" },
        { title: "All of Us Strangers", year: "2023" },
        { title: "The Zone of Interest", year: "2023" },
      ],
      alternatives: ["Aftersun (2022)", "The Worst Person in the World (2021)", "Drive My Car (2021)"],
      ...baseRec,
    },
    {
      title: light ? "A Thousand and One" : "20 Days in Mariupol",
      year: "2023",
      runtime: light ? "97 min" : "130 min",
      vibe: light ? "uplifting, intimate, human" : "powerful, haunting, necessary",
      confidence: 72,
      oneLine: light ? "Warmth and humor in unexpected places." : "A vital documentary about resilience.",
      whyItFits: [
        "A different format to keep things fresh.",
        "Strong storytelling without the usual streaming algorithm picks.",
        "Surprises you without exhausting you.",
      ],
      hiddenTitles: [
        { title: "The Eternal Memory", year: "2023" },
        { title: "Grand Concourse", year: "2021" },
        { title: "Neon Flesh", year: "2010" },
      ],
      alternatives: ["Showing Up (2022)", "In the Mood for Love (2000)", "Stalker (1979)"],
      ...baseRec,
    },
    {
      title: light ? "The Eternal Memory" : "The Iron Claw",
      year: "2023",
      runtime: light ? "90 min" : "128 min",
      vibe: light ? "meditative, poetic, gentle" : "intense, tragic, unforgettable",
      confidence: 75,
      oneLine: light ? "A meditation on memory and love." : "A devastating portrait of ambition and family.",
      whyItFits: [
        "International cinema brings perspective.",
        "Beautiful direction and cinematography.",
        "Worth your full attention tonight.",
      ],
      hiddenTitles: [
        { title: "The Taste of Things", year: "2023" },
        { title: "In My Room", year: "2018" },
        { title: "Bergman Island", year: "2021" },
      ],
      alternatives: ["La Haine (1995)", "The Celebration (1998)", "Requiem for a Dream (2000)"],
      ...baseRec,
    },
  ];
}
