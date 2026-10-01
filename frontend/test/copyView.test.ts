import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CountrySnapshot, LiveSnapshot } from '../src/api/types.ts'
import { writeCopyText } from '../src/domain/copyClipboard.ts'
import { copyTextFor, formatCopyEverything, formatCopyNews, formatCopySnapshot,
  selectCopySnapshot } from '../src/domain/copyView.ts'
import { formatGameTurn } from '../src/domain/gameDate.ts'
import { buildOutbreakTimeline } from '../src/domain/outbreakTimeline.ts'

const country = (id: string, index: number, population: number): CountrySnapshot => ({
  id, index, currentPopulation: population, originalPopulation: population,
  healthyPopulation: population - 10, infected: 6, deadPopulation: 4, zombies: 0,
  publicOrder: 0.75, borderStatus: 'closed', airportStatus: 'open', portStatus: null,
  governmentActions: [], cureResearch: { funding: 100, allocation: 0.2, rank: 1,
    flasks: { active: 1, inactive: 3, destroyed: 0 } },
})

const base: LiveSnapshot = {
  capturedAt: '2035-01-01T12:34:56Z', day: 243, gameDate: '2027-05-30',
  diseaseTurn: 240, eventTurn: 300, cureProgress: 14,
  countries: [country('soudi_arabia', 3, 1_234_567), country('peru', 1, 10)],
  gameMilestones: [], publicOrderEvents: [], countryInfectionEvents: [], zombieHordeEvents: [],
}

test('snapshot text has exact game date, complete aligned demographics and no analytics fields', () => {
  const text = formatCopySnapshot(base)
  const lines = text.split('\n')
  assert.deepEqual(lines.slice(0, 5), [
    'PLAGUE INC SNAPSHOT', 'Day 243 · 30 May 2027', '', 'COUNTRIES', '',
  ])
  assert.match(lines[5]!, /Country\s+Population\s+Healthy\s+Infected\s+Dead\s+Zombies/)
  assert.equal(lines[6], '-'.repeat(lines[5]!.length))
  assert.equal(lines.length, 9)
  assert.ok(lines[7]!.startsWith('Soudi Arabia'))
  assert.ok(lines[8]!.startsWith('Peru'))
  assert.match(lines[7]!, /1,234,567\s+1,234,557\s+6\s+4\s+0$/)
  assert.match(lines[8]!, /\s+10\s+0\s+6\s+4\s+0$/)
  assert.equal(lines[7], ['Soudi Arabia', '1,234,567'.padStart(10),
    '1,234,557'.padStart(9), '6'.padStart(8), '4'.padStart(4), '0'.padStart(7)].join('  '))
  assert.equal(formatCopySnapshot(base), text)
  assert.doesNotMatch(text, /2035-|Public Order|governmentActions|Research|borderStatus|airportStatus|cureProgress/)
  assert.doesNotMatch(text, /<[^>]+>|\|/)
})

test('country table expands widths without truncating long names or large values', () => {
  const long = { ...country('very_long_country_name_without_truncation', 0, 1_234_567_890_123),
    infected: 1_111_111_111_111 }
  const text = formatCopySnapshot({ ...base, countries: [long, ...base.countries] })
  assert.match(text, /Very Long Country Name Without Truncation/)
  assert.match(text, /1,234,567,890,123/)
  assert.match(text, /1,111,111,111,111/)
  assert.equal(text.split('\n')[6]?.length, text.split('\n')[5]?.length)
  const allCountries = Array.from({ length: 58 }, (_, index) => country(`country_${index}`, index, index + 10))
  const allText = formatCopySnapshot({ ...base, countries: allCountries })
  assert.equal(allText.split('\n').length, 7 + 58)
  assert.ok(allText.indexOf('Country 0') < allText.indexOf('Country 57'))
})

