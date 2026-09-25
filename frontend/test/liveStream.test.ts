import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { connectLiveStream, type EventSourceLike, type LiveStreamCallbacks } from '../src/api/liveStream.ts'
import { LiveGameStore } from '../src/api/liveStore.ts'

class FakeEventSource implements EventSourceLike {
  readonly listeners = new Map<string, Set<EventListener>>()
  closed = false
  addEventListener(type: string, listener: EventListener): void {
    const list = this.listeners.get(type) ?? new Set<EventListener>()
    list.add(listener)
    this.listeners.set(type, list)
  }
  removeEventListener(type: string, listener: EventListener): void { this.listeners.get(type)?.delete(listener) }
  close(): void { this.closed = true }
  emit(type: string, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) } as Event)
    }
  }
  listenerCount(): number { return [...this.listeners.values()].reduce((sum, list) => sum + list.size, 0) }
}

const country = { index: 0, id: 'balcan_states', currentPopulation: 10,
  originalPopulation: 20, healthyPopulation: 5, deadPopulation: 1, infected: 4, zombies: 0 }
const snapshot = { capturedAt: '2026-09-23T00:00:00Z', day: 5, gameDate: '2026-09-28',
  diseaseTurn: 5, eventTurn: 6, cureProgress: 2, countries: [country] }

test('SSE parses state, snapshot and status and removes every listener on cleanup', () => {
  const source = new FakeEventSource()
  const events: string[] = []
  const end = connectLiveStream({
    onEvent: (event) => events.push(event.type),
    onOpen: () => events.push('open'),
    onReconnect: () => events.push('reconnect'),
    onProtocolError: (error) => { throw error },
  }, () => source)
  assert.equal(source.listenerCount(), 5)
  source.emit('open')
  source.emit('state', { collector: { running: false, lastError: null }, session: null, snapshot: null })
  source.emit('snapshot', { sessionId: 'a', snapshot })
  source.emit('status', { running: false, lastError: null })
  source.emit('error')
  assert.deepEqual(events, ['open', 'state', 'snapshot', 'status', 'reconnect'])
  end()
  assert.equal(source.closed, true)
  assert.equal(source.listenerCount(), 0)
})

test('SSE recreates a failed source and cleanup cancels a pending retry', async () => {
  const sources: FakeEventSource[] = []
  const events: string[] = []
  const end = connectLiveStream({
    onEvent: (event) => events.push(event.type),
    onOpen: () => events.push('open'),
    onReconnect: () => events.push('reconnect'),
    onProtocolError: (error) => { throw error },
  }, () => {
    const next = new FakeEventSource()
    sources.push(next)
    return next
  }, 5)
  assert.equal(sources.length, 1)
  sources[0].emit('error')
  assert.equal(sources[0].closed, true)
  assert.equal(sources[0].listenerCount(), 0)
  await delay(15)
  assert.equal(sources.length, 2)
  sources[1].emit('open')
  sources[1].emit('state', { collector: { running: false, lastError: null }, session: null, snapshot: null })
  assert.deepEqual(events, ['reconnect', 'open', 'state'])
  sources[1].emit('error')
  end()
  await delay(15)
  assert.equal(sources.length, 2)
  assert.equal(sources[1].closed, true)
})

test('same store subscription survives repeated subscribers and StrictMode replay without duplicate connection', async () => {
  let connects = 0
  let closes = 0
  const store = new LiveGameStore(() => { connects++; return () => { closes++ } })
  const first = store.subscribe(() => {})
  const second = store.subscribe(() => {})
  assert.equal(connects, 1)
  first()
  assert.equal(closes, 0)
  second()
  const remount = store.subscribe(() => {})
  assert.equal(connects, 1)
  remount()
  await delay(10)
  assert.equal(closes, 1)
})

test('waiting game, backend reconnect, status transitions and session switch replace latest snapshot', () => {
  let callbacks: LiveStreamCallbacks | null = null
  const store = new LiveGameStore((next) => { callbacks = next; return () => {} })
  const unsubscribe = store.subscribe(() => {})
  const stream = callbacks!
  stream.onEvent({ type: 'state', data: { collector: { running: false, lastError: null },
    session: null, snapshot: null } })
  assert.equal(store.getSnapshot().connectionState, 'waiting-for-game')
  assert.equal(store.getSnapshot().error, null)
  stream.onEvent({ type: 'snapshot', data: { sessionId: 'first', snapshot } })
  assert.equal(store.getSnapshot().connectionState, 'live')
  assert.equal(store.getSnapshot().snapshot?.countries[0]?.id, 'balcan_states')
  stream.onEvent({ type: 'snapshot', data: { sessionId: 'second', snapshot: { ...snapshot, day: 0 } } })
  assert.equal(store.getSnapshot().sessionId, 'second')
  assert.equal(store.getSnapshot().snapshot?.day, 0)
  stream.onEvent({ type: 'status', data: { running: false, lastError: null } })
  assert.equal(store.getSnapshot().connectionState, 'waiting-for-game')
  assert.equal(store.getSnapshot().snapshot, null)
  stream.onReconnect()
  assert.equal(store.getSnapshot().connectionState, 'reconnecting')
  assert.ok(store.getSnapshot().error)
  unsubscribe()
})
