export interface GameDateAnchor {
  day: number
  gameDate: string
}

const displayDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
})

export function gameDateForTurn(turn: number, anchor: GameDateAnchor): string {
  if (!Number.isSafeInteger(turn) || !Number.isSafeInteger(anchor.day)
    || !/^\d{4}-\d{2}-\d{2}$/.test(anchor.gameDate)) {
    throw new RangeError('Invalid game turn or date anchor')
  }
  const date = new Date(`${anchor.gameDate}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== anchor.gameDate) {
    throw new RangeError('Invalid game date anchor')
  }
  date.setUTCDate(date.getUTCDate() + turn - anchor.day)
  return displayDate.format(date)
}

export function formatGameTurn(turn: number, anchor: GameDateAnchor): string {
  return `Day ${turn} · ${gameDateForTurn(turn, anchor)}`
}
