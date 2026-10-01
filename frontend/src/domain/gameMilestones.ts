import type { GameMilestone, GameMilestoneType } from '../api/types.ts'
import { formatCountryName } from './countries.ts'

const labels: Record<GameMilestoneType, string> = {
  virus_dna_detected: 'Virus DNA detected',
  more_infectious_than_tb: 'More infectious than TB',
  more_infectious_than_hiv: 'More infectious than HIV',
  disease_detected: 'Disease detected in',
  first_death: 'First death in',
  more_infectious_than_common_cold: 'More infectious than the Common Cold',
  worse_than_black_death: 'Worse than the Black Death',
  worse_than_spanish_flu: 'Worse than Spanish Flu',
  worse_than_smallpox: 'Worse than Smallpox',
}

export function milestoneLabel(event: GameMilestone): string {
  const label = labels[event.type]
  return event.countryId === null ? label : `${label} ${formatCountryName(event.countryId)}`
}
