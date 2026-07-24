/**
 * poe.ninja PoE2 API client.
 *
 * The core stays pure: `fetch` is INJECTED, never imported. That is what lets
 * the MCP server call poe.ninja directly (server-side, no CORS) while the web
 * app routes the same code through a proxy, with both sharing this logic.
 *
 * ## Why a proxy is needed in the browser
 * Measured 2026-07-24: poe.ninja sends NO `Access-Control-Allow-Origin` header
 * on any /poe2/api endpoint, and `OPTIONS` returns 405. A browser cannot call
 * it directly at all. Public CORS proxies additionally choke on the SSE first
 * hop because they buffer the stream.
 *
 * ## The two-step fetch
 * Every character read is: SSE endpoint -> `data: {"version":N}` -> then the
 * model endpoint at that version. The version is not guessable.
 */

import type { CharModelResponse } from '../model/types.js'
import { normalizeAccount } from './url.js'

export type FetchLike = (input: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean
  status: number
  text(): Promise<string>
  json(): Promise<unknown>
}>

export type NinjaErrorReason = 'not-found' | 'network' | 'cors' | 'bad-response' | 'timeout'

export class NinjaError extends Error {
  override name = 'NinjaError'
  constructor(
    readonly reason: NinjaErrorReason,
    message: string,
  ) {
    super(message)
  }
}

export interface NinjaClientOptions {
  fetch: FetchLike
  /**
   * Base for direct poe.ninja calls. Server-side only — a browser cannot use
   * this (no CORS).
   */
  baseUrl?: string
  /**
   * Proxy base for browser use. When set, character reads go to
   * `{proxyBaseUrl}/api/character?account=&league=&character=` and the SSE hop
   * happens server-side inside the proxy.
   */
  proxyBaseUrl?: string
  timeoutMs?: number
}

const DEFAULT_BASE = 'https://poe.ninja'
const DEFAULT_TIMEOUT = 20_000

export class NinjaClient {
  private readonly fetch: FetchLike
  private readonly baseUrl: string
  private readonly proxyBaseUrl: string | null
  private readonly timeoutMs: number

  constructor(opts: NinjaClientOptions) {
    this.fetch = opts.fetch
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '')
    this.proxyBaseUrl = opts.proxyBaseUrl ? opts.proxyBaseUrl.replace(/\/+$/, '') : null
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT
  }

  private async get(url: string): Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }> {
    const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(this.timeoutMs) : undefined
    try {
      return await this.fetch(url, signal ? { signal } : {})
    } catch (err) {
      const name = (err as { name?: string })?.name
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new NinjaError('timeout', `Request to ${url} timed out after ${this.timeoutMs}ms.`)
      }
      // A fetch that never yields a Response in a browser is almost always the
      // CORS policy, not the network.
      throw new NinjaError('cors', `Could not reach ${url}. In a browser this is poe.ninja's CORS policy; configure a proxy.`)
    }
  }

  /**
   * Read the `version` number from an SSE endpoint.
   *
   * The stream stays open indefinitely, so we read only what we need: the
   * first `data:` line carries the version and nothing after it matters.
   */
  private async readVersion(url: string): Promise<number> {
    const res = await this.get(url)
    if (res.status === 404) throw new NinjaError('not-found', 'poe.ninja has no record of that account or character.')
    if (!res.ok) throw new NinjaError('bad-response', `poe.ninja returned ${res.status} for the version stream.`)

    let body: string
    try {
      body = await res.text()
    } catch {
      throw new NinjaError('bad-response', 'The version stream ended before a version arrived.')
    }

    const line = body.split('\n').find((l) => l.startsWith('data:'))
    if (!line) throw new NinjaError('bad-response', 'The version stream carried no data frame.')

    try {
      const parsed = JSON.parse(line.slice(5).trim()) as { version?: unknown }
      if (typeof parsed.version !== 'number') {
        throw new NinjaError('not-found', 'poe.ninja returned no version — the profile may be private or unindexed.')
      }
      return parsed.version
    } catch (err) {
      if (err instanceof NinjaError) throw err
      throw new NinjaError('bad-response', 'The version frame was not valid JSON.')
    }
  }

  /** List an account's characters. Server-side only (no proxy route for this). */
  async listCharacters(account: string): Promise<unknown[]> {
    const acct = encodeURIComponent(normalizeAccount(account))
    const version = await this.readVersion(`${this.baseUrl}/poe2/api/events/characters/${acct}`)
    const res = await this.get(`${this.baseUrl}/poe2/api/profile/characters/${acct}/${version}`)
    if (!res.ok) throw new NinjaError('bad-response', `poe.ninja returned ${res.status} for the character list.`)
    const json = await res.json()
    return Array.isArray(json) ? json : []
  }

  /**
   * Fetch one character's full model.
   *
   * Uses the proxy when configured (browser), otherwise the direct two-step
   * fetch (server).
   */
  async fetchCharacter(account: string, league: string, character: string): Promise<CharModelResponse> {
    const acct = normalizeAccount(account)

    if (this.proxyBaseUrl) {
      const url =
        `${this.proxyBaseUrl}/api/character?account=${encodeURIComponent(acct)}` +
        `&league=${encodeURIComponent(league)}&character=${encodeURIComponent(character)}`
      const res = await this.get(url)
      if (res.status === 404) {
        let detail = 'Character not found — check the profile is public and the name is correct.'
        try {
          const body = (await res.json()) as { error?: unknown }
          if (typeof body?.error === 'string') detail = body.error
        } catch {
          /* non-JSON body; keep the default */
        }
        throw new NinjaError('not-found', detail)
      }
      if (!res.ok) throw new NinjaError('bad-response', `The import service returned ${res.status}.`)
      return (await res.json()) as CharModelResponse
    }

    const e = (s: string) => encodeURIComponent(s)
    const version = await this.readVersion(
      `${this.baseUrl}/poe2/api/events/character/${e(acct)}/${e(league)}/${e(character)}`,
    )
    const res = await this.get(
      `${this.baseUrl}/poe2/api/profile/characters/${e(acct)}/${e(league)}/${e(character)}/model/${version}`,
    )
    if (!res.ok) throw new NinjaError('bad-response', `poe.ninja returned ${res.status} for the character model.`)
    return (await res.json()) as CharModelResponse
  }
}
