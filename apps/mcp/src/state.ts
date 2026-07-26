/**
 * Session state: the character currently loaded, plus lazily-loaded game data.
 *
 * Analysis tools operate on a loaded character rather than each re-fetching it —
 * the payload is ~400 KB and the SSE version hop makes a fetch slow. Tools fail
 * with an actionable message when nothing is loaded, rather than silently
 * returning empty results.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  analyzeCharacter,
  NinjaClient,
  ModDatabase,
  PassiveTree,
  indexSupports,
  parseAllSetups,
  type Analysis,
  type CharModel,
  type ModBaseData,
  type ModData,
  type PassiveTreeData,
  type SkillSetup,
  type SupportGem,
} from '@poe2/core'

const here = dirname(fileURLToPath(import.meta.url))
/** dist/ sits one level under apps/mcp, so data is four levels up. */
const dataDir = join(here, '..', '..', '..', 'packages', 'data', 'generated')

export class NoCharacterLoadedError extends Error {
  constructor() {
    super(
      'No character is loaded. Call poe2_load_character first with a poe.ninja profile URL, ' +
        'or with account, league and character names.',
    )
    this.name = 'NoCharacterLoadedError'
  }
}

export interface LoadedCharacter {
  model: CharModel
  analysis: Analysis
  setups: SkillSetup[]
  supports: Map<string, SupportGem>
  source: string
}

let current: LoadedCharacter | null = null
let tree: PassiveTree | null = null
let mods: ModDatabase | null = null

export const client = new NinjaClient({
  // Server-side, so poe.ninja is reachable directly — no proxy needed. The
  // browser build cannot do this; see services/ninja-proxy.
  fetch: (input, init) => fetch(input, init as RequestInit),
})

export async function loadCharacter(raw: unknown, source: string): Promise<LoadedCharacter> {
  const analysis = await analyzeCharacter(raw)
  const model = (raw as { charModel?: CharModel }).charModel ?? (raw as CharModel)
  const setups = parseAllSetups(model.skills)
  current = { model, analysis, setups, supports: indexSupports(setups), source }
  return current
}

export function requireCharacter(): LoadedCharacter {
  if (!current) throw new NoCharacterLoadedError()
  return current
}

export function loadedCharacter(): LoadedCharacter | null {
  return current
}

/** The passive tree artifact, read once and kept. */
export function passiveTree(): PassiveTree {
  if (!tree) {
    const data = JSON.parse(readFileSync(join(dataDir, 'passive-tree.json'), 'utf8')) as PassiveTreeData
    tree = new PassiveTree(data)
  }
  return tree
}

/**
 * The mod artifact, read once and kept. 3.6 MB, so it is loaded on first use
 * rather than at startup — most sessions never touch it.
 */
export function modDatabase(): ModDatabase {
  if (!mods) {
    const data = JSON.parse(readFileSync(join(dataDir, 'mods.json'), 'utf8')) as ModData
    // Compatibility comes from a second source (RePoE-fork). Its absence must
    // degrade to "cannot check", never to a silent pass.
    let bases: ModBaseData | undefined
    try {
      bases = JSON.parse(readFileSync(join(dataDir, 'mod-bases.json'), 'utf8')) as ModBaseData
    } catch {
      bases = undefined
    }
    mods = new ModDatabase(data, bases)
  }
  return mods
}
