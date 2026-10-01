import type { LiveSnapshot } from '../api/types.ts'
import { formatCountryName } from './countries.ts'
import { formatGameTurn } from './gameDate.ts'
import { buildOutbreakTimeline } from './outbreakTimeline.ts'

const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const headings = ['Country', 'Population', 'Healthy', 'Infected', 'Dead', 'Zombies'] as const

export type CopyTarget = 'snapshot' | 'news' | 'everything'
export type CopySource = 'live' | 'history'

export function selectCopySnapshot(
  source: CopySource, live: LiveSnapshot | null, historical: LiveSnapshot | null,
): LiveSnapshot | null {
  return source === 'live' ? live : historical
}

export function formatCopySnapshot(snapshot: LiveSnapshot): string {
  const rows = snapshot.countries.map((country) => [
    formatCountryName(country.id),
    numberFormatter.format(country.currentPopulation),
    numberFormatter.format(country.healthyPopulation),
    numberFormatter.format(country.infected),
    numberFormatter.format(country.deadPopulation),
    numberFormatter.format(country.zombies),
  ])
  const widths = headings.map((heading, index) => Math.max(heading.length,
    ...rows.map((row) => row[index]!.length)))
  const line = (cells: readonly string[]) => cells.map((cell, index) => index === 0
    ? cell.padEnd(widths[index]!) : cell.padStart(widths[index]!)).join('  ')
  const header = line(headings)
  const table = [header, '-'.repeat(header.length), ...rows.map(line)].join('\n')

  return `PLAGUE INC SNAPSHOT\n${formatGameTurn(snapshot.day, snapshot)}\n\nCOUNTRIES\n\n${table}`
}

export function formatCopyNews(snapshot: LiveSnapshot): string {
  const events = buildOutbreakTimeline(snapshot)
  const body = events.length === 0
    ? 'No outbreak timeline events available for this snapshot.'
    : events.map((event) => `${formatGameTurn(event.turn, snapshot)}\n${event.label}`).join('\n\n')
  return `OUTBREAK NEWS\n\n${body}`
}

export function formatCopyEverything(snapshot: LiveSnapshot): string {
  return `${formatCopySnapshot(snapshot)}\n\n${formatCopyNews(snapshot)}`
}

export function copyTextFor(snapshot: LiveSnapshot, target: CopyTarget): string {
  switch (target) {
    case 'snapshot': return formatCopySnapshot(snapshot)
    case 'news': return formatCopyNews(snapshot)
    case 'everything': return formatCopyEverything(snapshot)
  }
}
