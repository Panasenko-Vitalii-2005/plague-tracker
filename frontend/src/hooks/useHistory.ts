import { useCallback, useEffect, useState } from 'react'
import { getCountryHistory, getSession, getSessionCountries, getSessionHistory, getSessions } from '../api/client.ts'
import type {
  CountryHistoryResponse, SessionCountriesResponse, SessionDetails, SessionHistoryResponse, SessionSummary,
} from '../api/types.ts'

export type Resource<T> =
  | { status: 'idle' | 'loading'; data: null; error: null; reload: () => void }
  | { status: 'success' | 'empty'; data: T; error: null; reload: () => void }
  | { status: 'error'; data: null; error: Error; reload: () => void }

function useResource<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  isEmpty: (data: T) => boolean,
): Resource<T> {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<
    | { key: string | null; status: 'idle' | 'loading'; data: null; error: null }
    | { key: string | null; status: 'success' | 'empty'; data: T; error: null }
    | { key: string | null; status: 'error'; data: null; error: Error }
  >({ key, status: key === null ? 'idle' : 'loading', data: null, error: null })

  useEffect(() => {
    if (key === null) return
    const controller = new AbortController()
    let current = true
    load(controller.signal).then((data) => {
      if (current) setState({ key, status: isEmpty(data) ? 'empty' : 'success', data, error: null })
    }).catch((cause: unknown) => {
      if (current && !controller.signal.aborted) {
        setState({ key, status: 'error', data: null,
          error: cause instanceof Error ? cause : new Error(String(cause)) })
      }
    })
    return () => { current = false; controller.abort() }
  }, [key, revision, load, isEmpty])

  const reload = () => {
    setState({ key, status: key === null ? 'idle' : 'loading', data: null, error: null })
    setRevision((value) => value + 1)
  }
  if (key === null) return { status: 'idle', data: null, error: null, reload }
  if (state.key !== key) return { status: 'loading', data: null, error: null, reload }
  return { ...state, reload } as Resource<T>
}

export function useSessions(): Resource<SessionSummary[]> {
  return useResource('sessions', getSessions, emptySessions)
}

export function useSession(sessionId: string | null): Resource<SessionDetails> {
  const load = useCallback((signal: AbortSignal) => getSession(sessionId!, signal), [sessionId])
  return useResource(sessionId, load, neverEmpty)
}

export function useSessionHistory(sessionId: string | null): Resource<SessionHistoryResponse> {
  const load = useCallback((signal: AbortSignal) => getSessionHistory(sessionId!, signal), [sessionId])
  return useResource(sessionId, load, emptyHistory)
}

export function useSessionCountries(sessionId: string | null): Resource<SessionCountriesResponse> {
  const load = useCallback((signal: AbortSignal) => getSessionCountries(sessionId!, signal), [sessionId])
  return useResource(sessionId, load, emptyCountries)
}

export function useCountryHistory(
  sessionId: string | null,
  countryId: string | null,
): Resource<CountryHistoryResponse> {
  const key = sessionId && countryId ? `${sessionId}\u0000${countryId}` : null
  const load = useCallback((signal: AbortSignal) => getCountryHistory(sessionId!, countryId!, signal),
    [sessionId, countryId])
  return useResource(key, load, emptyHistory)
}

const emptySessions = (data: SessionSummary[]) => data.length === 0
const neverEmpty = () => false
const emptyHistory = (data: SessionHistoryResponse | CountryHistoryResponse) => data.history.length === 0
const emptyCountries = (data: SessionCountriesResponse) => data.countries.length === 0
