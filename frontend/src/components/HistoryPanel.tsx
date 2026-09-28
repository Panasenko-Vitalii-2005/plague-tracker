import { lazy, memo, Suspense, useState } from 'react'
import type { CountryHistoryResponse, SessionCountriesResponse, SessionDetails, SessionHistoryResponse, SessionSummary as SessionSummaryData } from '../api/types.ts'
import { formatCountryName, resolveSessionCountry } from '../domain/countries.ts'
import { globalPercentages } from '../domain/dashboard.ts'
import { aggregateCountries } from '../domain/metrics.ts'
import { formatPercent, formatPopulation } from '../domain/format.ts'
import { useCountryHistory, useSession, useSessionCountries, useSessionHistory, useSessions,
  type Resource } from '../hooks/useHistory.ts'
import { useReplay, type HistoricalReplay } from '../hooks/useReplay.ts'
import { CountryOverview } from './CountryOverview.tsx'
import { CountryGrid } from './CountryGrid.tsx'
import { CountrySelector } from './CountrySelector.tsx'
import { CureProgress } from './CureProgress.tsx'
import { EmptyState } from './EmptyState.tsx'
import { MetricCard } from './MetricCard.tsx'
import { SessionSummary } from './SessionSummary.tsx'
import { ZombieHordeMovements } from './ZombieHordeMovements.tsx'

const HistoryChart = lazy(() => import('./HistoryChart.tsx').then((module) => ({ default: module.HistoryChart })))
const CountryHistoryChart = lazy(() => import('./CountryHistoryChart.tsx')
  .then((module) => ({ default: module.CountryHistoryChart })))

export const HistoryPanel = memo(function HistoryPanel() {
  const sessions = useSessions()
  const [sessionId, setSessionId] = useState('')
  const [preferredCountryId, setPreferredCountryId] = useState<string | null>(null)
  const session = useSession(sessionId || null)
  const global = useSessionHistory(sessionId || null)
  const replay = useReplay(sessionId, global)
  const countries = useSessionCountries(sessionId || null)
  const availableCountries = countries.status === 'success' ? countries.data.countries : []
  const countryId = countries.status === 'success'
    ? resolveSessionCountry(availableCountries, preferredCountryId) : null
  const country = useCountryHistory(sessionId || null, countryId)
  return <HistoryDashboard sessions={sessions} session={session} global={global} countries={countries}
    country={country} replay={replay} sessionId={sessionId} onSessionChange={(id) => { replay.reset(); setSessionId(id) }}
    preferredCountryId={preferredCountryId} onCountryChange={setPreferredCountryId} />
})

