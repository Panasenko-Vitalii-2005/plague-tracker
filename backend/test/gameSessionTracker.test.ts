import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameSessionTracker } from '../src/GameSessionTracker.js';
import { TrackedCollector, type SnapshotCollector } from '../src/TrackedCollector.js';
import { InMemorySessionRepository, InMemorySnapshotRepository } from '../src/repositories.js';
import type { CollectorExit, GameSnapshot } from '../src/types.js';

function snapshot(
  day: number,
  revision: number,
  changes: Partial<Pick<GameSnapshot, 'diseaseTurn' | 'eventTurn' | 'cureProgress'>> = {},
): GameSnapshot {
  return {
    capturedAt: new Date(Date.UTC(2026, 8, 23, 0, day % 60, revision)).toISOString(),
    day,
    gameDate: '2026-09-23',
    diseaseTurn: changes.diseaseTurn ?? day,
    eventTurn: changes.eventTurn ?? revision,
    cureProgress: changes.cureProgress ?? 0,
    zombieHordeEvents: [],
    countries: [{
      index: 0,
      id: 'soudi_arabia',
      currentPopulation: 100,
      originalPopulation: 100,
      healthyPopulation: 100 - revision,
      deadPopulation: 0,
      infected: revision,
      zombies: 0,
      publicOrder: null,
      borderStatus: null, airportStatus: null, portStatus: null,
      governmentActions: [],
      cureResearch: null,
    }],
  };
}

function fixture() {
  let id = 0;
  const logs: string[] = [];
  const tracker = new GameSessionTracker({
    createId: () => `session-${++id}`,
    log: (line) => logs.push(line),
  });
  return { tracker, logs };
}

test('10A, 10B, 10C, 11A keeps only last observed day 10', async () => {
  const { tracker } = fixture();
  await tracker.handleSnapshot(snapshot(10, 1));
  await tracker.handleSnapshot(snapshot(10, 2));
  await tracker.handleSnapshot(snapshot(10, 3));
  assert.equal((await tracker.getHistory()).length, 0);
  await tracker.handleSnapshot(snapshot(11, 1));

  const history = await tracker.getHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0]!.day, 10);
  assert.equal(history[0]!.countries[0]!.infected, 3);
  assert.equal(history[0]!.countries[0]!.id, 'soudi_arabia');
  assert.equal(tracker.getCurrentDaySnapshot()?.day, 11);
});

test('normal growth 10 -> 11 -> 12 finalizes each observed day', async () => {
  const { tracker } = fixture();
  await tracker.handleSnapshot(snapshot(10, 1));
  await tracker.handleSnapshot(snapshot(11, 1));
  await tracker.handleSnapshot(snapshot(12, 1));
  assert.deepEqual((await tracker.getHistory()).map((item) => item.day), [10, 11]);
  await tracker.flush();
  assert.deepEqual((await tracker.getHistory()).map((item) => item.day), [10, 11, 12]);
});

test('gap 10 -> 13 never synthesizes days 11 or 12', async () => {
  const { tracker, logs } = fixture();
  await tracker.handleSnapshot(snapshot(10, 1));
  await tracker.handleSnapshot(snapshot(13, 1));
  await tracker.flush();
  assert.deepEqual((await tracker.getHistory()).map((item) => item.day), [10, 13]);
  assert.ok(logs.some((line) => line.includes('[history] gap session=session-1 10 -> 13')));
});

test('373 -> 373 -> 0 -> 1 creates two sessions and closes the old one', async () => {
  const { tracker, logs } = fixture();
  await tracker.handleSnapshot(snapshot(373, 1));
  await tracker.handleSnapshot(snapshot(373, 2));
  await tracker.handleSnapshot(snapshot(0, 1));
  await tracker.handleSnapshot(snapshot(1, 1));

  const sessions = await tracker.getSessions();
  assert.equal(sessions.length, 2);
  assert.notEqual(sessions[0]!.id, sessions[1]!.id);
  assert.equal(sessions[0]!.firstDay, 373);
  assert.equal(sessions[0]!.lastDay, 373);
  assert.equal(sessions[0]!.endedAt, snapshot(373, 2).capturedAt);
  assert.equal(sessions[1]!.firstDay, 0);
  assert.equal(sessions[1]!.lastDay, 1);
  assert.equal(sessions[1]!.endedAt, null);
  assert.deepEqual((await tracker.getHistory()).map((item) => [item.sessionId, item.day, item.countries[0]!.infected]),
    [['session-1', 373, 2], ['session-2', 0, 1]]);
  assert.ok(logs.some((line) => line.includes('[session] ended session-1 day=373')));
  assert.ok(logs.some((line) => line.includes('[session] started session-2 day=0')));
});

