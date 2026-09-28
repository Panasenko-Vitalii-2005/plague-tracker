# Plague tracker backend collector consumer

This package reads the existing C# memory collector as an NDJSON child process,
stores one final observation per game day in SQLite, and serves a local,
read-only HTTP API consumed by the sibling Vite frontend.

## Setup

```powershell
cd D:\custom-projects\plague-tracker\backend
npm install
npm test
npm start
```

`npm start` builds the package, starts the HTTP server and the Release
collector executable with `--watch --interval 250`, and prints concise
snapshot, session, and history events. `npm run collector:test` remains an
alias for this development runner.

```text
[collector] started pid=12345
[session] started 00000000-0000-0000-0000-000000000001 day=0
[snapshot] day=0 date=2026-09-23 cure=0 diseaseTurn=0 eventTurn=0 countries=58
[history] finalized session=00000000-0000-0000-0000-000000000001 day=0
```

Press Ctrl+C to stop HTTP admission, cancel retries, stop and reap the child
collector, flush history, and close SQLite. Plague Inc may be started before or
after the backend: a supervisor waits for a valid game snapshot and reconnects
after the game closes and reopens. REST and SSE remain available while waiting.
The backend starts the compiled `.exe` directly; it never runs `dotnet run`.

Retries use delays of 1, 2, 3, then 5 seconds (5 seconds thereafter). A valid
snapshot resets the backoff. Collector exit flushes the buffered day but does
not close the game session; the existing day comparison decides whether the
next snapshot resumes it or starts a new session. Normal absence/loading of
the game leaves `/live` at `running:false` with `lastError:null`.

## Configuration

| Environment variable | Meaning | Default |
|---|---|---|
| `PLAGUE_COLLECTOR_PATH` | Absolute path to Release collector `.exe` | Development sibling project path |
| `PLAGUE_COLLECTOR_INTERVAL_MS` | Watch interval in milliseconds, 250–60000 | `250` |
| `PLAGUE_COLLECTOR_DEBUG` | Pass `--debug` when `true` | `false` |
| `PLAGUE_DB_PATH` | SQLite file path, or `:memory:` | `backend/data/plague-tracker.sqlite` |
| `PLAGUE_API_HOST` | HTTP listen host | `127.0.0.1` |
| `PLAGUE_API_PORT` | HTTP listen port | `3001` |

The development default resolves to
`D:\custom-projects\C# console collector\bin\Release\net8.0-windows\PlagueInc.MemoryCollector.exe`
in the current workspace layout. Set `PLAGUE_COLLECTOR_PATH` explicitly when
moving or deploying the packages.
Relative database paths resolve from the backend package directory. The data
directory is created automatically and ignored by Git. `:memory:` is useful
for temporary runs; it is not durable.

## Read-only HTTP API

All routes use `/api/v1` and return JSON. The default listener binds only to
`127.0.0.1`; there is no authentication or backend CORS. The frontend uses a
same-origin Vite development proxy.

| Route | Result |
|---|---|
| `GET /health` | `{ "status": "ok" }`, without database queries |
| `GET /live` | Collector status, active session and current snapshot; session/snapshot are `null` when collector is not running |
| `GET /live/stream` | Server-Sent Events for current live state (not historical replay) |
| `GET /sessions` | Newest-first session summaries with snapshot count and first/last game dates |
| `GET /sessions/:sessionId` | One session's metadata and date range |
| `GET /sessions/:sessionId/history` | `{ sessionId, history }` with global sums per observed day, no country arrays |
| `GET /sessions/:sessionId/days/:day` | Full saved snapshot for an observed day: session ID, global fields and countries in `country_index` order |
| `GET /sessions/:sessionId/countries` | `{ sessionId, countries: [{ id, index }] }`, raw IDs ordered by country index; empty for a session with no saved country rows |
| `GET /sessions/:sessionId/countries/:countryId/history` | `{ sessionId, countryId, history }` for the raw country ID |

