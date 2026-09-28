import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { buildApi } from '../src/api.js';
import { CollectorSupervisor, type SupervisedCollector } from '../src/CollectorSupervisor.js';
import { GameSessionTracker } from '../src/GameSessionTracker.js';
import { InMemorySessionRepository, InMemorySnapshotRepository } from '../src/repositories.js';
import { TrackedCollector } from '../src/TrackedCollector.js';
import type { CollectorExit, CollectorStatus, GameSnapshot } from '../src/types.js';

function snapshot(day: number): GameSnapshot {
  return {
    capturedAt: new Date(Date.UTC(2026, 8, 23 + day)).toISOString(),
    day,
    gameDate: new Date(Date.UTC(2026, 8, 23 + day)).toISOString().slice(0, 10),
    diseaseTurn: day + 500,
    eventTurn: day + 700,
    cureProgress: 0,
    zombieHordeEvents: [],
    countries: [{ index: 0, id: 'morroco', currentPopulation: 100, originalPopulation: 100,
      healthyPopulation: 90, deadPopulation: 0, infected: 10, zombies: 0,
      governmentActions: [], cureResearch: null }],
  };
}

class FakeCollector implements SupervisedCollector {
  available = false;
  starts = 0;
  stops = 0;
  private latest: GameSnapshot | null = null;
  private readonly snapshots = new Set<(snapshot: GameSnapshot) => void>();
  private readonly exits = new Set<(exit: CollectorExit) => void>();
  private readonly errors = new Set<(error: Error) => void>();
  private status: CollectorStatus = {
    state: 'stopped', pid: null, startedAt: null, lastSnapshotAt: null,
    lastDiseaseTurn: null, lastError: null, exit: null,
  };

  async start(): Promise<void> {
    this.starts++;
    this.latest = null;
    if (!this.available) {
      this.status = { ...this.status, state: 'failed', pid: null,
        lastError: "Process 'PlagueIncEvolved.exe' was not found." };
      throw new Error(this.status.lastError!);
    }
    this.status = { ...this.status, state: 'running', pid: 111216,
      lastError: null, startedAt: new Date().toISOString(), exit: null };
  }

  async stop(): Promise<void> {
    this.stops++;
    if (this.status.state === 'running') this.exit(true);
  }

  getStatus(): CollectorStatus { return { ...this.status }; }
  getLatestSnapshot(): GameSnapshot | null { return this.latest; }
  onSnapshot(listener: (value: GameSnapshot) => void): () => void {
    this.snapshots.add(listener); return () => { this.snapshots.delete(listener); };
  }
  onExit(listener: (value: CollectorExit) => void): () => void {
    this.exits.add(listener); return () => { this.exits.delete(listener); };
  }
  onError(listener: (value: Error) => void): () => void {
    this.errors.add(listener); return () => { this.errors.delete(listener); };
  }
  getListenerCounts(): { snapshots: number; exits: number; errors: number } {
    return { snapshots: this.snapshots.size, exits: this.exits.size, errors: this.errors.size };
  }
  emitSnapshot(value: GameSnapshot): void {
    assert.equal(this.status.state, 'running');
    this.latest = value;
    this.status.lastSnapshotAt = value.capturedAt;
    for (const listener of this.snapshots) listener(value);
  }
  exit(requested = false): void {
    const exit: CollectorExit = { code: requested ? 0 : 1, signal: null, requested };
    this.status = { ...this.status, state: requested ? 'stopped' : 'failed', pid: null,
      lastError: requested ? null : 'Game process exited; watch stopped.', exit };
    for (const listener of this.exits) listener(exit);
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= end) throw new Error('timed out waiting for condition');
    await delay(5);
  }
}

class Frames {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = '';
  constructor(response: Response, private readonly abort: AbortController) {
    assert.ok(response.body);
    this.reader = response.body.getReader();
  }
  async next(): Promise<{ event: string; data: any }> {
    while (!this.buffer.includes('\n\n')) {
      const chunk = await Promise.race([
        this.reader.read(),
        delay(2_000).then(() => { throw new Error('timed out waiting for SSE'); }),
      ]);
      if (chunk.done) throw new Error('SSE closed');
      this.buffer += this.decoder.decode(chunk.value, { stream: true });
    }
    const end = this.buffer.indexOf('\n\n');
    const frame = this.buffer.slice(0, end);
    this.buffer = this.buffer.slice(end + 2);
    const lines = frame.split('\n');
    return {
      event: lines.find((line) => line.startsWith('event: '))?.slice(7) ?? '',
      data: JSON.parse(lines.find((line) => line.startsWith('data: '))!.slice(6)),
    };
  }
  close(): void { this.abort.abort(); }
}

