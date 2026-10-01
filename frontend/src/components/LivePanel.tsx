import { useMemo, useState } from 'react'
import type { LiveGameView } from '../api/liveStore.ts'
import { resolveSessionCountry } from '../domain/countries.ts'
import { globalPercentages, liveStatus } from '../domain/dashboard.ts'
import { formatPercent } from '../domain/format.ts'
import { aggregateCountries } from '../domain/metrics.ts'
import { CountryOverview } from './CountryOverview.tsx'
import { CountryGrid } from './CountryGrid.tsx'
import { CountrySelector } from './CountrySelector.tsx'
import { CountryInfectionHistory } from './CountryInfectionHistory.tsx'
import { OutbreakTimeline } from './OutbreakTimeline.tsx'
import { CureProgress } from './CureProgress.tsx'
import { EmptyState } from './EmptyState.tsx'
import { MetricCard } from './MetricCard.tsx'
import { SessionSummary } from './SessionSummary.tsx'
import { ZombieHordeMovements } from './ZombieHordeMovements.tsx'

export function LivePanel({ live }: { live: LiveGameView }) {
  const [preferredCountryId, setPreferredCountryId] = useState<string | null>(null)
  const snapshot = live.snapshot
  const metrics = useMemo(() => snapshot ? aggregateCountries(snapshot.countries) : null, [snapshot])
  const status = liveStatus(live.connectionState)

  if (live.connectionState !== 'live' || !snapshot || !metrics) {
    const tone = status.tone === 'offline' ? 'error' : 'waiting'
    return <div className="dashboard-view"><EmptyState title={status.label} detail={status.description} tone={tone} /></div>
  }

  const percentages = globalPercentages(metrics)
  const catalog = snapshot.countries.map(({ id, index }) => ({ id, index }))
  const countryId = resolveSessionCountry(catalog, preferredCountryId)
  const country = snapshot.countries.find((item) => item.id === countryId) ?? null

  return <div className="dashboard-view" aria-label="Live game dashboard">
    <div className="view-heading"><div><span className="eyebrow">REAL-TIME MONITORING</span>
      <h1>Live outbreak overview</h1></div><span className="view-note">Current game state</span></div>
    <SessionSummary sessionId={live.sessionId} items={[
      { label: 'DAY', value: snapshot.day },
      { label: 'GAME DATE', value: snapshot.gameDate },
      { label: 'CURE', value: formatPercent(snapshot.cureProgress) },
    ]} />
    <CureProgress value={snapshot.cureProgress} />
    <section className="kpi-section" aria-label="Global population metrics">
      <div className="section-title"><div><span className="eyebrow">GLOBAL STATUS</span><h2>Population</h2></div>
        <span>Updated from the latest game snapshot</span></div>
      <div className="kpi-grid">
        <MetricCard label="Healthy" value={metrics.healthy} percent={percentages.healthy} tone="healthy" />
        <MetricCard label="Infected" value={metrics.infected} percent={percentages.infected} tone="infected" />
        <MetricCard label="Dead" value={metrics.dead} percent={percentages.dead} tone="dead" />
        <MetricCard label="Zombies" value={metrics.zombies} percent={percentages.zombies}
          tone="zombies" quiet={metrics.zombies === 0} />
      </div>
    </section>
    <OutbreakTimeline snapshot={snapshot} />
    <CountryInfectionHistory events={snapshot.countryInfectionEvents} anchor={snapshot} />
    <ZombieHordeMovements events={snapshot.zombieHordeEvents} anchor={snapshot} />
    <CountryGrid countries={snapshot.countries} anchor={snapshot} />
    <div className="country-layout">
      <section className="surface country-pick-panel" aria-label="Choose live country">
        <div className="panel-heading"><div><span className="eyebrow">COUNTRY</span><h2>Explore the map data</h2></div></div>
        <CountrySelector countries={catalog} selectedId={countryId} onChange={setPreferredCountryId}
          controlId="live-country" />
      </section>
      {country && countryId ? <CountryOverview id={countryId} country={country} context={`Day ${snapshot.day} · live`} />
        : <EmptyState title="No country data" detail="Countries will appear when the game provides them." />}
    </div>
    <p className="scope-note">Charts use saved daily observations and are available in HISTORY. Live monitoring keeps only the latest snapshot.</p>
  </div>
}