For example, in PowerShell:

```powershell
$base = 'http://127.0.0.1:3001/api/v1'
Invoke-RestMethod "$base/health"
Invoke-RestMethod "$base/live"
$sessions = @(Invoke-RestMethod "$base/sessions")
$id = $sessions[0].id
Invoke-RestMethod "$base/sessions/$id"
Invoke-RestMethod "$base/sessions/$id/history"
$day = (Invoke-RestMethod "$base/sessions/$id/history").history[-1].day
Invoke-RestMethod "$base/sessions/$id/days/$day"
Invoke-RestMethod "$base/sessions/$id/countries"
Invoke-RestMethod "$base/sessions/$id/countries/soudi_arabia/history"
```

Global history sums `healthyPopulation`, `infected`, `deadPopulation`,
`zombies`, and `originalPopulation` across countries. It does not infer any
metric from `currentPopulation`. Histories are ordered by ascending game day
and contain only actually observed days; gaps are not interpolated. Country
IDs such as `soudi_arabia` are not renamed. An unknown session returns 404
(`SESSION_NOT_FOUND`); an existing session without snapshots returns an empty
country list. An unknown country history returns 404 (`COUNTRY_NOT_FOUND`).
The full-day route returns 404 (`SNAPSHOT_NOT_FOUND`) for an unobserved day and
400 (`INVALID_DAY`) unless `day` is a non-negative safe integer. It does not
substitute a nearby day. Saved country values are returned unchanged.
Each live, SSE and full-day country also contains `publicOrder: number | null`:
the collector's raw `System.Single` fraction in `0..1`, **not** a percentage.
The backend does not scale or round it. Missing values in older collector
payloads and older SQLite rows become `null`, as do explicitly unreadable
values. Each historical day retains its own observed value; later changes do
not modify earlier snapshots.
Each live, SSE and full-day country also contains `borderStatus`,
`airportStatus`, and `portStatus`: each is exactly `"open"`, `"closed"`, or
`null`. They are current country-level infrastructure flags, not Government
Action history or disease-specific transport availability. `null` means
unavailable, unreadable, or not applicable (for example, no airport or port);
the backend never infers a state from actions or converts `null` to closed.
Missing fields in older collector payloads normalize to `null`. Migration 5
adds nullable, value-constrained columns to `country_snapshots`, so older
SQLite rows read as `null`; each historical day keeps its own stored values.
Each live and full-day country contains `governmentActions: [{ id, turn,
removed }]` and `cureResearch: { funding, allocation, rank, flasks: { active,
inactive, destroyed } } | null`. Action IDs are raw and never whitelisted.
Schema migration 2 stores action events in list order and nullable cure values
on each saved country/day. Older rows return `governmentActions: []` and
`cureResearch: null`. Rank is derived for that day's positive funding values;
equal funding uses country index, and any missing cure contribution leaves
ranks null rather than guessing. The live API uses the current snapshot, while
the full-day route uses only values saved for the requested day.
Both `/api/v1/live` and the full-day route include `zombieHordeEvents` in
collector replay-list order. Each entry has dispatch `turn`, `eventTurn`,
`diseaseId`, raw source/destination IDs, `zombies`, and nullable `vehicleId`,
`arrivalTurn`, `arrivalEventTurn`. A day saved before arrival retains null
arrival fields even when a later day knows the exact arrival. Missing event
arrays in older collector payloads and older SQLite rows become `[]`; missing
lifecycle fields become JSON `null` during ingestion.
`/api/v1/live` (`snapshot.countryInfectionEvents`), SSE live snapshots,
and the full-day route expose `countryInfectionEvents: [{ countryId, turn,
eventTurn, diseaseId }]`. This cumulative replay-derived list records the
game's **first detected infection marker** in supported ordinary single-player
play, not necessarily the physical instant the first infected person entered
a country. It has no reliable source-country or route provenance; the backend
does not infer either. Replay order, duplicates, raw country IDs and integer
values are preserved. Missing arrays from older collectors and older SQLite
rows read as `[]`. Each historical day returns only the list stored with that
day; later markers do not retroactively enrich earlier snapshots.
All API errors have `{ "error": { "code": "...", "message": "..." } }`;
unexpected errors are logged server-side and do not expose stack traces.

