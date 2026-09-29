import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { buildApi } from "../src/api.js";
import { openDatabase } from "../src/database.js";
import { GameSessionTracker } from "../src/GameSessionTracker.js";
import { publicOrderStatus } from "../src/publicOrderTimeline.js";
import {
  InMemorySessionRepository,
  InMemorySnapshotRepository,
} from "../src/repositories.js";
import {
  SqliteSessionRepository,
  SqliteSnapshotRepository,
} from "../src/sqliteRepositories.js";
import {
  TrackedCollector,
  type SnapshotCollector,
} from "../src/TrackedCollector.js";
import type {
  CollectorExit,
  GameSnapshot,
  PublicOrderEvent,
} from "../src/types.js";
import {
  parsePublicOrderEvents,
  validateSnapshot,
} from "../src/validateSnapshot.js";

function snapshot(
  day: number,
  publicOrder: number | null,
  id = "soudi_arabia",
): GameSnapshot {
  return {
    capturedAt: new Date(Date.UTC(2026, 8, 23, 0, day % 60)).toISOString(),
    day,
    gameDate: new Date(Date.UTC(2027, 0, day + 1)).toISOString().slice(0, 10),
    diseaseTurn: day,
    eventTurn: day + 10,
    cureProgress: 0,
    zombieHordeEvents: [],
    countryInfectionEvents: [],
    gameMilestones: [],
    publicOrderEvents: [],
    countries: [
      {
        index: 0,
        id,
        currentPopulation: 100,
        originalPopulation: 100,
        healthyPopulation: 90,
        deadPopulation: 0,
        infected: 10,
        zombies: 0,
        publicOrder,
        borderStatus: null,
        airportStatus: null,
        portStatus: null,
        governmentActions: [],
        cureResearch: null,
      },
    ],
  };
}

test("Public Order classifier uses exact raw fraction boundaries without rounding", () => {
  const cases = [
    [1, "normal"],
    [0.9, "normal"],
    [0.8999999, "general_disorder"],
    [0.6, "general_disorder"],
    [0.5999999, "mass_disorder"],
    [0.3, "mass_disorder"],
    [0.2999999, "near_anarchy"],
    [0.0000001, "near_anarchy"],
    [0, "anarchy"],
    [null, null],
  ] as const;
  for (const [value, expected] of cases)
    assert.equal(publicOrderStatus(value), expected);
  for (const value of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => publicOrderStatus(value), RangeError);
  }
});

test("baseline and same-band changes create no events; deterioration, improvement and jumps create one each", async () => {
  const tracker = new GameSessionTracker({ createId: () => "game" });
  await tracker.handleSnapshot(snapshot(10, 0.95));
  assert.deepEqual(tracker.getCurrentDaySnapshot()?.publicOrderEvents, []);

  await tracker.handleSnapshot(snapshot(10, 0.93));
  assert.deepEqual(tracker.getCurrentDaySnapshot()?.publicOrderEvents, []);

  await tracker.handleSnapshot(snapshot(10, 0.31));

  const first = tracker.getCurrentDaySnapshot()?.publicOrderEvents;
  assert.deepEqual(first, [
    {
      countryId: "soudi_arabia",
      turn: 10,
      fromStatus: "normal",
      toStatus: "mass_disorder",
      publicOrder: 0.31,
      direction: "deteriorated",
    },
  ]);

  await tracker.handleSnapshot(snapshot(10, 0.31));
  assert.deepEqual(
    tracker.getCurrentDaySnapshot()?.publicOrderEvents,
    first,
    "repeated ingestion of the same snapshot must not append a duplicate",
  );

  await tracker.handleSnapshot(snapshot(11, 0.68));

  const events = tracker.getCurrentDaySnapshot()?.publicOrderEvents;
  assert.equal(events?.length, 2);

  assert.deepEqual(events?.[1], {
    countryId: "soudi_arabia",
    turn: 11,
    fromStatus: "mass_disorder",
    toStatus: "general_disorder",
    publicOrder: 0.68,
    direction: "improved",
  });

  assert.equal(
    tracker.getCurrentDaySnapshot()?.countries[0]?.publicOrder,
    0.68,
    "the raw Public Order value must remain unchanged",
  );
});
test("null and missing-day gaps rebaseline without synthesizing threshold crossings", async () => {
  const tracker = new GameSessionTracker({ createId: () => "game" });
  await tracker.handleSnapshot(snapshot(10, null));
  await tracker.handleSnapshot(snapshot(11, 0.87));
  await tracker.handleSnapshot(snapshot(12, null));
  await tracker.handleSnapshot(snapshot(13, 0.58));
  assert.deepEqual(tracker.getCurrentDaySnapshot()?.publicOrderEvents, []);
  await tracker.handleSnapshot(snapshot(16, 0.31));
  assert.deepEqual(
    tracker.getCurrentDaySnapshot()?.publicOrderEvents,
    [],
    "day 14-15 were not observed, so their crossings must not be guessed",
  );
  await tracker.handleSnapshot(snapshot(17, 0.15));
  assert.deepEqual(tracker.getCurrentDaySnapshot()?.publicOrderEvents, [
    {
      countryId: "soudi_arabia",
      turn: 17,
      fromStatus: "mass_disorder",
      toStatus: "near_anarchy",
      publicOrder: 0.15,
      direction: "deteriorated",
    },
  ]);
});

