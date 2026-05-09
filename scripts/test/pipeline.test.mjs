// CLI-level tests for pipeline.js. Doesn't run a real PDF — just exercises
// argv parsing, error paths, and config loading. Real conversions are covered
// by the lib unit tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINE = resolve(__dirname, '..', 'pipeline.js');

const run = (...argv) => spawnSync('node', [PIPELINE, ...argv], { encoding: 'utf8', shell: false });

test('CLI: empty inline JSON → "Missing required fields"', () => {
  const r = run('{}');
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.match(out.error, /Missing required fields/);
});

test('CLI: invalid JSON → invalid args error', () => {
  const r = run('not-json');
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.match(out.error, /Invalid CLI args/);
});

test('CLI: --config <file> reads config from file', () => {
  const path = join(tmpdir(), `pipeline-cfg-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify({ pdf: '/no.pdf', output: '/no.md' }), 'utf8');
  try {
    const r = run('--config', path);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    assert.doesNotMatch(out.error, /Invalid CLI args/);
    assert.doesNotMatch(out.error, /Missing required fields/);
  } finally {
    unlinkSync(path);
  }
});

test('CLI: --config=<file> equals form works', () => {
  const path = join(tmpdir(), `pipeline-cfg-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify({ pdf: '/no.pdf', output: '/no.md' }), 'utf8');
  try {
    const r = run(`--config=${path}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    assert.doesNotMatch(out.error, /Invalid CLI args/);
  } finally {
    unlinkSync(path);
  }
});

test('CLI: --config without path → error', () => {
  const r = run('--config');
  const out = JSON.parse(r.stdout);
  assert.match(out.error, /--config requires a file path/);
});

test('CLI: unknown flag rejected', () => {
  const r = run('--bogus');
  const out = JSON.parse(r.stdout);
  assert.match(out.error, /Unknown flag/);
});

test('CLI: --quiet does not break parse', () => {
  const r = run('--quiet', '{}');
  const out = JSON.parse(r.stdout);
  assert.match(out.error, /Missing required fields/);
});

test('CLI: --dry-run does not break parse', () => {
  const r = run('--dry-run', '{}');
  const out = JSON.parse(r.stdout);
  assert.match(out.error, /Missing required fields/);
});

test('CLI: missing config file → JSON error', () => {
  const r = run('--config', '/nonexistent.json');
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
});
