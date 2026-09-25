import type { CollectorStatus, GameSnapshot } from './types.js';
import type { SnapshotCollector, LiveEventSource, LiveSnapshotEvent, LiveStatusEvent } from './TrackedCollector.js';
import { TrackedCollector } from './TrackedCollector.js';

export interface SupervisedCollector extends SnapshotCollector {
  getStatus(): CollectorStatus;
  getLatestSnapshot(): GameSnapshot | null;
}

export interface CollectorSupervisorOptions {
  retryDelaysMs?: readonly number[];
  log?: (message: string) => void;
}

const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000, 3_000, 5_000] as const;

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

// These are ordinary game lifecycle states, not faults to present as lastError.
function isGameUnavailable(message: string): boolean {
  return /process .* was not found|no valid .*process|World\.instance|World\.diseases|game process exited|Mono runtime was not found|more than one .*process|unreadable for 10 consecutive cycles|ReadProcessMemory failed|snapshot read failed/i.test(message);
}

export class CollectorSupervisor implements LiveEventSource {
  private readonly retryDelaysMs: readonly number[];
  private readonly log: (message: string) => void;
  private readonly snapshotListeners = new Set<(event: LiveSnapshotEvent) => void>();
  private readonly statusListeners = new Set<(event: LiveStatusEvent) => void>();
  private readonly unsubscribers: Array<() => void>;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attemptPromise: Promise<void> | null = null;
  private retryIndex = 0;
  private active = false;
  private stopping = false;
  private running = false;
  private lastError: string | null = null;

  constructor(
    private readonly collector: SupervisedCollector,
    private readonly tracked: TrackedCollector,
    options: CollectorSupervisorOptions = {},
  ) {
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    if (this.retryDelaysMs.length === 0 || this.retryDelaysMs.some((delay) => !Number.isSafeInteger(delay) || delay < 1)) {
      throw new Error('retryDelaysMs must contain positive integer delays');
    }
    this.log = options.log ?? ((message) => console.error(message));
    this.unsubscribers = [
      tracked.onLiveSnapshot((event) => {
        if (!this.active || this.stopping) return;
        this.retryIndex = 0;
        if (this.collector.getStatus().state === 'running') {
          if (!this.running) this.log(`[collector] attached pid=${this.collector.getStatus().pid ?? 'unknown'}`);
          this.setStatus(true, null);
        }
        for (const listener of this.snapshotListeners) listener(event);
      }),
      collector.onExit(() => {
        if (!this.active || this.stopping) return;
        // TrackedCollector registered its exit listener first and queued the
        // final flush. Deliver any queued live snapshot before status=false.
        void this.tracked.tracker.waitForIdle().then(() => {
          if (!this.active || this.stopping) return;
          this.setStatus(false, this.errorForPublicStatus(this.collector.getStatus().lastError));
          this.scheduleRetry();
        });
      }),
      collector.onError?.((error) => {
        if (!this.active || this.stopping) return;
        const publicError = this.errorForPublicStatus(error.message);
        if (publicError) this.setStatus(this.running, publicError);
      }) ?? (() => {}),
    ];
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.stopping = false;
    this.log('[collector] waiting for game');
    this.launchAttempt();
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.active = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    await this.attemptPromise;
    try {
      await this.tracked.stop();
    } finally {
      this.setStatus(false, null);
    }
  }

  dispose(): void {
    if (this.active || this.retryTimer || this.attemptPromise) {
      throw new Error('Stop the collector supervisor before disposing it');
    }
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.snapshotListeners.clear();
    this.statusListeners.clear();
  }

  getStatus(): CollectorStatus {
    const status = this.collector.getStatus();
    return { ...status, state: this.running ? 'running' : 'stopped', lastError: this.lastError };
  }

  getLatestSnapshot(): GameSnapshot | null {
    return this.running ? this.collector.getLatestSnapshot() : null;
  }

  onLiveSnapshot(listener: (event: LiveSnapshotEvent) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => { this.snapshotListeners.delete(listener); };
  }

  onStatus(listener: (event: LiveStatusEvent) => void): () => void {
    this.statusListeners.add(listener);
    return () => { this.statusListeners.delete(listener); };
  }

  getLiveListenerCounts(): { snapshot: number; status: number } {
    return { snapshot: this.snapshotListeners.size, status: this.statusListeners.size };
  }

  private launchAttempt(): void {
    if (!this.active || this.stopping || this.attemptPromise) return;
    this.attemptPromise = (async () => {
      try {
        await this.tracked.start();
        // start() resolves at child spawn, not at a valid game snapshot.
        // A child that has already exited will be retried by onExit.
        if (this.collector.getStatus().state !== 'running') this.scheduleRetry();
      } catch (cause) {
        const message = describe(cause);
        const publicError = this.errorForPublicStatus(message);
        this.setStatus(false, publicError);
        if (publicError) this.log(`[collector:error] ${message}`);
        this.scheduleRetry();
      }
    })().finally(() => { this.attemptPromise = null; });
  }

  private scheduleRetry(): void {
    if (!this.active || this.stopping || this.retryTimer) return;
    const delay = this.retryDelaysMs[Math.min(this.retryIndex, this.retryDelaysMs.length - 1)]!;
    this.retryIndex++;
    this.log(`[collector] retry in ${delay / 1_000}s`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.launchAttempt();
    }, delay);
  }

  private errorForPublicStatus(message: string | null): string | null {
    return message && !isGameUnavailable(message) ? message : null;
  }

  private setStatus(running: boolean, lastError: string | null): void {
    if (this.running === running && this.lastError === lastError) return;
    this.running = running;
    this.lastError = lastError;
    for (const listener of this.statusListeners) {
      try { listener({ running, lastError }); } catch (cause) {
        this.log(`[live:error] status listener failed: ${describe(cause)}`);
      }
    }
  }
}
