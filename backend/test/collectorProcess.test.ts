import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import type { ChildProcess } from 'node:child_process';
import { PlagueCollectorProcess, type SpawnCollector } from '../src/PlagueCollectorProcess.js';
import type { CollectorConfig } from '../src/config.js';
import type { GameSnapshot } from '../src/types.js';
import { loadCollectorConfig } from '../src/config.js';

const config: CollectorConfig = {
  executablePath: 'C:\\collector\\PlagueInc.MemoryCollector.exe',
  intervalMilliseconds: 1000,
  debug: false,
};

function snapshot(turn = 10, id = 'soudi_arabia'): GameSnapshot {
  return {
    capturedAt: '2026-09-22T19:30:12.345Z',
    diseaseTurn: turn,
    eventTurn: 20,
    day: turn,
    gameDate: '2026-10-02',
    cureProgress: 37.5,
    zombieHordeEvents: [],
    countries: [{
      index: 0,
      id,
      currentPopulation: 100,
      originalPopulation: 100,
      healthyPopulation: 90,
      deadPopulation: 0,
      infected: 10,
      zombies: 0,
      publicOrder: null,
      borderStatus: null, airportStatus: null, portStatus: null,
      governmentActions: [],
      cureResearch: null,
    }],
  };
}

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 12345;
  exitCode: number | null = null;
  killed = false;
  killCalls = 0;

  writeSnapshot(value: unknown): void {
    this.stdout.write(`${JSON.stringify(value)}\n`);
  }

  finish(code: number): void {
    this.exitCode = code;
    this.stdout.end();
    this.stderr.end();
    this.emit('exit', code, null);
    this.emit('close', code, null);
  }

  kill(): boolean {
    this.killed = true;
    this.killCalls++;
    queueMicrotask(() => this.finish(0));
    return true;
  }
}

function fixture() {
  const children: FakeChild[] = [];
  const calls: { file: string; args: string[]; options: unknown }[] = [];
  const logs: string[] = [];
  const spawnFake: SpawnCollector = (file, args, options) => {
    calls.push({ file, args, options });
    const child = new FakeChild();
    children.push(child);
    queueMicrotask(() => child.emit('spawn'));
    return child as unknown as ChildProcess;
  };
  const consumer = new PlagueCollectorProcess(config, spawnFake, (line) => logs.push(line));
  return { consumer, children, calls, logs };
}

test('valid snapshot updates latest and notifies subscribers with raw id', async () => {
  const { consumer, children } = fixture();
  const received: GameSnapshot[] = [];
  consumer.onSnapshot((value) => received.push(value));
  await consumer.start();
  const incoming = snapshot();
  incoming.countries[0]!.publicOrder = 0.9951444;
  incoming.countries[0]!.borderStatus = 'closed';
  incoming.countries[0]!.airportStatus = 'open';
  incoming.countries[0]!.portStatus = null;
  children[0]!.writeSnapshot(incoming);
  assert.equal(received.length, 1);
  assert.equal(received[0]!.countries[0]!.id, 'soudi_arabia');
  assert.equal(received[0]!.countries[0]!.publicOrder, 0.9951444);
  assert.deepEqual([received[0]!.countries[0]!.borderStatus,
    received[0]!.countries[0]!.airportStatus, received[0]!.countries[0]!.portStatus],
  ['closed', 'open', null]);
  assert.equal(consumer.getLatestSnapshot()?.capturedAt, snapshot().capturedAt);
  assert.equal(consumer.getStatus().lastDiseaseTurn, 10);
  await consumer.stop();
});

test('collector NDJSON carries government events and cure fields into latest snapshot', async () => {
  const { consumer, children } = fixture();
  await consumer.start();
  const input = snapshot();
  input.countries[0]!.governmentActions = [
    { id: 'research_funding_10', turn: 9, removed: false },
    { id: 'infectious_disease_teams__mobilised', turn: 10, removed: true },
  ];
  input.countries[0]!.cureResearch = { funding: 3188.2, allocation: 0.4, rank: 99,
    flasks: { active: 4, inactive: 3, destroyed: 2 } };
  children[0]!.writeSnapshot(input);
  const country = consumer.getLatestSnapshot()?.countries[0];
  assert.deepEqual(country?.governmentActions, input.countries[0]!.governmentActions);
  assert.equal(country?.cureResearch?.funding, 3188.2);
  assert.equal(country?.cureResearch?.allocation, 0.4);
  assert.deepEqual(country?.cureResearch?.flasks, { active: 4, inactive: 3, destroyed: 2 });
  assert.equal(country?.cureResearch?.rank, 1); // Recomputed from the whole snapshot.
  await consumer.stop();
});

test('collector NDJSON carries cumulative Zombie Horde lifecycle events in order', async () => {
  const { consumer, children } = fixture();
  await consumer.start();
  const input = snapshot();
  input.zombieHordeEvents = [
    { turn: 10, eventTurn: 20, diseaseId: 0, sourceCountryId: 'soudi_arabia',
      destinationCountryId: 'sudan', zombies: 77868, vehicleId: 1389,
      arrivalTurn: null, arrivalEventTurn: null },
    { turn: 10, eventTurn: 21, diseaseId: 0, sourceCountryId: 'soudi_arabia',
      destinationCountryId: 'sudan', zombies: 77868, vehicleId: 1390,
      arrivalTurn: 12, arrivalEventTurn: 25 },
  ];
  children[0]!.writeSnapshot(input);
  assert.deepEqual(consumer.getLatestSnapshot()?.zombieHordeEvents, input.zombieHordeEvents);
  await consumer.stop();
});

