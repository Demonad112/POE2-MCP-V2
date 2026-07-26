/**
 * Single import surface for everything the tools use.
 *
 * Keeps tools.ts free of import noise, and makes the boundary explicit: if
 * something is not re-exported here, the tool layer is not reaching into it.
 */

export {
  NODE_KIND,
  PobBridge,
  PobBridgeError,
  decodePobExport,
  editPobTree,
  parseProfileUrl,
  pathToNode,
  readPlayerStats,
  resolveAllocation,
  simulateCustomMods,
  simulatePassiveNode,
  statSources,
  suggestNodesForStat,
  supportedStats,
  validateByName,
  validateSetup,
} from '@poe2/core'

import { findMechanic, type Mechanic } from './mechanics.js'

/** Empty query lists everything rather than erroring. */
export function findMechanicSafe(query: string): Mechanic[] {
  return findMechanic(query)
}
