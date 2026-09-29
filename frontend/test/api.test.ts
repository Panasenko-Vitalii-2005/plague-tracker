import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apiUrl, normalizeApiBaseUrl } from '../src/api/config.ts'
import { ApiError, getCountryHistory, getHistoricalSnapshot, getSessionCountries, getSessions } from '../src/api/client.ts'
import { parseHistoricalSnapshot, parseLiveState, parseSessionCountries, parseSessionHistory, parseSessions } from '../src/api/parse.ts'
import type { GameMilestone } from '../src/api/types.ts'

const country = {
  index: 2, id: 'soudi_arabia', currentPopulation: 90, originalPopulation: 100,
  healthyPopulation: 70, deadPopulation: 5, infected: 20, zombies: 1,
  governmentActions: [{ id: 'research_funding_2', turn: 14, removed: false }],
  cureResearch: { funding: 1564.9822, allocation: 0.2, rank: 9,
    flasks: { active: 2, inactive: 6, destroyed: 0 } },
}
const snapshot = {
  capturedAt: '2026-09-23T00:00:00Z', day: 10, gameDate: '2026-10-03',
  diseaseTurn: 12, eventTurn: 14, cureProgress: 25.51, countries: [country],
}

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

test('game milestone parser accepts all nine types, preserves order and duplicates, and defaults missing to empty', () => {
  const events = [milestones[0]!, ...milestones, { ...milestones[3]!, diseaseId: -7 }]
  const live = parseLiveState({ collector: { running: true, lastError: null }, session: null,
    snapshot: { ...snapshot, gameMilestones: events } })
  const history = parseHistoricalSnapshot({ sessionId: 'session-a', ...snapshot, gameMilestones: events })
  assert.deepEqual(live.snapshot?.gameMilestones, events)
  assert.deepEqual(history.gameMilestones, events)
  assert.equal(history.gameMilestones[4]?.countryId, 'soudi_arabia')
  assert.deepEqual(parseHistoricalSnapshot({ sessionId: 'legacy', ...snapshot }).gameMilestones, [])
})

test('game milestone parser rejects malformed lists, types, numbers and country contexts', () => {
  for (const invalidList of [null, {}, 'news', 1]) {
    assert.throws(() => parseHistoricalSnapshot({ sessionId: 'session-a', ...snapshot,
      gameMilestones: invalidList }), /gameMilestones/)
  }
  const global = milestones[0]!
  const countrySpecific = milestones[3]!
  for (const invalid of [
    null, [], 'event',
    { ...global, type: 'unknown' }, { ...global, type: 'Virus_DNA_Detected' },
    { ...global, turn: 1.5 }, { ...global, turn: Number.MAX_SAFE_INTEGER + 1 },
    { ...global, turn: Number.NaN }, { ...global, turn: '11' },
    { ...global, diseaseId: 1.5 }, { ...global, diseaseId: Number.POSITIVE_INFINITY },
    { ...global, countryId: 'russia' }, { ...global, countryId: undefined },
    { ...countrySpecific, countryId: null }, { ...countrySpecific, countryId: '' },
    { ...countrySpecific, countryId: ' ' }, { ...countrySpecific, countryId: 1 },
    { ...milestones[5]!, countryId: null },
  ]) {
    assert.throws(() => parseHistoricalSnapshot({ sessionId: 'session-a', ...snapshot,
      gameMilestones: [invalid] }), /game milestone/)
  }
})

test('API URL defaults to same-origin /api/v1 and accepts an override', () => {
  assert.equal(normalizeApiBaseUrl(), '/api/v1')
  assert.equal(apiUrl('/live/stream', '/api/v1/'), '/api/v1/live/stream')
  assert.equal(apiUrl('sessions', 'http://127.0.0.1:3001/api/v1/'),
    'http://127.0.0.1:3001/api/v1/sessions')
})

test('session and history parsing retains IDs and actual day gaps', () => {
  const sessions = parseSessions([{
    id: 'session-a', startedAt: '2026-09-23T00:00:00Z', endedAt: null,
    firstDay: 120, lastDay: 124, snapshotCount: 3, isOpen: true,
    firstGameDate: '2026-10-01', lastGameDate: '2026-10-05',
  }])
  assert.equal(sessions[0]?.id, 'session-a')
  assert.equal(sessions[0]?.snapshotCount, 3)
  const point = {
    capturedAt: snapshot.capturedAt, gameDate: snapshot.gameDate,
    diseaseTurn: 1, eventTurn: 2, cureProgress: 0,
    healthy: 70, infected: 20, dead: 5, zombies: 1, originalPopulation: 100,
  }
  const history = parseSessionHistory({ sessionId: 'session-a', history: [
    { ...point, day: 120 }, { ...point, day: 121 }, { ...point, day: 124 },
  ] })
  assert.deepEqual(history.history.map((entry) => entry.day), [120, 121, 124])
})

