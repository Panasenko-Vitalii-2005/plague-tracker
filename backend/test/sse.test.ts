import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { buildApi } from '../src/api.js';
import { GameSessionTracker } from '../src/GameSessionTracker.js';
import { PlagueCollectorProcess, type SpawnCollector } from '../src/PlagueCollectorProcess.js';
import { InMemorySessionRepository, InMemorySnapshotRepository } from '../src/repositories.js';
import { SseConnection } from '../src/sse.js';
import { TrackedCollector, type LiveEventSource, type LiveSnapshotEvent, type LiveStatusEvent,
  type SnapshotCollector } from '../src/TrackedCollector.js';
import type { CollectorExit, CollectorStatus, GameSnapshot } from '../src/types.js';

function snapshot(day: number, revision = 1): GameSnapshot {
  return {
    capturedAt: new Date(Date.UTC(2026, 8, 23, 0, day % 60, revision)).toISOString(),
    day,
    gameDate: new Date(Date.UTC(2026, 8, 23 + day)).toISOString().slice(0, 10),
    diseaseTurn: day + 500,
    eventTurn: revision,
    cureProgress: revision,
    zombieHordeEvents: [],
    countryInfectionEvents: [],
    gameMilestones: [],
    publicOrderEvents: [],
    countries: [{
      index: 0, id: 'soudi_arabia', currentPopulation: 100,
      originalPopulation: 100, healthyPopulation: 90,
      infected: 10, deadPopulation: 0, zombies: 0,
      publicOrder: null, borderStatus: null, airportStatus: null, portStatus: null,
      governmentActions: [], cureResearch: null,
    }],
  };
}

class FakeCollector implements SnapshotCollector {
  private readonly snapshots = new Set<(value: GameSnapshot) => void>();
  private readonly exits = new Set<(value: CollectorExit) => void>();
  private readonly errors = new Set<(value: Error) => void>();
  private latest: GameSnapshot | null = null;
  private status: CollectorStatus = {
    state: 'stopped', pid: null, startedAt: null, lastSnapshotAt: null,
    lastDiseaseTurn: null, lastError: null, exit: null,
  };

  async start(): Promise<void> { this.status.state = 'running'; }
  async stop(): Promise<void> {
    if (this.status.state !== 'running') return;
    this.status.state = 'stopped';
    const exit: CollectorExit = { code: null, signal: 'SIGTERM', requested: true };
    for (const listener of this.exits) listener(exit);
  }
  getStatus(): CollectorStatus { return { ...this.status }; }
  getLatestSnapshot(): GameSnapshot | null { return this.latest; }
  onSnapshot(listener: (value: GameSnapshot) => void): () => void {
    this.snapshots.add(listener);
    return () => { this.snapshots.delete(listener); };
  }
  onExit(listener: (value: CollectorExit) => void): () => void {
    this.exits.add(listener);
    return () => { this.exits.delete(listener); };
  }
  onError(listener: (value: Error) => void): () => void {
    this.errors.add(listener);
    return () => { this.errors.delete(listener); };
  }
  emitSnapshot(value: GameSnapshot): void {
    this.latest = value;
    this.status.lastSnapshotAt = value.capturedAt;
    for (const listener of this.snapshots) listener(value);
  }
  emitError(message: string): void {
    this.status.lastError = message;
    for (const listener of this.errors) listener(new Error(message));
  }
}

class EventReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = '';

  constructor(response: Response, private readonly controller: AbortController) {
    assert.ok(response.body);
    this.reader = response.body.getReader();
  }

  async next(timeoutMilliseconds = 3000): Promise<{ id: number | null; event: string | null; data: unknown; comment: string | null }> {
    let boundary = this.buffer.indexOf('\n\n');
    while (boundary < 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          this.reader.read(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('timed out waiting for SSE frame')), timeoutMilliseconds);
          }),
        ]);
        if (result.done) throw new Error('SSE stream closed unexpectedly');
        this.buffer += this.decoder.decode(result.value, { stream: true });
      } finally {
        if (timer) clearTimeout(timer);
      }
      boundary = this.buffer.indexOf('\n\n');
    }
    const frame = this.buffer.slice(0, boundary);
    this.buffer = this.buffer.slice(boundary + 2);
    const lines = frame.split('\n');
    const field = (name: string) => lines.find((line) => line.startsWith(`${name}: `))?.slice(name.length + 2) ?? null;
    const rawData = field('data');
    return {
      id: field('id') === null ? null : Number(field('id')),
      event: field('event'),
      data: rawData === null ? null : JSON.parse(rawData),
      comment: lines.find((line) => line.startsWith(': ')) ?? null,
    };
  }

  close(): void { this.controller.abort(); }
}

