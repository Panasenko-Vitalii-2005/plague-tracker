const populationFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const percentFormatter = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const axisFormatter = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export function formatPopulation(value: number): string {
  return populationFormatter.format(value).replace(/[\u00a0\u202f]/g, ' ')
}

export function formatPercent(value: number): string {
  return `${percentFormatter.format(value).replace(/[\u00a0\u202f]/g, ' ')}%`
}

export function formatPublicOrder(value: number | null): string {
  return value === null ? 'N/A' : formatPercent(value * 100)
}

export function formatAxisPopulation(value: number): string {
  return axisFormatter.format(value)
}
