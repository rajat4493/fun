# F.U.N One Pick MVP

A fast MVP for the F.U.N concept: one perfect streaming pick based on mood, time, country, and current subscriptions.

## What is included

- Posh Apple TV × Netflix-like landing UI
- Choose / Self-describe input modes
- Mood chips, exclusions, time, country, platform selector
- API route using Anthropic first, OpenAI fallback
- Safe recommendation prompt: no name-shaming, no legal-risk intent claims
- Result card: one pick, why it fits, where-to-watch placeholder, hidden layer

## Run locally

```bash
npm install
cp .env.example .env.local
# add ANTHROPIC_API_KEY and/or OPENAI_API_KEY
npm run dev
```

Open http://localhost:3000

## Current phase

Phase 2: One Pick + classy hidden-layer insight + local verified availability sample.

Availability is checked against `src/lib/availability-data.json`. If a title is not present for the selected country, F.U.N marks it as "Availability not verified yet." A production version should replace the local sample file with a licensed or compliant availability provider.

## Best next tasks for Codex

1. Expand the local verified catalogue or connect a licensed availability provider.
2. Add a small local catalogue of 100 verified titles for Poland to reduce hallucination.
3. Add shareable result cards.
4. Add subscription-fit scoring: current apps vs recommended apps.
5. Add legal pages: Terms, Privacy, Recommendation Methodology.

## Codex prompt to continue

Build Phase 2 for this Next.js app. Add a provider-availability abstraction under `src/lib/availability.ts` with a clean interface: `checkAvailability(title, year, country)`. For now, implement a mock provider using a local JSON file of verified titles. Update `/api/recommend` so after the LLM selects a title, the backend checks availability and replaces the `whereToWatch` block. Keep the UI premium and do not add user accounts yet.
