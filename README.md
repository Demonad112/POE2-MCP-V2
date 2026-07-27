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

Analysis core, web app with a visual passive tree and per-item modifier
analysis, and a 27-tool MCP server are all shipped, including the Path of
Building bridge for what-if simulation.

The bridge is the one part **not verified end to end**. Its protocol is tested
against a fake that reproduces the addon's real behaviour, but no Path of
Building runs in this project's CI or in the container it was written in.
Verification against a live instance is
[documented for you to run](apps/mcp/README.md#verifying-the-bridge).

| | |
|---|---|
| `packages/core` | Pure analysis. No I/O, no framework — `fetch` is injected. 180 tests. |
| `apps/web` | Static Next.js app on GitHub Pages, including the passive tree render. |
| `apps/mcp` | 27-tool MCP server over stdio. See [TOOLS.md](apps/mcp/TOOLS.md). |
| `packages/data` | Versioned game data and re-runnable extraction scripts. |
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
npm test          # 180 tests against a real captured character
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
  pob/                   export decode, PlayerStat reader, live bridge
  gear/                  affix ladders per item class, waste and swaps
  chat/                  grounded context + provider-agnostic transport
  gems/                  support gem parsing and validation
  tree/                  passive graph, path finding, allocation
  recommend/             ranked, quantified findings
  reconcile/             flags drift between sources
packages/data/           generated artifacts + provenance
apps/web/                Next.js static export -> GitHub Pages
apps/mcp/                MCP server over stdio
services/ninja-proxy/    SSE hop + CORS, deployed separately
```

Neither app contains analysis logic. Both import `packages/core`, so they agree
by construction — V1's fatal flaw was vendoring a duplicate analyser into its web
app, after which the two could only agree by coincidence.

The MCP tool table is **generated from the registry**
(`npm run tools -w @poe2/mcp`) and CI fails if it drifts. V1 shipped four
different tool counts across its docs because that list was hand-maintained.

### DPS is tiered

- **Tier 1 (default, authoritative)** — read `skills[i].dps[0]`.
- **Tier 2 (simulation)** — drive a live Path of Building instance for what-ifs:
  apply a change, read what its engine makes of it, put it back. Measured, not
  estimated. Requires PoB running locally with the MCP Bridge addon.
- **Tier 3 (estimation)** — **deliberately not built.** It had no trigger. The
  poe.ninja path resolves every damaging skill (`dps.unresolved` is null on the
  reference character), and a Path of Building code carries 106 computed
  `PlayerStat` values including `TotalDPS`. The real gap was that codes were
  being *rejected*, on the false claim that they carry no computed stats. They
  are now a first-class import. Building an estimator to fill a gap that does not
  exist would mean inventing numbers in a project whose first rule is not to.

Every number carries a `provenance` field through to the UI.

### Cross-validation

poe.ninja's figures are checked against Path of Building's own engine, using the
export embedded in the payload. On the reference character PoB's `TotalDPS`
reads 109859.05 against poe.ninja's 109,859 — they agree, which is what makes
disagreement meaningful. When sources disagree the analyser **flags it** rather
than silently preferring one.

### Gear is read by mod id, not by matching text

poe.ninja ships the actual modifier id on every equipped item —
`itemData.mods.explicit[].id` is `LocalIncreasedPhysicalDamagePercent7`. Joined
to the affix data from [RePoE-fork](https://repoe-fork.github.io/poe2/) and
[pob-data](https://repoe-fork.github.io/pob-data/poe2/), that gives an exact
tier, the roll's position in its window, and what better tiers exist — with no
text matching anywhere.

**T1 is the best tier**, and **a tier is meaningless without an item class.**
`ColdResistance` has 16 members game-wide and 8 on a ring; a global number would
tell a ring wearer "T9 of 16" when they have T1 of 8. Ladders are resolved
against each item's own base, honouring the ordered, first-match-wins spawn
weights that make most affixes class-specific.

Upgrades are split by whether the item you already own can hold them. On the
reference character T1 physical damage needs item level 82 and the bow is 76 —
a new base — while T1 dexterity needs 74 and is achievable right now. Those are
different actions at very different costs and are never merged.

### Survivability is measured against real map tiers

Waystone tier maps to area level as **64 + tier**, taken from the waystone item
bases and corroborated four ways. Headroom is the character's smallest fatal hit
over base monster damage at that level, reported per tier and against the boss
levels Path of Building itself uses — 82 (pinnacle floor) and 85 (the ceiling for
all enemies).

The figure is against a **base** monster. Rare and unique multipliers and map
modifiers are not in the data, so it is an upper bound, never a verdict that a
tier is safe — and it says so next to the number rather than below the fold.

### Two import routes, both carrying real numbers

A **poe.ninja URL or payload** gives the full picture: per-skill damage, stat
attribution, gear modifier tiers.

A **Path of Building code** gives fewer panels and every figure in them is Path
of Building's own — all five maximum-hit-taken values, every resistance, life,
energy shield, armour, evasion, `TotalDPS`. On the reference character both
routes agree exactly: 3,808 chaos and 109,859 DPS. What a code cannot answer is
listed explicitly, so a missing panel is never mistaken for a missing stat.

### Optional chat, and where the key lives

Off by default. When enabled, the model is handed the figures this project
derived and instructed to answer only from them, naming what is missing rather
than estimating. Replies are labelled model-generated; the panels remain the
authority.

**The key lives in your browser, never in this repository.** This is a static
export with no server, and Next inlines every `NEXT_PUBLIC_*` value into the
published bundle — so a key in repository secrets would be readable by anyone who
opened devtools. A serverless proxy holding the key server-side is supported as
an alternative. There is deliberately no arrangement where a maintainer's key
ships with the site.

### Offline

A service worker caches the data artifacts (tree, affix ladders, monster stats)
cache-first, since they are immutable per deploy, and the app shell
network-first so it never goes stale. Character requests are **never** cached: a
stale character sheet served as current is exactly the kind of quietly wrong
answer this project avoids.

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
