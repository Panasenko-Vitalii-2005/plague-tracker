import { connectLiveStream, type LiveStreamCallbacks } from './liveStream.ts'
import type { CollectorStatus, GameSession, LiveSnapshot, LiveSseEvent } from './types.ts'

export type LiveConnectionState = 'connecting' | 'waiting-for-game' | 'live' | 'reconnecting' | 'error'

export interface LiveGameView {
  connectionState: LiveConnectionState
  collectorStatus: CollectorStatus
  session: GameSession | null
  sessionId: string | null
  snapshot: LiveSnapshot | null
  error: Error | null
}

const initialState: LiveGameView = {
  connectionState: 'connecting',
  collectorStatus: { running: false, lastError: null },
  session: null,
  sessionId: null,
  snapshot: null,
  error: null,
}

export type ConnectLiveStream = (callbacks: LiveStreamCallbacks) => () => void

export class LiveGameStore {
  private state: LiveGameView = initialState
  private readonly listeners = new Set<() => void>()
  private disconnect: (() => void) | null = null
  private closeTimer: ReturnType<typeof setTimeout> | null = null
  private readonly connectStream: ConnectLiveStream

  constructor(connectStream: ConnectLiveStream = connectLiveStream) {
    this.connectStream = connectStream
  }

  getSnapshot = (): LiveGameView => this.state

  subscribe = (listener: () => void): (() => void) => {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer)
      this.closeTimer = null
    }
    this.listeners.add(listener)
    if (!this.disconnect) this.connect()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0 && !this.closeTimer) {
        // React StrictMode immediately re-subscribes in development. Keep the
        // same EventSource across that replay, but close it on a real unmount.
        this.closeTimer = setTimeout(() => {
          this.closeTimer = null
          if (this.listeners.size === 0) {
            this.disconnect?.()
            this.disconnect = null
            this.state = initialState
          }
        }, 0)
      }
    }
  }

  private connect(): void {
    this.update(initialState)
    this.disconnect = this.connectStream({
      onEvent: (event) => this.applyEvent(event),
      onOpen: () => {
        if (this.state.connectionState === 'reconnecting') {
          this.update({ ...this.state, connectionState: 'connecting', error: null })
        }
      },
      onReconnect: () => this.update({ ...initialState,
        connectionState: 'reconnecting',
        error: new Error('Связь с backend потеряна. Повторное подключение…'),
      }),
      onProtocolError: (error) => this.update({ ...initialState, connectionState: 'error', error }),
    })
  }

  private applyEvent(event: LiveSseEvent): void {
    if (event.type === 'state') {
      const { collector, session, snapshot } = event.data
      this.update({
        connectionState: !collector.running ? 'waiting-for-game' : snapshot ? 'live' : 'connecting',
        collectorStatus: collector,
        session,
        sessionId: session?.id ?? null,
        snapshot,
        error: null,
      })
      return
    }
    if (event.type === 'status') {
      const status = event.data
      this.update({
        ...this.state,
        collectorStatus: status,
        connectionState: status.running ? (this.state.snapshot ? 'live' : 'connecting') : 'waiting-for-game',
        session: status.running ? this.state.session : null,
        sessionId: status.running ? this.state.sessionId : null,
        snapshot: status.running ? this.state.snapshot : null,
        error: null,
      })
      return
    }
    const { sessionId, snapshot } = event.data
    this.update({
      connectionState: 'live',
      collectorStatus: { running: true, lastError: null },
      session: this.state.sessionId === sessionId ? this.state.session : null,
      sessionId,
      snapshot,
      error: null,
    })
  }

  private update(next: LiveGameView): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }
}

export const liveGameStore = new LiveGameStore()
