const env = (import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } }).env

export function normalizeApiBaseUrl(value?: string): string {
  const trimmed = value?.trim() || '/api/v1'
  return trimmed.replace(/\/+$/, '') || '/api/v1'
}

export const API_BASE_URL = normalizeApiBaseUrl(env?.VITE_API_BASE_URL)

export function apiUrl(path: string, baseUrl = API_BASE_URL): string {
  return `${normalizeApiBaseUrl(baseUrl)}/${path.replace(/^\/+/, '')}`
}
