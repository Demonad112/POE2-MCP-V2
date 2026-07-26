/**
 * Survivability against content, expressed in the only unit the data supports.
 *
 * ## What is NOT here, and why
 *
 * "What map tier can I run" is not answerable from any data source this project
 * has. Checked, not assumed: `WorldAreas.json` carries `level` for 158 endgame
 * maps but **no tier field of any kind**, and the levels it does carry collapse
 * to six distinct values (35, 65, 74, 75, 79, 80). There is no T1-T15 ladder to
 * map onto. Inventing one — "area level 80 is about T15" — would be a made-up
 * number dressed as a measurement, which is the one thing this project does not
 * do.
 *
 * ## What IS here
 *
 * Area level headroom: the character's smallest fatal hit against the game's own
 * base monster damage at that level, from `default_monster_stats`. That ratio is
 * real and derived end to end.
 *
 * It is also, on its own, optimistic — and says so. The figure is for a BASE
 * monster. Rares, uniques and map modifiers multiply it, and `ModMap.json`
 * shows those multipliers reaching well past 2x. So the headroom is reported as
 * a multiple against a baseline, never as a verdict on what content is safe.
 */

import type { DefenseSummary } from '../defense/index.js'

/** Base monster physical damage by area level, from default_monster_stats. */
export interface MonsterStatData {
  version: number
  generatedFrom: string
  /** areaLevel -> base physical damage */
  physicalDamage: Record<string, number>
  /** Distinct area levels that real endgame maps use. */
  mapLevels: number[]
  /** areaLevel -> a few map names at that level, so the number means something. */
  mapsByLevel: Record<string, string[]>
}

export interface HeadroomRow {
  areaLevel: number
  /** Base monster physical damage at this level. */
  baseMonsterHit: number
  /** How many base hits the character survives. */
  headroom: number
  /** Example maps at this level, when any exist. */
  maps: string[]
}

export interface ContentReport {
  /** The hit that kills soonest — the honest survivability anchor. */
  lowestMaximumHit: number
  lowestMaximumHitType: string
  rows: HeadroomRow[]
  /** Stated limits of the figure. Rendered next to it, never omitted. */
  caveats: string[]
  /** What could not be determined, and why. */
  unresolved: { question: string; missing: string }[]
}

export function analyzeContent(defense: DefenseSummary, data: MonsterStatData): ContentReport {
  const lowest = defense.lowestMaximumHit
  const rows: HeadroomRow[] = []

  const levels = data.mapLevels.length
    ? data.mapLevels
    : Object.keys(data.physicalDamage).map(Number).filter((n) => n >= 65)

  for (const level of [...new Set(levels)].sort((a, b) => a - b)) {
    const hit = data.physicalDamage[String(level)]
    if (typeof hit !== 'number' || hit <= 0) continue
    rows.push({
      areaLevel: level,
      baseMonsterHit: Math.round(hit),
      headroom: lowest !== null ? Number((lowest / hit).toFixed(1)) : 0,
      maps: data.mapsByLevel[String(level)] ?? [],
    })
  }

  return {
    lowestMaximumHit: lowest ?? 0,
    lowestMaximumHitType: defense.lowestMaximumHitType ?? 'unknown',
    rows,
    caveats: [
      'Measured against a BASE monster of that area level. Rare and unique monsters hit considerably harder, and map modifiers multiply it further.',
      `Headroom is against ${defense.lowestMaximumHitType ?? 'the weakest'} damage, the type that kills this character soonest. Other damage types have more room.`,
      'Base monster damage is physical. A character with weak elemental or chaos mitigation has less headroom than this row shows.',
    ],
    unresolved: [
      {
        question: 'Which map tier is safe to run?',
        missing:
          'No map tier data exists in any source used here. WorldAreas carries area levels for 158 maps but no tier field, ' +
          'and the levels collapse to six values with no T1-T15 ladder. Mapping area level to tier would be invented, not derived.',
      },
    ],
  }
}