test('live response parsing keeps raw country ID unchanged', () => {
  const value = parseLiveState({
    collector: { running: true, lastError: null },
    session: { id: 'session-a', startedAt: snapshot.capturedAt, endedAt: null, firstDay: 10, lastDay: 10 },
    snapshot,
  })
  assert.equal(value.snapshot?.countries[0]?.id, 'soudi_arabia')
  assert.equal(value.snapshot?.countries[0]?.publicOrder, null)
  assert.deepEqual([value.snapshot?.countries[0]?.borderStatus,
    value.snapshot?.countries[0]?.airportStatus, value.snapshot?.countries[0]?.portStatus], [null, null, null])
  assert.equal(value.snapshot?.cureProgress, 25.51)
  assert.deepEqual(value.snapshot?.countryInfectionEvents, [])
  assert.throws(() => parseLiveState({ collector: { running: true, lastError: null }, session: null,
    snapshot: { ...snapshot, countries: [{ ...country, infected: 'twenty' }] } }), /country.infected/)
})

test('full historical snapshot parser validates every field and keeps raw country IDs', () => {
  const parsed = parseHistoricalSnapshot({ sessionId: 'session-a', ...snapshot })
  assert.equal(parsed.sessionId, 'session-a')
  assert.deepEqual(parsed.countries, [{ ...country, publicOrder: null,
    borderStatus: null, airportStatus: null, portStatus: null }])
  for (const [key, value] of Object.entries({ sessionId: 4, capturedAt: 4, day: '10', gameDate: 4,
    diseaseTurn: '12', eventTurn: '14', cureProgress: '25', countries: null })) {
    assert.throws(() => parseHistoricalSnapshot({ sessionId: 'session-a', ...snapshot, [key]: value }))
  }
  assert.throws(() => parseHistoricalSnapshot({ sessionId: 'session-a', ...snapshot,
    countries: [{ ...country, infected: '20' }] }), /country.infected/)
})

test('public order parser preserves raw fractions and normalizes legacy/null values', () => {
  const states = [
    { ...country, publicOrder: 1 },
    { ...country, id: 'egypt', index: 3, publicOrder: 0.9497843 },
    { ...country, id: 'peru', index: 4, publicOrder: 0 },
    { ...country, id: 'russia', index: 5, publicOrder: null },
    { ...country, id: 'ukraine', index: 6 },
  ]
  const parsed = parseHistoricalSnapshot({ sessionId: 'session-a', ...snapshot, countries: states })
  assert.deepEqual(parsed.countries.map((item) => item.publicOrder), [1, 0.9497843, 0, null, null])
  assert.equal(parsed.countries[1]?.publicOrder, 0.9497843)
  for (const bad of [-0.01, 1.01, '0.5', Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => parseHistoricalSnapshot({ sessionId: 'session-a', ...snapshot,
      countries: [{ ...country, publicOrder: bad }] }), /country.publicOrder/)
  }
})

test('infrastructure parser preserves open, closed and null independently; missing stays null', () => {
  const countries = [
    { ...country, borderStatus: 'open', airportStatus: 'closed', portStatus: null },
    { ...country, index: 3, id: 'egypt', borderStatus: 'closed', airportStatus: 'open', portStatus: 'open' },
    { ...country, index: 4, id: 'peru' },
  ]
  const parsed = parseHistoricalSnapshot({ sessionId: 'session-a', ...snapshot, countries })
  assert.deepEqual(parsed.countries.map(({ borderStatus, airportStatus, portStatus }) =>
    [borderStatus, airportStatus, portStatus]),
  [['open', 'closed', null], ['closed', 'open', 'open'], [null, null, null]])
  const live = parseLiveState({ collector: { running: true, lastError: null }, session: null,
    snapshot: { ...snapshot, countries } })
  assert.equal(live.snapshot?.countries[0]?.airportStatus, 'closed')
  for (const field of ['borderStatus', 'airportStatus', 'portStatus'] as const) {
    for (const invalid of ['OPEN', 'unknown', '', 0, false, [], {}]) {
      assert.throws(() => parseHistoricalSnapshot({ sessionId: 'session-a', ...snapshot,
        countries: [{ ...country, [field]: invalid }] }), new RegExp(`country\\.${field}`))
    }
  }
})

