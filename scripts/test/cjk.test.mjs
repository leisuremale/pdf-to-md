import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectLang, removeCJKSpaces, fixMiddleDot } from '../lib/cjk.js';

test('detectLang: pure CJK → zh', () => {
  assert.equal(detectLang('我们对自己的身份认同'), 'zh');
});

test('detectLang: pure Latin → en', () => {
  assert.equal(detectLang('hello world from anywhere'), 'en');
});

test('detectLang: empty input → en (no CJK, total 0)', () => {
  assert.equal(detectLang(''), 'en');
});

test('detectLang: mixed below 30% CJK → en', () => {
  // 1 CJK char in a 20-char Latin string
  assert.equal(detectLang('hello world from 我'), 'en');
});

test('removeCJKSpaces: all spaces between CJK chars removed', () => {
  const r = removeCJKSpaces('我 们 对 自 己 的 身 份 认 同', 'zh');
  assert.equal(r.content, '我们对自己的身份认同');
  assert.equal(r.removed, 9);
});

test('removeCJKSpaces: preserves Chinese-English spacing', () => {
  const r = removeCJKSpaces('AI 技术 hello world 我 们', 'zh');
  assert.equal(r.content, 'AI 技术 hello world 我们');
});

test('removeCJKSpaces: en lang short-circuits', () => {
  const r = removeCJKSpaces('hello world', 'en');
  assert.equal(r.content, 'hello world');
  assert.equal(r.removed, 0);
});

test('removeCJKSpaces: multiple consecutive spaces', () => {
  const r = removeCJKSpaces('我   们    对', 'zh');
  assert.equal(r.content, '我们对');
});

test('fixMiddleDot: CJK?CJK → CJK·CJK', () => {
  const r = fixMiddleDot('苏?汤普金', 'zh');
  assert.equal(r.content, '苏·汤普金');
  assert.equal(r.fixedCount, 1);
});

test('fixMiddleDot: Latin?Latin (foreign name) → Latin·Latin', () => {
  const r = fixMiddleDot('Bach?Smith', 'zh');
  assert.equal(r.content, 'Bach·Smith');
});

test('fixMiddleDot: en lang short-circuits', () => {
  const r = fixMiddleDot('a?b', 'en');
  assert.equal(r.content, 'a?b');
  assert.equal(r.fixedCount, 0);
});

test('fixMiddleDot: multiple in one string', () => {
  const r = fixMiddleDot('苏?汤普金 与 约翰?史密斯', 'zh');
  assert.equal(r.fixedCount, 2);
  assert.ok(r.content.includes('苏·汤普金'));
  assert.ok(r.content.includes('约翰·史密斯'));
});