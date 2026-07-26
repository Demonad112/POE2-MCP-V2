/**
 * Item modifier database: affixes, roll ranges and tiers.
 *
 * ## What this answers, and what it refuses to
 *
 * **Answers:** what affixes exist for a stat, what they can roll, which tier a
 * given roll corresponds to, and how far a roll sits from the best possible.
 * All of that comes from the game's own mod table joined to its stat
 * descriptions.
 *
 * **Refuses:** whether a mod is *legal on a given item base*. That linkage is
 * not in the data. `type_key` looks like an index into spawn_tags and is not —
 * following it maps attack speed to belts only, and flat energy shield to bows,
 * claws and non-item tags like `Claw_onhit_audio`. Only 11,403 of 16,788
 * type_keys are even in range. So there is no `validateItemMods` here: a
 * legality check would have to invent the rule it claims to enforce.
 *
 * Tier analysis is the useful thing that IS grounded, and it is what an item is
 * usually judged on anyway — "your +42 life is tier 4 of 9" is more actionable
 * than "this mod is allowed here".
 */

export interface ModStat {
  id: string
  min: number
  max: number
  /** Rendered at the maximum roll. */
  text: string
  /** Rendered at the minimum roll. */
  textMin: string
}

export interface ModEntry {
  id: string
  /** Affix name, e.g. "of the Gods". Null for implicits and some corrupted mods. */
  affix: string | null
  kind: string
  level: number
  stats: ModStat[]
  /** 1 is the highest tier. */
  tier: number
  tiers: number
}

export interface ModData {
  version: number
  modCount: number
  limitation: string
  mods: ModEntry[]
}

/**
 * Reduce a mod line to a shape that can be compared across rolls:
 * "+38% to Lightning Resistance" -> "+#% to lightning resistance".
 */
export function modSkeleton(text: string): string {
  return text
    .replace(/\[(?:[^\]|]+\|)?([^\]]+)\]/g, '$1')
    .replace(/[+-]?\d+(?:\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Every number in a mod line, in order. */
export function modValues(text: string): number[] {
  return (text.match(/[+-]?\d+(?:\.\d+)?/g) ?? []).map(Number)
}

export interface RollAssessment {
  /** Where the roll sits in this tier's window, 0 (minimum) to 1 (maximum). */
  positionInTier: number | null
  tier: number
  tiers: number
  affix: string | null
  /** This tier's window. */
  min: number
  max: number
  /** The best roll any tier of this affix family can produce. */
  bestPossible: number
  level: number
}

export interface ItemModAnalysis {
  text: string
  /** Null when the line matches nothing in the database. */
  matched: RollAssessment | null
  note: string | null
}

export class ModDatabase {
  private readonly bySkeleton = new Map<string, ModEntry[]>()
  readonly limitation: string
  readonly size: number

  constructor(data: ModData) {
    this.limitation = data.limitation
    this.size = data.mods.length
    for (const mod of data.mods) {
      for (const stat of mod.stats) {
        // Index on both bounds: a stat whose min and max render differently
        // (e.g. sign changes) must be findable either way.
        for (const key of new Set([modSkeleton(stat.text), modSkeleton(stat.textMin)])) {
          const list = this.bySkeleton.get(key) ?? []
          if (!list.includes(mod)) list.push(mod)
          this.bySkeleton.set(key, list)
        }
      }
    }
  }

  /** Free-text search over affix names and rendered stat text. */
  search(query: string, opts: { kind?: string; limit?: number } = {}): ModEntry[] {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const limit = opts.limit ?? 25
    const out: ModEntry[] = []

    for (const list of this.bySkeleton.values()) {
      for (const mod of list) {
        if (out.includes(mod)) continue
        if (opts.kind && mod.kind !== opts.kind) continue
        const haystack = `${mod.affix ?? ''} ${mod.stats.map((s) => s.text).join(' ')}`.toLowerCase()
        if (!haystack.includes(q)) continue
        out.push(mod)
        if (out.length >= limit * 4) break
      }
      if (out.length >= limit * 4) break
    }

    // Best tier first, so the top of the list is what a crafter cares about.
    return out.sort((a, b) => a.tier - b.tier || b.level - a.level).slice(0, limit)
  }

  /**
   * Assess a single mod line from an item.
   *
   * Returns `matched: null` rather than a guess when the line has no
   * counterpart in the database — many lines are runes, corrupted implicits or
   * unique-only mods that this table does not carry.
   */
  assess(text: string): ItemModAnalysis {
    const skeleton = modSkeleton(text)
    const candidates = this.bySkeleton.get(skeleton)
    if (!candidates?.length) {
      return {
        text,
        matched: null,
        note: 'No affix in the database renders to this line. It may be a rune, a unique-only modifier, or a stat this data set does not describe.',
      }
    }

    const values = modValues(text)
    const value = values[0]
    if (value === undefined) {
      return { text, matched: null, note: 'This line carries no numeric roll to place in a tier.' }
    }

    // The tier whose window contains the roll. Several tiers can overlap, so
    // prefer the best (lowest-numbered) tier that fits.
    const family = candidates
      .filter((m) => m.stats.length === values.length)
      .sort((a, b) => a.tier - b.tier)
    const pool = family.length ? family : candidates

    const fits = pool.filter((m) => {
      const stat = m.stats[0]
      return stat && value >= Math.min(stat.min, stat.max) && value <= Math.max(stat.min, stat.max)
    })
    const chosen = fits[0] ?? null

    const bestPossible = Math.max(...pool.map((m) => Math.max(m.stats[0]!.min, m.stats[0]!.max)))

    if (!chosen) {
      return {
        text,
        matched: null,
        note: `The stat is recognised but ${value} falls outside every known tier window for it, which usually means the value is modified by quality, a rune, or an increase from elsewhere on the character.`,
      }
    }

    const stat = chosen.stats[0]!
    const low = Math.min(stat.min, stat.max)
    const high = Math.max(stat.min, stat.max)
    const span = high - low

    return {
      text,
      matched: {
        positionInTier: span > 0 ? (value - low) / span : null,
        tier: chosen.tier,
        tiers: chosen.tiers,
        affix: chosen.affix,
        min: low,
        max: high,
        bestPossible,
        level: chosen.level,
      },
      note: null,
    }
  }

  /** Assess every mod line on an item. */
  assessAll(lines: string[]): {
    mods: ItemModAnalysis[]
    matched: number
    unmatched: number
    limitation: string
  } {
    const mods = lines.map((line) => this.assess(line))
    return {
      mods,
      matched: mods.filter((m) => m.matched).length,
      unmatched: mods.filter((m) => !m.matched).length,
      limitation: this.limitation,
    }
  }
}