async function waitUntil(predicate: () => boolean, timeoutMilliseconds = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition did not become true');
    await delay(10);
  }
}

async function fixture(t: TestContext) {
  const collector = new FakeCollector();
  const sessions = new InMemorySessionRepository();
  const snapshots = new InMemorySnapshotRepository();
  let id = 0;
  const tracker = new GameSessionTracker({ sessions, snapshots, createId: () => `session-${++id}` });
  const tracked = new TrackedCollector(collector, tracker, () => {});
  const app = buildApi({ collector, tracker, sessions, snapshots, liveEvents: tracked });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(async () => { await app.close(); await tracked.stop(); tracked.dispose(); });
  return { app, address, collector, tracker, tracked };
}

async function connect(address: string, lastEventId?: string) {
  const controller = new AbortController();
  const response = await fetch(`${address}/api/v1/live/stream`, {
    signal: controller.signal,
    ...(lastEventId === undefined ? {} : { headers: { 'Last-Event-ID': lastEventId } }),
  });
  return { response, events: new EventReader(response, controller) };
}

test('SSE streams state, every live update, reset session ID, status and keeps REST responsive', async (t) => {
  const { app, address, collector, tracked } = await fixture(t);
  const { response, events } = await connect(address);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
  assert.equal(response.headers.get('cache-control'), 'no-cache');
  assert.equal(response.headers.get('connection'), 'keep-alive');
  const state = await events.next();
  assert.equal(state.event, 'state');
  assert.deepEqual(state.data, {
    collector: { running: false, lastError: null }, session: null, snapshot: null,
  });

  // A client can remain connected while the game/collector becomes available.
  await tracked.start();
  const started = await events.next();
  assert.equal(started.event, 'status');
  assert.deepEqual(started.data, { running: true, lastError: null });

  const dispatched = snapshot(100, 1);
  dispatched.countries[0]!.publicOrder = 1;
  dispatched.countries[0]!.borderStatus = 'closed';
  dispatched.countries[0]!.airportStatus = 'open';
  dispatched.countries[0]!.portStatus = null;
  dispatched.zombieHordeEvents = [{
    turn: 100, eventTurn: 1, diseaseId: 0,
    sourceCountryId: 'soudi_arabia', destinationCountryId: 'sudan', zombies: 77_868,
    vehicleId: 1_389, arrivalTurn: null, arrivalEventTurn: null,
  }];
  dispatched.countryInfectionEvents = [
    { countryId: 'soudi_arabia', turn: 1, eventTurn: 1, diseaseId: 0 },
  ];
  dispatched.gameMilestones = [
    { type: 'virus_dna_detected', turn: 11, countryId: null, diseaseId: 0 },
  ];
  collector.emitSnapshot(dispatched);
  const first = await events.next();
  const arrived = snapshot(100, 2);
  arrived.countries[0]!.publicOrder = 0.9951444;
  arrived.countries[0]!.borderStatus = 'open';
  arrived.countries[0]!.airportStatus = 'closed';
  arrived.countries[0]!.portStatus = 'open';
  arrived.zombieHordeEvents = [{
    ...dispatched.zombieHordeEvents[0]!, arrivalTurn: 100, arrivalEventTurn: 2,
  }];
  arrived.countryInfectionEvents = [
    ...dispatched.countryInfectionEvents,
    { countryId: 'middle_east', turn: 69, eventTurn: 98, diseaseId: 0 },
  ];
  arrived.gameMilestones = [
    ...dispatched.gameMilestones,
    { type: 'disease_detected', turn: 150, countryId: 'soudi_arabia', diseaseId: 0 },
  ];
  collector.emitSnapshot(arrived);
  const second = await events.next();
  collector.emitSnapshot(snapshot(101, 1));
  const nextDay = await events.next();
  assert.deepEqual([first.event, second.event, nextDay.event], ['snapshot', 'snapshot', 'snapshot']);
  assert.deepEqual([first.data, second.data, nextDay.data].map((value) => (value as LiveSnapshotEvent).snapshot.day),
    [100, 100, 101]);
  assert.equal((second.data as LiveSnapshotEvent).snapshot.eventTurn, 2);
  assert.deepEqual((first.data as LiveSnapshotEvent).snapshot.zombieHordeEvents, dispatched.zombieHordeEvents);
  assert.deepEqual((second.data as LiveSnapshotEvent).snapshot.zombieHordeEvents, arrived.zombieHordeEvents);
  assert.deepEqual((first.data as LiveSnapshotEvent).snapshot.countryInfectionEvents,
    dispatched.countryInfectionEvents);
  assert.deepEqual((second.data as LiveSnapshotEvent).snapshot.countryInfectionEvents,
    arrived.countryInfectionEvents);
  assert.deepEqual((first.data as LiveSnapshotEvent).snapshot.gameMilestones,
    dispatched.gameMilestones);
  assert.deepEqual((second.data as LiveSnapshotEvent).snapshot.gameMilestones,
    arrived.gameMilestones);
  assert.equal((first.data as LiveSnapshotEvent).snapshot.countries[0]!.publicOrder, 1);
  assert.equal((second.data as LiveSnapshotEvent).snapshot.countries[0]!.publicOrder, 0.9951444);
  assert.deepEqual([first.data, second.data].map((value) => {
    const country = (value as LiveSnapshotEvent).snapshot.countries[0]!;
    return [country.borderStatus, country.airportStatus, country.portStatus];
  }), [['closed', 'open', null], ['open', 'closed', 'open']]);
  assert.equal((first.data as LiveSnapshotEvent).snapshot.countries[0]!.id, 'soudi_arabia');
  assert.equal((first.data as LiveSnapshotEvent).sessionId, (nextDay.data as LiveSnapshotEvent).sessionId);

  collector.emitSnapshot(snapshot(0, 1));
  const reset = await events.next();
  assert.equal(reset.event, 'snapshot');
  assert.notEqual((reset.data as LiveSnapshotEvent).sessionId, (first.data as LiveSnapshotEvent).sessionId);
  assert.equal((reset.data as LiveSnapshotEvent).snapshot.day, 0);

  collector.emitError('temporary collector read error');
  const errorStatus = await events.next();
  assert.equal(errorStatus.event, 'status');
  assert.deepEqual(errorStatus.data, { running: true, lastError: 'temporary collector read error' });
  await tracked.stop();
  const stopped = await events.next();
  assert.equal(stopped.event, 'status');
  assert.equal((stopped.data as LiveStatusEvent).running, false);
  assert.ok(state.id! < started.id! && started.id! < first.id! && first.id! < reset.id!);

  const health = await app.inject('/api/v1/health');
  assert.equal(health.statusCode, 200);
  events.close();
  await waitUntil(() => tracked.getLiveListenerCounts().snapshot === 0
    && tracked.getLiveListenerCounts().status === 0);
});

