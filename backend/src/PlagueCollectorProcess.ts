import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import path from 'node:path';
import { LineBuffer } from './lineBuffer.js';
import { validateSnapshot } from './validateSnapshot.js';
import type { CollectorConfig } from './config.js';
import type { CollectorExit, CollectorStatus, GameSnapshot } from './types.js';

export type SpawnCollector = (file: string, args: string[], options: SpawnOptions) => ChildProcess;
export type CollectorLogger = (message: string) => void;

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export class PlagueCollectorProcess {
  private child: ChildProcess | null = null;
  private latestSnapshot: GameSnapshot | null = null;
  private status: CollectorStatus = {
    state: 'stopped',
    pid: null,
    startedAt: null,
    lastSnapshotAt: null,
    lastDiseaseTurn: null,
    lastError: null,
    exit: null,
  };
  private readonly snapshotListeners = new Set<(snapshot: GameSnapshot) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly diagnosticListeners = new Set<(line: string) => void>();
  private readonly exitListeners = new Set<(exit: CollectorExit) => void>();
  private stopPromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private resolveClose: (() => void) | null = null;
  private stopRequested = false;

  constructor(
    private readonly config: CollectorConfig,
    private readonly spawnCollector: SpawnCollector = spawn,
    private readonly log: CollectorLogger = (message) => console.error(message),
  ) {}

  getLatestSnapshot(): GameSnapshot | null {
    return this.latestSnapshot;
  }

  getStatus(): CollectorStatus {
    return { ...this.status, exit: this.status.exit ? { ...this.status.exit } : null };
  }

  onSnapshot(listener: (snapshot: GameSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onDiagnostic(listener: (line: string) => void): () => void {
    this.diagnosticListeners.add(listener);
    return () => this.diagnosticListeners.delete(listener);
  }

  onExit(listener: (exit: CollectorExit) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.child !== null || this.status.state === 'starting' || this.status.state === 'running') {
      throw new Error('collector is already starting or running');
    }

    this.stopRequested = false;
    this.latestSnapshot = null;
    this.status = {
      ...this.status,
      state: 'starting',
      pid: null,
      startedAt: new Date().toISOString(),
      lastSnapshotAt: null,
      lastDiseaseTurn: null,
      lastError: null,
      exit: null,
    };

    const args = ['--watch', '--interval', String(this.config.intervalMilliseconds)];
    if (this.config.debug) args.push('--debug');

    let child: ChildProcess;
    try {
      child = this.spawnCollector(this.config.executablePath, args, {
        cwd: path.dirname(this.config.executablePath),
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (cause) {
      const error = new Error(`failed to spawn collector: ${errorMessage(cause)}`);
      this.status.state = 'failed';
      this.reportError(error);
      throw error;
    }

    this.child = child;
    this.closePromise = new Promise<void>((resolve) => { this.resolveClose = resolve; });

    const stdout = new LineBuffer(
      (line) => this.handleStdoutLine(line),
      (message) => this.reportError(new Error(`collector stdout: ${message}`)),
    );
    const stderr = new LineBuffer(
      (line) => this.handleStderrLine(line),
      (message) => this.reportError(new Error(`collector stderr: ${message}`)),
    );

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));

    let spawned = false;
    let startSettled = false;
    let resolveStart: () => void = () => {};
    let rejectStart: (error: Error) => void = () => {};
    const started = new Promise<void>((resolve, reject) => {
      resolveStart = resolve;
      rejectStart = reject;
    });

    child.on('spawn', () => {
      spawned = true;
      this.status.state = 'running';
      this.status.pid = child.pid ?? null;
      this.log(`[collector] started pid=${child.pid ?? 'unknown'}`);
      if (!startSettled) {
        startSettled = true;
        resolveStart();
      }
    });

    child.on('error', (cause: Error) => {
      const error = new Error(`${spawned ? 'collector process error' : 'failed to spawn collector'}: ${cause.message}`);
      this.status.state = 'failed';
      this.reportError(error);
      if (!startSettled) {
        startSettled = true;
        rejectStart(error);
      }
    });

    let observedExit: CollectorExit | null = null;
    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      observedExit = { code, signal, requested: this.stopRequested };
      this.status.exit = observedExit;
    });

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      stdout.finish();
      stderr.finish();
      const exit = observedExit ?? { code, signal, requested: this.stopRequested };
      this.status.exit = exit;
      this.status.pid = null;
      if (this.status.state !== 'failed') {
        this.status.state = exit.requested || exit.code === 0 ? 'stopped' : 'failed';
      }
      if (!exit.requested && exit.code !== 0 && this.status.lastError === null) {
        this.reportError(new Error(`collector exited unexpectedly (code=${exit.code}, signal=${exit.signal ?? 'none'})`));
      }
      this.log(`[collector] exited code=${exit.code ?? 'null'} signal=${exit.signal ?? 'none'}`);
      for (const listener of this.exitListeners) {
        try { listener(exit); } catch (cause) { this.log(`[collector:error] exit listener failed: ${errorMessage(cause)}`); }
      }
      if (!startSettled) {
        startSettled = true;
        rejectStart(new Error('collector closed before it started'));
      }
      if (this.child === child) this.child = null;
      this.resolveClose?.();
      this.resolveClose = null;
      this.closePromise = null;
    });

    return started;
  }

  async stop(): Promise<void> {
    if (this.stopPromise !== null) return this.stopPromise;
    const child = this.child;
    const closed = this.closePromise;
    if (child === null || closed === null) return;

    this.stopRequested = true;
    this.stopPromise = (async () => {
      if (child.exitCode === null && !child.killed) {
        try {
          child.kill('SIGTERM');
        } catch (cause) {
          this.reportError(new Error(`could not stop collector: ${errorMessage(cause)}`));
        }
      }

      if (!await this.waitForClose(closed, 5_000)) {
        this.log('[collector:error] collector did not stop within 5 seconds; forcing termination');
        child.kill('SIGKILL');
        if (!await this.waitForClose(closed, 2_000)) {
          throw new Error('collector did not exit after forced termination');
        }
      }
    })();

    try {
      await this.stopPromise;
    } finally {
      this.stopPromise = null;
    }
  }

  private waitForClose(closed: Promise<void>, timeoutMilliseconds: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMilliseconds);
      void closed.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  private handleStdoutLine(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (cause) {
      this.reportError(new Error(`malformed collector JSON skipped: ${errorMessage(cause)}`));
      return;
    }

    let snapshot: GameSnapshot;
    try {
      snapshot = validateSnapshot(value);
    } catch (cause) {
      this.reportError(new Error(`invalid collector snapshot skipped: ${errorMessage(cause)}`));
      return;
    }

    this.latestSnapshot = snapshot;
    this.status.lastSnapshotAt = snapshot.capturedAt;
    this.status.lastDiseaseTurn = snapshot.diseaseTurn;
    for (const listener of this.snapshotListeners) {
      try { listener(snapshot); } catch (cause) { this.reportError(new Error(`snapshot listener failed: ${errorMessage(cause)}`)); }
    }
  }

  private handleStderrLine(line: string): void {
    if (/^error:\s*/i.test(line)) {
      this.reportError(new Error(line.replace(/^error:\s*/i, '')));
    } else {
      this.log(`[collector] ${line}`);
    }
    for (const listener of this.diagnosticListeners) {
      try { listener(line); } catch (cause) { this.log(`[collector:error] diagnostic listener failed: ${errorMessage(cause)}`); }
    }
  }

  private reportError(error: Error): void {
    this.status.lastError = error.message;
    this.log(`[collector:error] ${error.message}`);
    for (const listener of this.errorListeners) {
      try { listener(error); } catch (cause) { this.log(`[collector:error] error listener failed: ${errorMessage(cause)}`); }
    }
  }
}
