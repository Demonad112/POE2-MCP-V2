'use client'

import { useCallback, useState } from 'react'
import { analyzeCharacter, type Analysis } from '@poe2/core'
import { DefensePanel } from '@/components/DefensePanel'
import { DpsMatrix } from '@/components/DpsMatrix'
import { GearDetail } from '@/components/GearDetail'
import { GearPanel } from '@/components/GearPanel'
import { Headroom } from '@/components/Headroom'
import { ImportBar, type ImportResult } from '@/components/ImportBar'
import { Reconciliation } from '@/components/Reconciliation'
import { Recommendations } from '@/components/Recommendations'
import { Skeleton } from '@/components/Skeleton'
import { TreePanel } from '@/components/tree/TreePanel'
import { Tag } from '@/components/ui'

/**
 * Stats the analysis found the build short on, worst first.
 *
 * Only genuine shortfalls: a resistance below its cap, and the damage type with
 * the lowest maximum hit when it is meaningfully thinner than the rest. Offering
 * routes for a stat that is already fine would be noise dressed as advice.
 */
function weakStatsFrom(analysis: Analysis) {
  const out: Array<{ key: string; label: string; shortfall: string }> = []

  for (const res of analysis.defense.resistances) {
    if (res.underCap <= 0) continue
    out.push({
      key: `${res.type}Resistance`,
      label: `${res.type[0]!.toUpperCase()}${res.type.slice(1)} res`,
      shortfall: `−${res.underCap}%`,
    })
  }
  // Largest gap first.
  out.sort((a, b) => Number(b.shortfall.replace(/\D/g, '')) - Number(a.shortfall.replace(/\D/g, '')))

  const lowest = analysis.defense.maxHits[0]
  if (lowest && lowest.ratioToHighest >= 1.5 && analysis.defense.life > 0) {
    out.push({ key: 'life', label: 'Life', shortfall: `${lowest.type} is thinnest` })
  }
  return out
}

export default function Home() {
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleResult = useCallback(async (r: ImportResult) => {
    if (!r.ok) {
      setError(r.error)
      return
    }
    setError(null)
    setBusy(true)
    try {
      setAnalysis(await analyzeCharacter(r.data))
    } catch (err) {
      setError(`Could not analyse that data: ${(err as Error).message}`)
      setAnalysis(null)
    } finally {
      setBusy(false)
    }
  }, [])

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">PoE2 Build Analyzer</h1>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-dim">
          Reads poe.ninja&rsquo;s own computed character data and turns it into ranked, quantified findings. Nothing
          here is re-derived from scratch, and nothing is invented — where a number can&rsquo;t be established, it says
          so.
        </p>
      </header>

      <ImportBar onResult={handleResult} busy={busy} setBusy={setBusy} />

      {error ? (
        <p role="alert" className="mt-4 rounded-lg border border-danger/40 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <main id="main" className="mt-6">
        {busy ? <Skeleton /> : null}

        {!busy && !analysis ? (
          <div className="rounded-xl border border-dashed border-line px-6 py-14 text-center">
            <p className="text-sm text-ink-dim">Import a character to see its analysis.</p>
            <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-ink-mute">
              Survivability is led by the smallest hit that kills, not by an averaged effective health pool — which on
              a typical character overstates safety by three times or more.
            </p>
          </div>
        ) : null}

        {!busy && analysis ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-lg font-semibold text-ink">{analysis.identity.name}</h2>
              <span className="text-sm text-ink-dim">
                Level {analysis.identity.level} {analysis.identity.className}
              </span>
              {analysis.identity.league ? <Tag>{analysis.identity.league}</Tag> : null}
              {analysis.pobStats ? <Tag tone="good">cross-validated</Tag> : null}
            </div>

            {analysis.warnings.map((w) => (
              <p key={w} className="rounded-lg border border-warn/40 px-4 py-3 text-xs leading-relaxed text-warn">
                {w}
              </p>
            ))}

            <Recommendations report={analysis.recommendations} />

            <div className="grid gap-4 lg:grid-cols-2">
              <DefensePanel d={analysis.defense} />
              <GearPanel items={analysis.items} passives={analysis.passives} />
              <Headroom defense={analysis.defense} />
            </div>

            <DpsMatrix dps={analysis.dps} />

            <GearDetail items={analysis.items} defense={analysis.defense} />

            <TreePanel allocation={analysis.passives} weakStats={weakStatsFrom(analysis)} />

            {analysis.reconciliation ? <Reconciliation report={analysis.reconciliation} /> : null}
          </div>
        ) : null}
      </main>

      <footer className="mt-12 border-t border-line pt-5 text-[11px] leading-relaxed text-ink-mute">
        Character data from poe.ninja. Path of Exile 2 is a trademark of Grinding Gear Games; this is an unofficial
        fan-made tool.
      </footer>
    </div>
  )
}
