'use client'

/**
 * Survivability against area level.
 *
 * The headline number this deliberately does NOT show is a map tier. No map tier
 * data exists in any source this project uses — WorldAreas carries area levels
 * for 158 maps and no tier field at all — so "you can run T12" would be invented.
 * The panel says so in the same breath as it shows what it does know, rather than
 * quietly omitting the question the reader actually has.
 */

import { useEffect, useState } from 'react'
import { analyzeContent, type DefenseSummary, type MonsterStatData } from '@poe2/core'
import { Empty, Panel } from './ui'

const DATA_URL = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/monster-stats.json`

export function Headroom({ defense }: { defense: DefenseSummary }) {
  const [data, setData] = useState<MonsterStatData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(DATA_URL)
      .then(async (res) => {
        if (!res.ok) throw new Error(`returned ${res.status}`)
        return (await res.json()) as MonsterStatData
      })
      .then((d) => !cancelled && setData(d))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <Panel title="Survivability by area level">
        <Empty>Could not load the monster data ({error}).</Empty>
      </Panel>
    )
  }
  if (!data) {
    return (
      <Panel title="Survivability by area level">
        <div className="h-20 animate-pulse rounded-lg bg-surface-sunken" />
      </Panel>
    )
  }

  const report = analyzeContent(defense, data)
  const max = Math.max(...report.rows.map((r) => r.headroom), 1)

  return (
    <Panel
      title="Survivability by area level"
      subtitle={
        <>
          Your smallest fatal hit is{' '}
          <span className="tabular font-semibold text-ink">{report.lowestMaximumHit.toLocaleString()}</span>{' '}
          {report.lowestMaximumHitType} damage, against base monster damage at each level.
        </>
      }
    >
      <ul className="space-y-1.5">
        {report.rows.map((row) => (
          <li key={row.areaLevel} className="grid grid-cols-[3.5rem_1fr_3rem] items-center gap-2">
            <span className="tabular text-[11px] text-ink-dim">area {row.areaLevel}</span>
            <span className="relative h-4 overflow-hidden rounded bg-surface-sunken">
              <span
                className="absolute inset-y-0 left-0 rounded bg-accent/70"
                style={{ width: `${(row.headroom / max) * 100}%` }}
              />
              {row.maps.length ? (
                <span className="absolute inset-y-0 left-1.5 flex items-center truncate text-[10px] text-ink-mute">
                  {row.maps.slice(0, 2).join(', ')}
                </span>
              ) : null}
            </span>
            <span className="tabular text-right text-[11px] font-semibold text-ink">{row.headroom}×</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-lg border border-warn/30 bg-warn/5 p-3">
        <h3 className="text-[11px] font-medium tracking-wide text-warn uppercase">Read this with the number</h3>
        <ul className="mt-1.5 space-y-1">
          {report.caveats.map((c) => (
            <li key={c} className="text-[11px] leading-relaxed text-ink-dim">
              {c}
            </li>
          ))}
        </ul>
      </div>

      {report.unresolved.map((u) => (
        <div key={u.question} className="mt-2 rounded-lg bg-surface-sunken p-3">
          <h3 className="text-[11px] font-medium text-ink-dim">{u.question}</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-mute">{u.missing}</p>
        </div>
      ))}
    </Panel>
  )
}
