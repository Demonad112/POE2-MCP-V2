/**
 * Mod database: tiers, roll assessment, and the things it refuses to answer.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { ModDatabase, modSkeleton, modValues, type ModData } from '../src/mods/index.js'
import { unwrapCharModel } from '../src/analyze.js'
import { normalizeItems } from '../src/model/slots.js'

const db = new ModDatabase(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../data/generated/mods.json', import.meta.url)), 'utf8')) as ModData,
)
const model = unwrapCharModel(
  JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/athrynas-v43.json', import.meta.url)), 'utf8')),
)

describe('normalising mod text', () => {
  it('reduces a line to a comparable skeleton', () => {
    // The sign is absorbed into the number token deliberately: an affix renders
    // its minimum and maximum rolls separately, and both must reduce to the
    // same skeleton for the index to find them.
    expect(modSkeleton('+38% to Lightning Resistance')).toBe('#% to lightning resistance')
    expect(modSkeleton('+12 to Strength')).toBe(modSkeleton('+34 to Strength'))
    expect(modSkeleton('+12 to Strength')).toBe(modSkeleton('-12 to Strength'))
  })

  it('strips PoE display markup', () => {
    expect(modSkeleton('+38% to [Resistances|Lightning Resistance]')).toBe('#% to lightning resistance')
  })

  it('keeps genuinely different phrasings apart', () => {
    // "+X% to" and "X% increased" are different mods and must not collide.
    expect(modSkeleton('+38% to Fire Resistance')).not.toBe(modSkeleton('38% increased Fire Resistance'))
  })

  it('extracts the numbers in order', () => {
    expect(modValues('Adds 5 to 12 Fire Damage')).toEqual([5, 12])
    expect(modValues('+38% to Lightning Resistance')).toEqual([38])
  })
})

describe('tiers from real game data', () => {
  it('loads the database', () => {
    expect(db.size).toBeGreaterThan(12_000)
  })

  it('finds the real strength affix ladder', () => {
    const results = db.search('to Strength', { kind: 'SUFFIX', limit: 5 })
    expect(results.length).toBeGreaterThan(0)
    const best = results[0]!
    // Tier 1 is the highest, and carries the real affix name.
    expect(best.tier).toBe(1)
    expect(best.affix).toBe('of the Gods')
    expect(best.level).toBe(81)
  })

  it('ranks better tiers first', () => {
    const results = db.search('to Strength', { kind: 'SUFFIX', limit: 5 })
    const tiers = results.map((r) => r.tier)
    expect([...tiers].sort((a, b) => a - b)).toEqual(tiers)
  })
})

describe('assessing a real roll', () => {
  it('places a roll in its tier window', () => {
    const result = db.assess('+35 to Strength')
    expect(result.matched).not.toBeNull()
    expect(result.matched!.tier).toBeLessThanOrEqual(2)
    expect(result.matched!.min).toBeLessThanOrEqual(35)
    expect(result.matched!.max).toBeGreaterThanOrEqual(35)
    expect(result.matched!.positionInTier).toBeGreaterThanOrEqual(0)
    expect(result.matched!.positionInTier).toBeLessThanOrEqual(1)
  })

  it('reports the best roll the affix family can produce', () => {
    const low = db.assess('+6 to Strength')
    expect(low.matched).not.toBeNull()
    expect(low.matched!.bestPossible).toBeGreaterThan(low.matched!.max)
  })

  it('assesses the reference character’s real gear', () => {
    const items = normalizeItems(model)
    const belt = items.find((i) => i.slotId === 11)!
    expect(belt.name).toBe('Golem Tether')

    const analysis = db.assessAll(belt.mods)
    expect(analysis.mods).toHaveLength(belt.mods.length)
    // Real gear should match a meaningful share of its lines.
    expect(analysis.matched).toBeGreaterThan(0)
    for (const mod of analysis.mods) {
      if (!mod.matched) expect(mod.note).toBeTruthy()
      else expect(mod.matched.tier).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('refusing to guess', () => {
  it('returns no match for a line it does not recognise', () => {
    const result = db.assess('Grants Something That Does Not Exist')
    expect(result.matched).toBeNull()
    expect(result.note).toContain('No affix in the database')
  })

  it('says so when a stat is known but the value fits no tier', () => {
    const result = db.assess('+99999 to Strength')
    expect(result.matched).toBeNull()
    expect(result.note).toMatch(/outside every known tier/)
  })

  it('states on every result that base compatibility is not covered', () => {
    const analysis = db.assessAll(['+35 to Strength'])
    expect(analysis.limitation).toMatch(/no mod-to-item-base compatibility/i)
    // The database must never expose a legality check.
    expect((db as unknown as Record<string, unknown>).validateItemMods).toBeUndefined()
  })
})
