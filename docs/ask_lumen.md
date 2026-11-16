# Ask LUMEN

_Owner: Ebin_ · code: `web/src/features/ask/` · content: `docs/ask_help.md`

An offline helper opened with `/` (or the **Ask** button in the header). It is **search and fixed templates, not a chatbot**:
it can only act on the phrases listed here, and it can only quote text that is already in LUMEN's own files. No network, no
language model, no invented numbers. When it has no answer it says so and offers example questions.

## What it does
| Part | You type | It does | Code |
|---|---|---|---|
| Commands | `go to compare`, `show IM-2`, `slip 9 days`, `move front 2 days`, `help` | calls the app's own actions (`go`, `selectSite`, `setSlip`) | `commands.ts` |
| Questions | `how do I compare sites?`, `how is sunlight calculated?`, `why did you choose a ±?`, `what is libration` | keyword search over `public/content/knowledge.json`; shows the written answer and its source | `knowledge.ts` |
| Why this number | the **Why?** button on a Stand here number, or `why is this ± so big?` | a template filled from the SAME engine result the page shows | `why.ts`, `AskLumen.tsx` |

A **question is never run as a command** (anything starting with how/what/why/is/can…); commands are imperatives.

## How questions are answered
`knowledge.json` has ~94 entries of six kinds: **term** (glossary), **howto** (using the interface), **method** (how a result
is calculated), **decision** (why a choice was made), **concept** (background), **validation** (gate results).
- Ranking is BM25 over title, tags and body, with a bonus when a query word is in an entry's title or tags.
- **Intent** shifts the ranking: "how do I…" prefers how-tos, "how is … calculated" prefers methods, "why did we…" prefers
  decisions, "what is…" prefers definitions.
- A short synonym list ("delay" → slip, "dte" …) and one-typo tolerance on longer words.
- **Confidence:** strong matches are shown as answers; weak ones only as "Closest I have — I'm not sure…".
- Questions about **this** number ("why is this ± so big?") show the live card first; general questions show the written
  answer first. A live card never repeats a paragraph already on screen.

## Rules that keep it honest
- A **±** is only stated when the result has one (`dtMs != null`, `lo/hi != null`). Otherwise the line says why there is
  none, quoting `meta.sigmaSource` and `meta.tierBadge` (today: "Terrain mask · σ unavailable").
- The clearance rate is **derived** from `series.sunClearanceDeg` per `stepMs`; σ is read from `series.sigmaBandDeg`.
  Nothing is hard-coded, and no site's real numbers appear in the knowledge file or the tests.
- Verdict reasons, definitions and glossary text are **quoted**, not paraphrased.
- Each metric's "what it is" line comes from an **explicit** metric → entry map (never "first entry that mentions it" — that
  once showed Libration's definition under Earth elevation).
- Mock data is flagged ("MOCK DATA, not real results"). Slip is clamped to the live range (0…27 d) and the box says so.
- Shackleton is excluded from the knowledge file until its mask and coordinates are settled.

## Which result it explains
`AskLumen.tsx` uses `useEngineResult(site, mast)` — the very call Stand here makes — so the explanation is for the same
site, array height and window (30 days from 8 Feb 2027) as the numbers on screen, and the card says so. In mock-data mode
there is no page result; it falls back to the app's store result and says that instead. It computes only while the box is open.

## Adding or fixing answers
1. Edit `docs/ask_help.md` (`## Question`, then `Kind:`, `Source:`, `Tags:`, then the answer). Facts must come from
   PLAN_FINAL or from what the live pages actually say. Tags are extra words people might use.
2. Rebuild: `cd web && node scripts/build-knowledge.mjs`, and commit `public/content/knowledge.json`.
   (`knowledgeFresh.test.ts` fails if you forget.)
3. When someone reports a question that failed, add it to `questions.test.ts` (`MUST_FIND`, or `MUST_BE_FIRST`), then fix
   the content or tags — not the test.
4. Update the **status** entries ("Are the numbers on the pages real?", "σ unavailable") when the data situation changes.
   The how-to entries describe the live pages; update them when the interface changes.

## Wiring (all done)
`<AskLumen />` is mounted in `features/pages/PagesApp.tsx`; the header button and Stand here's **Why?** buttons call
`askWhy(metricKey)` (`askWhy.ts`, accepts any `keyof MetricSet`; metrics without a template get their value and "no written
explanation yet").

## Keys and accessibility
`/` opens (ignored in inputs, with ctrl/meta/alt, and on key repeat). `Esc` closes (capture phase, before popovers) and focus
returns to where it was. Focus is trapped inside the dialog; arrow keys only inside the box; avoids backtick (Perf HUD).
A hidden live region announces how many results appeared. Not yet checked with a real screen reader.

## Tests
`web/src/features/ask/*.test.ts` (parser, search, templates, a bank of ~70 ordinary questions with the entry each must find,
questions it must NOT answer, knowledge freshness) · `web/e2e/ask.spec.ts` (live app, mock data) ·
`web/e2e/ask.real.spec.ts` (real data: **Why?** explains exactly the number on screen).

## Known limits
- It only knows what is written down; anything else gets "I don't have an answer" plus examples. It is not a language model.
- The box's own wording is Planner wording (the live pages have no persona switch).
- No Methodology route yet, so sources are shown as text, not links.
- σ is preliminary Monte-Carlo (30 clones). Fine-terrain sites use the published error raster; coarse-mask sites assume a constant 1 m DEM error (badge says so). A site without σ says "σ unavailable".
  It is a planning value, not Monte-Carlo or calibrated. When real σ replaces it, the ± sentences fill in without changes here.