test('default poll interval is 250 ms and env override remains available', () => {
  assert.equal(loadCollectorConfig({}).intervalMilliseconds, 250);
  assert.equal(loadCollectorConfig({ PLAGUE_COLLECTOR_INTERVAL_MS: '1000' }).intervalMilliseconds, 1000);
});

test('new day/date/cure fields are required and validated', async () => {
  const { consumer, children } = fixture();
  await consumer.start();
  const invalid = snapshot();
  children[0]!.writeSnapshot({ ...invalid, day: -1 });
  children[0]!.writeSnapshot({ ...invalid, gameDate: '2026-02-30' });
  children[0]!.writeSnapshot({ ...invalid, cureProgress: 101 });
  assert.equal(consumer.getLatestSnapshot(), null);
  children[0]!.writeSnapshot(invalid);
  assert.equal(consumer.getLatestSnapshot()?.day, 10);
  assert.equal(consumer.getLatestSnapshot()?.cureProgress, 37.5);
  await consumer.stop();
});

test('malformed JSON is skipped and later valid line is accepted', async () => {
  const { consumer, children, logs } = fixture();
  await consumer.start();
  children[0]!.stdout.write('{broken\n');
  children[0]!.writeSnapshot(snapshot());
  assert.equal(consumer.getLatestSnapshot()?.diseaseTurn, 10);
  assert.ok(logs.some((line) => line.includes('malformed collector JSON skipped')));
  assert.equal(consumer.getStatus().state, 'running');
  await consumer.stop();
});

test('valid JSON with invalid schema is skipped', async () => {
  const { consumer, children } = fixture();
  await consumer.start();
  children[0]!.writeSnapshot({ capturedAt: 'wrong', countries: [] });
  assert.equal(consumer.getLatestSnapshot(), null);
  assert.equal(consumer.getStatus().state, 'running');
  await consumer.stop();
});

test('duplicate country id is rejected', async () => {
  const { consumer, children } = fixture();
  await consumer.start();
  const duplicate = snapshot();
  duplicate.countries.push({ ...duplicate.countries[0]!, index: 1 });
  children[0]!.writeSnapshot(duplicate);
  assert.equal(consumer.getLatestSnapshot(), null);
  assert.match(consumer.getStatus().lastError ?? '', /duplicate country id/);
  await consumer.stop();
});

test('stderr is logged separately and is never parsed as a snapshot', async () => {
  const { consumer, children, logs } = fixture();
  await consumer.start();
  children[0]!.stderr.write(`${JSON.stringify(snapshot())}\n`);
  assert.equal(consumer.getLatestSnapshot(), null);
  assert.ok(logs.some((line) => line.startsWith('[collector] {')));
  await consumer.stop();
});

test('normal exit changes status to stopped and keeps latest snapshot', async () => {
  const { consumer, children } = fixture();
  await consumer.start();
  children[0]!.writeSnapshot(snapshot());
  children[0]!.finish(0);
  assert.equal(consumer.getStatus().state, 'stopped');
  assert.equal(consumer.getStatus().exit?.code, 0);
  assert.equal(consumer.getLatestSnapshot()?.diseaseTurn, 10);
});

test('non-zero exit changes status to failed', async () => {
  const { consumer, children } = fixture();
  await consumer.start();
  children[0]!.finish(1);
  assert.equal(consumer.getStatus().state, 'failed');
  assert.equal(consumer.getStatus().exit?.code, 1);
});

test('collector stderr error is kept as the exit cause', async () => {
  const { consumer, children, logs } = fixture();
  await consumer.start();
  children[0]!.stderr.write('error: More than one game process is running\n');
  children[0]!.finish(1);
  assert.equal(consumer.getStatus().state, 'failed');
  assert.equal(consumer.getStatus().lastError, 'More than one game process is running');
  assert.ok(logs.some((line) => line.includes('[collector:error] More than one game process is running')));
});

test('start twice does not spawn a second process', async () => {
  const { consumer, calls } = fixture();
  await consumer.start();
  await assert.rejects(consumer.start(), /already starting or running/);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.args, ['--watch', '--interval', '1000']);
  await consumer.stop();
});

test('stop kills and reaps the child without leaving a process', async () => {
  const { consumer, children } = fixture();
  await consumer.start();
  await consumer.stop();
  assert.equal(children[0]!.killCalls, 1);
  assert.equal(consumer.getStatus().state, 'stopped');
  assert.equal(consumer.getStatus().pid, null);
});

test('spawn failure is distinguished from collector exit', async () => {
  const errors: string[] = [];
  const spawnFake: SpawnCollector = () => {
    const child = new FakeChild();
    queueMicrotask(() => child.emit('error', new Error('ENOENT')));
    queueMicrotask(() => child.finish(-1));
    return child as unknown as ChildProcess;
  };
  const consumer = new PlagueCollectorProcess(config, spawnFake, (line) => errors.push(line));
  await assert.rejects(consumer.start(), /failed to spawn collector: ENOENT/);
  assert.equal(consumer.getStatus().state, 'failed');
  assert.ok(errors.some((line) => line.includes('failed to spawn collector')));
});

test('debug flag is only passed when enabled', async () => {
  const { calls } = fixture();
  const child = new FakeChild();
  const consumer = new PlagueCollectorProcess(
    { ...config, debug: true },
    (file, args, options) => {
      calls.push({ file, args, options });
      queueMicrotask(() => child.emit('spawn'));
      return child as unknown as ChildProcess;
    },
    () => {},
  );
  await consumer.start();
  assert.deepEqual(calls[0]!.args, ['--watch', '--interval', '1000', '--debug']);
  await consumer.stop();
});
