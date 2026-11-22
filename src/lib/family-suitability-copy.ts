import type { Recommendation } from "@/lib/types";

// Presentation only, after all ranking and safety checks. A rating is not a promise
// about how every child will react. No provider call or prompt change is needed.
const absoluteSuitability = /\b(?:(?:without|no|free of|free from)\s+(?:any\s+)?(?:scary|frightening|scares|scare|fright|disturbing)|(?:safe|suitable|perfect|appropriate|engaging)\s+for\s+(?:all ages|every child|all children)|(?:won't|will not|cannot)\s+(?:scare|frighten))\b/i;
const guidance = "Age suitability varies; check the content guidance for your family.";

export function temperFamilySuitability(rec: Recommendation): Recommendation {
  const temper = (text: string) => absoluteSuitability.test(text) ? guidance : text;
  return {
    ...rec,
    oneLine: temper(rec.oneLine),
    whyItFits: [...new Set(rec.whyItFits.map(temper))],
  };
}