test('flush saves the final buffered day, keeps session open, and is idempotent', async () => {
  const { tracker } = fixture();
  await tracker.handleSnapshot(snapshot(20, 1));
  await tracker.flush();
  await tracker.flush();
  assert.equal((await tracker.getHistory()).length, 1);
  assert.equal(tracker.getActiveSession()?.lastDay, 20);
  assert.equal(tracker.getCurrentDaySnapshot()?.day, 20);
  assert.equal((await tracker.getSessions())[0]!.endedAt, null);
});

test('same day uses latest event, country, cure and diseaseTurn without changing day key', async () => {
  const { tracker } = fixture();
  await tracker.handleSnapshot(snapshot(10, 1));
  await tracker.handleSnapshot(snapshot(10, 2, { eventTurn: 99, cureProgress: 10.25, diseaseTurn: 500 }));
  await tracker.handleSnapshot(snapshot(10, 3, { eventTurn: 100, cureProgress: 11.5, diseaseTurn: 501 }));
  await tracker.handleSnapshot(snapshot(11, 1));
  const history = await tracker.getHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0]!.day, 10);
  assert.equal(history[0]!.eventTurn, 100);
  assert.equal(history[0]!.diseaseTurn, 501);
  assert.equal(history[0]!.cureProgress, 11.5);
  assert.equal(history[0]!.countries[0]!.infected, 3);
});

test('rapid snapshots stay ordered with asynchronous repositories', async () => {
  const sessionStore = new InMemorySessionRepository();
  const snapshotStore = new InMemorySnapshotRepository();
  const tracker = new GameSessionTracker({
    createId: () => 'session-async',
    sessions: {
      async save(session) { await Promise.resolve(); sessionStore.save(session); },
      list: () => sessionStore.list(),
      getById: (id) => sessionStore.getById(id),
      getLatestOpen: () => sessionStore.getLatestOpen(),
    },
    snapshots: {
      async save(value) { await Promise.resolve(); snapshotStore.save(value); },
      list: (sessionId) => snapshotStore.list(sessionId),
      getLatestForSession: (sessionId) => snapshotStore.getLatestForSession(sessionId),
      getByDay: (sessionId, day) => snapshotStore.getByDay(sessionId, day),
      getSessionStats: (sessionId) => snapshotStore.getSessionStats(sessionId),
      getGlobalHistory: (sessionId) => snapshotStore.getGlobalHistory(sessionId),
      getCountryHistory: (sessionId, countryId) => snapshotStore.getCountryHistory(sessionId, countryId),
      getCountriesForSession: (sessionId) => snapshotStore.getCountriesForSession(sessionId),
    },
  });

  const pending = [
    tracker.handleSnapshot(snapshot(10, 1)),
    tracker.handleSnapshot(snapshot(10, 2)),
    tracker.handleSnapshot(snapshot(10, 3)),
    tracker.handleSnapshot(snapshot(11, 1)),
    tracker.flush(),
  ];
  await Promise.all(pending);
  assert.deepEqual((await tracker.getHistory()).map((item) => [item.day, item.countries[0]!.infected]),
    [[10, 3], [11, 1]]);
  assert.equal((await tracker.getSessions()).length, 1);
});

class FakeCollector implements SnapshotCollector {
  private readonly snapshotListeners = new Set<(value: GameSnapshot) => void>();
  private readonly exitListeners = new Set<(value: CollectorExit) => void>();
  readonly stopCalls: number[] = [];

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    this.stopCalls.push(1);
    this.emitExit({ code: null, signal: 'SIGTERM', requested: true });
  }

  onSnapshot(listener: (value: GameSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  onExit(listener: (value: CollectorExit) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  emitSnapshot(value: GameSnapshot): void {
    for (const listener of this.snapshotListeners) listener(value);
  }

  emitExit(value: CollectorExit): void {
    for (const listener of this.exitListeners) listener(value);
  }
}

test('collector unexpected exit flushes last day', async () => {
  const collector = new FakeCollector();
  const { tracker } = fixture();
  const tracked = new TrackedCollector(collector, tracker, () => {});
  await tracked.start();
  collector.emitSnapshot(snapshot(42, 1));
  collector.emitSnapshot(snapshot(42, 2));
  collector.emitExit({ code: 1, signal: null, requested: false });
  await tracked.waitForIdle();
  assert.deepEqual((await tracker.getHistory()).map((item) => [item.day, item.countries[0]!.infected]), [[42, 2]]);
  assert.equal((await tracker.getSessions())[0]!.endedAt, null);
  tracked.dispose();
});

test('explicit stop and duplicate exit flush only once', async () => {
  const collector = new FakeCollector();
  const { tracker } = fixture();
  const tracked = new TrackedCollector(collector, tracker, () => {});
  await tracked.start();
  collector.emitSnapshot(snapshot(8, 1));
  await tracked.stop();
  await tracked.stop();
  assert.equal((await tracker.getHistory()).length, 1);
  assert.equal(tracker.getActiveSession()?.lastDay, 8);
  tracked.dispose();
});
