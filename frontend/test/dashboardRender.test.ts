import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer, type ViteDevServer } from 'vite'
import type { LiveGameView } from '../src/api/liveStore.ts'
import type { CountryHistoryResponse, HistoricalSnapshot, SessionCountriesResponse, SessionDetails,
  SessionHistoryResponse, SessionSummary } from '../src/api/types.ts'
import type { Resource } from '../src/hooks/useHistory.ts'
import type { HistoricalReplay } from '../src/hooks/useReplay.ts'

let server: ViteDevServer
let MetricCard: typeof import('../src/components/MetricCard.tsx').MetricCard
let CureProgress: typeof import('../src/components/CureProgress.tsx').CureProgress
let LivePanel: typeof import('../src/components/LivePanel.tsx').LivePanel
let HistoryDashboard: typeof import('../src/components/HistoryPanel.tsx').HistoryDashboard

before(async () => {
  server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom' })
  MetricCard = (await server.ssrLoadModule('/src/components/MetricCard.tsx')).MetricCard
  CureProgress = (await server.ssrLoadModule('/src/components/CureProgress.tsx')).CureProgress
  LivePanel = (await server.ssrLoadModule('/src/components/LivePanel.tsx')).LivePanel
  HistoryDashboard = (await server.ssrLoadModule('/src/components/HistoryPanel.tsx')).HistoryDashboard
})
after(async () => { await server?.close() })

const loaded = <T>(data: T): Resource<T> => ({ status: 'success', data, error: null, reload: () => {} })
const idle = <T>(): Resource<T> => ({ status: 'idle', data: null, error: null, reload: () => {} })
const replay = (snapshot: HistoricalSnapshot | null, day: number | null): HistoricalReplay => ({
  days: [10, 13], day, index: day === 10 ? 0 : 1,
  snapshot: snapshot ? loaded(snapshot) : idle(), isPlaying: false,
  selectIndex: () => {}, previous: () => {}, next: () => {}, togglePlay: () => {}, reset: () => {},
})

test('metric card and cure indicator format only their presentation', () => {
  const card = renderToStaticMarkup(createElement(MetricCard,
    { label: 'Infected', value: 12_300_000, percent: 25.51, tone: 'infected' }))
  assert.match(card, /12 300 000/)
  assert.match(card, /25,51% of original population/)
  const cure = renderToStaticMarkup(createElement(CureProgress, { value: 34.2769 }))
  assert.match(cure, /34,28%/)
  assert.match(cure, /value="34\.2769"/)
})

test('live panel renders waiting and backend unavailable states without data', () => {
  const base: LiveGameView = { connectionState: 'waiting-for-game', collectorStatus: { running: false, lastError: null },
    session: null, sessionId: null, snapshot: null, error: null }
  assert.match(renderToStaticMarkup(createElement(LivePanel, { live: base })), /Waiting for game/)
  assert.match(renderToStaticMarkup(createElement(LivePanel,
    { live: { ...base, connectionState: 'reconnecting' } })), /Reconnecting/)
  assert.match(renderToStaticMarkup(createElement(LivePanel,
    { live: { ...base, connectionState: 'error' } })), /Backend unavailable/)
})

test('live panel renders actual snapshot values and raw country option IDs', () => {
  const live: LiveGameView = { connectionState: 'live', collectorStatus: { running: true, lastError: null },
    session: null, sessionId: '12345678-aaaa', error: null,
    snapshot: { capturedAt: '2026-09-23T00:00:00Z', day: 184, gameDate: '2028-04-12', diseaseTurn: 200,
      eventTurn: 211, cureProgress: 34.2769, countries: [
        { index: 0, id: 'south_africa', originalPopulation: 1000, currentPopulation: 990,
          healthyPopulation: 800, infected: 170, deadPopulation: 20, zombies: 0 },
      ] } }
  const html = renderToStaticMarkup(createElement(LivePanel, { live }))
  assert.match(html, /Live outbreak overview/)
  assert.match(html, />184</)
  assert.match(html, /2028-04-12/)
  assert.match(html, /34,28%/)
  assert.match(html, /value="south_africa"/)
  assert.match(html, /South Africa/)
  assert.match(html, /17,00% of original population/)
  assert.match(html, /Original population/)
})

