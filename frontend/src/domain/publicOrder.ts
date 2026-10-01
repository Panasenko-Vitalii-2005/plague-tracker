import type { PublicOrderStatus } from '../api/types.ts'
import { formatPublicOrder } from './format.ts'

export const publicOrderStatuses: readonly PublicOrderStatus[] = [
  'normal', 'general_disorder', 'mass_disorder', 'near_anarchy', 'anarchy',
]

const labels: Record<PublicOrderStatus, string> = {
  normal: 'Normal',
  general_disorder: 'General Disorder',
  mass_disorder: 'Mass Disorder',
  near_anarchy: 'Near Anarchy',
  anarchy: 'Anarchy',
}

export function isPublicOrderStatus(value: unknown): value is PublicOrderStatus {
  return typeof value === 'string' && publicOrderStatuses.includes(value as PublicOrderStatus)
}

// These bands match the confirmed backend contract; they are not game enums.
export function publicOrderStatus(value: number | null): PublicOrderStatus | null {
  if (value === null) return null
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('publicOrder must be a finite fraction in 0..1')
  }
  if (value >= 0.9) return 'normal'
  if (value >= 0.6) return 'general_disorder'
  if (value >= 0.3) return 'mass_disorder'
  if (value > 0) return 'near_anarchy'
  return 'anarchy'
}

export function publicOrderStatusLabel(status: PublicOrderStatus): string {
  return labels[status]
}

export function formatPublicOrderWithStatus(value: number | null): string {
  const status = publicOrderStatus(value)
  return status === null ? 'N/A' : `${formatPublicOrder(value)} · ${publicOrderStatusLabel(status)}`
}
