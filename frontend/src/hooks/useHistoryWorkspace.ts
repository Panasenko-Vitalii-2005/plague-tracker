import { useState } from 'react'
import { resolveSessionCountry } from '../domain/countries.ts'
import { useCountryHistory, useSession, useSessionCountries, useSessionHistory, useSessions } from './useHistory.ts'
import { useReplay } from './useReplay.ts'

export function useHistoryWorkspace() {
  const sessions = useSessions()
  const [sessionId, setSessionId] = useState('')
  const [preferredCountryId, setPreferredCountryId] = useState<string | null>(null)
  const session = useSession(sessionId || null)
  const global = useSessionHistory(sessionId || null)
  const replay = useReplay(sessionId, global)
  const countries = useSessionCountries(sessionId || null)
  const availableCountries = countries.status === 'success' ? countries.data.countries : []
  const countryId = countries.status === 'success'
    ? resolveSessionCountry(availableCountries, preferredCountryId) : null
  const country = useCountryHistory(sessionId || null, countryId)

  return {
    sessions, session, global, countries, country, replay, sessionId,
    onSessionChange: (id: string) => { replay.reset(); setSessionId(id) },
    preferredCountryId, onCountryChange: setPreferredCountryId,
  }
}

export type HistoryWorkspace = ReturnType<typeof useHistoryWorkspace>
