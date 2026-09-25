import type { LiveEventSource, LiveSnapshotEvent, LiveStatusEvent } from './TrackedCollector.js';

export const SSE_HEARTBEAT_MS = 15_000;

export interface SseSink {
  write(chunk: string): boolean;
  end(): void;
  on(event: 'drain' | 'close', listener: () => void): unknown;
  off(event: 'drain' | 'close', listener: () => void): unknown;
  readonly writableEnded?: boolean;
  readonly destroyed?: boolean;
}

export class SseConnection {
  private readonly unsubscribeSnapshot: () => void;
  private readonly unsubscribeStatus: () => void;
  private readonly heartbeatTimer: ReturnType<typeof setInterval>;
  private pendingSnapshot: LiveSnapshotEvent | null = null;
  private pendingStatus: LiveStatusEvent | null = null;
  private initialSent = false;
  private blocked = false;
  private closed = false;
  private readonly handleDrain = () => {
    this.blocked = false;
    this.flushPending();
  };
  private readonly handleClose = () => { this.close(); };

  constructor(
    private readonly sink: SseSink,
    source: LiveEventSource,
    private readonly nextId: () => number,
    private readonly onClosed: () => void = () => {},
    heartbeatMilliseconds = SSE_HEARTBEAT_MS,
  ) {
    sink.on('drain', this.handleDrain);
    sink.on('close', this.handleClose);
    this.unsubscribeSnapshot = source.onLiveSnapshot((event) => {
      if (this.closed) return;
      // One slot only: a slow client needs the newest live state, not a queue.
      this.pendingSnapshot = event;
      this.flushPending();
    });
    this.unsubscribeStatus = source.onStatus((event) => {
      if (this.closed) return;
      if (!event.running) this.pendingSnapshot = null;
      this.pendingStatus = event;
      this.flushPending();
    });
    this.heartbeatTimer = setInterval(() => {
      if (!this.closed && this.initialSent && !this.blocked) {
        this.write(': heartbeat\n\n');
      }
    }, heartbeatMilliseconds);
    this.heartbeatTimer.unref?.();
  }

  sendInitialState(state: unknown): void {
    if (this.closed || this.initialSent) return;
    this.initialSent = true;
    this.writeEvent('state', state);
    this.flushPending();
  }

  getPendingCount(): number {
    return Number(this.pendingStatus !== null) + Number(this.pendingSnapshot !== null);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribeSnapshot();
    this.unsubscribeStatus();
    clearInterval(this.heartbeatTimer);
    this.sink.off('drain', this.handleDrain);
    this.sink.off('close', this.handleClose);
    this.pendingStatus = null;
    this.pendingSnapshot = null;
    if (!this.sink.writableEnded && !this.sink.destroyed) this.sink.end();
    this.onClosed();
  }

  private flushPending(): void {
    if (this.closed || !this.initialSent || this.blocked) return;
    if (this.pendingStatus) {
      const event = this.pendingStatus;
      this.pendingStatus = null;
      this.writeEvent('status', event);
    }
    if (this.pendingSnapshot && !this.blocked) {
      const event = this.pendingSnapshot;
      this.pendingSnapshot = null;
      this.writeEvent('snapshot', event);
    }
  }

  private writeEvent(name: string, data: unknown): void {
    this.write(`id: ${this.nextId()}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  private write(chunk: string): void {
    if (this.closed) return;
    try {
      if (!this.sink.write(chunk)) this.blocked = true;
    } catch {
      this.close();
    }
  }
}