test('history dashboard renders saved session, global values and historical country data', () => {
  const summary: SessionSummary = { id: 'abcdef12-3456', startedAt: '2026-09-23T00:00:00Z', endedAt: null,
    firstDay: 10, lastDay: 13, snapshotCount: 2, isOpen: true, firstGameDate: '2026-01-10',
    lastGameDate: '2026-01-13' }
  const sessions = loaded([summary])
  const session = loaded<SessionDetails>({ session: summary,
    range: { firstGameDate: '2026-01-10', lastGameDate: '2026-01-13' } })
  const global = loaded<SessionHistoryResponse>({ sessionId: summary.id, history: [
    { capturedAt: '2026-09-23T00:00:00Z', day: 10, gameDate: '2026-01-10', diseaseTurn: 9,
      eventTurn: 10, cureProgress: 0, healthy: 95, infected: 5, dead: 0, zombies: 0, originalPopulation: 100 },
    { capturedAt: '2026-09-23T00:01:00Z', day: 13, gameDate: '2026-01-13', diseaseTurn: 12,
      eventTurn: 13, cureProgress: 12.3456, healthy: 70, infected: 20, dead: 10, zombies: 0,
      originalPopulation: 100 },
  ] })
  const countries = loaded<SessionCountriesResponse>({ sessionId: summary.id,
    countries: [{ id: 'morroco', index: 0 }, { id: 'south_africa', index: 1 }] })
  const country = loaded<CountryHistoryResponse>({ sessionId: summary.id, countryId: 'south_africa', history: [
    { capturedAt: '2026-09-23T00:01:00Z', day: 13, gameDate: '2026-01-13', originalPopulation: 100,
      currentPopulation: 90, healthyPopulation: 70, infected: 20, deadPopulation: 10, zombies: 0 },
  ] })
  const selected: HistoricalSnapshot = { sessionId: summary.id, capturedAt: '2026-09-23T00:01:00Z',
    day: 13, gameDate: '2026-01-13', diseaseTurn: 12, eventTurn: 13, cureProgress: 12.3456,
    countries: [{ index: 1, id: 'south_africa', originalPopulation: 100, currentPopulation: 90,
      healthyPopulation: 60, infected: 30, deadPopulation: 10, zombies: 0 }] }
  const html = renderToStaticMarkup(createElement(HistoryDashboard, { sessions, session, global, countries, country,
    replay: replay(selected, 13), sessionId: summary.id, onSessionChange: () => {},
    preferredCountryId: 'south_africa', onCountryChange: () => {} }))
  assert.match(html, /Session history/)
  assert.match(html, /Open session/)
  assert.match(html, /2026-01-13/)
  assert.match(html, /12,35%/)
  assert.match(html, /Population over time/)
  assert.match(html, /value="south_africa"/)
  assert.match(html, /Spread in South Africa/)
  assert.match(html, /Saved day 13/)
  assert.match(html, /30,00% of original population/)
  assert.match(html, /Original population/)
  assert.match(html, /Historical replay timeline/)
  assert.doesNotMatch(html, /day 11/i)

  const prior: HistoricalSnapshot = { ...selected, day: 10, gameDate: '2026-01-10', cureProgress: 2,
    countries: [{ ...selected.countries[0]!, healthyPopulation: 95, infected: 5 }] }
  const priorHtml = renderToStaticMarkup(createElement(HistoryDashboard, { sessions, session, global,
    countries, country, replay: replay(prior, 10), sessionId: summary.id, onSessionChange: () => {},
    preferredCountryId: 'south_africa', onCountryChange: () => {} }))
  assert.match(priorHtml, /Saved day 10/)
  assert.match(priorHtml, /2026-01-10/)
  assert.match(priorHtml, /2,00%/)
  assert.match(priorHtml, /5,00% of original population/)
  assert.doesNotMatch(priorHtml, /30,00% of original population/)

  const absentHtml = renderToStaticMarkup(createElement(HistoryDashboard, { sessions, session, global,
    countries, country, replay: replay({ ...selected, countries: [] }, 13), sessionId: summary.id,
    onSessionChange: () => {}, preferredCountryId: 'south_africa', onCountryChange: () => {} }))
  assert.match(absentHtml, /No country data on this day/)
})

test('history dashboard gives a distinct empty-session state', () => {
  const html = renderToStaticMarkup(createElement(HistoryDashboard, { sessions: { status: 'empty', data: [],
    error: null, reload: () => {} }, session: idle(), global: idle(), countries: idle(), country: idle(),
    replay: replay(null, null),
    sessionId: '', onSessionChange: () => {}, preferredCountryId: null, onCountryChange: () => {} }))
  assert.match(html, /No saved sessions/)
})
