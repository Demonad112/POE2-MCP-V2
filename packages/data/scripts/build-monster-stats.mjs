/**
 * Build the monster/area artifact backing the survivability-versus-content view.
 *
 * Sources:
 *   https://repoe-fork.github.io/poe2/default_monster_stats.min.json
 *   https://repoe-fork.github.io/pob-data/poe2/WorldAreas.min.json
 *
 * ## The negative result, recorded so it is not re-investigated
 *
 * WorldAreas has NO map tier field. Its fields are: act, baseName,
 * bossVarieties, isHideout, isMap, level, monsterVarieties, name, tags,
 * description. 158 entries have isMap true with a level above zero, and those
 * levels take only six distinct values: 35, 65, 74, 75, 79, 80.
 *
 * So "what map tier can this character run" is not derivable, and this artifact
 * deliberately carries area LEVELS only. Anything mapping level to tier would be
 * invented.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'generated')
const cacheDir = join(outDir, '.cache')

const SOURCES = {
  monsters: 'https://repoe-fork.github.io/poe2/default_monster_stats.min.json',
  areas: 'https://repoe-fork.github.io/pob-data/poe2/WorldAreas.min.json',
}

async function load(name, url) {
  mkdirSync(cacheDir, { recursive: true })
  const path = join(cacheDir, `${name}.json`)
  if (!existsSync(path)) {
    process.stderr.write(`fetching ${url}\n`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url} returned ${res.status}`)
    writeFileSync(path, await res.text())
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

const [monsters, areas] = await Promise.all(Object.entries(SOURCES).map(([n, u]) => load(n, u)))

const physicalDamage = {}
for (const [level, stats] of Object.entries(monsters)) {
  if (typeof stats?.physical_damage === 'number') physicalDamage[level] = stats.physical_damage
}

const mapsByLevel = {}
for (const area of Object.values(areas)) {
  if (!area?.isMap || !(area.level > 0)) continue
  const key = String(area.level)
  ;(mapsByLevel[key] ??= []).push(area.baseName ?? area.name)
}
for (const key of Object.keys(mapsByLevel)) {
  mapsByLevel[key] = [...new Set(mapsByLevel[key])].sort().slice(0, 6)
}

const artifact = {
  version: 1,
  generatedFrom: Object.values(SOURCES).join(' + '),
  limitation:
    'Area levels only. WorldAreas carries no map tier field, and its 158 endgame maps use just six distinct levels, ' +
    'so no tier ladder is derivable. Mapping area level to map tier would be invented.',
  physicalDamage,
  mapLevels: Object.keys(mapsByLevel).map(Number).sort((a, b) => a - b),
  mapsByLevel,
}

mkdirSync(outDir, { recursive: true })
const json = JSON.stringify(artifact)
writeFileSync(join(outDir, 'monster-stats.json'), json)

console.log(`monster levels     ${Object.keys(physicalDamage).length}`)
console.log(`map area levels    ${artifact.mapLevels.join(', ')}`)
console.log(`size               ${(json.length / 1024).toFixed(1)} KB raw · ${(gzipSync(json, { level: 9 }).length / 1024).toFixed(1)} KB gzipped`)
console.log(`written            ${join(outDir, 'monster-stats.json')}`)
