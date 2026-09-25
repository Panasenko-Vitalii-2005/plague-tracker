import { buildApi } from './api.js';
import { loadApiConfig } from './apiConfig.js';
import { loadCollectorConfig } from './config.js';
import { loadDatabasePath, openDatabase } from './database.js';
import { GameSessionTracker } from './GameSessionTracker.js';
import { PlagueCollectorProcess } from './PlagueCollectorProcess.js';
import { CollectorSupervisor } from './CollectorSupervisor.js';
import { SqliteSessionRepository, SqliteSnapshotRepository } from './sqliteRepositories.js';
import { TrackedCollector } from './TrackedCollector.js';

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function main(): Promise<void> {
  const apiConfig = loadApiConfig();
  const collectorConfig = loadCollectorConfig();
  const databasePath = loadDatabasePath();
  const db = openDatabase(databasePath);
  const sessions = new SqliteSessionRepository(db);
  const snapshots = new SqliteSnapshotRepository(db);
  const tracker = new GameSessionTracker({
    sessions,
    snapshots,
    log: (message) => console.log(message),
  });
  const collector = new PlagueCollectorProcess(collectorConfig);
  const tracked = new TrackedCollector(collector, tracker);
  const supervisor = new CollectorSupervisor(collector, tracked, { log: (message) => console.log(message) });
  const api = buildApi({ tracker, sessions, snapshots, collector: supervisor, liveEvents: supervisor });

  collector.onSnapshot((snapshot) => {
    console.log(`[snapshot] day=${snapshot.day} date=${snapshot.gameDate} cure=${snapshot.cureProgress} diseaseTurn=${snapshot.diseaseTurn} eventTurn=${snapshot.eventTurn} countries=${snapshot.countries.length}`);
  });

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      let failed = false;
      // Stop HTTP admission first. Then stop the child and flush all queued
      // snapshots before closing the database.
      try { await api.close(); } catch (cause) {
        failed = true;
        console.error(`[api:error] shutdown: ${describeError(cause)}`);
      }
      try { await supervisor.stop(); } catch (cause) {
        failed = true;
        console.error(`[collector:error] shutdown: ${describeError(cause)}`);
      }
      try { await tracker.flush(); } catch (cause) {
        failed = true;
        console.error(`[history:error] shutdown: ${describeError(cause)}`);
      }
      try {
        const daily = db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM daily_snapshots').get()?.count ?? 0;
        const countryRows = db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM country_snapshots').get()?.count ?? 0;
        console.log(`[history] stored=${daily} countryRows=${countryRows}`);
      } catch (cause) {
        failed = true;
        console.error(`[database:error] summary: ${describeError(cause)}`);
      } finally {
        supervisor.dispose();
        tracked.dispose();
        db.close();
      }
      process.exitCode = failed ? 1 : 0;
    })();
    return shutdownPromise;
  };
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });

  try {
    await tracker.initialize();
    await api.listen(apiConfig);
    console.log(`[api] listening http://${apiConfig.host}:${apiConfig.port}/api/v1`);
    console.log(`[database] opened ${databasePath}`);
    supervisor.start();
  } catch (cause) {
    await shutdown();
    throw cause;
  }
}

void main().catch((cause) => {
  console.error(`[backend:error] ${describeError(cause)}`);
  process.exitCode = 1;
});
