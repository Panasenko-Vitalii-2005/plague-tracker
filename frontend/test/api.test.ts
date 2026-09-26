import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apiUrl, normalizeApiBaseUrl } from '../src/api/config.ts'
import { ApiError, getCountryHistory, getHistoricalSnapshot, getSessionCountries, getSessions } from '../src/api/client.ts'
import { parseHistoricalSnapshot, parseLiveState, parseSessionCountries, parseSessionHistory, parseSessions } from '../src/api/parse.ts'

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
  assert.equal(value.snapshot?.cureProgress, 25.51)
  assert.throws(() => parseLiveState({ collector: { running: true, lastError: null }, session: null,
    snapshot: { ...snapshot, countries: [{ ...country, infected: 'twenty' }] } }), /country.infected/)
})

test('full historical snapshot parser validates every field and keeps raw country IDs', () => {
  const parsed = parseHistoricalSnapshot({ sessionId: 'session-a', ...snapshot })
  assert.equal(parsed.sessionId, 'session-a')
  assert.deepEqual(parsed.countries, [country])
  for (const [key, value] of Object.entries({ sessionId: 4, capturedAt: 4, day: '10', gameDate: 4,
    diseaseTurn: '12', eventTurn: '14', cureProgress: '25', countries: null })) {
    assert.throws(() => parseHistoricalSnapshot({ sessionId: 'session-a', ...snapshot, [key]: value }))
  }
  assert.throws(() => parseHistoricalSnapshot({ sessionId: 'session-a', ...snapshot,
    countries: [{ ...country, infected: '20' }] }), /country.infected/)
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
