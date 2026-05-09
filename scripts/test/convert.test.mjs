import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolvePython, runPdf2md, runOcr } from '../lib/convert.js';

test('resolvePython: explicit override wins', () => {
  assert.equal(resolvePython('/custom/python'), '/custom/python');
});

test('resolvePython: env.PYTHON used when no override', () => {
  const orig = process.env.PYTHON;
  process.env.PYTHON = '/opt/homebrew/bin/python3';
  try {
    assert.equal(resolvePython(), '/opt/homebrew/bin/python3');
  } finally {
    if (orig === undefined) delete process.env.PYTHON;
    else process.env.PYTHON = orig;
  }
});

test('resolvePython: platform default when no override or env', () => {
  const orig = process.env.PYTHON;
  delete process.env.PYTHON;
  try {
    const expected = process.platform === 'win32' ? 'python' : 'python3';
    assert.equal(resolvePython(), expected);
  } finally {
    if (orig !== undefined) process.env.PYTHON = orig;
  }
});

test('runPdf2md and runOcr are exported as functions', () => {
  assert.equal(typeof runPdf2md, 'function');
  assert.equal(typeof runOcr,    'function');
});