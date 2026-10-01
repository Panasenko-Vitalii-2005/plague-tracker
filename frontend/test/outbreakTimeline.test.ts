import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseHistoricalSnapshot, parseLiveSnapshot } from '../src/api/parse.ts'
import type { CountrySnapshot, LiveSnapshot, PublicOrderEvent } from '../src/api/types.ts'
import { formatGameTurn, gameDateForTurn } from '../src/domain/gameDate.ts'
import { buildOutbreakTimeline } from '../src/domain/outbreakTimeline.ts'
import { formatPublicOrderWithStatus, publicOrderStatus, publicOrderStatusLabel } from '../src/domain/publicOrder.ts'

const country = (id: string, index: number): CountrySnapshot => ({
  id, index, currentPopulation: 100, originalPopulation: 100, healthyPopulation: 90,
  infected: 10, deadPopulation: 0, zombies: 0, publicOrder: 0.9,
  borderStatus: null, airportStatus: null, portStatus: null, cureResearch: null,
  governmentActions: [],
})

const base: LiveSnapshot = {
  capturedAt: '2035-01-01T00:00:00.000Z', day: 243, gameDate: '2027-05-30',
  diseaseTurn: 240, eventTurn: 301, cureProgress: 0,
  countries: [country('japan', 0), country('morroco', 1)],
  zombieHordeEvents: [], countryInfectionEvents: [], gameMilestones: [], publicOrderEvents: [],
}

const transition: PublicOrderEvent = {
  countryId: 'morroco', turn: 243, fromStatus: 'normal', toStatus: 'general_disorder',
  publicOrder: 0.8999999, direction: 'deteriorated',
}

test('five confirmed Public Order states use exact raw boundaries and readable labels', () => {
  const cases = [
    [1, 'normal', 'Normal'], [0.9, 'normal', 'Normal'],
    [0.8999999, 'general_disorder', 'General Disorder'],
    [0.6, 'general_disorder', 'General Disorder'],
    [0.5999999, 'mass_disorder', 'Mass Disorder'],
    [0.3, 'mass_disorder', 'Mass Disorder'],
    [0.2999999, 'near_anarchy', 'Near Anarchy'],
    [Number.MIN_VALUE, 'near_anarchy', 'Near Anarchy'],
    [0, 'anarchy', 'Anarchy'],
  ] as const
  for (const [value, expected, label] of cases) {
    assert.equal(publicOrderStatus(value), expected)
    assert.equal(publicOrderStatusLabel(expected), label)
  }
  assert.equal(publicOrderStatus(null), null)
  assert.equal(formatPublicOrderWithStatus(null), 'N/A')
  assert.equal(formatPublicOrderWithStatus(0.8999999), '90,00% · General Disorder')
  for (const invalid of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => publicOrderStatus(invalid), RangeError)
  }
})

test('Public Order event parser normalizes missing, preserves order/raw precision/duplicates and rejects malformed data', () => {
  assert.deepEqual(parseLiveSnapshot({ ...base, publicOrderEvents: undefined }).publicOrderEvents, [])
  const events = [transition, { ...transition }, { countryId: 'japan', turn: 244,
    fromStatus: 'near_anarchy', toStatus: 'anarchy', publicOrder: 0,
    direction: 'deteriorated' }]
  assert.deepEqual(parseLiveSnapshot({ ...base, publicOrderEvents: events }).publicOrderEvents, events)
  assert.deepEqual(parseHistoricalSnapshot({ ...base, sessionId: 'saved', publicOrderEvents: events }).publicOrderEvents,
    events)
  for (const invalid of [
    null, { ...transition, countryId: '' }, { ...transition, countryId: 42 },
    { ...transition, turn: -1 }, { ...transition, turn: 1.5 },
    { ...transition, fromStatus: 'stable' }, { ...transition, toStatus: 'stable' },
    { ...transition, direction: 'improved' }, { ...transition, publicOrder: 0.59 },
    { ...transition, publicOrder: -0.1 }, { ...transition, publicOrder: Number.NaN },
  ]) {
    assert.throws(() => parseLiveSnapshot({ ...base, publicOrderEvents: [invalid] }), /public order/)
  }
  for (const invalid of [null, {}, 'events']) {
    assert.throws(() => parseLiveSnapshot({ ...base, publicOrderEvents: invalid }), /publicOrderEvents/)
  }
})

test('date helper uses snapshot gameDate UTC anchor, not capturedAt, across month and year boundaries', () => {
  assert.equal(formatGameTurn(243, base), 'Day 243 · 30 May 2027')
  assert.equal(formatGameTurn(242, base), 'Day 242 · 29 May 2027')
  assert.equal(formatGameTurn(245, base), 'Day 245 · 1 Jun 2027')
  const yearEnd = { day: 10, gameDate: '2027-12-31' }
  assert.equal(gameDateForTurn(11, yearEnd), '1 Jan 2028')
  assert.equal(gameDateForTurn(9, yearEnd), '30 Dec 2027')
  assert.equal(gameDateForTurn(243, { ...base, gameDate: '2027-05-30' }), '30 May 2027')
  assert.throws(() => gameDateForTurn(1, { day: 1, gameDate: '2027-02-30' }), RangeError)
})

test('timeline merges three sources by turn, breaks ties by source and retains duplicate-looking entries', () => {
  const milestone = { type: 'first_death' as const, turn: 243, countryId: 'japan', diseaseId: 0 }
  const action = { id: 'research_funding_2', turn: 243, removed: false }
  const lifted = { id: 'border_closed', turn: 245, removed: true }
  const input: LiveSnapshot = { ...base,
    gameMilestones: [{ type: 'virus_dna_detected', turn: 240, countryId: null, diseaseId: 0 },
      milestone, { ...milestone }],
    countries: [{ ...country('japan', 0), governmentActions: [action, lifted] }, country('morroco', 1)],
    publicOrderEvents: [transition, { ...transition }, { ...transition, turn: 242,
      fromStatus: 'mass_disorder', toStatus: 'general_disorder', publicOrder: 0.7,
      direction: 'improved' }],
  }
  const original = JSON.stringify(input)
  const entries = buildOutbreakTimeline(input)
  assert.deepEqual(entries.map((entry) => [entry.turn, entry.kind]), [
    [240, 'milestone'], [242, 'public_order'], [243, 'milestone'], [243, 'milestone'],
    [243, 'government_action'], [243, 'public_order'], [243, 'public_order'],
    [245, 'government_action'],
  ])
  assert.equal(entries.filter((entry) => entry.label === 'First death in Japan').length, 2)
  assert.equal(entries.filter((entry) => entry.label.includes('Morroco deteriorated')).length, 2)
  assert.match(entries.find((entry) => entry.kind === 'public_order' && entry.turn === 243)!.label,
    /General Disorder · 90,00%/)
  assert.ok(entries.some((entry) => entry.label === 'Japan enacted Research Funding 2'))
  assert.ok(entries.some((entry) => entry.label === 'Japan lifted Border Closed'))
  assert.equal(JSON.stringify(input), original, 'sorting must not mutate source arrays')
  assert.deepEqual(buildOutbreakTimeline(base), [])
})