test('news text uses Outbreak Timeline chronology, duplicates and friendly labels', () => {
  const action = { id: 'research_funding_2', turn: 243, removed: false }
  const newsSnapshot: LiveSnapshot = { ...base,
    countries: [{ ...base.countries[0]!, governmentActions: [action,
      { id: 'border_closed', turn: 244, removed: true }] }, base.countries[1]!],
    gameMilestones: [
      { type: 'more_infectious_than_tb', turn: 240, countryId: null, diseaseId: 72 },
      { type: 'disease_detected', turn: 243, countryId: 'soudi_arabia', diseaseId: 72 },
      { type: 'disease_detected', turn: 243, countryId: 'soudi_arabia', diseaseId: 72 },
    ],
    publicOrderEvents: [{ countryId: 'peru', turn: 243, fromStatus: 'normal',
      toStatus: 'general_disorder', publicOrder: 0.8898, direction: 'deteriorated' }],
  }
  const text = formatCopyNews(newsSnapshot)
  const expectedEvents = buildOutbreakTimeline(newsSnapshot)
    .map((event) => `${formatGameTurn(event.turn, newsSnapshot)}\n${event.label}`)
  assert.equal(text, `OUTBREAK NEWS\n\n${expectedEvents.join('\n\n')}`)
  assert.match(text, /Day 240 · 27 May 2027\nMore infectious than TB/)
  assert.equal((text.match(/Disease detected in Soudi Arabia/g) ?? []).length, 2)
  assert.match(text, /Soudi Arabia enacted Research Funding 2/)
  assert.match(text, /Soudi Arabia lifted Border Closed/)
  assert.match(text, /Public order in Peru deteriorated to General Disorder · 88,98%/)
  assert.ok(text.indexOf('Disease detected in Soudi Arabia')
    < text.indexOf('Soudi Arabia enacted Research Funding 2'))
  assert.doesNotMatch(text, /diseaseId|countryId|general_disorder|research_funding_2|<[^>]+>/)
  assert.doesNotMatch(text, /Country Infection History|Zombie Horde Movements/)
})

test('empty news and combined text retain exact headings and blank-line boundary', () => {
  const news = formatCopyNews(base)
  assert.equal(news, 'OUTBREAK NEWS\n\nNo outbreak timeline events available for this snapshot.')
  assert.equal(formatCopyEverything(base), `${formatCopySnapshot(base)}\n\n${news}`)
  assert.equal(copyTextFor(base, 'snapshot'), formatCopySnapshot(base))
  assert.equal(copyTextFor(base, 'news'), news)
  assert.equal(copyTextFor(base, 'everything'), formatCopyEverything(base))
  assert.doesNotMatch(formatCopyEverything(base), /<[^>]+>|\*\*|```/)
})

test('copy source uses latest LIVE or exact selected historical snapshot without leakage', () => {
  const nextLive = { ...base, day: 246, gameDate: '2027-06-02',
    countries: [{ ...base.countries[0]!, infected: 777,
      governmentActions: [{ id: 'border_closed', turn: 245, removed: false }] }],
    gameMilestones: [{ type: 'first_death' as const, turn: 246, countryId: 'soudi_arabia', diseaseId: 1 }],
    publicOrderEvents: [{ countryId: 'soudi_arabia', turn: 246, fromStatus: 'normal' as const,
      toStatus: 'general_disorder' as const, publicOrder: 0.8, direction: 'deteriorated' as const }] }
  const historical = { ...base, day: 240, gameDate: '2027-05-27',
    countries: [{ ...base.countries[0]!, infected: 12,
      governmentActions: [{ id: 'research_funding_2', turn: 239, removed: false }] }],
    gameMilestones: [{ type: 'more_infectious_than_tb' as const,
      turn: 239, countryId: null, diseaseId: 1 }] }
  const newerLiveText = formatCopyEverything(selectCopySnapshot('live', nextLive, historical)!)
  assert.match(newerLiveText, /Day 246 · 2 Jun 2027/)
  assert.match(newerLiveText, /777/)
  assert.match(newerLiveText, /First death in Soudi Arabia/)
  assert.match(newerLiveText, /Soudi Arabia enacted Border Closed/)
  assert.match(newerLiveText, /Public order in Soudi Arabia deteriorated/)
  assert.notEqual(newerLiveText, formatCopyEverything(selectCopySnapshot('live', base, historical)!))

  const oldText = formatCopyEverything(selectCopySnapshot('history', nextLive, historical)!)
  assert.match(oldText, /Day 240 · 27 May 2027/)
  assert.match(oldText, /\s+12\s+4\s+0/)
  assert.match(oldText, /More infectious than TB/)
  assert.match(oldText, /Soudi Arabia enacted Research Funding 2/)
  assert.doesNotMatch(oldText, /777|First death|Border Closed|Public order in Soudi Arabia/)
  assert.equal(selectCopySnapshot('history', nextLive, null), null)
  assert.equal(selectCopySnapshot('live', null, historical), null)
})

test('clipboard writes exactly each formatter string and handles unavailable or failing APIs', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const written: string[] = []
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true,
      value: { clipboard: { writeText: async (value: string) => { written.push(value) } } } })
    for (const target of ['snapshot', 'news', 'everything'] as const) {
      assert.equal(await writeCopyText(copyTextFor(base, target)), true)
    }
    assert.deepEqual(written, [formatCopySnapshot(base), formatCopyNews(base), formatCopyEverything(base)])
    Object.defineProperty(globalThis, 'navigator', { configurable: true,
      value: { clipboard: { writeText: async () => { throw new Error('Denied') } } } })
    assert.equal(await writeCopyText('safe'), false)
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
    assert.equal(await writeCopyText('safe'), false)
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor)
    else Reflect.deleteProperty(globalThis, 'navigator')
  }
})