test("different countries retain raw IDs and independent event order", async () => {
  const tracker = new GameSessionTracker({ createId: () => "game" });
  const start = snapshot(10, 0.9);
  start.countries.push({
    ...start.countries[0]!,
    index: 1,
    id: "morroco",
    publicOrder: 0.3,
  });
  await tracker.handleSnapshot(start);
  const changed = snapshot(11, 0.5);
  changed.countries.push({
    ...changed.countries[0]!,
    index: 1,
    id: "morroco",
    publicOrder: 0.7,
  });
  await tracker.handleSnapshot(changed);
  assert.deepEqual(
    tracker
      .getCurrentDaySnapshot()
      ?.publicOrderEvents.map((event) => [
        event.countryId,
        event.direction,
        event.publicOrder,
      ]),
    [
      ["soudi_arabia", "deteriorated", 0.5],
      ["morroco", "improved", 0.7],
    ],
  );
});

test("legacy missing events normalize to empty; malformed persisted/API events are rejected", () => {
  const { publicOrderEvents: _omitted, ...legacy } = snapshot(10, 0.9);
  assert.deepEqual(validateSnapshot(legacy).publicOrderEvents, []);
  const event: PublicOrderEvent = {
    countryId: "soudi_arabia",
    turn: 10,
    fromStatus: "normal",
    toStatus: "general_disorder",
    publicOrder: 0.68,
    direction: "deteriorated",
  };
  assert.deepEqual(
    parsePublicOrderEvents([event, { ...event }]),
    [event, event],
    "valid persisted order and duplicates must be preserved",
  );
  for (const invalid of [
    { ...event, countryId: "" },
    { ...event, countryId: null },
    { ...event, turn: -1 },
    { ...event, turn: 1.5 },
    { ...event, fromStatus: "unknown" },
    { ...event, toStatus: "bogus_status" },
    { ...event, direction: "improved" },
    { ...event, publicOrder: 1.1 },
    { ...event, publicOrder: Number.NaN },
    { ...event, publicOrder: 0.31 },
  ]) {
    assert.throws(
      () =>
        validateSnapshot({
          ...snapshot(10, 0.9),
          publicOrderEvents: [invalid],
        }),
      /publicOrderEvents\[0\]/,
    );
    assert.throws(
      () => parsePublicOrderEvents([invalid]),
      /publicOrderEvents\[0\]/,
    );
  }
  for (const invalid of [null, {}, "event"]) {
    assert.throws(
      () =>
        validateSnapshot({ ...snapshot(10, 0.9), publicOrderEvents: invalid }),
      /publicOrderEvents/,
    );
  }
});

