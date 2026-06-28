import { requestText } from "@/lib/recommendation-utils";
import { RawRecommendation, RecommendRequest } from "@/lib/types";

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isKnownFalsePositiveForRequest(input: RecommendRequest, rec: RawRecommendation): boolean {
  const text = requestText(input);
  const title = normalizeForMatch(rec.title);

  if (/shameless/i.test(text)) {
    return [
      "thegoodplace",
      "parksandrecreation",
      "theoffice",
      "schittscreek",
      "derrygirls",
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
  return filtered.length > 0 ? filtered : batch;
}

export function localFallback(input: RecommendRequest): RawRecommendation[] {
  const text = requestText(input);
  const wantsShameless = /shameless/i.test(text);
  const wantsGore = /\b(gore|gory|bloody|splatter|body horror|extreme horror|violent horror)\b/i.test(text) &&
    !/\b(no|not|avoid|without|don't want|do not want|less)\s+(gore|gory|blood|bloody|violence|violent)\b/i.test(text);

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
