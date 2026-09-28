import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mapCountryHistoryToChart, mapGlobalHistoryToChart } from '../src/domain/chart.ts'
import { formatCountryName, resolveSessionCountry } from '../src/domain/countries.ts'
import { countryOverview, globalPercentages, liveStatus, percentageOf, shortSessionId } from '../src/domain/dashboard.ts'
import { formatAxisPopulation, formatPercent, formatPopulation, formatPublicOrder } from '../src/domain/format.ts'
import { formatGovernmentAction, formatResearchAllocation, formatResearchBudget } from '../src/domain/countryResearch.ts'
import { aggregateCountries } from '../src/domain/metrics.ts'

test('global live metrics are sums, independent of currentPopulation semantics', () => {
  const values = aggregateCountries([
    { index: 0, id: 'morroco', currentPopulation: 999, originalPopulation: 100,
      healthyPopulation: 70, infected: 20, deadPopulation: 5, zombies: 1,
      publicOrder: null, governmentActions: [], cureResearch: null },
    { index: 1, id: 'philipines', currentPopulation: 1, originalPopulation: 200,
      healthyPopulation: 100, infected: 50, deadPopulation: 30, zombies: 4,
      publicOrder: null, governmentActions: [], cureResearch: null },
  ])
  assert.deepEqual(values, { healthy: 170, infected: 70, dead: 35, zombies: 5, originalPopulation: 300 })
})

test('chart mapper retains actual day values and never interpolates gaps', () => {
  const point = { capturedAt: '2026-09-23T00:00:00Z', gameDate: '2026-10-01',
    diseaseTurn: 1, eventTurn: 2, cureProgress: 13,
    healthy: 90, infected: 10, dead: 0, zombies: 0, originalPopulation: 100 }
  const chart = mapGlobalHistoryToChart([{ ...point, day: 120 }, { ...point, day: 121 }, { ...point, day: 124 }])
  assert.deepEqual(chart.map((entry) => entry.day), [120, 121, 124])
  assert.equal(chart.length, 3)
  assert.equal(chart[2]?.cureProgress, 13)
  assert.equal(chart[2]?.gameDate, '2026-10-01')
  assert.equal(chart[2]?.infected, 10)
})

test('country chart retains actual game days, dates and raw population values', () => {
  const point = { capturedAt: '2026-09-23T00:00:00Z', gameDate: '2026-10-01',
    currentPopulation: 85, originalPopulation: 100, healthyPopulation: 70,
    infected: 10, deadPopulation: 5, zombies: 2 }
  const chart = mapCountryHistoryToChart([{ ...point, day: 10 }, { ...point, day: 13 }])
  assert.deepEqual(chart.map((entry) => entry.day), [10, 13])
  assert.deepEqual(chart[1], { day: 13, gameDate: '2026-10-01', healthy: 70,
    infected: 10, dead: 5, zombies: 2 })
})

test('global and country percentages use original population and handle zero safely', () => {
  assert.equal(percentageOf(25, 200), 12.5)
  assert.equal(percentageOf(5, 0), 0)
  assert.equal(percentageOf(Number.POSITIVE_INFINITY, 100), 0)
  assert.deepEqual(globalPercentages({ healthy: 60, infected: 30, dead: 10,
    zombies: 0, originalPopulation: 100 }), { healthy: 60, infected: 30, dead: 10, zombies: 0 })
  assert.deepEqual(countryOverview({ healthyPopulation: 60, infected: 30, deadPopulation: 10,
    zombies: 0, originalPopulation: 100, currentPopulation: 77 }), {
    healthy: 60, infected: 30, dead: 10, zombies: 0, originalPopulation: 100,
    currentPopulation: 77, healthyPercent: 60, infectedPercent: 30, deadPercent: 10,
  })
})

test('status copy distinguishes waiting from backend unavailable', () => {
  assert.deepEqual(liveStatus('waiting-for-game'), { label: 'Waiting for game', tone: 'waiting',
    description: 'Backend is ready. Open a game to start live tracking.' })
  assert.deepEqual(liveStatus('reconnecting'), { label: 'Reconnecting', tone: 'offline',
    description: 'Connection lost. Retrying automatically…' })
  assert.equal(liveStatus('error').label, 'Backend unavailable')
  assert.equal(shortSessionId('12345678-aaaa-bbbb'), '12345678…')
})

test('shared formatters use grouped populations and two-decimal cure', () => {
  assert.equal(formatPopulation(12_300_000), '12 300 000')
  assert.equal(formatPercent(25.51), '25,51%')
  assert.equal(formatAxisPopulation(1_200_000), '1.2M')
  assert.equal(formatPublicOrder(1), '100,00%')
  assert.equal(formatPublicOrder(0), '0,00%')
  assert.equal(formatPublicOrder(0.9497843), '94,98%')
  assert.equal(formatPublicOrder(0.50941885), '50,94%')
  assert.equal(formatPublicOrder(0.4627481), '46,27%')
  assert.equal(formatPublicOrder(null), 'N/A')
})

test('research formatting keeps numeric precision and accepts unknown raw action IDs', () => {
  assert.equal(formatResearchBudget(1564.9822), '$1,564.98')
  assert.equal(formatResearchAllocation(0.2), '20%')
  assert.equal(formatResearchAllocation(0.12345), '12.35%')
  assert.equal(formatGovernmentAction('infectious_disease_teams__mobilised'),
    'Infectious Disease Teams Mobilised')
  assert.equal(formatGovernmentAction('  urban_evacuation_ordered  '), 'Urban Evacuation Ordered')
})

test('historical session switch only selects a country present in the new REST list', () => {
  const first = [{ id: 'peru', index: 0 }, { id: 'morroco', index: 1 }]
  const second = [{ id: 'argentina', index: 0 }, { id: 'peru', index: 1 }]
  const third = [{ id: 'ukraine', index: 0 }]
  assert.equal(resolveSessionCountry(first, null), 'peru')
  assert.equal(resolveSessionCountry(second, 'peru'), 'peru')
  assert.equal(resolveSessionCountry(third, 'peru'), 'ukraine')
  assert.equal(resolveSessionCountry([], 'peru'), null)
  assert.equal(formatCountryName('south_africa'), 'South Africa')
  assert.equal(formatCountryName('soudi_arabia'), 'Soudi Arabia')
})
