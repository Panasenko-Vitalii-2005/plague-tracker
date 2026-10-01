import type { LiveSnapshot } from '../api/types.ts'
import { milestoneLabel } from './gameMilestones.ts'
import { formatCountryName } from './countries.ts'
import { formatPublicOrder } from './format.ts'
import { formatGovernmentAction } from './countryResearch.ts'
import { publicOrderStatusLabel } from './publicOrder.ts'

export interface OutbreakTimelineEntry {
  turn: number
  kind: 'milestone' | 'government_action' | 'public_order'
  label: string
}

export function buildOutbreakTimeline(snapshot: LiveSnapshot): OutbreakTimelineEntry[] {
  const entries: Array<OutbreakTimelineEntry & { source: number; sequence: number }> = []
  snapshot.gameMilestones.forEach((event, sequence) => entries.push({
    turn: event.turn, kind: 'milestone', label: milestoneLabel(event), source: 0, sequence,
  }))
  let actionSequence = 0
  snapshot.countries.forEach((country) => country.governmentActions.forEach((action) => entries.push({
    turn: action.turn, kind: 'government_action',
    label: `${formatCountryName(country.id)} ${action.removed ? 'lifted' : 'enacted'} ${formatGovernmentAction(action.id)}`,
    source: 1, sequence: actionSequence++,
  })))
  snapshot.publicOrderEvents.forEach((event, sequence) => entries.push({
    turn: event.turn, kind: 'public_order',
    label: `Public order in ${formatCountryName(event.countryId)} ${event.direction} to ${publicOrderStatusLabel(event.toStatus)} · ${formatPublicOrder(event.publicOrder)}`,
    source: 2, sequence,
  }))
  entries.sort((left, right) => left.turn - right.turn || left.source - right.source
    || left.sequence - right.sequence)
  return entries.map(({ turn, kind, label }) => ({ turn, kind, label }))
}