test('reconnect receives fresh state and ignores Last-Event-ID without replay', async (t) => {
  const { address, collector, tracked } = await fixture(t);
  await tracked.start();
  collector.emitSnapshot(snapshot(5));
  await tracked.waitForIdle();
  const first = await connect(address);
  const firstState = await first.events.next();
  assert.equal(firstState.event, 'state');
  assert.equal((firstState.data as { snapshot: GameSnapshot }).snapshot.day, 5);
  first.events.close();
  await waitUntil(() => tracked.getLiveListenerCounts().snapshot === 0);
  const second = await connect(address, '999999');
  const secondState = await second.events.next();
  assert.equal(secondState.event, 'state');
  assert.ok(secondState.id! > firstState.id!);
  assert.equal((secondState.data as { snapshot: GameSnapshot }).snapshot.day, 5);
  second.events.close();
});

test('100 connect/disconnect cycles leave no live subscriptions', async (t) => {
  const { address, tracked } = await fixture(t);
  for (let index = 0; index < 100; index++) {
    const { events } = await connect(address);
    assert.equal((await events.next()).event, 'state');
    events.close();
  }
  await waitUntil(() => tracked.getLiveListenerCounts().snapshot === 0
    && tracked.getLiveListenerCounts().status === 0, 5000);
});

