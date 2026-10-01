import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer, type ViteDevServer } from 'vite'
import type { LiveGameView } from '../src/api/liveStore.ts'
import type { CountryHistoryResponse, CountryInfectionEvent, CountrySnapshot, GameMilestone, HistoricalSnapshot, LiveSnapshot, SessionCountriesResponse, SessionDetails,
  SessionHistoryResponse, SessionSummary, ZombieHordeEvent } from '../src/api/types.ts'
import { countryStatusComposition } from '../src/domain/countryDonut.ts'
import type { Resource } from '../src/hooks/useHistory.ts'
import type { HistoricalReplay } from '../src/hooks/useReplay.ts'

let server: ViteDevServer
let MetricCard: typeof import('../src/components/MetricCard.tsx').MetricCard
let CureProgress: typeof import('../src/components/CureProgress.tsx').CureProgress
let LivePanel: typeof import('../src/components/LivePanel.tsx').LivePanel
let HistoryDashboard: typeof import('../src/components/HistoryPanel.tsx').HistoryDashboard
let CountryGrid: typeof import('../src/components/CountryGrid.tsx').CountryGrid
let ZombieHordeMovements: typeof import('../src/components/ZombieHordeMovements.tsx').ZombieHordeMovements
let CountryInfectionHistory: typeof import('../src/components/CountryInfectionHistory.tsx').CountryInfectionHistory
let OutbreakTimeline: typeof import('../src/components/OutbreakTimeline.tsx').OutbreakTimeline

