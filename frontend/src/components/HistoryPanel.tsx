import { lazy, memo, Suspense, useState } from 'react'
import type { CountryHistoryResponse, SessionCountriesResponse, SessionDetails, SessionHistoryResponse, SessionSummary as SessionSummaryData } from '../api/types.ts'
import { formatCountryName, resolveSessionCountry } from '../domain/countries.ts'
import { globalPercentages } from '../domain/dashboard.ts'
import { formatPercent, formatPopulation } from '../domain/format.ts'
import { useCountryHistory, useSession, useSessionCountries, useSessionHistory, useSessions,
  type Resource } from '../hooks/useHistory.ts'
import { CountryOverview } from './CountryOverview.tsx'
import { CountrySelector } from './CountrySelector.tsx'
import { CureProgress } from './CureProgress.tsx'
import { EmptyState } from './EmptyState.tsx'
import { MetricCard } from './MetricCard.tsx'
import { SessionSummary } from './SessionSummary.tsx'

const HistoryChart = lazy(() => import('./HistoryChart.tsx').then((module) => ({ default: module.HistoryChart })))
const CountryHistoryChart = lazy(() => import('./CountryHistoryChart.tsx')
  .then((module) => ({ default: module.CountryHistoryChart })))

export const HistoryPanel = memo(function HistoryPanel() {
  const sessions = useSessions()
  const [sessionId, setSessionId] = useState('')
  const [preferredCountryId, setPreferredCountryId] = useState<string | null>(null)
  const session = useSession(sessionId || null)
  const global = useSessionHistory(sessionId || null)
  const countries = useSessionCountries(sessionId || null)
  const availableCountries = countries.status === 'success' ? countries.data.countries : []
  const countryId = countries.status === 'success'
    ? resolveSessionCountry(availableCountries, preferredCountryId) : null
  const country = useCountryHistory(sessionId || null, countryId)
  return <HistoryDashboard sessions={sessions} session={session} global={global} countries={countries}
    country={country} sessionId={sessionId} onSessionChange={setSessionId}
    preferredCountryId={preferredCountryId} onCountryChange={setPreferredCountryId} />
})

export function HistoryDashboard({ sessions, session, global, countries, country, sessionId,
  onSessionChange, preferredCountryId, onCountryChange }: {
  sessions: Resource<SessionSummaryData[]>
  session: Resource<SessionDetails>
  global: Resource<SessionHistoryResponse>
  countries: Resource<SessionCountriesResponse>
  country: Resource<CountryHistoryResponse>
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
  const latest = history.at(-1)
  const latestPercentages = latest ? globalPercentages(latest) : null
  const countryHistory = country.status === 'success' ? country.data.history : []
  const latestCountry = countryHistory.at(-1)

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
      {latest && <>
        <CureProgress value={latest.cureProgress} />
        <section className="kpi-section" aria-label="Latest recorded global metrics">
          <div className="section-title"><div><span className="eyebrow">LAST RECORDED DAY · {latest.day}</span>
            <h2>Population</h2></div><span>{latest.gameDate}</span></div>
          <div className="kpi-grid">
            <MetricCard label="Healthy" value={latest.healthy} percent={latestPercentages?.healthy} tone="healthy" />
            <MetricCard label="Infected" value={latest.infected} percent={latestPercentages?.infected} tone="infected" />
            <MetricCard label="Dead" value={latest.dead} percent={latestPercentages?.dead} tone="dead" />
            <MetricCard label="Zombies" value={latest.zombies} percent={latestPercentages?.zombies}
              tone="zombies" quiet={latest.zombies === 0} />
          </div>
        </section>
        <section className="surface chart-panel" aria-label="Global history chart panel">
          <div className="panel-heading"><div><span className="eyebrow">GLOBAL HISTORY</span>
            <h2>Population over time</h2></div><span className="panel-meta">{history.length} observed days · game day axis</span></div>
          <Suspense fallback={<div className="chart-loading">Loading chart…</div>}>
            <HistoryChart history={history} />
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
        {country.status === 'loading' && <EmptyState title="Loading country data" detail="Reading saved observations…" />}
        {country.status === 'error' && <EmptyState title="Country history unavailable" detail={country.error.message} tone="error" />}
        {country.status === 'empty' && <EmptyState title="No country data available"
          detail="No observations were saved for this country in the selected session." />}
        {latestCountry && countryId && <CountryOverview id={countryId} country={latestCountry}
          context={`Latest saved day ${latestCountry.day} · ${latestCountry.gameDate}`} />}
        {country.status === 'idle' && countries.status === 'success' && <EmptyState title="Choose a country"
          detail="Select a country to see its latest saved state and history." />}
      </div>
      {countryHistory.length > 0 && countryId && <section className="surface chart-panel" aria-label="Country history chart panel">
        <div className="panel-heading"><div><span className="eyebrow">COUNTRY HISTORY</span>
          <h2>Spread in {formatCountryName(countryId)}</h2></div>
          <span className="panel-meta">{countryHistory.length} observed days · game day axis</span></div>
        <Suspense fallback={<div className="chart-loading">Loading chart…</div>}>
          <CountryHistoryChart history={countryHistory} />
        </Suspense>
      </section>}
    </>}
  </div>
}