export function HistoryDashboard({ sessions, session, global, countries, country, replay, sessionId,
  onSessionChange, preferredCountryId, onCountryChange }: {
  sessions: Resource<SessionSummaryData[]>
  session: Resource<SessionDetails>
  global: Resource<SessionHistoryResponse>
  countries: Resource<SessionCountriesResponse>
  country: Resource<CountryHistoryResponse>
  replay: HistoricalReplay
  sessionId: string
  onSessionChange(id: string): void
  preferredCountryId: string | null
  onCountryChange(id: string): void
}) {
  const availableCountries = countries.status === 'success' ? countries.data.countries : []
  const countryId = countries.status === 'success'
    ? resolveSessionCountry(availableCountries, preferredCountryId) : null
  const selectedSummary = (sessions.status === 'success' || sessions.status === 'empty')
    ? sessions.data.find((item) => item.id === sessionId) : null
  const sessionData = session.status === 'success' ? session.data.session : selectedSummary
  const dateRange = session.status === 'success' ? session.data.range : selectedSummary
  const history = global.status === 'success' ? global.data.history : []
  const snapshot = replay.snapshot.status === 'success' ? replay.snapshot.data : null
  const metrics = snapshot ? aggregateCountries(snapshot.countries) : null
  const percentages = metrics ? globalPercentages(metrics) : null
  const countryHistory = country.status === 'success' ? country.data.history : []
  const selectedCountry = snapshot?.countries.find((item) => item.id === countryId) ?? null

  return <div className="dashboard-view" aria-label="Saved history dashboard">
    <div className="view-heading"><div><span className="eyebrow">RECORDED GAME DATA</span>
      <h1>Session history</h1></div><span className="view-note">Only observed days are shown</span></div>
    <section className="surface history-toolbar" aria-label="Choose historical session">
      <div><label htmlFor="history-session">Saved session</label>
        <select id="history-session" value={sessionId} onChange={(event) => onSessionChange(event.target.value)}
          disabled={sessions.status !== 'success'}>
          <option value="">Choose a session</option>
          {sessions.status === 'success' && sessions.data.map((item) => <option key={item.id} value={item.id}>
            Day {item.firstDay}–{item.lastDay} · {item.snapshotCount} days · {item.id.slice(0, 8)}
          </option>)}
        </select></div>
      <div className="toolbar-actions">
        {sessionData && <span className={`session-state ${sessionData.endedAt === null ? 'is-open' : ''}`}>
          {sessionData.endedAt === null ? 'Open session' : 'Finished session'}</span>}
        <button type="button" className="secondary-button" onClick={sessions.reload}>Refresh sessions</button>
      </div>
    </section>

    {sessions.status === 'loading' && <EmptyState title="Loading sessions" detail="Reading saved game history…" />}
    {sessions.status === 'error' && <EmptyState title="History unavailable" detail={sessions.error.message} tone="error" />}
    {sessions.status === 'empty' && <EmptyState title="No saved sessions"
      detail="Recorded game days will appear here after a session has been tracked." />}
    {sessions.status === 'success' && !sessionId && <EmptyState title="Choose a saved session"
      detail="Select a session above to explore its global and country history." />}

    {sessionId && <>
      {session.status === 'error' && <EmptyState title="Session unavailable" detail={session.error.message} tone="error" />}
      {sessionData && <SessionSummary sessionId={sessionId} items={[
        { label: 'FIRST DAY', value: sessionData.firstDay },
        { label: 'LAST DAY', value: sessionData.lastDay },
        { label: 'RECORDED DAYS', value: sessionData.snapshotCount },
        { label: 'DATE RANGE', value: dateRange?.lastGameDate ?? '—',
          detail: dateRange?.firstGameDate ? `From ${dateRange.firstGameDate}` : 'No saved dates' },
      ]} />}

      {global.status === 'loading' && <EmptyState title="Loading global history" detail="Reading observed days…" />}
      {global.status === 'error' && <EmptyState title="Global history unavailable" detail={global.error.message} tone="error" />}
      {global.status === 'empty' && <EmptyState title="No recorded days"
        detail="This session exists, but no daily snapshots have been saved yet." />}
      {replay.day !== null && <section className="surface replay-panel" aria-label="Historical replay timeline">
        <div className="panel-heading"><div><span className="eyebrow">HISTORICAL REPLAY</span>
          <h2>Day {replay.day}</h2></div><span className="panel-meta">
            Observation {replay.index + 1} of {replay.days.length}</span></div>
        <div className="replay-controls">
          <button type="button" className="secondary-button" onClick={replay.previous}
            disabled={replay.index <= 0}>Previous</button>
          <button type="button" className="secondary-button" onClick={replay.togglePlay}
            disabled={replay.days.length < 2}>{replay.isPlaying ? 'Pause' : 'Play'}</button>
          <button type="button" className="secondary-button" onClick={replay.next}
            disabled={replay.index >= replay.days.length - 1}>Next</button>
          <label htmlFor="history-timeline">Observed day</label>
          <input id="history-timeline" type="range" min={0} max={replay.days.length - 1}
            value={replay.index} onChange={(event) => replay.selectIndex(Number(event.target.value))}
            aria-valuetext={`Day ${replay.day}`} />
        </div>
      </section>}
      {replay.day !== null && replay.snapshot.status === 'loading' && <EmptyState title={`Loading day ${replay.day}`}
        detail="Reading the saved world snapshot…" />}
      {replay.day !== null && replay.snapshot.status === 'error' && <div className="replay-error">
        <EmptyState title={`Day ${replay.day} unavailable`} detail={replay.snapshot.error.message} tone="error" />
        <button type="button" className="secondary-button" onClick={replay.snapshot.reload}>Retry day</button>
      </div>}
      {snapshot && metrics && <>
        <SessionSummary sessionId={sessionId} items={[
          { label: 'SELECTED DAY', value: snapshot.day },
          { label: 'GAME DATE', value: snapshot.gameDate },
          { label: 'CURE', value: formatPercent(snapshot.cureProgress) },
          { label: 'ORIGINAL POPULATION', value: formatPopulation(metrics.originalPopulation) },
        ]} />
        <CureProgress value={snapshot.cureProgress} />
        <section className="kpi-section" aria-label="Selected historical global metrics">
          <div className="section-title"><div><span className="eyebrow">SELECTED DAY · {snapshot.day}</span>
            <h2>Population</h2></div><span>{snapshot.gameDate}</span></div>
          <div className="kpi-grid">
            <MetricCard label="Healthy" value={metrics.healthy} percent={percentages?.healthy} tone="healthy" />
            <MetricCard label="Infected" value={metrics.infected} percent={percentages?.infected} tone="infected" />
            <MetricCard label="Dead" value={metrics.dead} percent={percentages?.dead} tone="dead" />
            <MetricCard label="Zombies" value={metrics.zombies} percent={percentages?.zombies}
              tone="zombies" quiet={metrics.zombies === 0} />
          </div>
        </section>
        <ZombieHordeMovements events={snapshot.zombieHordeEvents}
          datesByDay={new Map(history.map((point) => [point.day, point.gameDate]))} />
        <CountryGrid countries={snapshot.countries} />
      </>}
      {history.length > 0 && <>
        <section className="surface chart-panel" aria-label="Global history chart panel">
          <div className="panel-heading"><div><span className="eyebrow">GLOBAL HISTORY</span>
            <h2>Population over time</h2></div><span className="panel-meta">{history.length} observed days · game day axis</span></div>
          <Suspense fallback={<div className="chart-loading">Loading chart…</div>}>
            <HistoryChart history={history} selectedDay={replay.day} />
          </Suspense>
        </section>
        <details className="surface observations"><summary>Recent daily observations</summary>
          <div className="table-wrap"><table><thead><tr><th>Day</th><th>Date</th><th>Healthy</th>
            <th>Infected</th><th>Dead</th><th>Cure</th></tr></thead><tbody>
            {history.slice(-8).map((point) => <tr key={point.day}><td>{point.day}</td><td>{point.gameDate}</td>
              <td>{formatPopulation(point.healthy)}</td><td>{formatPopulation(point.infected)}</td>
              <td>{formatPopulation(point.dead)}</td><td>{formatPercent(point.cureProgress)}</td></tr>)}
          </tbody></table></div>
        </details>
      </>}

      <div className="country-layout">
        <section className="surface country-pick-panel" aria-label="Choose historical country">
          <div className="panel-heading"><div><span className="eyebrow">COUNTRY</span>
            <h2>Explore a country</h2></div></div>
          {countries.status === 'loading' && <p className="inline-state">Loading countries…</p>}
          {countries.status === 'error' && <p className="inline-state error-text" role="alert">{countries.error.message}</p>}
          {countries.status === 'empty' && <p className="inline-state">No country data available.</p>}
          {countries.status === 'success' && <CountrySelector key={sessionId} countries={availableCountries}
            selectedId={countryId} onChange={onCountryChange} controlId="history-country" />}
        </section>
        {snapshot && countryId && selectedCountry && <CountryOverview id={countryId} country={selectedCountry}
          context={`Saved day ${snapshot.day} · ${snapshot.gameDate}`} />}
        {snapshot && countryId && !selectedCountry && <EmptyState title="No country data on this day"
          detail={`${formatCountryName(countryId)} is absent from this saved snapshot.`} />}
        {replay.snapshot.status === 'loading' && <EmptyState title="Loading country state"
          detail="Reading the selected day…" />}
        {countries.status === 'success' && !countryId && <EmptyState title="Choose a country"
          detail="Select a country to see its saved state and history." />}
      </div>
      {country.status === 'loading' && <p className="inline-state">Loading country history…</p>}
      {country.status === 'error' && <p className="inline-state error-text" role="alert">{country.error.message}</p>}
      {countryHistory.length > 0 && countryId && <section className="surface chart-panel" aria-label="Country history chart panel">
        <div className="panel-heading"><div><span className="eyebrow">COUNTRY HISTORY</span>
          <h2>Spread in {formatCountryName(countryId)}</h2></div>
          <span className="panel-meta">{countryHistory.length} observed days · game day axis</span></div>
        <Suspense fallback={<div className="chart-loading">Loading chart…</div>}>
          <CountryHistoryChart history={countryHistory} selectedDay={replay.day} />
        </Suspense>
      </section>}
    </>}
  </div>
}