before(async () => {
  server = await createServer({ root: process.cwd(), server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  MetricCard = (await server.ssrLoadModule('/src/components/MetricCard.tsx')).MetricCard
  CureProgress = (await server.ssrLoadModule('/src/components/CureProgress.tsx')).CureProgress
  LivePanel = (await server.ssrLoadModule('/src/components/LivePanel.tsx')).LivePanel
  HistoryDashboard = (await server.ssrLoadModule('/src/components/HistoryPanel.tsx')).HistoryDashboard
  CountryGrid = (await server.ssrLoadModule('/src/components/CountryGrid.tsx')).CountryGrid
  ZombieHordeMovements = (await server.ssrLoadModule('/src/components/ZombieHordeMovements.tsx')).ZombieHordeMovements
  CountryInfectionHistory = (await server.ssrLoadModule('/src/components/CountryInfectionHistory.tsx')).CountryInfectionHistory
  OutbreakTimeline = (await server.ssrLoadModule('/src/components/OutbreakTimeline.tsx')).OutbreakTimeline
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
  deadPopulation: 5_000_000, publicOrder: null,
  borderStatus: null, airportStatus: null, portStatus: null,
  governmentActions: [], cureResearch: null, ...overrides,
})

const horde: ZombieHordeEvent = { turn: 10, eventTurn: 17, diseaseId: 0,
  sourceCountryId: 'soudi_arabia', destinationCountryId: 'south_east_asia', zombies: 358_580,
  vehicleId: 1178, arrivalTurn: null, arrivalEventTurn: null }

const infectionEvents: CountryInfectionEvent[] = [
  { countryId: 'soudi_arabia', turn: 1, eventTurn: 1, diseaseId: 0 },
  { countryId: 'middle_east', turn: 69, eventTurn: 98, diseaseId: 0 },
  { countryId: 'east_africa', turn: 74, eventTurn: 105, diseaseId: 0 },
  { countryId: 'greenland', turn: 270, eventTurn: 385, diseaseId: 0 },
]

const milestones: GameMilestone[] = [
  { type: 'virus_dna_detected', turn: 11, countryId: null, diseaseId: 0 },
  { type: 'more_infectious_than_tb', turn: 117, countryId: null, diseaseId: 0 },
  { type: 'more_infectious_than_hiv', turn: 138, countryId: null, diseaseId: 0 },
  { type: 'disease_detected', turn: 140, countryId: 'soudi_arabia', diseaseId: 0 },
  { type: 'more_infectious_than_common_cold', turn: 188, countryId: null, diseaseId: 0 },
  { type: 'first_death', turn: 233, countryId: 'afghanistan', diseaseId: 0 },
  { type: 'worse_than_black_death', turn: 253, countryId: null, diseaseId: 0 },
  { type: 'worse_than_spanish_flu', turn: 295, countryId: null, diseaseId: 0 },
  { type: 'worse_than_smallpox', turn: 316, countryId: null, diseaseId: 0 },
]

test('Outbreak Timeline and dedicated histories show exact event dates and readable labels', () => {
  const anchor: LiveSnapshot = {
    capturedAt: '2035-01-01T00:00:00Z', day: 243, gameDate: '2027-05-30',
    diseaseTurn: 240, eventTurn: 300, cureProgress: 0,
    countries: [countryCardFixture('japan', 0, { publicOrder: 0.8998,
      governmentActions: [{ id: 'research_funding_2', turn: 243, removed: false },
        { id: 'border_closed', turn: 242, removed: true }] })],
    gameMilestones: [{ type: 'first_death', turn: 243, countryId: 'japan', diseaseId: 0 }],
    publicOrderEvents: [{ countryId: 'japan', turn: 243, fromStatus: 'normal',
      toStatus: 'general_disorder', publicOrder: 0.8998, direction: 'deteriorated' }],
    countryInfectionEvents: [{ countryId: 'japan', turn: 242, eventTurn: 299, diseaseId: 0 }],
    zombieHordeEvents: [{ ...horde, turn: 242, arrivalTurn: 244, arrivalEventTurn: 302 }],
  }
  const timeline = renderToStaticMarkup(createElement(OutbreakTimeline, { snapshot: anchor }))
  assert.match(timeline, /Outbreak Timeline/)
  assert.match(timeline, /First death in Japan/)
  assert.match(timeline, /Japan enacted Research Funding 2/)
  assert.match(timeline, /Japan lifted Border Closed/)
  assert.match(timeline, /Public order in Japan deteriorated to General Disorder · 89,98%/)
  assert.match(timeline, /Day 242 · 29 May 2027/)
  assert.match(timeline, /Day 243 · 30 May 2027/)
  assert.ok(timeline.indexOf('Japan lifted Border Closed') < timeline.indexOf('First death in Japan'))
  assert.ok(timeline.indexOf('First death in Japan') < timeline.indexOf('Japan enacted Research Funding 2'))
  assert.ok(timeline.indexOf('Japan enacted Research Funding 2') < timeline.indexOf('Public order in Japan'))
  assert.doesNotMatch(timeline, /aria-label="Game Milestones"|Country Infection History|Zombie Horde Movements/)

  const infection = renderToStaticMarkup(createElement(CountryInfectionHistory,
    { events: anchor.countryInfectionEvents, anchor }))
  assert.match(infection, /Japan/)
  assert.match(infection, /Day 242 · 29 May 2027/)
  const hordes = renderToStaticMarkup(createElement(ZombieHordeMovements,
    { events: anchor.zombieHordeEvents, anchor }))
  assert.match(hordes, /Departed: Day 242 · 29 May 2027/)
  assert.match(hordes, /Arrived: Day 244 · 31 May 2027/)
  const cards = renderToStaticMarkup(createElement(CountryGrid, { countries: anchor.countries, anchor }))
  assert.match(cards, /<dt>Public Order<\/dt><dd>89,98% · General Disorder<\/dd>/)
  assert.match(cards, /Research Funding 2<\/span><small>Day 243 · 30 May 2027/)
  assert.match(cards, /Border Closed<\/span><small>Day 242 · 29 May 2027/)
})

test('infection history renders friendly names in replay order and preserves duplicates', () => {
  const empty = renderToStaticMarkup(createElement(CountryInfectionHistory, { events: [] }))
  assert.match(empty, /Country Infection History/)
  assert.match(empty, /No infection history available for this snapshot/)
  assert.doesNotMatch(empty, /class="infection-history-item"/)

  const html = renderToStaticMarkup(createElement(CountryInfectionHistory, {
    events: [...infectionEvents, { ...infectionEvents[1]! }],
  }))
  assert.equal((html.match(/class="infection-history-item"/g) ?? []).length, 5)
  assert.ok(html.indexOf('Soudi Arabia') < html.indexOf('Middle East'))
  assert.ok(html.indexOf('Middle East') < html.indexOf('East Africa'))
  assert.ok(html.indexOf('East Africa') < html.indexOf('Greenland'))
  assert.equal((html.match(/Middle East/g) ?? []).length, 2)
  assert.match(html, /Day 1/)
  assert.match(html, /Day 69/)
  assert.match(html, /Day 74/)
  assert.match(html, /Day 270/)
  assert.doesNotMatch(html, /soudi_arabia|middle_east|diseaseId|eventTurn|385/)
})

test('horde section handles empty, in-transit and arrived events without technical metadata', () => {
  const empty = renderToStaticMarkup(createElement(ZombieHordeMovements, { events: [] }))
  assert.match(empty, /Zombie Horde Movements/)
  assert.match(empty, /No zombie horde movements recorded yet/)
  assert.doesNotMatch(empty, /<ol/)

  const transit = renderToStaticMarkup(createElement(ZombieHordeMovements, { events: [horde] }))
  assert.match(transit, /Soudi Arabia/)
  assert.match(transit, /South East Asia/)
  assert.match(transit, /358 580 zombies/)
  assert.match(transit, /Departed: Day 10/)
  assert.match(transit, /In transit/)
  assert.doesNotMatch(transit, /soudi_arabia|south_east_asia|1178|diseaseId|eventTurn|Arrived:/)

  const arrived = { ...horde, arrivalTurn: 13, arrivalEventTurn: 21 }
  const duplicate = renderToStaticMarkup(createElement(ZombieHordeMovements, {
    events: [horde, arrived, { ...arrived }],
    anchor: { day: 10, gameDate: '2027-03-07' },
  }))
  assert.equal((duplicate.match(/class="horde-item"/g) ?? []).length, 3)
  assert.equal((duplicate.match(/358 580 zombies/g) ?? []).length, 3)
  assert.ok(duplicate.indexOf('In transit') < duplicate.indexOf('Arrived: Day 13'))
  assert.match(duplicate, /Departed: Day 10 · 7 Mar 2027/)
  assert.match(duplicate, /Arrived: Day 13 · 10 Mar 2027/)
  assert.doesNotMatch(duplicate, /1178|arrivalEventTurn|eventTurn/)
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

test('country cards show independent public order percentages and distinguish zero from unavailable', () => {
  const input = [
    countryCardFixture('egypt', 0, { publicOrder: 1 }),
    countryCardFixture('russia', 1, { publicOrder: 0 }),
    countryCardFixture('peru', 2, { publicOrder: 0.9497843 }),
    countryCardFixture('morroco', 3, { publicOrder: null }),
  ]
  const html = renderToStaticMarkup(createElement(CountryGrid, { countries: input }))
  assert.match(html, /<dt>Public Order<\/dt><dd>100,00% · Normal<\/dd>/)
  assert.match(html, /<dt>Public Order<\/dt><dd>0,00% · Anarchy<\/dd>/)
  assert.match(html, /<dt>Public Order<\/dt><dd>94,98% · Normal<\/dd>/)
  assert.match(html, /<dt>Public Order<\/dt><dd>N\/A<\/dd>/)
  assert.equal((html.match(/<dt>Public Order<\/dt>/g) ?? []).length, 4)
  assert.deepEqual(input.map((country) => country.publicOrder), [1, 0, 0.9497843, null])
})

test('country cards show independent border, airport and port states including N/A', () => {
  const countries = [
    countryCardFixture('egypt', 0, { borderStatus: 'open', airportStatus: 'closed', portStatus: null }),
    countryCardFixture('russia', 1, { borderStatus: 'closed', airportStatus: 'open', portStatus: 'open' }),
  ]
  const html = renderToStaticMarkup(createElement(CountryGrid, { countries }))
  const cards = [...html.matchAll(/<article class="surface country-card"[^>]*>([\s\S]*?)<\/article>/g)]
  assert.equal(cards.length, 2)
  assert.match(cards[0]![1]!, /<dt>Borders<\/dt><dd class="is-open">Open<\/dd>/)
  assert.match(cards[0]![1]!, /<dt>Airport<\/dt><dd class="is-closed">Closed<\/dd>/)
  assert.match(cards[0]![1]!, /<dt>Port<\/dt><dd class="is-unavailable">N\/A<\/dd>/)
  assert.match(cards[1]![1]!, /<dt>Borders<\/dt><dd class="is-closed">Closed<\/dd>/)
  assert.match(cards[1]![1]!, /<dt>Airport<\/dt><dd class="is-open">Open<\/dd>/)
  assert.match(cards[1]![1]!, /<dt>Port<\/dt><dd class="is-open">Open<\/dd>/)
  assert.deepEqual(countries.map(({ borderStatus, airportStatus, portStatus }) =>
    [borderStatus, airportStatus, portStatus]), [['open', 'closed', null], ['closed', 'open', 'open']])
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
  assert.match(html, /Pandemic Alert Issued<\/span><small>Day 138<em> · Removed<\/em>/)
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
      eventTurn: 211, cureProgress: 34.2769, zombieHordeEvents: [horde],
      countryInfectionEvents: infectionEvents, gameMilestones: [], publicOrderEvents: [], countries: [
        { index: 0, id: 'south_africa', originalPopulation: 1000, currentPopulation: 990,
          healthyPopulation: 800, infected: 170, deadPopulation: 20, zombies: 0,
          publicOrder: 0.4627481,
          borderStatus: 'open', airportStatus: 'closed', portStatus: null,
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
  assert.match(html, /Public Order/)
  assert.match(html, /46,27%/)
  assert.match(html, /<dt>Borders<\/dt><dd class="is-open">Open<\/dd>/)
  assert.match(html, /<dt>Airport<\/dt><dd class="is-closed">Closed<\/dd>/)
  assert.match(html, /<dt>Port<\/dt><dd class="is-unavailable">N\/A<\/dd>/)
  assert.equal((html.match(/aria-label="Infrastructure status"/g) ?? []).length, 2)
  assert.match(html, /Zombie Horde Movements/)
  assert.match(html, /Country Infection History/)
  assert.match(html, /Soudi Arabia/)
  assert.match(html, /East Africa/)
  assert.match(html, /In transit/)
})

test('infection history switches 333 empty → 334 recorded → 333 empty without LIVE leakage', () => {
  const summary: SessionSummary = { id: 'infection-session', startedAt: '2026-09-23T00:00:00Z', endedAt: null,
    firstDay: 333, lastDay: 344, snapshotCount: 3, isOpen: true,
    firstGameDate: '2027-08-01', lastGameDate: '2027-08-12' }
  const day333: HistoricalSnapshot = { sessionId: summary.id, capturedAt: '2026-09-23T00:00:00Z',
    day: 333, gameDate: '2027-08-01', diseaseTurn: 333, eventTurn: 400, cureProgress: 0,
    zombieHordeEvents: [], countryInfectionEvents: [], gameMilestones: [], publicOrderEvents: [],
    countries: [countryCardFixture('egypt', 0)] }
  const allEvents = [...infectionEvents, ...Array.from({ length: 54 }, (_, index) => ({
    countryId: `country_${index}`, turn: 271 + index, eventTurn: 386 + index, diseaseId: 0,
  }))]
  const day334: HistoricalSnapshot = { ...day333, day: 334, gameDate: '2027-08-02',
    countryInfectionEvents: allEvents }
  const common = { sessions: loaded([summary]), session: idle<SessionDetails>(),
    global: idle<SessionHistoryResponse>(),
    countries: loaded<SessionCountriesResponse>({ sessionId: summary.id, countries: [{ id: 'egypt', index: 0 }] }),
    country: idle<CountryHistoryResponse>(), sessionId: summary.id, onSessionChange: () => {},
    preferredCountryId: 'egypt', onCountryChange: () => {} }
  const renderDay = (snapshot: HistoricalSnapshot) => renderToStaticMarkup(createElement(HistoryDashboard, {
    ...common, replay: { ...replay(snapshot, snapshot.day), days: [333, 334, 343],
      index: snapshot.day === 333 ? 0 : 1 },
  }))
  const section = (html: string) => html.match(/<section class="surface infection-history-panel"[\s\S]*?<\/section>/)?.[0] ?? ''
  const live: LiveGameView = { connectionState: 'live', collectorStatus: { running: true, lastError: null },
    session: null, sessionId: summary.id, error: null,
    snapshot: { ...day334, day: 344, countryInfectionEvents: allEvents } }

  const old = section(renderDay(day333))
  const recorded = section(renderDay(day334))
  const liveNow = section(renderToStaticMarkup(createElement(LivePanel, { live })))
  const oldAgain = section(renderDay(day333))
  assert.match(old, /No infection history available for this snapshot/)
  assert.doesNotMatch(old, /infection-history-item|Soudi Arabia|Greenland/)
  assert.equal((recorded.match(/class="infection-history-item"/g) ?? []).length, 58)
  assert.match(recorded, /Soudi Arabia/)
  assert.match(recorded, /Greenland/)
  assert.equal((liveNow.match(/class="infection-history-item"/g) ?? []).length, 58)
  assert.match(oldAgain, /No infection history available for this snapshot/)
  assert.doesNotMatch(oldAgain, /infection-history-item|Soudi Arabia|Greenland/)
})

test('Game Milestone entries in Outbreak Timeline HISTORY follow stored 0 → 5 → 6 → 7 progression', () => {
  const summary: SessionSummary = { id: 'milestone-session', startedAt: '2026-09-23T00:00:00Z', endedAt: null,
    firstDay: 10, lastDay: 255, snapshotCount: 4, isOpen: true,
    firstGameDate: '2027-01-01', lastGameDate: '2027-09-12' }
  const base: HistoricalSnapshot = { sessionId: summary.id, capturedAt: '2026-09-23T00:00:00Z',
    day: 10, gameDate: '2027-01-01', diseaseTurn: 10, eventTurn: 10, cureProgress: 0,
    zombieHordeEvents: [], countryInfectionEvents: [], gameMilestones: [], publicOrderEvents: [],
    countries: [countryCardFixture('soudi_arabia', 0)] }
  const day224: HistoricalSnapshot = { ...base, day: 224, gameDate: '2027-08-12',
    gameMilestones: milestones.slice(0, 5) }
  const day234: HistoricalSnapshot = { ...base, day: 234, gameDate: '2027-08-22',
    gameMilestones: milestones.slice(0, 6) }
  const day254: HistoricalSnapshot = { ...base, day: 254, gameDate: '2027-09-11',
    gameMilestones: milestones.slice(0, 7) }
  const common = { sessions: loaded([summary]), session: idle<SessionDetails>(),
    global: idle<SessionHistoryResponse>(),
    countries: loaded<SessionCountriesResponse>({ sessionId: summary.id,
      countries: [{ id: 'soudi_arabia', index: 0 }] }),
    country: idle<CountryHistoryResponse>(), sessionId: summary.id, onSessionChange: () => {},
    preferredCountryId: 'soudi_arabia', onCountryChange: () => {} }
  const renderDay = (snapshot: HistoricalSnapshot) => renderToStaticMarkup(createElement(HistoryDashboard, {
    ...common, replay: { ...replay(snapshot, snapshot.day), days: [10, 224, 234, 254],
      index: [10, 224, 234, 254].indexOf(snapshot.day) },
  }))
  const section = (html: string) => html.match(/<section class="surface timeline-panel"[\s\S]*?<\/section>/)?.[0] ?? ''
  const live: LiveGameView = { connectionState: 'live', collectorStatus: { running: true, lastError: null },
    session: null, sessionId: summary.id, error: null,
    snapshot: { ...day254, day: 255, gameMilestones: milestones.slice(0, 7) } }

  const empty = section(renderDay(base))
  const five = section(renderDay(day224))
  const six = section(renderDay(day234))
  const seven = section(renderDay(day254))
  const liveNow = section(renderToStaticMarkup(createElement(LivePanel, { live })))
  const earlierAgain = section(renderDay(day224))
  assert.match(empty, /No outbreak timeline events available for this snapshot/)
  assert.doesNotMatch(empty, /timeline-item|Virus DNA detected/)
  assert.deepEqual([five, six, seven, liveNow, earlierAgain]
    .map((html) => (html.match(/class="timeline-item is-milestone"/g) ?? []).length), [5, 6, 7, 7, 5])
  assert.doesNotMatch(liveNow, /aria-label="Game Milestones"/)
  assert.match(five, /Disease detected in Soudi Arabia/)
  assert.doesNotMatch(five, /First death in Afghanistan|Worse than the Black Death/)
  assert.match(six, /First death in Afghanistan/)
  assert.doesNotMatch(six, /Worse than the Black Death/)
  assert.match(seven, /Worse than the Black Death/)
  assert.doesNotMatch(earlierAgain, /First death in Afghanistan|Worse than the Black Death/)
})

test('Outbreak Timeline LIVE and HISTORY use only their selected snapshot, including backward navigation', () => {
  const summary: SessionSummary = { id: 'timeline-session', startedAt: '2026-09-23T00:00:00Z', endedAt: null,
    firstDay: 242, lastDay: 244, snapshotCount: 2, isOpen: true,
    firstGameDate: '2027-05-29', lastGameDate: '2027-05-31' }
  const early: HistoricalSnapshot = { sessionId: summary.id, capturedAt: '2026-09-23T00:00:00Z',
    day: 242, gameDate: '2027-05-29', diseaseTurn: 242, eventTurn: 300, cureProgress: 0,
    zombieHordeEvents: [], countryInfectionEvents: [], publicOrderEvents: [],
    gameMilestones: [{ type: 'virus_dna_detected', turn: 240, countryId: null, diseaseId: 0 }],
    countries: [countryCardFixture('japan', 0, { publicOrder: 0.91,
      governmentActions: [{ id: 'research_funding_2', turn: 241, removed: false }] })] }
  const late: HistoricalSnapshot = { ...early, day: 244, gameDate: '2027-05-31',
    gameMilestones: [...early.gameMilestones,
      { type: 'first_death', turn: 243, countryId: 'japan', diseaseId: 0 }],
    countries: [countryCardFixture('japan', 0, { publicOrder: 0.8998,
      governmentActions: [...early.countries[0]!.governmentActions,
        { id: 'border_closed', turn: 243, removed: false }] })],
    publicOrderEvents: [{ countryId: 'japan', turn: 243, fromStatus: 'normal',
      toStatus: 'general_disorder', publicOrder: 0.8998, direction: 'deteriorated' }],
  }
  const common = { sessions: loaded([summary]), session: idle<SessionDetails>(),
    global: idle<SessionHistoryResponse>(), countries: loaded<SessionCountriesResponse>({ sessionId: summary.id,
      countries: [{ id: 'japan', index: 0 }] }), country: idle<CountryHistoryResponse>(),
    sessionId: summary.id, onSessionChange: () => {}, preferredCountryId: 'japan', onCountryChange: () => {} }
  const section = (html: string) => html.match(/<section class="surface timeline-panel"[\s\S]*?<\/section>/)?.[0] ?? ''
  const renderDay = (snapshot: HistoricalSnapshot) => section(renderToStaticMarkup(createElement(HistoryDashboard, {
    ...common, replay: { ...replay(snapshot, snapshot.day), days: [242, 244], index: snapshot.day === 242 ? 0 : 1 },
  })))
  const live: LiveGameView = { connectionState: 'live', collectorStatus: { running: true, lastError: null },
    session: null, sessionId: summary.id, error: null,
    snapshot: { ...late, day: 245, gameDate: '2027-06-01' } }
  const earlyHtml = renderDay(early)
  const lateHtml = renderDay(late)
  const liveHtml = section(renderToStaticMarkup(createElement(LivePanel, { live })))
  assert.match(earlyHtml, /Virus DNA detected/)
  assert.match(earlyHtml, /Japan enacted Research Funding 2/)
  assert.doesNotMatch(earlyHtml, /First death|Border Closed|Public order in Japan/)
  assert.match(lateHtml, /First death in Japan/)
  assert.match(lateHtml, /Japan enacted Border Closed/)
  assert.match(lateHtml, /Public order in Japan deteriorated to General Disorder/)
  assert.match(lateHtml, /Day 243 · 30 May 2027/)
  assert.match(liveHtml, /Public order in Japan deteriorated to General Disorder/)
  assert.doesNotMatch(renderDay(early), /First death|Border Closed|Public order in Japan/)
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
    zombieHordeEvents: [{ ...horde, arrivalTurn: 13, arrivalEventTurn: 21 }],
    countryInfectionEvents: [],
    gameMilestones: [],
    publicOrderEvents: [],
    countries: [{ index: 1, id: 'south_africa', originalPopulation: 100, currentPopulation: 90,
      healthyPopulation: 60, infected: 30, deadPopulation: 10, zombies: 0,
      publicOrder: null,
      borderStatus: null, airportStatus: null, portStatus: null,
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
  assert.match(html, /Arrived: Day 13 · 13 Jan 2026/)
  assert.match(html, /Departed: Day 10 · 10 Jan 2026/)
  assert.doesNotMatch(html, /day 11/i)

  const prior: HistoricalSnapshot = { ...selected, day: 10, gameDate: '2026-01-10', cureProgress: 2,
    zombieHordeEvents: [horde],
    countryInfectionEvents: [],
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
  assert.match(priorHtml, /In transit/)
  assert.doesNotMatch(priorHtml, /Arrived: Day 13/)
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

test('Egypt public order stays tied to the selected historical day, not the latest live value', () => {
  const summary: SessionSummary = { id: 'egypt-session', startedAt: '2026-09-23T00:00:00Z', endedAt: null,
    firstDay: 229, lastDay: 265, snapshotCount: 2, isOpen: true,
    firstGameDate: '2027-06-14', lastGameDate: '2027-07-20' }
  const historical: HistoricalSnapshot = { sessionId: summary.id, capturedAt: '2026-09-23T00:00:00Z',
    day: 229, gameDate: '2027-06-14', diseaseTurn: 229, eventTurn: 229, cureProgress: 0,
    zombieHordeEvents: [], countryInfectionEvents: [], gameMilestones: [], publicOrderEvents: [],
    countries: [countryCardFixture('egypt', 0, { publicOrder: 0.9497843 })] }
  const later: HistoricalSnapshot = { ...historical, day: 265, gameDate: '2027-07-20',
    countries: [countryCardFixture('egypt', 0, { publicOrder: 0.50941885 })] }
  const common = { sessions: loaded([summary]), session: idle<SessionDetails>(),
    global: idle<SessionHistoryResponse>(),
    countries: loaded<SessionCountriesResponse>({ sessionId: summary.id, countries: [{ id: 'egypt', index: 0 }] }),
    country: idle<CountryHistoryResponse>(), sessionId: summary.id, onSessionChange: () => {},
    preferredCountryId: 'egypt', onCountryChange: () => {} }
  const renderDay = (snapshot: HistoricalSnapshot) => renderToStaticMarkup(createElement(HistoryDashboard, {
    ...common, replay: { ...replay(snapshot, snapshot.day), days: [229, 265], index: snapshot.day === 229 ? 0 : 1 },
  }))

  const firstDay = renderDay(historical)
  const laterDay = renderDay(later)
  const live: LiveGameView = { connectionState: 'live', collectorStatus: { running: true, lastError: null },
    session: null, sessionId: summary.id, error: null,
    snapshot: { ...later, day: 266, countries: [countryCardFixture('egypt', 0, { publicOrder: 0.4627481 })] } }
  const liveDay = renderToStaticMarkup(createElement(LivePanel, { live }))

  assert.match(firstDay, /Saved day 229/)
  assert.match(firstDay, /<dt>Public Order<\/dt><dd>94,98% · Normal<\/dd>/)
  assert.doesNotMatch(firstDay, /50,94%|46,27%/)
  assert.match(laterDay, /Saved day 265/)
  assert.match(laterDay, /<dt>Public Order<\/dt><dd>50,94% · Mass Disorder<\/dd>/)
  assert.match(liveDay, /<dt>Public Order<\/dt><dd>46,27% · Mass Disorder<\/dd>/)
  assert.match(renderDay(historical), /<dt>Public Order<\/dt><dd>94,98% · Normal<\/dd>/)
})

test('selected-country overview and cards use infrastructure from the selected historical day', () => {
  const summary: SessionSummary = { id: 'infrastructure-session', startedAt: '2026-09-23T00:00:00Z', endedAt: null,
    firstDay: 267, lastDay: 311, snapshotCount: 2, isOpen: true,
    firstGameDate: '2027-01-01', lastGameDate: '2027-02-14' }
  const historical: HistoricalSnapshot = { sessionId: summary.id, capturedAt: '2026-09-23T00:00:00Z',
    day: 267, gameDate: '2027-01-01', diseaseTurn: 267, eventTurn: 267, cureProgress: 0,
    zombieHordeEvents: [], countryInfectionEvents: [], gameMilestones: [], publicOrderEvents: [],
    countries: [countryCardFixture('egypt', 0,
      { borderStatus: 'open', airportStatus: 'open', portStatus: 'open' })] }
  const later: HistoricalSnapshot = { ...historical, day: 311, gameDate: '2027-02-14',
    countries: [countryCardFixture('egypt', 0,
      { borderStatus: 'closed', airportStatus: 'closed', portStatus: 'closed' })] }
  const common = { sessions: loaded([summary]), session: idle<SessionDetails>(),
    global: idle<SessionHistoryResponse>(),
    countries: loaded<SessionCountriesResponse>({ sessionId: summary.id, countries: [{ id: 'egypt', index: 0 }] }),
    country: idle<CountryHistoryResponse>(), sessionId: summary.id, onSessionChange: () => {},
    preferredCountryId: 'egypt', onCountryChange: () => {} }
  const renderDay = (snapshot: HistoricalSnapshot) => renderToStaticMarkup(createElement(HistoryDashboard, {
    ...common, replay: { ...replay(snapshot, snapshot.day), days: [267, 311],
      index: snapshot.day === 267 ? 0 : 1 },
  }))

  const firstDay = renderDay(historical)
  const laterDay = renderDay(later)
  const live: LiveGameView = { connectionState: 'live', collectorStatus: { running: true, lastError: null },
    session: null, sessionId: summary.id, error: null,
    snapshot: { ...later, day: 312, countries: [countryCardFixture('egypt', 0,
      { borderStatus: 'open', airportStatus: 'closed', portStatus: null })] } }
  const liveDay = renderToStaticMarkup(createElement(LivePanel, { live }))
  assert.match(firstDay, /Saved day 267/)
  assert.equal((firstDay.match(/<dd class="is-open">Open<\/dd>/g) ?? []).length, 6)
  assert.doesNotMatch(firstDay, /<dd class="is-closed">Closed<\/dd>/)
  assert.match(laterDay, /Saved day 311/)
  assert.equal((laterDay.match(/<dd class="is-closed">Closed<\/dd>/g) ?? []).length, 6)
  assert.doesNotMatch(laterDay, /<dd class="is-open">Open<\/dd>/)
  assert.match(liveDay, /<dt>Borders<\/dt><dd class="is-open">Open<\/dd>/)
  assert.match(liveDay, /<dt>Airport<\/dt><dd class="is-closed">Closed<\/dd>/)
  assert.match(liveDay, /<dt>Port<\/dt><dd class="is-unavailable">N\/A<\/dd>/)
  assert.equal((renderDay(historical).match(/<dd class="is-open">Open<\/dd>/g) ?? []).length, 6)
})

test('history dashboard gives a distinct empty-session state', () => {
  const html = renderToStaticMarkup(createElement(HistoryDashboard, { sessions: { status: 'empty', data: [],
    error: null, reload: () => {} }, session: idle(), global: idle(), countries: idle(), country: idle(),
    replay: replay(null, null),
    sessionId: '', onSessionChange: () => {}, preferredCountryId: null, onCountryChange: () => {} }))
  assert.match(html, /No saved sessions/)
})
