import { apiUrl } from './config.ts'
import {
  parseCountryHistory, parseLiveState, parseSessionCountries, parseSessionDetails, parseSessionHistory, parseSessions,
} from './parse.ts'
import type {
  CountryHistoryResponse, LiveState, SessionCountriesResponse, SessionDetails, SessionHistoryResponse, SessionSummary,
} from './types.ts'

export class ApiError extends Error {
  readonly code: string
  readonly status: number | null

  constructor(
    message: string,
    code: string,
    status: number | null,
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

async function request<T>(path: string, parse: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(apiUrl(path), { signal })
  } catch (cause) {
    if (signal?.aborted) throw cause
    throw new ApiError('Backend недоступен. Проверьте, что он запущен.', 'NETWORK_ERROR', null)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ApiError('Backend вернул некорректный JSON.', 'INVALID_RESPONSE', response.status)
  }

  if (!response.ok) {
    const error = typeof body === 'object' && body !== null && 'error' in body
      ? (body as { error?: { code?: unknown; message?: unknown } }).error
      : undefined
    throw new ApiError(
      typeof error?.message === 'string' ? error.message : `HTTP ${response.status}`,
      typeof error?.code === 'string' ? error.code : 'HTTP_ERROR',
      response.status,
    )
  }

  try {
    return parse(body)
  } catch (cause) {
    throw new ApiError(
      cause instanceof Error ? cause.message : 'Unexpected response shape',
      'INVALID_RESPONSE',
      response.status,
    )
  }
}

export function getHealth(signal?: AbortSignal): Promise<{ status: 'ok' }> {
  return request('health', (value) => {
    if (typeof value !== 'object' || value === null || !('status' in value) || value.status !== 'ok') {
      throw new Error('Invalid health response')
    }
    return { status: 'ok' as const }
  }, signal)
}

export const getLive = (signal?: AbortSignal): Promise<LiveState> =>
  request('live', parseLiveState, signal)

export const getSessions = (signal?: AbortSignal): Promise<SessionSummary[]> =>
  request('sessions', parseSessions, signal)

export const getSession = (id: string, signal?: AbortSignal): Promise<SessionDetails> =>
  request(`sessions/${encodeURIComponent(id)}`, parseSessionDetails, signal)

export const getSessionHistory = (id: string, signal?: AbortSignal): Promise<SessionHistoryResponse> =>
  request(`sessions/${encodeURIComponent(id)}/history`, parseSessionHistory, signal)

export const getSessionCountries = (id: string, signal?: AbortSignal): Promise<SessionCountriesResponse> =>
  request(`sessions/${encodeURIComponent(id)}/countries`, parseSessionCountries, signal)

export const getCountryHistory = (
  sessionId: string,
  countryId: string,
  signal?: AbortSignal,
): Promise<CountryHistoryResponse> =>
  request(`sessions/${encodeURIComponent(sessionId)}/countries/${encodeURIComponent(countryId)}/history`,
    parseCountryHistory, signal)
