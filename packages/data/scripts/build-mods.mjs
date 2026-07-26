/**
 * Build the mod artifact: every affix with its stat, roll range and tier.
 *
 * Sources (both from Demonad112/poe2-mcp):
 *   data/game/mods/mods.json                          16,788 mods, 19 MB
 *   data/game/stat_descriptions/stat_descriptions.json 10,716 entries, 5.8 MB
 *
 * ## What is derivable, and what is not
 *
 * **Derivable.** Each mod carries `mod_id`, an affix `display_name` ("of the
 * Brute"), `generation_type_name` (PREFIX / SUFFIX / IMPLICIT / CORRUPTED), a
 * `level_requirement`, and stats with `stat_id` plus `min_value`/`max_value`.
 * Joining `stat_id` against the stat descriptions turns that into readable text
 * ("{0:+d} to Strength"). Grouping by stat and generation type, ordered by
 * level requirement, gives real tiers with real roll ranges.
 *
 * **NOT derivable: which item bases a mod can roll on.** `type_key` looks like
 * an index into spawn_tags, and it is not. Checked: `IncreasedAttackSpeed1`
 * would map to ['belt','default'] — attack speed on belts only — and flat
 * energy shield would map to bows, claws, daggers plus 'sanctum_monster' and
 * 'Claw_onhit_audio', which are not item classes at all. Only 11,403 of 16,788
 * type_keys are even in range. So this artifact deliberately carries NO
 * mod-to-base compatibility, and nothing built on it may claim to validate
 * whether a mod is legal on an item.
 *
 * Usage: node packages/data/scripts/build-mods.mjs [modsPath] [statDescriptionsPath]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const base = '/home/user/poe2-mcp/data/game'
const modsPath = process.argv[2] ?? `${base}/mods/mods.json`
const statsPath = process.argv[3] ?? `${base}/stat_descriptions/stat_descriptions.json`
const outDir = join(here, '..', 'generated')
const outPath = join(outDir, 'mods.json')

const modsRaw = JSON.parse(readFileSync(modsPath, 'utf8'))
const mods = Array.isArray(modsRaw.mods) ? modsRaw.mods : Object.values(modsRaw.mods ?? {})

// --- stat_id -> readable template ------------------------------------------
const statsRaw = JSON.parse(readFileSync(statsPath, 'utf8'))
const templates = new Map()
for (const entry of statsRaw.descriptions ?? []) {
  const variants = entry.variants ?? []
  // Prefer the plain positive-range variant; templates differ for negatives.
  const chosen = variants.find((v) => v.range === '#' || v.range === '1|#') ?? variants[0]
  const template = chosen?.template ?? entry.primary_template
  if (!template) continue
  for (const id of entry.stat_ids ?? []) if (!templates.has(id)) templates.set(id, template)
}

/** Strip PoE display markup: "[EnergyShield|Energy Shield]" -> "Energy Shield". */
function stripMarkup(text) {
  return text.replace(/\[(?:[^\]|]+\|)?([^\]]+)\]/g, '$1')
}

/** Render a template with a value, honouring the {0:+d} sign form. */
function render(template, value) {
  return stripMarkup(template).replace(/\{0(?::\+d)?\}/g, (match) =>
    match.includes('+d') && value >= 0 ? `+${value}` : String(value),
  )
}

// --- flatten -----------------------------------------------------------------
const out = []
let noTemplate = 0

for (const mod of mods) {
  const stats = (mod.stats ?? []).filter((s) => s && !s.is_empty && s.stat_id)
  if (!stats.length) continue

  const rendered = []
  for (const stat of stats) {
    const template = templates.get(stat.stat_id)
    if (!template) {
      noTemplate++
      continue
    }
    rendered.push({
      id: stat.stat_id,
      min: stat.min_value,
      max: stat.max_value,
      // Both bounds rendered so a caller can show the real roll window.
      text: render(template, stat.max_value),
      textMin: render(template, stat.min_value),
    })
  }
  if (!rendered.length) continue

  out.push({
    id: mod.mod_id,
    affix: mod.display_name || null,
    kind: mod.generation_type_name,
    level: mod.level_requirement ?? 0,
    stats: rendered,
  })
}

// --- tiers -------------------------------------------------------------------
// A tier family is one stat id at one generation type. Tier 1 is the highest
// level requirement, matching how the game numbers them.
const families = new Map()
for (const mod of out) {
  const key = `${mod.stats[0].id}|${mod.kind}`
  const list = families.get(key) ?? []
  list.push(mod)
  families.set(key, list)
}
for (const list of families.values()) {
  list.sort((a, b) => b.level - a.level)
  list.forEach((mod, index) => {
    mod.tier = index + 1
    mod.tiers = list.length
  })
}

const artifact = {
  version: 1,
  generatedFrom: 'Demonad112/poe2-mcp data/game/mods/mods.json + stat_descriptions.json',
  modCount: out.length,
  familyCount: families.size,
  limitation:
    'Carries no mod-to-item-base compatibility: type_key does not index spawn_tags (verified — it maps attack speed to belts only, and flat energy shield to bows and non-item tags). Nothing built on this may claim to validate whether a mod is legal on a given base.',
  mods: out,
}

mkdirSync(outDir, { recursive: true })
const json = JSON.stringify(artifact)
writeFileSync(outPath, json)

console.log(`source mods       ${mods.length}`)
console.log(`mods kept         ${out.length} (those with a resolvable stat template)`)
console.log(`dropped stats     ${noTemplate} (stat_id absent from stat_descriptions)`)
console.log(`tier families     ${families.size}`)
console.log(`size              ${(json.length / 1024 / 1024).toFixed(1)} MB raw · ${(gzipSync(json, { level: 9 }).length / 1024 / 1024).toFixed(2)} MB gzipped`)
console.log(`written           ${outPath}`)
