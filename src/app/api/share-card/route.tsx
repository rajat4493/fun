import { ImageResponse } from "next/og";
import type { ShareCardFormat, ShareCardStyle } from "@/lib/share-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ShareCardPayload = {
  title?: string;
  year?: string;
  posterUrl?: string;
  moodLine?: string;
  tags?: string[];
  style?: ShareCardStyle;
  format?: ShareCardFormat;
};

const styleConfig: Record<ShareCardStyle, {
  background: string;
  accent: string;
  text: string;
  muted: string;
  titleTransform: "none" | "uppercase";
  tracking: number;
}> = {
  cinematic: {
    background: "linear-gradient(145deg,#070706 0%,#17120d 58%,#090807 100%)",
    accent: "#efcb83",
    text: "#fffaf0",
    muted: "#bcb3a6",
    titleTransform: "none",
    tracking: 0,
  },
  playful: {
    background: "linear-gradient(145deg,#071315 0%,#142126 55%,#090d11 100%)",
    accent: "#ff796d",
    text: "#f8fbfb",
    muted: "#a9bdc0",
    titleTransform: "none",
    tracking: 0,
  },
  intense: {
    background: "linear-gradient(145deg,#050505 0%,#160b0b 55%,#050505 100%)",
    accent: "#ff5a54",
    text: "#fff8f6",
    muted: "#bba9a7",
    titleTransform: "uppercase",
    tracking: 1.5,
  },
};

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function trustedPosterUrl(value: unknown) {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const url = new URL(value);
    const allowed = [
      "image.tmdb.org",
      "m.media-amazon.com",
      "images-na.ssl-images-amazon.com",
      "ia.media-imdb.com",
    ];
    return url.protocol === "https:" && allowed.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

async function loadPosterDataUrl(url: string | undefined) {
  if (!url) return undefined;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(3500),
      cache: "force-cache",
    });
    if (!response.ok) return undefined;

    const contentType = response.headers.get("content-type")?.split(";")[0];
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (!contentType?.startsWith("image/") || contentLength > 5_000_000) return undefined;

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 5_000_000) return undefined;
    return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return undefined;
  }
}

export async function POST(request: Request) {
  let payload: ShareCardPayload;
  try {
    payload = await request.json() as ShareCardPayload;
  } catch {
    return Response.json({ error: "Invalid card request." }, { status: 400 });
  }

  const title = cleanText(payload.title, 96);
  const year = cleanText(payload.year, 8);
  const moodLine = cleanText(payload.moodLine, 110);
  const tags = (Array.isArray(payload.tags) ? payload.tags : [])
    .map((tag) => cleanText(tag, 24).toLowerCase())
    .filter(Boolean)
    .slice(0, 3);
  const styleName: ShareCardStyle = payload.style && payload.style in styleConfig ? payload.style : "cinematic";
  const format: ShareCardFormat = payload.format === "feed" ? "feed" : "story";
  const posterUrl = await loadPosterDataUrl(trustedPosterUrl(payload.posterUrl));

  if (!title || !moodLine) {
    return Response.json({ error: "Title and public mood are required." }, { status: 400 });
  }

  const palette = styleConfig[styleName];
  const width = 1080;
  const height = format === "story" ? 1920 : 1350;
  const compact = format === "feed";
  const posterWidth = compact ? 354 : 430;
  const posterHeight = compact ? 531 : 645;
  const longestTitleWord = title.split(/\s+/).reduce((longest, word) => Math.max(longest, word.length), 0);
  const titleSize = posterUrl
    ? title.length > 36
      ? (compact ? 56 : 66)
      : title.length > 22
        ? (compact ? 62 : 72)
        : longestTitleWord > 9
          ? (compact ? 68 : 78)
          : (compact ? 80 : 92)
    : title.length > 36
      ? (compact ? 76 : 88)
      : title.length > 22
        ? (compact ? 86 : 100)
        : (compact ? 96 : 112);

  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          display: "flex",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          background: palette.background,
          color: palette.text,
          fontFamily:
            styleName === "intense"
              ? "monospace"
              : styleName === "cinematic"
                ? "serif"
                : "sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 32,
            display: "flex",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 28,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 72,
            top: compact ? 62 : 88,
            display: "flex",
            fontSize: 28,
            letterSpacing: 8,
            color: palette.muted,
          }}
        >
          TONIGHT I NEEDED
        </div>
        <div
          style={{
            position: "absolute",
            left: 72,
            top: compact ? 118 : 155,
            width: 900,
            display: "flex",
            fontSize: compact ? 68 : 86,
            lineHeight: 1.04,
            fontWeight: 500,
            letterSpacing: styleName === "intense" ? 1 : 0,
          }}
        >
          {moodLine}
        </div>

        <div
          style={{
            position: "absolute",
            left: 72,
            top: compact ? 390 : 520,
            display: "flex",
            flexDirection: "column",
            width: posterUrl ? (compact ? 500 : 470) : 900,
          }}
        >
          <div style={{ display: "flex", fontSize: 28, color: palette.accent }}>So I’m watching</div>
          <div
            style={{
              display: "flex",
              marginTop: 18,
              fontSize: titleSize,
              lineHeight: 0.94,
              fontWeight: 700,
              textTransform: palette.titleTransform,
              letterSpacing: palette.tracking,
            }}
          >
            {title}
          </div>
          {year && <div style={{ display: "flex", marginTop: 18, fontSize: 26, color: palette.muted }}>{year}</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 34 }}>
            {tags.map((tag) => (
              <div
                key={tag}
                style={{
                  display: "flex",
                  border: `1px solid ${palette.accent}70`,
                  borderRadius: 999,
                  padding: "10px 16px",
                  fontSize: 21,
                  color: palette.text,
                }}
              >
                {tag}
              </div>
            ))}
          </div>
        </div>

        {posterUrl && (
          <div
            style={{
              position: "absolute",
              right: 76,
              top: compact ? 390 : 560,
              width: posterWidth,
              height: posterHeight,
              display: "flex",
              overflow: "hidden",
              borderRadius: 24,
              border: "1px solid rgba(255,255,255,0.24)",
              boxShadow: "0 28px 80px rgba(0,0,0,0.5)",
              background: "#121216",
            }}
          >
            <img src={posterUrl} alt="" width={posterWidth} height={posterHeight} style={{ objectFit: "cover" }} />
          </div>
        )}

        <div
          style={{
            position: "absolute",
            left: 72,
            bottom: compact ? 116 : 178,
            display: "flex",
            fontSize: compact ? 30 : 34,
            color: palette.muted,
          }}
        >
          Trusting this choice. Ask me tomorrow.
        </div>
        <div
          style={{
            position: "absolute",
            right: 72,
            bottom: compact ? 62 : 92,
            display: "flex",
            fontSize: 21,
            letterSpacing: 1,
            color: "rgba(255,255,255,0.46)",
          }}
        >
          picked with F.U.N
        </div>
      </div>
    ),
    {
      width,
      height,
      headers: {
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": `inline; filename="fun-pick-${format}.png"`,
      },
    },
  );
}
