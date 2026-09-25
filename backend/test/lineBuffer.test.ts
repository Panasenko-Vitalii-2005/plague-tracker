import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LineBuffer } from '../src/lineBuffer.js';

function capture() {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, parser: new LineBuffer((line) => lines.push(line), (error) => errors.push(error)) };
}

test('one complete line is delivered', () => {
  const { parser, lines } = capture();
  parser.push('{"a":1}\n');
  assert.deepEqual(lines, ['{"a":1}']);
});

test('a line split across chunks is reassembled', () => {
  const { parser, lines } = capture();
  parser.push('{"capturedAt":"2026-');
  assert.equal(lines.length, 0);
  parser.push('09-22T19:00:00Z"}\n');
  assert.equal(lines.length, 1);
});

test('multiple lines in one chunk are delivered separately', () => {
  const { parser, lines } = capture();
  parser.push('first\nsecond\n');
  assert.deepEqual(lines, ['first', 'second']);
});

test('partial tail is retained for the next chunk', () => {
  const { parser, lines } = capture();
  parser.push('first\nsec');
  assert.deepEqual(lines, ['first']);
  parser.push('ond\n');
  assert.deepEqual(lines, ['first', 'second']);
});

test('CRLF and empty lines are handled', () => {
  const { parser, lines } = capture();
  parser.push('first\r\n\r\nsecond\n');
  assert.deepEqual(lines, ['first', 'second']);
});

test('split UTF-8 characters are decoded without corruption', () => {
  const { parser, lines } = capture();
  const bytes = Buffer.from('перу\n', 'utf8');
  parser.push(bytes.subarray(0, 1));
  parser.push(bytes.subarray(1));
  assert.deepEqual(lines, ['перу']);
});

test('oversized line is discarded and parser recovers', () => {
  const lines: string[] = [];
  const errors: string[] = [];
  const parser = new LineBuffer((line) => lines.push(line), (error) => errors.push(error), 10);
  parser.push('this line is far too long');
  parser.push('\ngood\n');
  assert.deepEqual(lines, ['good']);
  assert.equal(errors.length, 1);
});