## Live SSE stream

Connect an `EventSource` to `http://127.0.0.1:3001/api/v1/live/stream`.
The response uses `text/event-stream`, `Cache-Control: no-cache`, and a
keep-alive connection. Every connection immediately receives `state`, matching
the conceptual shape of `GET /live`, even if the game is unavailable. It stays
open while the game is paused or the collector is stopped.

```text
id: 1
event: state
data: {"collector":{"running":true,"lastError":null},"session":{"id":"..."},"snapshot":{"day":152,"countries":[...]}}

id: 2
event: snapshot
data: {"sessionId":"...","snapshot":{"day":152,"countries":[...]}}

id: 3
event: status
data: {"running":false,"lastError":null}

: heartbeat

```

`snapshot` is emitted for every valid collector snapshot after the tracker
assigns its session ID; several snapshots for one day are normal. It includes
all countries. `status` reports collector start, error, and stop/exit. The
heartbeat is an SSE comment about every 15 seconds and has no event ID.
Event IDs increase only within this backend process and are not database IDs.
On reconnect the server sends a fresh `state`, then new live events. It ignores
`Last-Event-ID` and does not replay missed events; persistent daily history is
available through the REST endpoints.

Each client unsubscribes and clears its heartbeat timer on disconnect. If a
client cannot receive data fast enough, the stream keeps at most the newest
pending snapshot and newest status instead of building an unbounded queue.
The same SSE connection remains open across collector exit and restart. It
receives `status` with `running:false` on exit and `running:true` after the
first valid snapshot from a newly attached collector.

## Collector process

```ts
import { loadCollectorConfig, PlagueCollectorProcess } from './dist/src/index.js';

const collector = new PlagueCollectorProcess(loadCollectorConfig());
const unsubscribe = collector.onSnapshot((snapshot) => {
  console.log(snapshot.diseaseTurn, snapshot.countries.length);
});
collector.onError((error) => console.error(error.message));
collector.onExit((exit) => console.log(exit.code, exit.signal));

await collector.start();
console.log(collector.getStatus(), collector.getLatestSnapshot());
// On application shutdown:
await collector.stop();
unsubscribe();
```

`start()` rejects if this instance already has a child. There is no automatic
reconnect. `getStatus()` exposes `stopped`, `starting`, `running`, or `failed`,
along with PID, timestamps, last turn/error, and exit details. The process
itself keeps only the last valid snapshot, which remains readable after exit.
Session and daily history state live in the separate tracker.

The stdout reader uses an incremental UTF-8 decoder and a bounded line buffer.
It accepts LF and CRLF, ignores blank lines, and discards an unfinished tail
when the child closes. Each line is parsed and validated independently. A bad
line is logged and skipped; later lines continue normally. Validation requires
a parseable ISO timestamp, a valid `yyyy-MM-dd` game date, non-negative safe
integer `day`, turns and population values, finite `cureProgress` in `0..100`,
`publicOrder` either null or finite in `0..1`, non-empty country IDs, and no
duplicate IDs. Infrastructure statuses accept only exact `"open"`, `"closed"`,
or `null` (and normalize missing fields to `null`); other strings and types
reject the snapshot. It does not require exactly 58 countries. Raw IDs are passed
through unchanged.

Stderr has its own line reader and is never parsed as a snapshot. Diagnostic
lines are logged with `[collector]`; lines beginning with `error:` are reported
with `[collector:error]` and retained as `lastError`, including when the child
then exits non-zero. `--debug` is passed only when configured.