test("Migration 8 gives version-7 daily rows empty events and rejects corrupt stored event JSON", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "plague-public-order-v7-"));
  const databasePath = path.join(directory, "history.sqlite");
  const legacy = new Database(databasePath);
  legacy.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations VALUES (1, '2026-09-01'), (2, '2026-09-01'),
      (3, '2026-09-01'), (4, '2026-09-01'), (5, '2026-09-01'),
      (6, '2026-09-01'), (7, '2026-09-01');
    CREATE TABLE game_sessions (
      id TEXT PRIMARY KEY, started_at TEXT NOT NULL, ended_at TEXT,
      first_day INTEGER NOT NULL, last_day INTEGER NOT NULL);
    CREATE TABLE daily_snapshots (
      session_id TEXT NOT NULL, day INTEGER NOT NULL, captured_at TEXT NOT NULL,
      game_date TEXT NOT NULL, disease_turn INTEGER NOT NULL, event_turn INTEGER NOT NULL,
      cure_progress REAL NOT NULL, zombie_horde_events_json TEXT NOT NULL DEFAULT '[]',
      country_infection_events_json TEXT NOT NULL DEFAULT '[]',
      game_milestones_json TEXT NOT NULL DEFAULT '[]', PRIMARY KEY (session_id, day));
    CREATE TABLE country_snapshots (
      session_id TEXT NOT NULL, day INTEGER NOT NULL, country_id TEXT NOT NULL,
      country_index INTEGER NOT NULL, current_population INTEGER NOT NULL,
      original_population INTEGER NOT NULL, healthy_population INTEGER NOT NULL,
      dead_population INTEGER NOT NULL, infected INTEGER NOT NULL, zombies INTEGER NOT NULL,
      cure_funding REAL, cure_allocation REAL, flask_active INTEGER, flask_inactive INTEGER,
      flask_destroyed INTEGER, public_order REAL, border_status TEXT, airport_status TEXT,
      port_status TEXT, PRIMARY KEY (session_id, day, country_id));
    CREATE TABLE government_action_events (
      session_id TEXT NOT NULL, day INTEGER NOT NULL, country_id TEXT NOT NULL,
      event_index INTEGER NOT NULL, action_id TEXT NOT NULL, turn INTEGER NOT NULL,
      removed INTEGER NOT NULL);
    INSERT INTO game_sessions VALUES ('legacy', '2026-09-01T00:00:00Z', NULL, 10, 10);
    INSERT INTO daily_snapshots VALUES
      ('legacy', 10, '2026-09-01T00:00:00Z', '2027-01-11', 10, 20, 0, '[]', '[]', '[]');
  `);
  legacy.close();
  const db = openDatabase(databasePath);
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  assert.equal(
    db
      .prepare<
        [],
        { version: number }
      >("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")
      .get()!.version,
    8,
  );
  const repo = new SqliteSnapshotRepository(db);
  assert.deepEqual(repo.getByDay("legacy", 10)?.publicOrderEvents, []);
  db.prepare(
    "UPDATE daily_snapshots SET public_order_events_json = ? WHERE session_id = ?",
  ).run(JSON.stringify([{ countryId: "", turn: 10 }]), "legacy");
  assert.throws(() => repo.getByDay("legacy", 10), /publicOrderEvents\[0\]/);
});

test("SQLite restart preserves cumulative transitions and does not duplicate reprocessed snapshots", async (t) => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "plague-public-order-restart-"),
  );
  const databasePath = path.join(directory, "history.sqlite");
  let db = openDatabase(databasePath);
  t.after(() => {
    if (db.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  let sessions = new SqliteSessionRepository(db);
  let snapshots = new SqliteSnapshotRepository(db);
  const tracker = new GameSessionTracker({
    sessions,
    snapshots,
    createId: () => "game",
  });
  await tracker.handleSnapshot(snapshot(10, 0.87));
  await tracker.handleSnapshot(snapshot(10, 0.31));
  await tracker.flush();
  const original = snapshots.getByDay("game", 10)!.publicOrderEvents;
  assert.equal(original.length, 1);
  db.close();

  db = openDatabase(databasePath);
  sessions = new SqliteSessionRepository(db);
  snapshots = new SqliteSnapshotRepository(db);
  const resumed = new GameSessionTracker({ sessions, snapshots });
  await resumed.initialize();
  await resumed.handleSnapshot(snapshot(10, 0.31));
  await resumed.handleSnapshot(snapshot(10, 0.31));
  await resumed.handleSnapshot(snapshot(11, 0.31));
  await resumed.handleSnapshot(snapshot(11, 0.68));
  await resumed.flush();
  assert.equal(resumed.getActiveSession()?.id, "game");
  assert.deepEqual(snapshots.getByDay("game", 10)?.publicOrderEvents, original);
  assert.deepEqual(snapshots.getByDay("game", 11)?.publicOrderEvents, [
    original[0],
    {
      countryId: "soudi_arabia",
      turn: 11,
      fromStatus: "mass_disorder",
      toStatus: "general_disorder",
      publicOrder: 0.68,
      direction: "improved",
    },
  ]);
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) AS count FROM daily_snapshots").get() as {
        count: number;
      }
    ).count,
    2,
  );
});

test("restart rebaselines a changed first observation, then tracks later changes and resets at a new session", async () => {
  const sessions = new InMemorySessionRepository();
  const snapshots = new InMemorySnapshotRepository();
  const beforeRestart = new GameSessionTracker({
    sessions,
    snapshots,
    createId: () => "first",
  });
  await beforeRestart.handleSnapshot(snapshot(10, 0.9));
  await beforeRestart.flush();

  const afterRestart = new GameSessionTracker({
    sessions,
    snapshots,
    createId: () => "second",
  });
  await afterRestart.handleSnapshot(snapshot(10, 0.5));
  assert.deepEqual(
    afterRestart.getCurrentDaySnapshot()?.publicOrderEvents,
    [],
    "the unobserved change while the backend was down must not be fabricated",
  );
  await afterRestart.handleSnapshot(snapshot(11, 0.29));
  assert.deepEqual(afterRestart.getCurrentDaySnapshot()?.publicOrderEvents, [
    {
      countryId: "soudi_arabia",
      turn: 11,
      fromStatus: "mass_disorder",
      toStatus: "near_anarchy",
      publicOrder: 0.29,
      direction: "deteriorated",
    },
  ]);
  await afterRestart.handleSnapshot(snapshot(0, 0.1));
  assert.equal(afterRestart.getActiveSession()?.id, "second");
  assert.deepEqual(
    afterRestart.getCurrentDaySnapshot()?.publicOrderEvents,
    [],
    "a new game session starts a separate transition timeline",
  );
  assert.equal(
    (await afterRestart.getHistory("first")).at(-1)?.publicOrderEvents.length,
    1,
  );
});

class FakeCollector implements SnapshotCollector {
  private readonly listeners = new Set<(snapshot: GameSnapshot) => void>();
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  onSnapshot(listener: (snapshot: GameSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onExit(_listener: (exit: CollectorExit) => void): () => void {
    return () => {};
  }
  emit(snapshotValue: GameSnapshot): void {
    for (const listener of this.listeners) listener(snapshotValue);
  }
}

test("LIVE, SSE source and historical day API expose derived transitions without future leakage", async (t) => {
  const sessions = new InMemorySessionRepository();
  const snapshots = new InMemorySnapshotRepository();
  const tracker = new GameSessionTracker({
    sessions,
    snapshots,
    createId: () => "game",
  });
  const collector = new FakeCollector();
  const tracked = new TrackedCollector(collector, tracker);
  t.after(() => tracked.dispose());
  await tracked.start();
  const emitted: PublicOrderEvent[][] = [];
  tracked.onLiveSnapshot((event) =>
    emitted.push(event.snapshot.publicOrderEvents),
  );
  collector.emit(snapshot(10, 0.87));
  await tracked.waitForIdle();
  collector.emit(snapshot(11, 0.58));
  await tracked.waitForIdle();
  collector.emit(snapshot(12, 0.29));
  await tracked.waitForIdle();
  await tracker.flush();

  const app = buildApi({
    tracker,
    sessions,
    snapshots,
    collector: {
      getStatus: () => ({
        state: "running",
        pid: 1,
        startedAt: null,
        lastSnapshotAt: null,
        lastDiseaseTurn: 12,
        lastError: null,
        exit: null,
      }),
      getLatestSnapshot: () => snapshot(12, 0.29),
    },
    liveEvents: tracked,
  });
  t.after(() => app.close());
  const live = await app.inject("/api/v1/live");
  const day10 = await app.inject("/api/v1/sessions/game/days/10");
  const day11 = await app.inject("/api/v1/sessions/game/days/11");
  const day12 = await app.inject("/api/v1/sessions/game/days/12");
  assert.deepEqual(
    emitted.map((events) => events.length),
    [0, 1, 2],
  );
  assert.equal(live.json().snapshot.publicOrderEvents.length, 2);
  assert.deepEqual(
    [
      day10.json().publicOrderEvents.length,
      day11.json().publicOrderEvents.length,
      day12.json().publicOrderEvents.length,
    ],
    [0, 1, 2],
  );
  assert.equal(day11.json().publicOrderEvents[0].toStatus, "mass_disorder");

  assert.equal(day12.json().publicOrderEvents[1].toStatus, "near_anarchy");
});
