import { NextResponse } from "next/server";
import { enrichRelatedPosters } from "@/lib/metadata";

type RelatedPosterRequest = {
  titles?: Array<{ title?: string; year?: string }>;
};

// Lazy poster lookup for hidden/similar titles, called by the client only when the "show more"
// section is actually opened — see enrichRelatedPosters for why this is split out of the
// blocking /api/recommend path.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RelatedPosterRequest;
    const titles = (body.titles ?? [])
      .filter((item): item is { title: string; year?: string } => typeof item.title === "string" && item.title.trim().length > 0)
      .map((item) => ({ title: item.title.trim(), year: item.year?.trim() ?? "" }));

    if (titles.length === 0) return NextResponse.json({ posters: [] });

    const posters = await enrichRelatedPosters(titles);
    return NextResponse.json({ posters });
  } catch {
    return NextResponse.json({ posters: [] });
  }
}
