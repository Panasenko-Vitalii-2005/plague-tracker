import { GameSessionTracker } from './GameSessionTracker.js';
import type { CollectorExit, GameSnapshot } from './types.js';
import { copySnapshot } from './repositories.js';

export interface LiveSnapshotEvent {
  sessionId: string;
  snapshot: GameSnapshot;
}

export interface LiveStatusEvent {
  running: boolean;
  lastError: string | null;
}

export interface LiveEventSource {
  onLiveSnapshot(listener: (event: LiveSnapshotEvent) => void): () => void;
  onStatus(listener: (event: LiveStatusEvent) => void): () => void;
}

export interface SnapshotCollector {
  start(): Promise<void>;
  stop(): Promise<void>;
  onSnapshot(listener: (snapshot: GameSnapshot) => void): () => void;
  onExit(listener: (exit: CollectorExit) => void): () => void;
  onError?(listener: (error: Error) => void): () => void;
}

export class TrackedCollector implements LiveEventSource {
  private trackingError: Error | null = null;
  private readonly unsubscribeSnapshot: () => void;
  private readonly unsubscribeExit: () => void;
  private readonly unsubscribeError: (() => void) | null;
  private readonly liveSnapshotListeners = new Set<(event: LiveSnapshotEvent) => void>();
  private readonly statusListeners = new Set<(event: LiveStatusEvent) => void>();
  private liveStatus: LiveStatusEvent = { running: false, lastError: null };

  constructor(
    private readonly collector: SnapshotCollector,
    readonly tracker: GameSessionTracker,
    private readonly log: (message: string) => void = (message) => console.error(message),
  ) {
    this.unsubscribeSnapshot = collector.onSnapshot((snapshot) => {
      this.observe(this.tracker.handleSnapshot(snapshot).then(() => {
        const sessionId = this.tracker.getActiveSession()?.id;
        if (sessionId) this.emitLiveSnapshot({ sessionId, snapshot: copySnapshot(snapshot) });
      }));
    });
    this.unsubscribeExit = collector.onExit(() => {
      this.observe(this.tracker.flush().finally(() => {
        this.setStatus({ ...this.liveStatus, running: false });
      }));
    });
    this.unsubscribeError = collector.onError?.((error) => {
      this.setStatus({ ...this.liveStatus, lastError: error.message });
    }) ?? null;
  }

  async start(): Promise<void> {
    this.trackingError = null;
    await this.tracker.initialize();
    try {
      await this.collector.start();
      this.setStatus({ running: true, lastError: null });
    } catch (cause) {
      this.setStatus({ running: false, lastError: cause instanceof Error ? cause.message : String(cause) });
      throw cause;
    }
  }

  async stop(): Promise<void> {
    try {
      try {
        await this.collector.stop();
      } finally {
        // Also covers an already-stopped child or a backend shutdown with no
        // close event. The tracker's flush is idempotent.
        await this.tracker.flush();
      }
    } finally {
      this.setStatus({ ...this.liveStatus, running: false });
    }
    if (this.trackingError) throw this.trackingError;
  }

  onLiveSnapshot(listener: (event: LiveSnapshotEvent) => void): () => void {
    this.liveSnapshotListeners.add(listener);
    return () => { this.liveSnapshotListeners.delete(listener); };
  }

  onStatus(listener: (event: LiveStatusEvent) => void): () => void {
    this.statusListeners.add(listener);
    return () => { this.statusListeners.delete(listener); };
  }

  getLiveListenerCounts(): { snapshot: number; status: number } {
    return { snapshot: this.liveSnapshotListeners.size, status: this.statusListeners.size };
  }

  async waitForIdle(): Promise<void> {
    await this.tracker.getHistory();
    if (this.trackingError) throw this.trackingError;
  }

  dispose(): void {
    this.unsubscribeSnapshot();
    this.unsubscribeExit();
    this.unsubscribeError?.();
    this.liveSnapshotListeners.clear();
    this.statusListeners.clear();
  }

  private setStatus(status: LiveStatusEvent): void {
    if (this.liveStatus.running === status.running && this.liveStatus.lastError === status.lastError) return;
    this.liveStatus = status;
    for (const listener of this.statusListeners) {
      try { listener({ ...status }); } catch (cause) {
        this.log(`[live:error] status listener failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
  }

  private emitLiveSnapshot(event: LiveSnapshotEvent): void {
    for (const listener of this.liveSnapshotListeners) {
      try { listener(event); } catch (cause) {
        this.log(`[live:error] snapshot listener failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
  }

  private observe(operation: Promise<void>): void {
    void operation.catch((cause: unknown) => {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.trackingError ??= error;
      this.log(`[history:error] ${error.message}`);
    });
  }
}
