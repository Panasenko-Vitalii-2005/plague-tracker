import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GlobalHistoryPoint } from '../src/api/types.ts'
import { adjacentDay, dayAtSliderIndex, observedDays, replayDay, replayIndex } from '../src/domain/replay.ts'

const point = (day: number): GlobalHistoryPoint => ({
  capturedAt: '2026-09-23T00:00:00Z', day, gameDate: '2027-01-01', diseaseTurn: day,
  eventTurn: day, cureProgress: 0, healthy: 1, infected: 2, dead: 3, zombies: 0,
  originalPopulation: 6,
})

test('replay days are exactly the observed history and initial day is latest', () => {
  const days = observedDays([100, 101, 104, 105].map(point))
  assert.deepEqual(days, [100, 101, 104, 105])
  assert.equal(replayDay(days, null), 105)
  assert.equal(replayDay([8, 12], null), 12) // New session uses its own last observed day.
  assert.equal(replayDay([], null), null)
})

test('previous, next, slider and playback steps never synthesize gap days', () => {
  const days = [100, 101, 104, 105]
  assert.equal(adjacentDay(days, 101, 1), 104)
  assert.equal(adjacentDay(days, 104, -1), 101)
  assert.equal(adjacentDay(days, 100, -1), null)
  assert.equal(adjacentDay(days, 105, 1), null)
  assert.equal(dayAtSliderIndex(days, 2), 104)
  assert.equal(replayIndex(days, 104), 2)
  const played = [100]
  while (adjacentDay(days, played.at(-1)!, 1) !== null) played.push(adjacentDay(days, played.at(-1)!, 1)!)
  assert.deepEqual(played, days)
})
