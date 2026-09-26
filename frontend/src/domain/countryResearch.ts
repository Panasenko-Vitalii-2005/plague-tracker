const budgetFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
})
const allocationFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

export function formatResearchBudget(funding: number): string {
  return budgetFormatter.format(funding)
}

export function formatResearchAllocation(allocation: number): string {
  return `${allocationFormatter.format(allocation * 100)}%`
}

export function formatGovernmentAction(id: string): string {
  return id.replace(/_+/g, ' ').trim().replace(/\s+/g, ' ')
    .split(' ').map((word) => word ? `${word[0]!.toUpperCase()}${word.slice(1).toLowerCase()}` : '').join(' ')
}