test('live and historical parsers retain government actions and cure research, including legacy null', () => {
  const live = parseLiveState({ collector: { running: true, lastError: null }, session: null, snapshot })
  assert.deepEqual(live.snapshot?.countries[0]?.governmentActions, country.governmentActions)
  assert.deepEqual(live.snapshot?.countries[0]?.cureResearch, country.cureResearch)

  const legacyCountry = { ...country, governmentActions: [], cureResearch: null }
  const historical = parseHistoricalSnapshot({ sessionId: 'old-session', ...snapshot, countries: [legacyCountry] })
  assert.deepEqual(historical.countries[0]?.governmentActions, [])
  assert.equal(historical.countries[0]?.cureResearch, null)

  for (const invalid of [
    { governmentActions: null },
    { governmentActions: [{ id: 'unknown', turn: 1.5, removed: false }] },
    { governmentActions: [{ id: 'unknown', turn: 1, removed: 'false' }] },
    { cureResearch: { ...country.cureResearch, rank: 0 } },
    { cureResearch: { ...country.cureResearch, flasks: { active: -1, inactive: 6, destroyed: 0 } } },
    { cureResearch: { ...country.cureResearch, funding: '1564' } },
  ]) {
    assert.throws(() => parseHistoricalSnapshot({ sessionId: 'session-a', ...snapshot,
      countries: [{ ...country, ...invalid }] }))
  }
})

test('horde parsing preserves replay order, duplicates and lifecycle state in live and history', () => {
  const dispatch = { turn: 160, eventTurn: 229, diseaseId: 0,
    sourceCountryId: 'soudi_arabia', destinationCountryId: 'australia', zombies: 358580 }
  const arrived = { ...dispatch, vehicleId: 1178, arrivalTurn: 174, arrivalEventTurn: 249 }
  const live = parseLiveState({ collector: { running: true, lastError: null }, session: null,
    snapshot: { ...snapshot, zombieHordeEvents: [dispatch, arrived, { ...arrived }] } })
  assert.deepEqual(live.snapshot?.zombieHordeEvents, [
    { ...dispatch, vehicleId: null, arrivalTurn: null, arrivalEventTurn: null }, arrived, arrived,
  ])
  const historical = parseHistoricalSnapshot({ sessionId: 'session-a', ...snapshot,
    zombieHordeEvents: [dispatch] })
  assert.equal(historical.zombieHordeEvents[0]?.arrivalTurn, null)
  assert.deepEqual(parseHistoricalSnapshot({ sessionId: 'legacy', ...snapshot }).zombieHordeEvents, [])

  for (const event of [{ ...dispatch, turn: -1 }, { ...dispatch, zombies: '358580' },
    { ...dispatch, sourceCountryId: ' ' }, { ...arrived, arrivalTurn: 159 },
    { ...arrived, vehicleId: -1 }, { ...arrived, arrivalEventTurn: -1 }]) {
    assert.throws(() => parseHistoricalSnapshot({ sessionId: 'session-a', ...snapshot,
      zombieHordeEvents: [event] }), /zombie horde/)
  }
  assert.throws(() => parseHistoricalSnapshot({ sessionId: 'session-a', ...snapshot,
    zombieHordeEvents: null }), /zombieHordeEvents/)
})

test('country infection parsing preserves raw IDs, order and duplicates in live and history', () => {
  const saudi = { countryId: 'soudi_arabia', turn: 1, eventTurn: 1, diseaseId: 0 }
  const middleEast = { countryId: 'middle_east', turn: 69, eventTurn: 98, diseaseId: 0 }
  const eastAfrica = { countryId: 'east_africa', turn: 74, eventTurn: 105, diseaseId: 0 }
  const greenland = { countryId: 'greenland', turn: 270, eventTurn: 385, diseaseId: 0 }
  const events = [saudi, middleEast, { ...middleEast }, eastAfrica, greenland]
  const live = parseLiveState({ collector: { running: true, lastError: null }, session: null,
    snapshot: { ...snapshot, countryInfectionEvents: events } })
  const history = parseHistoricalSnapshot({ sessionId: 'session-a', ...snapshot,
    countryInfectionEvents: events })
  assert.deepEqual(live.snapshot?.countryInfectionEvents, events)
  assert.deepEqual(history.countryInfectionEvents, events)
  assert.equal(history.countryInfectionEvents[1]?.countryId, 'middle_east')
  assert.deepEqual(parseHistoricalSnapshot({ sessionId: 'legacy', ...snapshot }).countryInfectionEvents, [])
})

