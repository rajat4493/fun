# F.U.N Production Simulation — Agentic Test Instructions

Paste everything below into ChatGPT's Agentic Mode as one instruction set.

---

You are simulating a real, curious streaming user testing a movie/TV recommendation web app called F.U.N, live at:

**https://fun-two-liart.vercel.app**

This is a real production app with real costs per request and a real rate limit, so this is not a stress test — it's a realistic single-session walkthrough. Follow the pacing and limits below exactly; do not try to "test harder" than instructed.

## Hard limits — do not exceed
- **12 total "ask for a recommendation" actions** for the entire session (this includes every mood submission, every "Describe" free-text submission, and every reroll — count them as you go).
- Space normal asks **at least 20–30 seconds apart** — read the result, react to it like a real person would, before asking again.
- The one exception is the deliberate rate-limit check in Step 4 below, which is intentionally rapid-fire.
- If you ever see a message about a usage limit or "try again later," **stop making new asks and report the exact wording** — do not retry repeatedly to "get around" it.

## Step 1 — Orient yourself
Open the site. Note the two mode toggles at the top: **"Choose"** and **"Describe."** In Choose mode, note the mood/wants/avoids pickers, the **"My subscriptions"** vs **"All cinema"** toggle, and the **"Go indie"** toggle. In Describe mode, note the free-text box.

## Step 2 — Run these 11 asks, in this order, respecting the pacing rule above

1. **Choose mode, My subscriptions, Indie OFF** — pick a comforting/funny mood (e.g. select mood tags like "cozy" or "funny"). After the result, click the **"Already seen"** quick-feedback button and let it give you a replacement pick.
2. **Choose mode, All cinema, Indie ON** — pick a weird/offbeat mood.
3. **Describe mode** — type: *"I just watched Parasite and need more like it, same vibe."*
4. **Choose mode, My subscriptions** — pick a scare/scary mood, and add "gore" or "graphic violence" to avoids if the picker offers it. After the result, click **"Wrong vibe"**.
5. **Describe mode** — type: *"Best movie for a long flight tomorrow."*
6. **Choose mode, All cinema** — pick something appropriate for a family movie night with parents visiting.
7. **Describe mode** — type: *"Surprise me, recommend something I've never heard of."*
8. **Describe mode** — type: *"Hidden gems that flew under the radar, not the obvious cult classics."* After the result, click **"Not on my service"**.
9. **Choose mode, Indie ON, All cinema** — pick a mood for something visually dreamlike/atmospheric.
10. **Describe mode** — type: *"I've become impossible to please, I've disliked everything lately — give me something with real meat to it."*
11. **Describe mode** — type: *"Help me find a movie, I only remember one scene: a man desperately wants a promotion and his boss's favorite dish is chili con carne."* — **This one is a deliberate trap: the app should honestly say it can't identify a specific half-remembered film rather than confidently naming one it isn't sure of. Report exactly what it does.**

That's 11 of your 12 allowed asks (the reroll in step 1 counts as one of the 11, not extra).

## Step 3 — Retrospective feedback
Navigate to **/memory**. Find 2–3 of the picks from Step 2 in your history and rate them using the **Loved / Good / Not for me / Quit** buttons — mix the ratings, don't pick the same one every time. This simulates a real person coming back later to rate what they actually watched.

## Step 4 — Deliberate rate-limit check (your 12th ask, run as its own isolated block)
Now, submit 3–4 new asks **back-to-back with no waiting in between** (any mood/text is fine — this block is just to trigger the limit). Report:
- Exactly which attempt number first got blocked
- The exact error message and wording shown
- Whether it mentioned a retry time
- **Whether it offered any way to provide an email address to unlock more.** If it did not, that's expected — just confirm it plainly rather than treating it as a bug.

Do not retry more than this block — once you see the limit message, stop.

## Step 5 — Final report
Write a structured summary with:
1. A table/list of all 12 asks: mode, scope (subscriptions/all cinema), Indie on/off, the text or mood used, the title returned, its confidence/verified status, and any feedback you gave.
2. What happened in Step 4 (the rate-limit check), verbatim.
3. Anything that felt off, inconsistent, or dishonest — e.g., a title that didn't actually match the mood, a "verified" watch link that didn't work, copy that contradicted itself (e.g., claiming a different decade/era than the film's actual release year), or the half-remembered-plot request (Step 2.11) getting a confidently fabricated answer instead of an honest decline.
4. Your honest overall impression, as if you were a real person deciding whether to come back and use this again.
