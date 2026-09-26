import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer, type ViteDevServer } from 'vite'
import type { LiveGameView } from '../src/api/liveStore.ts'
import type { CountryHistoryResponse, CountrySnapshot, HistoricalSnapshot, SessionCountriesResponse, SessionDetails,
  SessionHistoryResponse, SessionSummary } from '../src/api/types.ts'
import { countryStatusComposition } from '../src/domain/countryDonut.ts'
import type { Resource } from '../src/hooks/useHistory.ts'
import type { HistoricalReplay } from '../src/hooks/useReplay.ts'

let server: ViteDevServer
let MetricCard: typeof import('../src/components/MetricCard.tsx').MetricCard
let CureProgress: typeof import('../src/components/CureProgress.tsx').CureProgress
let LivePanel: typeof import('../src/components/LivePanel.tsx').LivePanel
let HistoryDashboard: typeof import('../src/components/HistoryPanel.tsx').HistoryDashboard
let CountryGrid: typeof import('../src/components/CountryGrid.tsx').CountryGrid

before(async () => {
  server = await createServer({ root: process.cwd(), server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  MetricCard = (await server.ssrLoadModule('/src/components/MetricCard.tsx')).MetricCard
  CureProgress = (await server.ssrLoadModule('/src/components/CureProgress.tsx')).CureProgress
  LivePanel = (await server.ssrLoadModule('/src/components/LivePanel.tsx')).LivePanel
  HistoryDashboard = (await server.ssrLoadModule('/src/components/HistoryPanel.tsx')).HistoryDashboard
  CountryGrid = (await server.ssrLoadModule('/src/components/CountryGrid.tsx')).CountryGrid
})
after(async () => { await server?.close() })

const loaded = <T>(data: T): Resource<T> => ({ status: 'success', data, error: null, reload: () => {} })
const idle = <T>(): Resource<T> => ({ status: 'idle', data: null, error: null, reload: () => {} })
const replay = (snapshot: HistoricalSnapshot | null, day: number | null): HistoricalReplay => ({
  days: [10, 13], day, index: day === 10 ? 0 : 1,
  snapshot: snapshot ? loaded(snapshot) : idle(), isPlaying: false,
  selectIndex: () => {}, previous: () => {}, next: () => {}, togglePlay: () => {}, reset: () => {},
})

const countryCardFixture = (id: string, index: number,
  overrides: Partial<CountrySnapshot> = {}): CountrySnapshot => ({
  id, index, currentPopulation: 80_000_000, originalPopulation: 100_000_000,
  healthyPopulation: 20_000_000, infected: 55_000_000, zombies: 0,
  deadPopulation: 5_000_000, governmentActions: [], cureResearch: null, ...overrides,
})

test('all country cards render in index order with readable names and current population', () => {
  const input = [countryCardFixture('balcan_states', 2), countryCardFixture('soudi_arabia', 0),
    countryCardFixture('morroco', 1)]
  const html = renderToStaticMarkup(createElement(CountryGrid, { countries: input }))
  assert.equal((html.match(/class="surface country-card"/g) ?? []).length, 3)
  assert.ok(html.indexOf('Soudi Arabia country card') < html.indexOf('Morroco country card'))
  assert.ok(html.indexOf('Morroco country card') < html.indexOf('Balcan States country card'))
  assert.deepEqual(input.map((item) => item.id), ['balcan_states', 'soudi_arabia', 'morroco'])
  assert.match(html, /<dt>Population<\/dt><dd>80 000 000<\/dd>/)
  assert.match(html, /<dt>Healthy<\/dt><dd>20 000 000<\/dd>/)
  assert.match(html, /<dt>Infected<\/dt><dd>55 000 000<\/dd>/)
  assert.match(html, /<dt>Zombies<\/dt><dd>0<\/dd>/)
  assert.match(html, /<dt>Dead<\/dt><dd>5 000 000<\/dd>/)
  assert.match(html, /Recorded status mix for Soudi Arabia/)
  assert.equal((html.match(/<svg class="country-card-donut"/g) ?? []).length, 3)
})

test('all 58 observed countries are rendered without dropping or changing raw IDs', () => {
  const countries = Array.from({ length: 58 }, (_, index) => countryCardFixture(`raw_country_${index}`, index)).reverse()
  const html = renderToStaticMarkup(createElement(CountryGrid, { countries }))
  assert.equal((html.match(/class="surface country-card"/g) ?? []).length, 58)
  assert.ok(html.indexOf('Raw Country 0 country card') < html.indexOf('Raw Country 57 country card'))
  assert.deepEqual(countries.map((item) => item.id), Array.from({ length: 58 }, (_, index) => `raw_country_${57 - index}`))
})

test('donut composition uses recorded healthy/infected/dead counts without adding zombies', () => {
  const withZombies = countryCardFixture('peru', 0, { zombies: 60_000_000 })
  const composition = countryStatusComposition(withZombies)
  assert.deepEqual(composition.slices, [
    { name: 'Healthy', value: 20_000_000 },
    { name: 'Infected', value: 55_000_000 },
    { name: 'Dead', value: 5_000_000 },
  ])
  assert.equal(composition.total, 80_000_000)
  assert.equal(countryStatusComposition({ ...withZombies, zombies: 0 }).total, composition.total)
  const html = renderToStaticMarkup(createElement(CountryGrid, { countries: [withZombies] }))
  assert.equal((html.match(/stroke-dasharray=/g) ?? []).length, 3)
  assert.match(html, /Zombies are shown separately/)
})

test('empty, zero-population, long-name and large-count cards render safely', () => {
  const empty = renderToStaticMarkup(createElement(CountryGrid, { countries: [] }))
  assert.match(empty, /No countries in this snapshot/)
  const zero = renderToStaticMarkup(createElement(CountryGrid, { countries: [countryCardFixture('peru', 0, {
    currentPopulation: 0, originalPopulation: 0, healthyPopulation: 0,
    infected: 0, zombies: 0, deadPopulation: 0,
  })] }))
  assert.match(zero, /country-card-empty-donut/)
  assert.doesNotMatch(zero, /NaN|Infinity/)
  const large = renderToStaticMarkup(createElement(CountryGrid, { countries: [countryCardFixture(
    'very_long_country_name_with_several_words', 0, { currentPopulation: 1_234_567_890_123 },
  )] }))
  assert.match(large, /Very Long Country Name With Several Words/)
  assert.match(large, /1 234 567 890 123/)
})

test('country card shows formatted cure research and exactly the recorded flask states', () => {
  const research = { funding: 1564.9822, allocation: 0.2, rank: 9,
    flasks: { active: 2, inactive: 6, destroyed: 0 } }
  const html = renderToStaticMarkup(createElement(CountryGrid, { countries: [
    countryCardFixture('peru', 0, { cureResearch: research }),
  ] }))
  assert.match(html, /\$1,564\.98/)
  assert.match(html, /<dt>Allocation<\/dt><dd>20%<\/dd>/)
  assert.match(html, /<dt>Rank<\/dt><dd>#9<\/dd>/)
  assert.equal((html.match(/aria-label="Active research flask"/g) ?? []).length, 2)
  assert.equal((html.match(/aria-label="Inactive research flask"/g) ?? []).length, 6)
  assert.equal((html.match(/aria-label="Destroyed research flask"/g) ?? []).length, 0)
  assert.match(html, /Active 2 · Potential 6 · Destroyed 0/)

  const ten = renderToStaticMarkup(createElement(CountryGrid, { countries: [
    countryCardFixture('peru', 0, { cureResearch: { ...research,
      flasks: { active: 1, inactive: 7, destroyed: 2 } } }),
  ] }))
  assert.equal((ten.match(/aria-label="[^"]+ research flask"/g) ?? []).length, 10)
  assert.equal((ten.match(/aria-label="Destroyed research flask"/g) ?? []).length, 2)
})

test('zero contribution is distinct from unavailable historical cure data', () => {
  const zero = renderToStaticMarkup(createElement(CountryGrid, { countries: [
    countryCardFixture('peru', 0, { cureResearch: { funding: 0, allocation: 0, rank: null,
      flasks: { active: 0, inactive: 4, destroyed: 0 } } }),
  ] }))
  assert.match(zero, /\$0\.00/)
  assert.match(zero, /<dt>Allocation<\/dt><dd>0%<\/dd>/)
  assert.match(zero, /Not ranked/)
  assert.doesNotMatch(zero, /<dd>#0<\/dd>/)
  assert.equal((zero.match(/aria-label="Inactive research flask"/g) ?? []).length, 4)

  const legacy = renderToStaticMarkup(createElement(CountryGrid, { countries: [
    countryCardFixture('peru', 0, { cureResearch: null }),
  ] }))
  assert.match(legacy, /Cure research data unavailable/)
  assert.doesNotMatch(legacy, /\$0\.00|Not ranked|research-flask is-/)
})

test('government actions are newest first without mutation, retain unknown and removed events', () => {
  const actions = [
    { id: 'research_funding_2', turn: 115, removed: false },
    { id: 'pandemic_alert_issued', turn: 138, removed: true },
    { id: 'urban_evacuation_ordered', turn: 169, removed: false },
  ]
  const html = renderToStaticMarkup(createElement(CountryGrid, { countries: [
    countryCardFixture('peru', 0, { governmentActions: actions }),
  ] }))
  assert.match(html, /<details class="country-actions"><summary>Government actions <span>\(3\)<\/span><\/summary>/)
  assert.ok(html.indexOf('Urban Evacuation Ordered') < html.indexOf('Pandemic Alert Issued'))
  assert.ok(html.indexOf('Pandemic Alert Issued') < html.indexOf('Research Funding 2'))
  assert.match(html, /title="urban_evacuation_ordered"/)
  assert.match(html, /Pandemic Alert Issued<\/span><small>Turn 138<em> · Removed<\/em>/)
  assert.deepEqual(actions.map((action) => action.id),
    ['research_funding_2', 'pandemic_alert_issued', 'urban_evacuation_ordered'])

  const empty = renderToStaticMarkup(createElement(CountryGrid, { countries: [countryCardFixture('peru', 0)] }))
  assert.match(empty, /No government actions/)
  assert.doesNotMatch(empty, /class="country-actions-list"/)
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
          healthyPopulation: 800, infected: 170, deadPopulation: 20, zombies: 0,
          governmentActions: [], cureResearch: null },
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
  assert.match(html, /South Africa country card/)
  assert.match(html, /<dt>Population<\/dt><dd>990<\/dd>/)
  assert.match(html, /<dt>Infected<\/dt><dd>170<\/dd>/)
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
      healthyPopulation: 60, infected: 30, deadPopulation: 10, zombies: 0,
      governmentActions: [{ id: 'urban_evacuation_ordered', turn: 13, removed: false }],
      cureResearch: { funding: 2500.99, allocation: 0.4, rank: 2,
        flasks: { active: 3, inactive: 5, destroyed: 0 } } }] }
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
  assert.match(html, /South Africa country card/)
  assert.match(html, /<dt>Infected<\/dt><dd>30<\/dd>/)
  assert.match(html, /\$2,500\.99/)
  assert.match(html, /Urban Evacuation Ordered/)
  assert.doesNotMatch(html, /day 11/i)

  const prior: HistoricalSnapshot = { ...selected, day: 10, gameDate: '2026-01-10', cureProgress: 2,
    countries: [{ ...selected.countries[0]!, healthyPopulation: 95, infected: 5,
      governmentActions: [{ id: 'research_funding_2', turn: 10, removed: false }],
      cureResearch: { funding: 1564.9822, allocation: 0.2, rank: 9,
        flasks: { active: 2, inactive: 6, destroyed: 0 } } }] }
  const priorHtml = renderToStaticMarkup(createElement(HistoryDashboard, { sessions, session, global,
    countries, country, replay: replay(prior, 10), sessionId: summary.id, onSessionChange: () => {},
    preferredCountryId: 'south_africa', onCountryChange: () => {} }))
  assert.match(priorHtml, /Saved day 10/)
  assert.match(priorHtml, /2026-01-10/)
  assert.match(priorHtml, /2,00%/)
  assert.match(priorHtml, /5,00% of original population/)
  assert.doesNotMatch(priorHtml, /30,00% of original population/)
  assert.match(priorHtml, /South Africa country card/)
  assert.match(priorHtml, /<dt>Infected<\/dt><dd>5<\/dd>/)
  assert.doesNotMatch(priorHtml, /<dt>Infected<\/dt><dd>30<\/dd>/)
  assert.match(priorHtml, /\$1,564\.98/)
  assert.match(priorHtml, /<dt>Rank<\/dt><dd>#9<\/dd>/)
  assert.equal((priorHtml.match(/aria-label="Active research flask"/g) ?? []).length, 2)
  assert.match(priorHtml, /Research Funding 2/)
  assert.doesNotMatch(priorHtml, /\$2,500\.99|Urban Evacuation Ordered/)

  const absentHtml = renderToStaticMarkup(createElement(HistoryDashboard, { sessions, session, global,
    countries, country, replay: replay({ ...selected, countries: [] }, 13), sessionId: summary.id,
    onSessionChange: () => {}, preferredCountryId: 'south_africa', onCountryChange: () => {} }))
  assert.match(absentHtml, /No country data on this day/)
  assert.match(absentHtml, /No countries in this snapshot/)

  const loadingHtml = renderToStaticMarkup(createElement(HistoryDashboard, { sessions, session, global,
    countries, country, replay: { ...replay(null, 10), snapshot: { status: 'loading', data: null,
      error: null, reload: () => {} } }, sessionId: summary.id, onSessionChange: () => {},
    preferredCountryId: 'south_africa', onCountryChange: () => {} }))
  assert.match(loadingHtml, /Loading day 10/)
  assert.doesNotMatch(loadingHtml, /country-card/)
  const errorHtml = renderToStaticMarkup(createElement(HistoryDashboard, { sessions, session, global,
    countries, country, replay: { ...replay(null, 10), snapshot: { status: 'error', data: null,
      error: new Error('snapshot failed'), reload: () => {} } }, sessionId: summary.id,
    onSessionChange: () => {}, preferredCountryId: 'south_africa', onCountryChange: () => {} }))
  assert.match(errorHtml, /snapshot failed/)
  assert.doesNotMatch(errorHtml, /country-card/)
})

test('history dashboard gives a distinct empty-session state', () => {
  const html = renderToStaticMarkup(createElement(HistoryDashboard, { sessions: { status: 'empty', data: [],
    error: null, reload: () => {} }, session: idle(), global: idle(), countries: idle(), country: idle(),
    replay: replay(null, null),
    sessionId: '', onSessionChange: () => {}, preferredCountryId: null, onCountryChange: () => {} }))
  assert.match(html, /No saved sessions/)
})