test('country infection parser rejects malformed explicit values', () => {
  const valid = { countryId: 'greenland', turn: 270, eventTurn: 385, diseaseId: 0 }
  for (const invalid of [
    { ...valid, countryId: '' }, { ...valid, countryId: ' ' }, { ...valid, countryId: 7 },
    { ...valid, turn: 1.5 }, { ...valid, turn: '270' },
    { ...valid, eventTurn: null }, { ...valid, eventTurn: Number.NaN },
    { ...valid, diseaseId: Number.POSITIVE_INFINITY },
  ]) {
    assert.throws(() => parseHistoricalSnapshot({ sessionId: 'session-a', ...snapshot,
      countryInfectionEvents: [invalid] }), /country infection/)
  }
  for (const invalidList of [null, {}, 'INFECT: greenland']) {
    assert.throws(() => parseHistoricalSnapshot({ sessionId: 'session-a', ...snapshot,
      countryInfectionEvents: invalidList }), /countryInfectionEvents/)
  }
})

test('full historical snapshot client requests the observed day', async () => {
  const original = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = async (input) => {
    urls.push(String(input))
    return new Response(JSON.stringify({ sessionId: 'session-a', ...snapshot }), { status: 200 })
  }
  try {
    assert.equal((await getHistoricalSnapshot('session-a', 10)).day, 10)
    assert.deepEqual(urls, ['/api/v1/sessions/session-a/days/10'])
  } finally { globalThis.fetch = original }
})

test('historical country list parsing preserves backend order and raw IDs', () => {
  const value = parseSessionCountries({ sessionId: 'session-a', countries: [
    { id: 'peru', index: 0 }, { id: 'soudi_arabia', index: 1 },
    { id: 'morroco', index: 2 }, { id: 'philipines', index: 3 },
    { id: 'balcan_states', index: 4 },
  ] })
  assert.deepEqual(value.countries.map((item) => item.id),
    ['peru', 'soudi_arabia', 'morroco', 'philipines', 'balcan_states'])
  assert.deepEqual(parseSessionCountries({ sessionId: 'empty', countries: [] }).countries, [])
  assert.throws(() => parseSessionCountries({ sessionId: 'bad', countries: [{ id: 'peru', index: '0' }] }),
    /country.index/)
})

test('historical country list loads through REST without a live snapshot', async () => {
  const original = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = async (input) => {
    urls.push(String(input))
    return new Response(JSON.stringify({ sessionId: 'session-a', countries: [
      { id: 'peru', index: 0 }, { id: 'balcan_states', index: 1 },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const countries = await getSessionCountries('session-a')
    assert.deepEqual(countries.countries.map((item) => item.id), ['peru', 'balcan_states'])
    assert.deepEqual(urls, ['/api/v1/sessions/session-a/countries'])
  } finally { globalThis.fetch = original }
})

test('REST client normalizes API errors and encodes raw country IDs', async () => {
  const original = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = async (input) => {
    urls.push(String(input))
    return new Response(JSON.stringify({ error: { code: 'COUNTRY_NOT_FOUND', message: 'Country not found' } }),
      { status: 404, headers: { 'content-type': 'application/json' } })
  }
  try {
    await assert.rejects(getCountryHistory('session-a', 'balcan_states'),
      (error: unknown) => error instanceof ApiError && error.code === 'COUNTRY_NOT_FOUND' && error.status === 404)
    assert.equal(urls[0], '/api/v1/sessions/session-a/countries/balcan_states/history')
  } finally { globalThis.fetch = original }
})

test('backend unavailable is a network error, not an empty session list', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => { throw new TypeError('network down') }
  try {
    await assert.rejects(getSessions(),
      (error: unknown) => error instanceof ApiError && error.code === 'NETWORK_ERROR')
  } finally { globalThis.fetch = original }
})