class FakeSink extends EventEmitter {
  readonly writes: string[] = [];
  blocked = false;
  writableEnded = false;
  destroyed = false;
  write(chunk: string): boolean { this.writes.push(chunk); return !this.blocked; }
  end(): void { this.writableEnded = true; this.emit('close'); }
}

class FakeLiveSource implements LiveEventSource {
  readonly snapshots = new Set<(event: LiveSnapshotEvent) => void>();
  readonly statuses = new Set<(event: LiveStatusEvent) => void>();
  onLiveSnapshot(listener: (event: LiveSnapshotEvent) => void): () => void {
    this.snapshots.add(listener);
    return () => { this.snapshots.delete(listener); };
  }
  onStatus(listener: (event: LiveStatusEvent) => void): () => void {
    this.statuses.add(listener);
    return () => { this.statuses.delete(listener); };
  }
  emitSnapshot(event: LiveSnapshotEvent): void { for (const listener of this.snapshots) listener(event); }
  emitStatus(event: LiveStatusEvent): void { for (const listener of this.statuses) listener(event); }
}

test('heartbeat is a comment and disconnect clears timer/listeners', async () => {
  const sink = new FakeSink();
  const source = new FakeLiveSource();
  let id = 0;
  const stream = new SseConnection(sink, source, () => ++id, () => {}, 10);
  stream.sendInitialState({ collector: { running: false }, session: null, snapshot: null });
  await delay(45);
  assert.ok(sink.writes.some((chunk) => chunk === ': heartbeat\n\n'));
  assert.equal(id, 1); // Heartbeat has no application event ID.
  stream.close();
  const countAfterClose = sink.writes.length;
  await delay(35);
  assert.equal(sink.writes.length, countAfterClose);
  assert.equal(source.snapshots.size, 0);
  assert.equal(source.statuses.size, 0);
});

test('backpressure coalesces 1000 snapshots to the latest and never builds an unbounded queue', () => {
  const sink = new FakeSink();
  const source = new FakeLiveSource();
  let id = 0;
  const stream = new SseConnection(sink, source, () => ++id);
  sink.blocked = true;
  stream.sendInitialState({ status: 'initial' });
  for (let day = 0; day < 1000; day++) {
    source.emitSnapshot({ sessionId: 'session-1', snapshot: snapshot(day) });
    assert.ok(stream.getPendingCount() <= 2);
  }
  assert.equal(stream.getPendingCount(), 1);
  sink.blocked = false;
  sink.emit('drain');
  const delivered = sink.writes.filter((chunk) => chunk.includes('event: snapshot'));
  assert.equal(delivered.length, 1);
  assert.match(delivered[0]!, /"day":999/);
  assert.equal(stream.getPendingCount(), 0);
  source.emitStatus({ running: false, lastError: null });
  assert.equal(sink.writes.filter((chunk) => chunk.includes('event: status')).length, 1);
  stream.close();
});

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 12345;
  exitCode: number | null = null;
  killed = false;
  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => {
      this.exitCode = 0;
      this.stdout.end();
      this.stderr.end();
      this.emit('exit', 0, null);
      this.emit('close', 0, null);
    });
    return true;
  }
}

test('malformed collector NDJSON never becomes a live snapshot event', async () => {
  const child = new FakeChild();
  const spawnFake: SpawnCollector = () => {
    queueMicrotask(() => child.emit('spawn'));
    return child as unknown as ChildProcess;
  };
  const collector = new PlagueCollectorProcess({
    executablePath: 'C:\\collector\\fake.exe', intervalMilliseconds: 250, debug: false,
  }, spawnFake, () => {});
  const tracker = new GameSessionTracker();
  const tracked = new TrackedCollector(collector, tracker, () => {});
  const received: LiveSnapshotEvent[] = [];
  tracked.onLiveSnapshot((event) => received.push(event));
  await tracked.start();
  child.stdout.write('{bad json\n');
  child.stdout.write(`${JSON.stringify({ ...snapshot(1), day: -1 })}\n`);
  await tracked.waitForIdle();
  assert.equal(received.length, 0);
  child.stdout.write(`${JSON.stringify(snapshot(1))}\n`);
  await tracked.waitForIdle();
  assert.equal(received.length, 1);
  await tracked.stop();
  tracked.dispose();
});