`stop()` first calls Node's `child.kill('SIGTERM')` and waits up to five seconds
for `close`. On Windows, Node may terminate the child directly rather than
delivering a console Ctrl+C event, so the collector's Ctrl+C handler is not
guaranteed to run when its parent stops it. If the child remains alive, the
consumer uses `SIGKILL` as a final cleanup step and waits two more seconds.
An intentional stop is recorded as `stopped`; an unexpected non-zero exit is
recorded as `failed`. The dev runner handles SIGINT/SIGTERM and awaits `stop()`
to avoid leaving an orphan collector.

## Sessions and daily history

`GameSessionTracker` owns the monotonic-day timeline and one buffered
`currentDaySnapshot`. Await `handleSnapshot(snapshot)` before reading its
state. A snapshot on the same `day` replaces the buffer, even when only its
`eventTurn`, `diseaseTurn`, cure or country data changed. On a higher `day`, the
last observed snapshot of the previous day is finalized and the incoming one
becomes the new buffer. A gap is logged but missing days are never synthesized.
On a lower `day`, the tracker finalizes and ends the old session, then creates
a new backend UUID session. PID and `diseaseTurn` are not session keys.

`flush()` persists the buffered day but keeps the game session open. It is
idempotent. Only a lower observed day closes a session and sets `endedAt`.
`TrackedCollector` wires the process's snapshot/exit events to the tracker and
also flushes on explicit `stop()`. The dev runner awaits that stop during
backend shutdown. History includes the flushed day; the current in-progress
day is also available from `getCurrentDaySnapshot()`.

```ts
import {
  GameSessionTracker,
  PlagueCollectorProcess,
  SqliteSessionRepository,
  SqliteSnapshotRepository,
  TrackedCollector,
  loadCollectorConfig,
  loadDatabasePath,
  openDatabase,
} from './dist/src/index.js';

const db = openDatabase(loadDatabasePath());
const tracker = new GameSessionTracker({
  sessions: new SqliteSessionRepository(db),
  snapshots: new SqliteSnapshotRepository(db),
  log: console.error,
});
const tracked = new TrackedCollector(
  new PlagueCollectorProcess(loadCollectorConfig()),
  tracker,
);
await tracked.start();
// On shutdown; also happens on child-process exit:
await tracked.stop();
const sessions = await tracker.getSessions();
const history = await tracker.getHistory(sessions[0]?.id);
tracked.dispose();
db.close();
```

The repository interfaces accept synchronous or asynchronous implementations,
so tracking rules do not depend on SQLite. In-memory implementations remain
available for tests or ephemeral use.

On startup, `TrackedCollector.start()` initializes the tracker from the latest
open session and its latest saved historical snapshot before starting the
collector. If the next `day` is the same or higher, that session continues;
the same day can be replaced by a newer observation. If the day decreases,
the old session closes and a new UUID session begins. A backend restart alone
does not create a new game session.

SQLite migrations are versioned in `schema_migrations`. Version 1 creates
`game_sessions`, `daily_snapshots`, and `country_snapshots`. Foreign keys are
enabled; migration 3 adds a JSON column on `daily_snapshots` for that day's
exact ordered Zombie Horde event list, including duplicate-looking entries.
Migration 4 adds nullable `country_snapshots.public_order` with a `0..1`
constraint; pre-migration rows read as null. Migration 5 adds nullable
infrastructure-status columns. Migration 6 adds
`daily_snapshots.country_infection_events_json` with an empty-array default
for old rows. The ordered list is replaced atomically with the daily snapshot.
File-backed databases use WAL. Each daily upsert is one transaction:
update the global row, delete its old country rows, insert the complete current
set. The `(session_id, day)` primary key prevents duplicate days, and
`country_index` preserves the collector's country order on read-back. Raw
country IDs are stored unchanged. A failed country insert rolls back the
global update and all country changes.
