import { randomUUID } from 'node:crypto';
import {
  copySnapshot,
  InMemorySessionRepository,
  InMemorySnapshotRepository,
  type SessionRepository,
  type SnapshotRepository,
} from './repositories.js';
import type { GameSession, GameSnapshot, HistoricalSnapshot, PublicOrderEvent } from './types.js';
import { observedPublicOrderEvents } from './publicOrderTimeline.js';

export interface GameSessionTrackerOptions {
  sessions?: SessionRepository;
  snapshots?: SnapshotRepository;
  log?: (message: string) => void;
  createId?: () => string;
}

export class GameSessionTracker {
  private readonly sessions: SessionRepository;
  private readonly snapshots: SnapshotRepository;
  private readonly log: (message: string) => void;
  private readonly createId: () => string;
  private activeSession: GameSession | null = null;
  private currentDaySnapshot: GameSnapshot | null = null;
  private lastCapturedAt: string | null = null;
  private currentDayDirty = false;
  private initialized = false;
  private baselineAfterRestore = false;
  private lastKnownPublicOrderEvents: PublicOrderEvent[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(options: GameSessionTrackerOptions = {}) {
    this.sessions = options.sessions ?? new InMemorySessionRepository();
    this.snapshots = options.snapshots ?? new InMemorySnapshotRepository();
    this.log = options.log ?? (() => {});
    this.createId = options.createId ?? randomUUID;
  }

  initialize(): Promise<void> {
    return this.enqueue(() => this.restoreIfNeeded());
  }

  handleSnapshot(snapshot: GameSnapshot): Promise<void> {
    const incoming = copySnapshot(snapshot);
    return this.enqueue(async () => {
      await this.restoreIfNeeded();
      await this.accept(incoming);
    });
  }

  // Persist the buffered day without ending the game session. A process
  // restart may resume the same monotonic timeline.
  flush(): Promise<void> {
    return this.enqueue(async () => {
      await this.restoreIfNeeded();
      await this.finalizeCurrentDay();
    });
  }

  getActiveSession(): GameSession | null {
    return this.activeSession ? { ...this.activeSession } : null;
  }

  getCurrentDaySnapshot(): GameSnapshot | null {
    return this.currentDaySnapshot ? copySnapshot(this.currentDaySnapshot) : null;
  }

  async getHistory(sessionId?: string): Promise<HistoricalSnapshot[]> {
    await this.queue;
    return this.snapshots.list(sessionId);
  }

  async getSessions(): Promise<GameSession[]> {
    await this.queue;
    return this.sessions.list();
  }

  async waitForIdle(): Promise<void> {
    await this.queue;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.queue.then(operation);
    // Keep the queue usable after a repository failure; the caller still
    // receives the rejected result and can report it.
    this.queue = result.then(() => {}, () => {});
    return result;
  }

  private async restoreIfNeeded(): Promise<void> {
    if (this.initialized) return;
    const session = await this.sessions.getLatestOpen();
    if (session) {
      const latest = await this.snapshots.getLatestForSession(session.id);
      if (latest && latest.day > session.lastDay) {
        throw new Error(`session ${session.id} lastDay is older than its latest snapshot`);
      }
      this.activeSession = session;
      this.currentDaySnapshot = latest?.day === session.lastDay ? copySnapshot(latest) : null;
      this.lastCapturedAt = latest?.capturedAt ?? session.startedAt;
      this.currentDayDirty = false;
      this.baselineAfterRestore = latest !== null;
      this.lastKnownPublicOrderEvents = latest?.publicOrderEvents.map((event) => ({ ...event })) ?? [];
      this.log(`[session] resumed ${session.id} day=${session.lastDay}`);
    }
    this.initialized = true;
  }

  private async accept(incoming: GameSnapshot): Promise<void> {
    if (!this.activeSession) {
      await this.startSession({ ...incoming, publicOrderEvents: [] });
      return;
    }

    const previousDay = this.activeSession.lastDay;
    if (incoming.day < previousDay) {
      await this.finalizeCurrentDay();
      await this.endSession();
      await this.startSession({ ...incoming, publicOrderEvents: [] });
      return;
    }

    const observed: GameSnapshot = {
      ...incoming,
      publicOrderEvents: this.currentDaySnapshot
        ? observedPublicOrderEvents(this.currentDaySnapshot, incoming,
          !this.baselineAfterRestore && incoming.day <= previousDay + 1)
        : this.lastKnownPublicOrderEvents.map((event) => ({ ...event })),
    };
    if (incoming.day === previousDay) {
      this.currentDaySnapshot = observed;
      this.lastCapturedAt = incoming.capturedAt;
      this.currentDayDirty = true;
      this.baselineAfterRestore = false;
      this.lastKnownPublicOrderEvents = observed.publicOrderEvents.map((event) => ({ ...event }));
      return;
    }

    await this.finalizeCurrentDay();
    if (incoming.day > previousDay + 1) {
      this.log(`[history] gap session=${this.activeSession.id} ${previousDay} -> ${incoming.day}`);
    }
    const advanced = { ...this.activeSession, lastDay: incoming.day };
    await this.sessions.save(advanced);
    this.activeSession = advanced;
    this.currentDaySnapshot = observed;
    this.lastCapturedAt = incoming.capturedAt;
    this.currentDayDirty = true;
    this.baselineAfterRestore = false;
    this.lastKnownPublicOrderEvents = observed.publicOrderEvents.map((event) => ({ ...event }));
  }

  private async startSession(snapshot: GameSnapshot): Promise<void> {
    const session: GameSession = {
      id: this.createId(),
      startedAt: snapshot.capturedAt,
      endedAt: null,
      firstDay: snapshot.day,
      lastDay: snapshot.day,
    };
    await this.sessions.save(session);
    this.activeSession = session;
    this.currentDaySnapshot = snapshot;
    this.lastCapturedAt = snapshot.capturedAt;
    this.currentDayDirty = true;
    this.baselineAfterRestore = false;
    this.lastKnownPublicOrderEvents = snapshot.publicOrderEvents.map((event) => ({ ...event }));
    this.log(`[session] started ${session.id} day=${snapshot.day}`);
  }

  private async finalizeCurrentDay(): Promise<void> {
    if (!this.activeSession || !this.currentDaySnapshot || !this.currentDayDirty) return;
    const snapshot: HistoricalSnapshot = {
      ...copySnapshot(this.currentDaySnapshot),
      sessionId: this.activeSession.id,
    };
    await this.snapshots.save(snapshot);
    this.currentDayDirty = false;
    this.log(`[history] finalized session=${snapshot.sessionId} day=${snapshot.day}`);
  }

  private async endSession(): Promise<void> {
    if (!this.activeSession) return;
    const ended: GameSession = {
      ...this.activeSession,
      endedAt: this.lastCapturedAt,
    };
    await this.sessions.save(ended);
    this.log(`[session] ended ${ended.id} day=${ended.lastDay}`);
    this.activeSession = null;
    this.currentDaySnapshot = null;
    this.lastCapturedAt = null;
    this.currentDayDirty = false;
    this.baselineAfterRestore = false;
    this.lastKnownPublicOrderEvents = [];
  }
}
