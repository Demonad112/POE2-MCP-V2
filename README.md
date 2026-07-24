# PoE2 Build Analyzer

Path of Exile 2 character analysis that reads poe.ninja's own computed data and
turns it into ranked, quantified, evidence-backed findings.

Two rules shape everything here:

1. **Never recompute what poe.ninja already computed.** Its payload ships
   fully-calculated per-skill DPS and 46 defensive stats. They are read, not
   re-derived.
2. **Never invent a number.** Where a value can't be established from the data,
   the output says exactly what is missing instead of guessing.

## Status

**Milestone 1** — analysis core and web app. The visual passive tree and the MCP
server land in milestone 2.

| | |
|---|---|
| `packages/core` | Pure analysis. No I/O, no framework — `fetch` is injected. 63 tests. |
| `apps/web` | Static Next.js app, deployed to GitHub Pages. |
| `services/ninja-proxy` | One serverless function. Needed because poe.ninja sends no CORS headers. |

## Why this exists

It replaces an earlier Python MCP server that had two structural problems.

**It recomputed what it was handed.** poe.ninja returns computed per-skill damage
at `charModel.skills[i].dps[0]`. V1 read only `defensiveStats`, discarded the
rest, and exposed a `calculate_character_dps` tool that demanded ~15
caller-supplied modifiers to reconstruct a number that had arrived for free.

**Its core was duplicated.** The web app ran on a vendored copy of the analysis
code, so it could only agree with the MCP server by coincidence. Here both
adapters import `packages/core`; they render and serialise, they never analyse.

## What it tells you

Findings are ranked by gain per unit of cost, so a free reallocation outranks an
equal-sized fix that costs an exalt. Each carries the action, the measured
impact, the cost, the trade-off, and an expandable evidence trail tracing every
claim back to the payload.

Survivability is led by **`lowestMaximumHitTaken`** — the smallest hit that kills
— rather than an averaged effective health pool. On the reference character EHP
reads 13,569 while a 3,808 chaos hit is fatal: a 3.5× overstatement, and the
difference between "tanky" and "dies to one slam".

## Getting started

```bash
npm install
npm test          # 63 tests against a real captured character
npm run build     # core -> dist, then the web static export
npm run dev       # web app at http://localhost:3000
```

Node 22+.

### Verifying a change end-to-end

```bash
npm run build
npx serve apps/web/out -l 3210      # or: python3 -m http.server 3210
node scripts/screenshot.mjs         # drives a real browser, asserts the DOM
```

`scripts/screenshot.mjs` loads the built export in Chromium, pastes the real
388 KB character model, asserts the headline numbers actually reached the page,
checks for horizontal overflow and console errors, and writes screenshots at
mobile and desktop widths in both themes. Render correctness is not inferred
from code.

## Architecture

```
packages/core/           pure analysis — the single source of truth
  ninja/                 client (injected fetch), SSE hop, URL parsing
  model/                 slots · passives · breakdowns · types
  defense/               0.5 mechanics incl. deflection and ward
  dps/                   Tier 1 reader over skills[].dps[0]
  pob/                   export decode + PlayerStat reader
  recommend/             ranked, quantified findings
  reconcile/             flags drift between sources
apps/web/                Next.js static export -> GitHub Pages
services/ninja-proxy/    SSE hop + CORS, deployed separately
```

### DPS is tiered

- **Tier 1 (default, authoritative)** — read `skills[i].dps[0]`.
- **Tier 2 (simulation)** — drive a live Path of Building instance for what-ifs.
  *Milestone 2.*
- **Tier 3 (fallback)** — internal estimation, **always** labelled `estimate` and
  never silently mixed with Tier 1.

Every number carries a `provenance` field through to the UI.

### Cross-validation

poe.ninja's figures are checked against Path of Building's own engine, using the
export embedded in the payload. On the reference character PoB's `TotalDPS`
reads 109859.05 against poe.ninja's 109,859 — they agree, which is what makes
disagreement meaningful. When sources disagree the analyser **flags it** rather
than silently preferring one.

## Correctness rules

Each of these is a real bug that shipped before, and each is locked by a test.

- **Weapon sets 1 and 2 are alternates, never additive** — for items *and*
  passives. V1 summed 103 + 16 + 16 and reported 135 as one tree. Respect
  `useSecondWeaponSet`; never credit swap-set stats to the live build.
- **Normalize the passive selection once, centrally.** It arrives as a flat list
  from one path and as a dict from another.
- **Model deflection and ward** — 0.5 mechanics with no prior representation.
- **Lead with `lowestMaximumHitTaken`, not averaged EHP.**
- **`passiveCounts.passives` (109) and `passiveSelection.length` (103) are
  different numbers** and are never conflated.
- **Item fields live on `item.itemData`**, not the wrapper.
- **Unmapped breakdown stat ids surface as `stat_<id>`**, never as a guessed name.

## Findings from the live API

Verified against the live endpoints, and worth recording because they contradict
what the endpoints appear to offer:

- **Per-skill ladder DPS does not exist.** `sort=dps-Ice Shot` returns rows
  identical to `sort=dps` — the server silently falls back. The column set is
  fixed at 10 regardless of parameters. Ladder comparison is therefore **not**
  part of this project.
- **Ladder filter parameters are ignored.** `chaosres=60-`, `level=95-` and
  `skill=` all return baseline rows. Only `class`, `sort` and `overview` apply.
- **Ladder DPS is a lossy display string** (`"78M"`). The numeric-looking
  sub-field is a constant tag; the remaining bytes are non-monotonic across rows.
- **poe.ninja sends no CORS headers** and `OPTIONS` returns 405, so a browser
  cannot call it directly — hence `services/ninja-proxy`.
- **The SSE version stream never closes.** Awaiting the whole body hangs; it must
  be read incrementally and cancelled.
- **`total = base × (1 + inc/100) × more`** holds for flat stats (verified on
  life, armour and energy shield) but **not** for capped resistances, nor for
  percentage stats carrying an increased component — `movementSpeed` and
  `itemRarity` follow different rules. Those report as unverifiable rather than
  asserting a rule.

## Deployment

The web app deploys to GitHub Pages via `.github/workflows/deploy.yml` on pushes
to `main`.

Two steps need a human:

1. **Enable Pages** — Settings → Pages → Source: *GitHub Actions*.
2. **Deploy the proxy** and set `NEXT_PUBLIC_NINJA_PROXY_BASE` as a repository
   variable. See [`services/ninja-proxy/README.md`](services/ninja-proxy/README.md).

Without the proxy the app still works in **paste-only mode** — paste a character
model JSON and everything is computed locally in the browser.

## Credits

Character data from [poe.ninja](https://poe.ninja). The import pipeline builds on
work in [Poe2-endgame](https://github.com/Demonad112/Poe2-endgame).

Path of Exile 2 is a trademark of Grinding Gear Games. This is an unofficial
fan-made tool, not affiliated with or endorsed by Grinding Gear Games.