async function fixture(t: TestContext, retryDelaysMs: number[] = [10, 20, 30]) {
  const collector = new FakeCollector();
  const sessions = new InMemorySessionRepository();
  const snapshots = new InMemorySnapshotRepository();
  const tracker = new GameSessionTracker({ sessions, snapshots, createId: () => 'session-1' });
  const tracked = new TrackedCollector(collector, tracker, () => {});
  const logs: string[] = [];
  const supervisor = new CollectorSupervisor(collector, tracked, { retryDelaysMs, log: (line) => logs.push(line) });
  const api = buildApi({ collector: supervisor, liveEvents: supervisor, tracker, sessions, snapshots });
  const address = await api.listen({ host: '127.0.0.1', port: 0 });
  t.after(async () => { await api.close(); await supervisor.stop(); supervisor.dispose(); tracked.dispose(); });
  return { collector, supervisor, tracker, logs, api, address };
}

test('backend starts absent, retries, attaches later, survives exit and a second launch on one SSE connection', async (t) => {
  const { collector, supervisor, tracker, logs, api, address } = await fixture(t);
  supervisor.start();
  const abort = new AbortController();
  const response = await fetch(`${address}/api/v1/live/stream`, { signal: abort.signal });
  const frames = new Frames(response, abort);
  assert.equal(response.status, 200);
  assert.deepEqual((await frames.next()).data, {
    collector: { running: false, lastError: null }, session: null, snapshot: null,
  });
  await waitUntil(() => collector.starts >= 2);
  assert.equal((await api.inject('/api/v1/health')).statusCode, 200);
  assert.deepEqual((await api.inject('/api/v1/live')).json().collector,
    { running: false, lastError: null });
  collector.available = true;
  await waitUntil(() => collector.getStatus().state === 'running');
  collector.emitSnapshot(snapshot(10));
  assert.deepEqual((await frames.next()).data, { running: true, lastError: null });
  const first = await frames.next();
  assert.equal(first.event, 'snapshot');
  assert.equal(first.data.snapshot.day, 10);
  assert.equal(first.data.sessionId, 'session-1');
  collector.exit();
  const stopped = await frames.next();
  assert.equal(stopped.event, 'status');
  assert.deepEqual(stopped.data, { running: false, lastError: null });
  await waitUntil(() => collector.getStatus().state === 'running');
  collector.emitSnapshot(snapshot(11));
  assert.deepEqual((await frames.next()).data, { running: true, lastError: null });
  const second = await frames.next();
  assert.equal(second.event, 'snapshot');
  assert.equal(second.data.snapshot.day, 11);
  assert.equal(second.data.sessionId, first.data.sessionId);
  assert.equal((await tracker.getSessions()).length, 1);
  assert.equal(supervisor.getLiveListenerCounts().snapshot, 1);
  assert.equal(supervisor.getLiveListenerCounts().status, 1);
  assert.ok(logs.some((line) => line.includes('waiting for game')));
  assert.ok(logs.some((line) => line.includes('retry in')));
  frames.close();
  await waitUntil(() => supervisor.getLiveListenerCounts().snapshot === 0
    && supervisor.getLiveListenerCounts().status === 0);
});

test('successful snapshot resets backoff and shutdown cancels pending retries without orphan child', async (t) => {
  const { collector, supervisor, logs } = await fixture(t, [10, 20, 30]);
  supervisor.start();
  await waitUntil(() => collector.starts >= 2);
  collector.available = true;
  await waitUntil(() => collector.getStatus().state === 'running');
  collector.emitSnapshot(snapshot(20));
  await waitUntil(() => supervisor.getStatus().state === 'running');
  collector.exit();
  await waitUntil(() => supervisor.getStatus().state === 'stopped'
    && logs.at(-1)?.includes('retry in') === true);
  assert.equal(logs.filter((line) => line.includes('retry in')).at(-1), '[collector] retry in 0.01s');
  await supervisor.stop();
  const count = collector.starts;
  await delay(60);
  assert.equal(collector.starts, count, 'shutdown must not spawn another collector');
  assert.equal(collector.getStatus().state, 'failed');
  assert.equal(supervisor.getStatus().state, 'stopped');
});

test('shutdown stops a running child and multiple restarts do not duplicate runtime subscriptions', async (t) => {
  const { collector, supervisor } = await fixture(t);
  collector.available = true;
  supervisor.start();
  await waitUntil(() => collector.getStatus().state === 'running');
  collector.emitSnapshot(snapshot(1));
  await waitUntil(() => supervisor.getStatus().state === 'running');
  const listenerCounts = collector.getListenerCounts();
  for (let day = 2; day <= 4; day++) {
    collector.exit();
    await waitUntil(() => supervisor.getStatus().state === 'stopped');
    await waitUntil(() => collector.getStatus().state === 'running');
    collector.emitSnapshot(snapshot(day));
    await waitUntil(() => supervisor.getStatus().state === 'running');
    assert.deepEqual(collector.getListenerCounts(), listenerCounts);
  }
  await supervisor.stop();
  assert.equal(collector.stops, 1);
  assert.equal(collector.getStatus().state, 'stopped');
  assert.equal(supervisor.getStatus().state, 'stopped');
  const count = collector.starts;
  await delay(40);
  assert.equal(collector.starts, count);
});
