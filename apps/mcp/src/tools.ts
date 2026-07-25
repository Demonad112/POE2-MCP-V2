/**
 * Tool definitions.
 *
 * Every tool is a thin adapter over @poe2/core — the MCP server contains no
 * analysis logic of its own, so it and the web app agree by construction rather
 * than by two implementations being kept in step.
 *
 * Definitions live in one array so the documented tool table can be GENERATED
 * from the registry (see tool-table.ts). V1 shipped four different stale tool
 * counts across its docs; hand-maintaining that list is what caused it.
 */

import { z } from 'zod'
import {
  NODE_KIND,
  decodePobExport,
  findMechanicSafe,
  parseProfileUrl,
  pathToNode,
  readPlayerStats,
  resolveAllocation,
  statSources,
  validateByName,
  validateSetup,
} from './deps.js'
import { client, loadCharacter, loadedCharacter, passiveTree, requireCharacter } from './state.js'

export interface ToolDef {
  name: string
  title: string
  description: string
  inputSchema: z.ZodRawShape
  annotations: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const
const READ_ONLY_NETWORK = { ...READ_ONLY, openWorldHint: true } as const

function truncate<T>(items: T[], limit: number): { items: T[]; total: number; truncated: boolean } {
  return { items: items.slice(0, limit), total: items.length, truncated: items.length > limit }
}

export const TOOLS: ToolDef[] = [
  {
    name: 'poe2_load_character',
    title: 'Load a character',
    description:
      'Fetch a Path of Exile 2 character from poe.ninja and make it the active character for every other tool. ' +
      'Accepts either a full poe.ninja profile URL, or account plus league plus character name. Also accepts a raw ' +
      'character model JSON payload for offline use. Returns an identity and headline summary; call the more ' +
      'specific tools for detail.',
    inputSchema: {
      url: z.string().optional().describe('A poe.ninja PoE2 profile URL, e.g. https://poe.ninja/poe2/profile/Name-1234/runesofaldur/character/Char'),
      account: z.string().optional().describe('Account in Name-1234 or Name#1234 form. Used with league and character.'),
      league: z.string().optional().describe('League slug, e.g. runesofaldur or standard.'),
      character: z.string().optional().describe('Character name.'),
      json: z.string().optional().describe('A raw character model JSON payload, as an alternative to fetching.'),
    },
    annotations: READ_ONLY_NETWORK,
    handler: async (args) => {
      const { url, account, league, character, json } = args as Record<string, string | undefined>

      if (json) {
        const loaded = await loadCharacter(JSON.parse(json), 'pasted JSON')
        return summarize(loaded)
      }

      let ref = url ? parseProfileUrl(url) : null
      if (url && !ref) {
        throw new Error(
          `"${url}" is not a recognised poe.ninja PoE2 profile URL. Expected a form like ` +
            'https://poe.ninja/poe2/profile/Account-1234/league/character/Name, or pass account, league and character separately.',
        )
      }
      if (!ref) {
        if (!account || !league || !character) {
          throw new Error('Provide either a poe.ninja profile URL, or all three of account, league and character.')
        }
        ref = { account, leagueSlug: league, character }
      }
      if (!ref.leagueSlug) {
        throw new Error('That URL contains no league. Use the full profile URL, or pass league explicitly.')
      }

      const payload = await client.fetchCharacter(ref.account, ref.leagueSlug, ref.character)
      const loaded = await loadCharacter(payload, `${ref.account}/${ref.leagueSlug}/${ref.character}`)
      return summarize(loaded)
    },
  },

  {
    name: 'poe2_get_defenses',
    title: 'Get defensive analysis',
    description:
      'Defensive breakdown of the loaded character, led by the lowest maximum hit taken — the smallest single hit ' +
      'that kills. Includes per-damage-type maximum hits, resistances with over- and under-cap amounts, and the 0.5 ' +
      'mechanics deflection and ward. Also reports how far the averaged effective health pool overstates survivability.',
    inputSchema: {},
    annotations: READ_ONLY,
    handler: () => {
      const d = requireCharacter().analysis.defense
      return {
        lowestMaximumHit: d.lowestMaximumHit,
        lowestMaximumHitType: d.lowestMaximumHitType,
        effectiveHealthPool: d.effectiveHealthPool,
        ehpOverstatementRatio: d.ehpOverstatementRatio,
        note:
          d.ehpOverstatementRatio && d.ehpOverstatementRatio > 1.5
            ? `Effective health pool overstates survivability by ${d.ehpOverstatementRatio.toFixed(1)}x. Judge this build by the lowest maximum hit.`
            : null,
        maxHits: d.maxHits,
        resistances: d.resistances,
        pools: { life: d.life, energyShield: d.energyShield, ward: d.ward, chaosRawPool: d.chaosRawPool },
        mitigation: {
          armour: d.armour,
          physicalDamageReduction: d.physicalDamageReduction,
          physicalDamageReductionAgainstHit: d.physicalDamageReductionAgainstHit,
          evasion: d.evasion,
          evadeChance: d.evadeChance,
          blockChance: d.blockChance,
          deflectionRating: d.deflectionRating,
          deflectChance: d.deflectChance,
          deflectEffect: d.deflectEffect,
        },
        missingFromPayload: d.missing,
      }
    },
  },

  {
    name: 'poe2_get_skill_damage',
    title: 'Get per-skill damage',
    description:
      'Per-skill damage for the loaded character, read verbatim from poe.ninja’s computed values — never ' +
      'recalculated. Includes hit DPS, damage over time, use rate, critical strike, projectiles and the damage-type ' +
      'split. Charge-up skills report a hit rate below 1, meaning only that fraction of uses land.',
    inputSchema: {
      includeBuffs: z.boolean().optional().describe('Include buff and herald skills, which deal damage over time only. Default false.'),
    },
    annotations: READ_ONLY,
    handler: (args) => {
      const dps = requireCharacter().analysis.dps
      const skills = args.includeBuffs ? dps.skills : dps.hitSkills
      return {
        primary: dps.primary,
        skills,
        provenance: dps.provenance,
        unresolved: dps.unresolved,
      }
    },
  },

  {
    name: 'poe2_get_recommendations',
    title: 'Get ranked recommendations',
    description:
      'Ranked, quantified improvements for the loaded character, ordered by gain per unit of cost so a free ' +
      'reallocation outranks an equally-sized fix that costs currency. Each carries the concrete action, the ' +
      'measured impact, the cost, the trade-off, and an evidence trail tracing every claim back to the payload. ' +
      'Also reports what could not be determined, rather than guessing.',
    inputSchema: {},
    annotations: READ_ONLY,
    handler: () => requireCharacter().analysis.recommendations,
  },

  {
    name: 'poe2_find_stat_sources',
    title: 'Find what grants a stat',
    description:
      'Attribute a stat to the exact items, passives, quests and attributes that grant it, using poe.ninja’s own ' +
      'per-stat breakdown. This is what makes "replace this ring" able to state precisely what would be lost. ' +
      'Stat keys are names like life, energyShield, armour, evasionRating, ward, fireResistance.',
    inputSchema: {
      stat: z.string().describe('Stat key, e.g. "armour", "life", "coldResistance".'),
    },
    annotations: READ_ONLY,
    handler: (args) => {
      const { breakdowns } = requireCharacter().analysis
      const stat = String(args.stat)
      const entry = breakdowns.byKey.get(stat)
      if (!entry) {
        const available = [...breakdowns.byKey.keys()].sort()
        throw new Error(`No breakdown for "${stat}". Available stats: ${available.join(', ')}.`)
      }
      return {
        stat: entry.key,
        label: entry.label,
        total: entry.total,
        base: entry.base,
        increasedPercent: entry.inc,
        more: entry.more,
        derivation: entry.derivation,
        cap: entry.cap,
        idConfidence: entry.confidence,
        sources: statSources(breakdowns, stat).map((c) => ({
          value: c.value,
          kind: c.modKind,
          from: c.source.itemName ?? c.source.label ?? 'character base',
          sourceKind: c.source.kind,
          passiveNodeId: c.source.nodeId,
        })),
      }
    },
  },

  {
    name: 'poe2_analyze_passive_tree',
    title: 'Analyze the passive tree',
    description:
      'Passive allocation for the loaded character, resolved against the tree data. Keeps the two weapon sets ' +
      'separate — they are alternates, never additive — and reports allocated notables, keystones and jewel ' +
      'sockets. Multiple connected groups are normal and are explained rather than flagged as a broken tree.',
    inputSchema: {},
    annotations: READ_ONLY,
    handler: () => {
      const { analysis } = requireCharacter()
      const resolved = resolveAllocation(passiveTree(), analysis.passives)
      return {
        counts: {
          reportedByNinja: analysis.passives.counts,
          allocatedMainSelection: analysis.passives.mainSelectionLength,
          liveTotal: resolved.live.length,
          note: 'poe.ninja’s own passive count and the length of the allocated-node list are different numbers and are not interchangeable.',
        },
        activeWeaponSet: analysis.passives.activeSet,
        weaponSetNodeCounts: { set1: analysis.passives.set1.length, set2: analysis.passives.set2.length },
        notables: resolved.notables.map((n) => ({ id: n.id, name: n.name, stats: n.stats })),
        keystones: resolved.keystones.map((n) => ({ id: n.id, name: n.name, stats: n.stats })),
        jewelSockets: resolved.jewelSockets.map((n) => ({ id: n.id, name: n.name })),
        ascendancy: resolved.ascendancy.map((n) => ({ id: n.id, name: n.name, ascendancy: n.ascendancy })),
        groups: resolved.components.map((c) => ({ kind: c.kind, ascendancy: c.ascendancy, size: c.nodes.length })),
        unresolvedNodeIds: resolved.unresolvedIds,
      }
    },
  },

  {
    name: 'poe2_inspect_passive_node',
    title: 'Inspect a passive node',
    description:
      'Look up a passive node by id or by name, returning its stats, kind, ascendancy and neighbours. Name lookup ' +
      'is a case-insensitive substring match and returns every match, since notable names repeat across the tree.',
    inputSchema: {
      id: z.number().int().optional().describe('Node id.'),
      name: z.string().optional().describe('Node name or fragment, e.g. "Gathering Winds".'),
      limit: z.number().int().min(1).max(50).optional().describe('Maximum matches for a name search. Default 10.'),
    },
    annotations: READ_ONLY,
    handler: (args) => {
      const tree = passiveTree()
      const describe = (id: number) => {
        const node = tree.node(id)
        if (!node) return null
        return {
          id: node.id,
          name: node.name,
          kind: Object.entries(NODE_KIND).find(([, v]) => v === node.kind)?.[0] ?? 'normal',
          stats: node.stats,
          ascendancy: node.ascendancy,
          neighbours: tree.neighbours(node.id).map((n) => ({ id: n, name: tree.node(n)?.name ?? '' })),
        }
      }

      if (typeof args.id === 'number') {
        const node = describe(args.id)
        if (!node) throw new Error(`No passive node with id ${args.id} in the tree data (${tree.size} nodes).`)
        return node
      }

      const name = String(args.name ?? '').trim().toLowerCase()
      if (!name) throw new Error('Provide either an id or a name.')
      const matches = [...tree.allNodes()].filter((n) => n.name.toLowerCase().includes(name))
      const { items, total, truncated } = truncate(matches, Number(args.limit ?? 10))
      return { query: args.name, total, truncated, matches: items.map((n) => describe(n.id)) }
    },
  },

  {
    name: 'poe2_find_path_to_node',
    title: 'Find the cheapest path to a node',
    description:
      'Shortest route from the loaded character’s allocated tree to a target passive node, walking unallocated ' +
      'nodes. Returns the nodes that would need allocating and the passive-point cost. Returns a zero-cost result ' +
      'when the node is already allocated, and reports unreachable rather than guessing.',
    inputSchema: {
      nodeId: z.number().int().describe('Target passive node id.'),
    },
    annotations: READ_ONLY,
    handler: (args) => {
      const { analysis } = requireCharacter()
      const tree = passiveTree()
      const target = Number(args.nodeId)
      const node = tree.node(target)
      if (!node) throw new Error(`No passive node with id ${target} in the tree data.`)

      const result = pathToNode(tree, analysis.passives.live, target)
      if (!result) {
        return {
          target: { id: node.id, name: node.name },
          reachable: false,
          note: 'No route exists from the allocated tree to this node in the available data. Ascendancy wheels are reached through the class node and are not always linked in this data set.',
        }
      }
      return {
        target: { id: node.id, name: node.name, stats: node.stats },
        reachable: true,
        alreadyAllocated: result.cost === 0,
        cost: result.cost,
        path: result.path.map((n) => ({ id: n.id, name: n.name, stats: n.stats })),
      }
    },
  },

  {
    name: 'poe2_get_skill_setups',
    title: 'Get skill and support gem setups',
    description:
      'Every skill setup on the loaded character with its support gems, each support’s own tags, its category and ' +
      'the stats it grants — all read from the character payload rather than a gem database.',
    inputSchema: {
      skill: z.string().optional().describe('Restrict to one active skill by name.'),
    },
    annotations: READ_ONLY,
    handler: (args) => {
      const { setups } = requireCharacter()
      const wanted = args.skill ? String(args.skill).toLowerCase() : null
      const filtered = wanted ? setups.filter((s) => (s.skill ?? '').toLowerCase() === wanted) : setups
      if (wanted && !filtered.length) {
        throw new Error(
          `No setup for "${args.skill}". Available: ${setups.map((s) => s.skill).filter(Boolean).join(', ')}.`,
        )
      }
      return { setups: filtered }
    },
  },

  {
    name: 'poe2_validate_support_gems',
    title: 'Validate a support gem combination',
    description:
      'Check a set of support gems against a skill. Reports two things, both grounded in the payload rather than ' +
      'inferred: support gems sharing a category, which the game forbids within one skill, and supports whose tags ' +
      'share nothing with the skill so they have nothing to act on. Gem definitions come from the loaded character, ' +
      'so unknown gem names are reported as unknown rather than assumed valid. Validates the character’s own setups ' +
      'when no arguments are given.',
    inputSchema: {
      skill: z.string().optional().describe('Active skill name. Omit to validate every setup on the character.'),
      supports: z.array(z.string()).optional().describe('Support gem names to check against that skill.'),
    },
    annotations: READ_ONLY,
    handler: (args) => {
      const { setups, supports: known } = requireCharacter()

      if (!args.skill) {
        return {
          setups: setups.filter((s) => s.skill).map((s) => validateSetup(s)),
          note: 'Validated the character’s existing setups. Pass skill and supports to test a hypothetical combination.',
        }
      }

      const skill = String(args.skill)
      const setup = setups.find((s) => (s.skill ?? '').toLowerCase() === skill.toLowerCase())
      if (!setup) {
        throw new Error(
          `"${skill}" is not a skill on the loaded character, so its tags are unknown and nothing can be checked against it. ` +
            `Available: ${setups.map((s) => s.skill).filter(Boolean).join(', ')}.`,
        )
      }

      const names = Array.isArray(args.supports) ? (args.supports as string[]) : setup.supports.map((s) => s.name)
      const { validation, unknown } = validateByName(known, skill, setup.skillTags, names)
      return {
        ...validation,
        unknownGems: unknown,
        unknownNote: unknown.length
          ? `${unknown.join(', ')} are not among the gem definitions on this character, so they were not checked.`
          : null,
      }
    },
  },

  {
    name: 'poe2_import_pob',
    title: 'Import a Path of Building code',
    description:
      'Decode a Path of Building export code and return the build level, class and Path of Building’s own computed ' +
      'stats. Those stats are an independent second opinion on poe.ninja’s numbers — where the two agree, both are ' +
      'trustworthy; where they disagree, that is worth knowing.',
    inputSchema: {
      code: z.string().describe('A Path of Building export code (base64url + zlib).'),
    },
    annotations: READ_ONLY,
    handler: async (args) => {
      const xml = await decodePobExport(String(args.code))
      const stats = readPlayerStats(xml)
      return {
        playerStats: stats,
        statCount: Object.keys(stats).length,
        headline: {
          totalDps: stats.TotalDPS ?? null,
          life: stats.Life ?? null,
          energyShield: stats.EnergyShield ?? null,
        },
      }
    },
  },

  {
    name: 'poe2_get_pob_code',
    title: 'Get the character’s Path of Building code',
    description:
      'Return the Path of Building export code poe.ninja embeds for the loaded character, ready to paste into Path ' +
      'of Building, along with the stats it carries.',
    inputSchema: {},
    annotations: READ_ONLY,
    handler: async () => {
      const { model, analysis } = requireCharacter()
      const code = model.pathOfBuildingExport
      if (!code) {
        return { code: null, note: 'poe.ninja did not attach a Path of Building export to this character.' }
      }
      return { code, playerStats: analysis.pobStats, length: code.length }
    },
  },

  {
    name: 'poe2_cross_validate',
    title: 'Cross-validate poe.ninja against Path of Building',
    description:
      'Compare poe.ninja’s computed stats against Path of Building’s own engine and against poe.ninja’s own ' +
      'breakdown arithmetic. Disagreements are flagged rather than resolved — silently preferring one source is how ' +
      'a wrong number ships looking confident. Stats that cannot be verified are listed as such.',
    inputSchema: {},
    annotations: READ_ONLY,
    handler: () => {
      const { analysis } = requireCharacter()
      if (!analysis.reconciliation) {
        return {
          available: false,
          note: 'This character has no Path of Building export attached, so poe.ninja’s figures cannot be cross-checked against a second engine.',
        }
      }
      const r = analysis.reconciliation
      return {
        available: true,
        summary: { agree: r.matches, minor: r.minor, major: r.major, unverifiable: r.unresolved },
        disagreements: r.checks.filter((c) => c.severity === 'major' || c.severity === 'minor'),
        unverifiable: r.checks.filter((c) => c.severity === 'unresolved'),
      }
    },
  },

  {
    name: 'poe2_explain_mechanic',
    title: 'Explain a PoE2 mechanic',
    description:
      'Explain a Path of Exile 2 mechanic, with the basis for each claim stated so it can be weighed. Covers armour, ' +
      'mitigation order, chaos and energy shield, maximum hit versus effective health pool, resistance caps, block, ' +
      'energy shield recharge, evasion, weapon sets, support categories, and deflection and ward. Omit the query to ' +
      'list everything covered.',
    inputSchema: {
      query: z.string().optional().describe('Mechanic id or search term, e.g. "armour" or "chaos".'),
    },
    annotations: READ_ONLY,
    handler: (args) => {
      const matches = findMechanicSafe(String(args.query ?? ''))
      if (!matches.length) {
        throw new Error(
          `Nothing covered for "${args.query}". This reference deliberately omits mechanics that have not been verified.`,
        )
      }
      return { matches }
    },
  },

  {
    name: 'poe2_health_check',
    title: 'Check server health',
    description:
      'Report which data sets are loaded, whether a character is active, and whether poe.ninja is reachable. Use ' +
      'this to distinguish a configuration problem from a genuinely empty result.',
    inputSchema: {
      checkNetwork: z.boolean().optional().describe('Also probe poe.ninja. Default false.'),
    },
    annotations: READ_ONLY_NETWORK,
    handler: async (args) => {
      const loaded = loadedCharacter()
      let tree: { nodes: number; edges: number } | { error: string }
      try {
        const t = passiveTree()
        tree = { nodes: t.size, edges: [...t.edgePairs()].length }
      } catch (err) {
        tree = { error: (err as Error).message }
      }

      let network: string | null = null
      if (args.checkNetwork) {
        try {
          const res = await fetch('https://poe.ninja/poe2/api/data/index-state')
          network = res.ok ? 'reachable' : `poe.ninja returned ${res.status}`
        } catch (err) {
          network = `unreachable: ${(err as Error).message}`
        }
      }

      return {
        toolCount: TOOLS.length,
        passiveTree: tree,
        character: loaded
          ? { loaded: true, name: loaded.analysis.identity.name, level: loaded.analysis.identity.level, source: loaded.source }
          : { loaded: false },
        poeNinja: network,
      }
    },
  },
]

function summarize(loaded: ReturnType<typeof loadedCharacter> extends null ? never : NonNullable<ReturnType<typeof loadedCharacter>>) {
  const { analysis } = loaded
  return {
    identity: analysis.identity,
    survivability: {
      lowestMaximumHit: analysis.defense.lowestMaximumHit,
      lowestMaximumHitType: analysis.defense.lowestMaximumHitType,
      effectiveHealthPool: analysis.defense.effectiveHealthPool,
    },
    primarySkill: analysis.dps.primary
      ? { name: analysis.dps.primary.name, dps: analysis.dps.primary.dps }
      : null,
    findingCount: analysis.recommendations.recommendations.length,
    crossValidated: analysis.pobStats !== null,
    warnings: analysis.warnings,
    source: loaded.source,
  }
}
