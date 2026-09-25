import { apiUrl } from './config.ts'
import { parseCollectorStatus, parseLiveSnapshotEvent, parseLiveState } from './parse.ts'
import type { LiveSseEvent } from './types.ts'

export interface EventSourceLike {
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
  close(): void
}

export interface LiveStreamCallbacks {
  onEvent(event: LiveSseEvent): void
  onOpen(): void
  onReconnect(): void
  onProtocolError(error: Error): void
}

export type EventSourceFactory = (url: string) => EventSourceLike

export function connectLiveStream(
  callbacks: LiveStreamCallbacks,
  createSource: EventSourceFactory = (url) => new EventSource(url),
  reconnectDelayMs = 3000,
): () => void {
  let source: EventSourceLike | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  const parseEvent = (type: LiveSseEvent['type'], parse: (value: unknown) => LiveSseEvent['data']) =>
    (event: Event) => {
      try {
        const data: unknown = JSON.parse((event as MessageEvent<string>).data)
        callbacks.onEvent({ type, data: parse(data) } as LiveSseEvent)
      } catch (cause) {
        callbacks.onProtocolError(cause instanceof Error ? cause : new Error(String(cause)))
      }
    }
  const state = parseEvent('state', parseLiveState)
  const snapshot = parseEvent('snapshot', parseLiveSnapshotEvent)
  const status = parseEvent('status', parseCollectorStatus)
  const open = () => callbacks.onOpen()
  const detach = (current: EventSourceLike) => {
    current.removeEventListener('state', state)
    current.removeEventListener('snapshot', snapshot)
    current.removeEventListener('status', status)
    current.removeEventListener('open', open)
    current.removeEventListener('error', error)
    current.close()
  }
  const error = () => {
    if (closed || !source) return
    callbacks.onReconnect()
    // A failed Vite proxy response can leave EventSource permanently closed.
    // Re-create it explicitly instead of relying only on the browser's retry.
    detach(source)
    source = null
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (!closed) connect()
    }, reconnectDelayMs)
  }
  const connect = () => {
    source = createSource(apiUrl('live/stream'))
    source.addEventListener('state', state)
    source.addEventListener('snapshot', snapshot)
    source.addEventListener('status', status)
    source.addEventListener('open', open)
    source.addEventListener('error', error)
  }
  connect()

  return () => {
    closed = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (source) detach(source)
    source = null
  }
}
