import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const backendDirectory = fileURLToPath(new URL('../../', import.meta.url));

export function loadDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.PLAGUE_DB_PATH?.trim() || 'data/plague-tracker.sqlite';
  return configured === ':memory:' ? configured : path.resolve(backendDirectory, configured);
}

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE game_sessions (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        first_day INTEGER NOT NULL CHECK (first_day >= 0),
        last_day INTEGER NOT NULL CHECK (last_day >= first_day)
      );
      CREATE INDEX game_sessions_open_idx ON game_sessions(ended_at, started_at);

      CREATE TABLE daily_snapshots (
        session_id TEXT NOT NULL,
        day INTEGER NOT NULL CHECK (day >= 0),
        captured_at TEXT NOT NULL,
        game_date TEXT NOT NULL,
        disease_turn INTEGER NOT NULL,
        event_turn INTEGER NOT NULL,
        cure_progress REAL NOT NULL CHECK (cure_progress >= 0 AND cure_progress <= 100),
        PRIMARY KEY (session_id, day),
        FOREIGN KEY (session_id) REFERENCES game_sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE country_snapshots (
        session_id TEXT NOT NULL,
        day INTEGER NOT NULL,
        country_id TEXT NOT NULL,
        country_index INTEGER NOT NULL CHECK (country_index >= 0),
        current_population INTEGER NOT NULL,
        original_population INTEGER NOT NULL,
        healthy_population INTEGER NOT NULL,
        dead_population INTEGER NOT NULL,
        infected INTEGER NOT NULL,
        zombies INTEGER NOT NULL,
        PRIMARY KEY (session_id, day, country_id),
        UNIQUE (session_id, day, country_index),
        FOREIGN KEY (session_id, day)
          REFERENCES daily_snapshots(session_id, day) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE country_snapshots ADD COLUMN cure_funding REAL;
      ALTER TABLE country_snapshots ADD COLUMN cure_allocation REAL;
      ALTER TABLE country_snapshots ADD COLUMN flask_active INTEGER;
      ALTER TABLE country_snapshots ADD COLUMN flask_inactive INTEGER;
      ALTER TABLE country_snapshots ADD COLUMN flask_destroyed INTEGER;

      CREATE TABLE government_action_events (
        session_id TEXT NOT NULL,
        day INTEGER NOT NULL,
        country_id TEXT NOT NULL,
        event_index INTEGER NOT NULL,
        action_id TEXT NOT NULL,
        turn INTEGER NOT NULL,
        removed INTEGER NOT NULL CHECK (removed IN (0, 1)),
        PRIMARY KEY (session_id, day, country_id, event_index),
        FOREIGN KEY (session_id, day, country_id)
          REFERENCES country_snapshots(session_id, day, country_id) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE daily_snapshots
        ADD COLUMN zombie_horde_events_json TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE country_snapshots ADD COLUMN public_order REAL
        CHECK (public_order IS NULL OR (public_order >= 0 AND public_order <= 1));
    `,
  },
] as const;

export function openDatabase(databasePath = loadDatabasePath()): Database.Database {
  if (databasePath !== ':memory:') {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const db = new Database(databasePath);
  try {
    db.pragma('foreign_keys = ON');
    if (databasePath !== ':memory:') db.pragma('journal_mode = WAL');
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`);

    const applied = new Set(
      db.prepare<[], { version: number }>('SELECT version FROM schema_migrations ORDER BY version')
        .all().map((row) => row.version),
    );
    if ([...applied].some((version) => !migrations.some((migration) => migration.version === version))) {
      throw new Error('database contains an unsupported schema migration');
    }
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      db.transaction(() => {
        db.exec(migration.sql);
        db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
          .run(migration.version, new Date().toISOString());
      })();
    }
    return db;
  } catch (cause) {
    db.close();
    throw cause;
  }
}
