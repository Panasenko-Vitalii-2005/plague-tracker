import { StringDecoder } from 'node:string_decoder';

export class LineBuffer {
  private readonly decoder = new StringDecoder('utf8');
  private tail = '';
  private discardingOversizedLine = false;

  constructor(
    private readonly onLine: (line: string) => void,
    private readonly onError: (message: string) => void,
    private readonly maxLineLength = 1_048_576,
  ) {}

  push(chunk: Buffer | string): void {
    this.consume(typeof chunk === 'string' ? chunk : this.decoder.write(chunk));
  }

  finish(): void {
    this.consume(this.decoder.end());
    if (this.tail.trim().length > 0) {
      this.onError('discarded incomplete line when stream closed');
    }
    this.tail = '';
    this.discardingOversizedLine = false;
  }

  private consume(text: string): void {
    let remaining = text;
    while (remaining.length > 0) {
      const newline = remaining.indexOf('\n');
      if (newline < 0) {
        if (!this.discardingOversizedLine) {
          this.tail += remaining;
          if (this.tail.length > this.maxLineLength) {
            this.tail = '';
            this.discardingOversizedLine = true;
            this.onError(`discarding line longer than ${this.maxLineLength} characters`);
          }
        }
        return;
      }

      const segment = remaining.slice(0, newline);
      remaining = remaining.slice(newline + 1);
      if (this.discardingOversizedLine) {
        this.discardingOversizedLine = false;
        continue;
      }

      const line = this.tail + segment;
      this.tail = '';
      if (line.length > this.maxLineLength) {
        this.onError(`discarding line longer than ${this.maxLineLength} characters`);
        continue;
      }

      const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
      if (normalized.trim().length > 0) {
        this.onLine(normalized);
      }
    }
  }
}
