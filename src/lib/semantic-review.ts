import { reviewCandidatesWithOpenAI, type LlmCallTelemetry } from "@/lib/llm";
import { validateSemanticRecommendation, type TrustRejection } from "@/lib/recommendation-trust";
import { resolveRuntimeConstraint } from "@/lib/intent";
import type { IntentContract, RawRecommendation, RecommendRequest, SemanticCandidateReview } from "@/lib/types";

const SENSITIVE_SITUATIONS = ["panic", "anxiety", "grief", "breakup"];

function titleKey(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function needsSemanticReview(contract: IntentContract): boolean {
  return contract.hardAvoids.length > 0 ||
    contract.softAvoids.length > 0 ||
    contract.confidence < 0.65 ||
    Boolean(contract.ambiguity) ||
    contract.situation.some((item) => SENSITIVE_SITUATIONS.some((signal) => item.includes(signal))) ||
    ["scare", "gore", "cry"].includes(contract.primary) ||
    contract.secondary.some((item) => ["emotional-relief", "gentle-comfort", "bleak"].includes(item));
}

function compactCandidate(candidate: RawRecommendation) {
  return {
    title: candidate.title,
    year: candidate.year,
    format: candidate.format,
    runtime: candidate.runtime,
    contentCategory: candidate.contentCategory ?? [],
    emotionalEffect: candidate.emotionalEffect ?? [],
    oneLine: candidate.oneLine,
    fitEvidence: (candidate.whyItFits ?? []).slice(0, 3),
  };
}

export function buildSemanticReviewPrompt(input: RecommendRequest, contract: IntentContract, candidates: RawRecommendation[]): string {
  const runtimeConstraint = resolveRuntimeConstraint(input);
  return `You are F.U.N's independent recommendation reviewer. Evaluate candidates against the viewer contract.

Rules:
- Hard boundaries and explicit format/language requirements are absolute.
- Judge the emotional effect of the actual title, not the persuasiveness of its explanation.
- Reject only for a direct, material conflict supported by the title's established content or the supplied candidate facts. Do not invent adjacent risks, symbolic associations, or new constraints that are absent from the contract.
- A candidate does not need to satisfy every secondary preference perfectly. Accept a strong primary emotional match that respects every hard boundary.
- Soft avoids may lower emotionalFit, but they are not hardViolations by themselves unless they materially break the primary emotional job.
- When a soft avoid is explicitly central to the request, treat a direct conflict as material. Examples: "nothing slow" should reject methodical or dread-heavy slow-burn thrillers; "not romantic / not about heartbreak" should reject titles whose emotional engine is romance, yearning, or breakup pain.
- For comfort or breakup-recovery requests, prefer relief that comes from humor, friendship, community, playfulness, or reassurance. Do not accept a title just because it is warm if it still centers romance or emotional hurt.
- For gripping-thriller requests that also say "not emotionally exhausting" or "nothing slow", reject titles that are punishing, oppressive, prestige-heavy, or primarily sustained dread even if they are technically thrilling.
- A small runtime overage is acceptable when the runtime target is soft. Only treat runtime as a hard violation when the contract explicitly marks it strict, or when the overage exceeds the allowed tolerance.
- A hidden gem is useful only when it remains accessible at the requested discovery/intensity level; prestige is not automatically fit.
- Accept only candidates likely to satisfy the requested emotional job. emotionalFit is 0-100.
- Reject when any hard boundary is violated, emotionalFit is below 65, or confidence is below 0.65.
- Keep reasons short and diagnostic. Do not propose replacement titles.

Viewer contract:
${JSON.stringify({
    primary: contract.primary,
    secondary: contract.secondary,
    hardAvoids: contract.hardAvoids,
    softAvoids: contract.softAvoids,
    format: contract.format,
    language: contract.language,
    situation: contract.situation,
    intensity: contract.intensity,
    emotionalGoal: contract.emotionalGoal,
    discoveryPreference: contract.discoveryPreference,
    ambiguity: contract.ambiguity,
    runtime: runtimeConstraint
      ? {
        targetMinutes: runtimeConstraint.limitMinutes,
        strict: runtimeConstraint.strict,
        allowedOverageMinutes: runtimeConstraint.toleranceMinutes,
      }
      : null,
  })}

Candidates:
${JSON.stringify(candidates.map(compactCandidate))}`;
}

export async function reviewSemanticCandidates(
  input: RecommendRequest,
  contract: IntentContract,
  candidates: RawRecommendation[],
  onCall?: (value: LlmCallTelemetry) => void,
): Promise<{ accepted: RawRecommendation[]; rejected: TrustRejection[]; reviews: SemanticCandidateReview[]; usedLocalBackstop: boolean }> {
  if (!needsSemanticReview(contract) || candidates.length === 0) {
    return { accepted: candidates, rejected: [], reviews: [], usedLocalBackstop: false };
  }

  try {
    const reviews = await reviewCandidatesWithOpenAI(
      buildSemanticReviewPrompt(input, contract, candidates),
      candidates.length,
      {
        captureContent: process.env.FUN_COLLECT_PROMPTS === "true",
        onCall,
      },
    );
    const byTitle = new Map(reviews.map((review) => [titleKey(review.title), review]));
    const accepted: RawRecommendation[] = [];
    const rejected: TrustRejection[] = [];
    for (const candidate of candidates) {
      const review = byTitle.get(titleKey(candidate.title));
      // Numeric fit and explicit violations are the enforceable contract. The model's boolean is
      // retained for diagnostics, but cannot independently veto a candidate after assigning it a
      // passing fit score with no hard conflict; that combination caused avoidable over-rejection.
      if (review && review.hardViolations.length === 0 && review.emotionalFit >= 65 && review.confidence >= 0.65) {
        accepted.push(candidate);
      } else {
        rejected.push({
          title: candidate.title,
          reasons: review
            ? [...review.hardViolations.map((item) => `semantic: ${item}`), `semantic: ${review.reason}`]
            : ["semantic: independent review did not return this candidate"],
        });
      }
    }
    accepted.sort((a, b) => {
      const aReview = byTitle.get(titleKey(a.title));
      const bReview = byTitle.get(titleKey(b.title));
      return (bReview?.emotionalFit ?? 0) - (aReview?.emotionalFit ?? 0) || b.confidence - a.confidence;
    });
    return { accepted, rejected, reviews, usedLocalBackstop: false };
  } catch {
    // Provider failure must not disable safety. Existing local semantic checks remain a
    // conservative emergency backstop, and diagnostics make this degraded path visible.
    const accepted: RawRecommendation[] = [];
    const rejected: TrustRejection[] = [];
    for (const candidate of candidates) {
      const rejection = validateSemanticRecommendation(input, candidate, contract);
      if (rejection) rejected.push(rejection);
      else accepted.push(candidate);
    }
    return { accepted, rejected, reviews: [], usedLocalBackstop: true };
  }
}
