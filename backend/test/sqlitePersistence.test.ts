import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import type Database from 'better-sqlite3';
import { loadDatabasePath, openDatabase } from '../src/database.js';
import { GameSessionTracker } from '../src/GameSessionTracker.js';
import { SqliteSessionRepository, SqliteSnapshotRepository } from '../src/sqliteRepositories.js';
import { TrackedCollector, type SnapshotCollector } from '../src/TrackedCollector.js';
import type { CollectorExit, GameSession, GameSnapshot, HistoricalSnapshot } from '../src/types.js';

function temporaryDatabase(t: TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), 'plague-sqlite-test-'));
  const databasePath = path.join(directory, 'history.sqlite');
  let db = openDatabase(databasePath);
  t.after(() => {
    if (db.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    databasePath,
    get db() { return db; },
    reopen() { db.close(); db = openDatabase(databasePath); return db; },
  };
}

function rowCount(db: Database.Database, table: string): number {
  if (!['game_sessions', 'daily_snapshots', 'country_snapshots'].includes(table)) {
    throw new Error('unknown test table');
  }
  return db.prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count;
}

function snapshot(day: number, revision = 1, countryCount = 58): GameSnapshot {
  const ids = ['soudi_arabia', 'morroco', 'philipines', 'balcan_states'];
  return {
    capturedAt: new Date(Date.UTC(2026, 8, 23, 0, day % 60, revision)).toISOString(),
    day,
    gameDate: new Date(Date.UTC(2026, 8, 23 + day)).toISOString().slice(0, 10),
    diseaseTurn: day + revision,
    eventTurn: revision,
    cureProgress: revision * 1.25,
    zombieHordeEvents: [],
    countries: Array.from({ length: countryCount }, (_, index) => ({
      index,
      id: ids[index] ?? `country_${index}`,
      currentPopulation: 1000 - revision,
      originalPopulation: 1000,
      healthyPopulation: 1000 - revision,
      deadPopulation: 0,
      infected: revision,
      zombies: 0,
      governmentActions: [],
      cureResearch: null,
    })),
  };
}

function session(id: string, day: number, endedAt: string | null = null): GameSession {
  return {
    id,
    startedAt: '2026-09-23T00:00:00.000Z',
    endedAt,
    firstDay: day,
    lastDay: day,
  };
}

function historical(id: string, day: number, revision = 1, count = 58): HistoricalSnapshot {
  return { sessionId: id, ...snapshot(day, revision, count) };
}

test('database path config, migrations, foreign keys and WAL', (t) => {
  const store = temporaryDatabase(t);
  assert.equal(loadDatabasePath({ PLAGUE_DB_PATH: ':memory:' }), ':memory:');
  assert.ok(loadDatabasePath({}).endsWith(path.join('backend', 'data', 'plague-tracker.sqlite')));
  assert.equal(store.db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(store.db.pragma('journal_mode', { simple: true }), 'wal');
  assert.deepEqual(store.db.prepare<[], { version: number }>('SELECT version FROM schema_migrations').all(),
    [{ version: 1 }, { version: 2 }, { version: 3 }]);
  assert.ok(existsSync(store.databasePath));
  store.reopen();
  assert.equal(rowCount(store.db, 'game_sessions'), 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() !== undefined, true);
  const memory = openDatabase(':memory:');
  t.after(() => memory.close());
  assert.equal(memory.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(memory.pragma('journal_mode', { simple: true }), 'memory');
});

test('session and one day persist all 58 countries in original index and raw-id order', (t) => {
  const store = temporaryDatabase(t);
  const sessions = new SqliteSessionRepository(store.db);
  const snapshots = new SqliteSnapshotRepository(store.db);
  sessions.save(session('game-a', 10));
  snapshots.save(historical('game-a', 10));
  assert.equal(rowCount(store.db, 'game_sessions'), 1);
  assert.equal(rowCount(store.db, 'daily_snapshots'), 1);
  assert.equal(rowCount(store.db, 'country_snapshots'), 58);
  assert.deepEqual(snapshots.getLatestForSession('game-a'), historical('game-a', 10));
  assert.deepEqual(snapshots.getByDay('game-a', 10), historical('game-a', 10));
  assert.equal(snapshots.getByDay('game-a', 11), null);
  assert.deepEqual(snapshots.list('game-a')[0]!.countries.map((country) => country.index),
    Array.from({ length: 58 }, (_, index) => index));
  assert.deepEqual(snapshots.list('game-a')[0]!.countries.slice(0, 4).map((country) => country.id),
    ['soudi_arabia', 'morroco', 'philipines', 'balcan_states']);
});

test('full day SQLite read uses one global, one country and one action query', (t) => {
  const store = temporaryDatabase(t);
  const sessions = new SqliteSessionRepository(store.db);
  sessions.save(session('game-a', 10));
  new SqliteSnapshotRepository(store.db).save(historical('game-a', 10));
  const queries: string[] = [];
  const traced = new Proxy(store.db, {
    get(target, property, receiver) {
      if (property === 'prepare') return (sql: string) => {
        queries.push(sql);
        return target.prepare(sql);
      };
      return Reflect.get(target, property, receiver);
    },
  }) as Database.Database;
  const repository = new SqliteSnapshotRepository(traced);
  const result = repository.getByDay('game-a', 10);
  assert.equal(result?.countries.length, 58);
  assert.equal(queries.length, 3);
  assert.match(queries[0]!, /daily_snapshots/);
  assert.match(queries[1]!, /country_snapshots[\s\S]*ORDER BY country_index/);
  assert.match(queries[2]!, /government_action_events[\s\S]*ORDER BY country_id, event_index/);
  queries.length = 0;
  assert.equal(repository.getByDay('game-a', 11), null);
  assert.equal(queries.length, 1);
});

test('SQLite lists unique session countries in index order with raw IDs', (t) => {
  const store = temporaryDatabase(t);
  const sessions = new SqliteSessionRepository(store.db);
  const snapshots = new SqliteSnapshotRepository(store.db);
  sessions.save(session('empty', 0));
  sessions.save(session('game-a', 10));
  snapshots.save(historical('game-a', 10, 1, 4));
  snapshots.save(historical('game-a', 11, 1, 4));
  snapshots.save(historical('game-a', 11, 2, 4));
  assert.deepEqual(snapshots.getCountriesForSession('empty'), []);
  assert.deepEqual(snapshots.getCountriesForSession('game-a'), [
    { id: 'soudi_arabia', index: 0 },
    { id: 'morroco', index: 1 },
    { id: 'philipines', index: 2 },
    { id: 'balcan_states', index: 3 },
  ]);
  assert.deepEqual(snapshots.getCountriesForSession('missing'), []);
});

test('day replacement updates globals and replaces the complete country set without duplicates', (t) => {
  const store = temporaryDatabase(t);
  const sessions = new SqliteSessionRepository(store.db);
  const snapshots = new SqliteSnapshotRepository(store.db);
  sessions.save(session('game-a', 10));
  snapshots.save(historical('game-a', 10, 1, 3));
  snapshots.save(historical('game-a', 10, 2, 2));
  assert.equal(rowCount(store.db, 'daily_snapshots'), 1);
  assert.equal(rowCount(store.db, 'country_snapshots'), 2);
  assert.deepEqual(snapshots.list('game-a'), [historical('game-a', 10, 2, 2)]);
  assert.throws(() => store.db.prepare(`
    INSERT INTO daily_snapshots
      (session_id, day, captured_at, game_date, disease_turn, event_turn, cure_progress)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('game-a', 10, '2026-09-23T00:00:00Z', '2026-09-23', 10, 10, 0), /UNIQUE|PRIMARY KEY/);
});

test('failed replacement rolls back global changes and all country changes', (t) => {
  const store = temporaryDatabase(t);
  const sessions = new SqliteSessionRepository(store.db);
  const snapshots = new SqliteSnapshotRepository(store.db);
  sessions.save(session('game-a', 10));
  const original = historical('game-a', 10, 1, 2);
  snapshots.save(original);
  const invalid = historical('game-a', 10, 9, 2);
  invalid.countries[1]!.index = invalid.countries[0]!.index;
  assert.throws(() => snapshots.save(invalid), /UNIQUE/);
  assert.deepEqual(snapshots.list('game-a'), [original]);
  assert.equal(rowCount(store.db, 'country_snapshots'), 2);
});

test('two sessions remain independent and foreign-key cascade deletes their own days', (t) => {
  const store = temporaryDatabase(t);
  const sessions = new SqliteSessionRepository(store.db);
  const snapshots = new SqliteSnapshotRepository(store.db);
  sessions.save(session('game-a', 10, '2026-09-23T00:00:00Z'));
  sessions.save(session('game-b', 0));
  snapshots.save(historical('game-a', 10, 1, 2));
  snapshots.save(historical('game-b', 0, 2, 3));
  assert.deepEqual(snapshots.list('game-a').map((item) => item.day), [10]);
  assert.deepEqual(snapshots.list('game-b').map((item) => item.day), [0]);
  assert.equal(rowCount(store.db, 'daily_snapshots'), 2);
  store.db.prepare('DELETE FROM game_sessions WHERE id = ?').run('game-a');
  assert.equal(rowCount(store.db, 'game_sessions'), 1);
  assert.equal(rowCount(store.db, 'daily_snapshots'), 1);
  assert.equal(rowCount(store.db, 'country_snapshots'), 3);
  assert.deepEqual(snapshots.list('game-b'), [historical('game-b', 0, 2, 3)]);
});

test('full history survives close and reopen with all fields and 58 country indexes', (t) => {
  const store = temporaryDatabase(t);
  new SqliteSessionRepository(store.db).save(session('game-a', 20, '2026-09-23T00:00:00Z'));
  new SqliteSnapshotRepository(store.db).save(historical('game-a', 20));
  new SqliteSnapshotRepository(store.db).save(historical('game-a', 21, 2));
  store.reopen();
  const restored = new SqliteSnapshotRepository(store.db).list('game-a');
  assert.deepEqual(restored, [historical('game-a', 20), historical('game-a', 21, 2)]);
  assert.equal(restored[1]!.countries.length, 58);
  assert.equal(new SqliteSessionRepository(store.db).list()[0]!.endedAt,
    '2026-09-23T00:00:00Z');
});

test('restart resumes open session on same and next day, then lower day creates a new session', async (t) => {
  const store = temporaryDatabase(t);
  const makeTracker = (db: Database.Database) => new GameSessionTracker({
    sessions: new SqliteSessionRepository(db),
    snapshots: new SqliteSnapshotRepository(db),
  });
  const first = makeTracker(store.db);
  await first.handleSnapshot(snapshot(150, 1));
  const originalId = first.getActiveSession()!.id;
  await first.flush();
  assert.equal(rowCount(store.db, 'daily_snapshots'), 1);
  assert.equal(new SqliteSessionRepository(store.db).getLatestOpen()!.id, originalId);
  assert.equal(new SqliteSessionRepository(store.db).getLatestOpen()!.endedAt, null);

  store.reopen();
  const resumed = makeTracker(store.db);
  await resumed.initialize();
  assert.equal(resumed.getActiveSession()!.id, originalId);
  assert.equal(resumed.getCurrentDaySnapshot()!.day, 150);
  await resumed.handleSnapshot(snapshot(150, 2));
  await resumed.flush();
  assert.equal(rowCount(store.db, 'daily_snapshots'), 1);
  assert.equal(new SqliteSnapshotRepository(store.db).getLatestForSession(originalId)!.eventTurn, 2);
  await resumed.handleSnapshot(snapshot(151, 1));
  await resumed.flush();
  assert.equal(resumed.getActiveSession()!.id, originalId);
  assert.equal(rowCount(store.db, 'daily_snapshots'), 2);
  assert.equal(rowCount(store.db, 'country_snapshots'), 116);
  assert.equal(new SqliteSessionRepository(store.db).getLatestOpen()!.lastDay, 151);

  store.reopen();
  const afterSecondRestart = makeTracker(store.db);
  await afterSecondRestart.handleSnapshot(snapshot(149, 1));
  const newId = afterSecondRestart.getActiveSession()!.id;
  assert.notEqual(newId, originalId);
  await afterSecondRestart.flush();
  const sessions = new SqliteSessionRepository(store.db).list();
  assert.equal(sessions.length, 2);
  assert.notEqual(sessions.find((item) => item.id === originalId)!.endedAt, null);
  assert.equal(sessions.find((item) => item.id === newId)!.endedAt, null);
  assert.deepEqual(new SqliteSnapshotRepository(store.db).list(newId).map((item) => item.day), [149]);
});

test('restart after an unflushed day uses persisted lastDay without inventing history', async (t) => {
  const store = temporaryDatabase(t);
  const makeTracker = (db: Database.Database) => new GameSessionTracker({
    sessions: new SqliteSessionRepository(db),
    snapshots: new SqliteSnapshotRepository(db),
  });
  const first = makeTracker(store.db);
  await first.handleSnapshot(snapshot(150));
  await first.handleSnapshot(snapshot(151));
  const id = first.getActiveSession()!.id;
  assert.deepEqual(new SqliteSnapshotRepository(store.db).list(id).map((item) => item.day), [150]);
  assert.equal(new SqliteSessionRepository(store.db).getLatestOpen()!.lastDay, 151);

  store.reopen(); // Simulate abrupt process loss without flush().
  const resumed = makeTracker(store.db);
  await resumed.initialize();
  assert.equal(resumed.getActiveSession()!.id, id);
  assert.equal(resumed.getCurrentDaySnapshot(), null);
  await resumed.handleSnapshot(snapshot(151, 2));
  await resumed.flush();
  assert.deepEqual(new SqliteSnapshotRepository(store.db).list(id).map((item) => item.day), [150, 151]);
  assert.equal(new SqliteSessionRepository(store.db).getLatestOpen()!.endedAt, null);
});

test('graceful tracked stop persists final day but does not close the game session', async (t) => {
  const store = temporaryDatabase(t);
  const snapshotListeners = new Set<(value: GameSnapshot) => void>();
  let onExit: ((value: CollectorExit) => void) | null = null;
  const collector: SnapshotCollector = {
    async start() {},
    async stop() { onExit?.({ code: null, signal: 'SIGTERM', requested: true }); },
    onSnapshot(listener) { snapshotListeners.add(listener); return () => { snapshotListeners.delete(listener); }; },
    onExit(listener) { onExit = listener; return () => { onExit = null; }; },
  };
  const tracker = new GameSessionTracker({
    sessions: new SqliteSessionRepository(store.db),
    snapshots: new SqliteSnapshotRepository(store.db),
  });
  const tracked = new TrackedCollector(collector, tracker);
  await tracked.start();
  for (const listener of snapshotListeners) listener(snapshot(42, 1));
  for (const listener of snapshotListeners) listener(snapshot(42, 2));
  await tracked.stop();
  await tracked.stop();
  assert.equal(rowCount(store.db, 'daily_snapshots'), 1);
  assert.equal(rowCount(store.db, 'country_snapshots'), 58);
  assert.equal(new SqliteSnapshotRepository(store.db).list()[0]!.eventTurn, 2);
  assert.equal(new SqliteSessionRepository(store.db).getLatestOpen()!.endedAt, null);
  tracked.dispose();
});
