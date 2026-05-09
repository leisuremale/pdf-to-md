import { test } from 'node:test';
import assert from 'node:assert/strict';

import { joinParagraphs } from '../lib/join.js';

test('joinParagraphs zh: broken sentence rejoined at sentence-end', () => {
  const input = '我们对自己的身份认同。\n我们最热衷的事\n物。';
  const r = joinParagraphs(input, 'zh');
  // After join: "我们对自己的身份认同。" and "我们最热衷的事物。"
  assert.ok(r.content.includes('我们对自己的身份认同。'));
  assert.ok(r.content.includes('我们最热衷的事物。'), '"事/物" rejoined');
});

test('joinParagraphs zh: heading stands alone', () => {
  const input = '前一段。\n## 标题\n后一段。';
  const r = joinParagraphs(input, 'zh');
  const lines = r.content.split('\n\n');
  assert.ok(lines.includes('## 标题'));
});

test('joinParagraphs zh: standalone HTML comment stays alone', () => {
  const input = '前一段。\n<!-- p:2 -->\n后一段。';
  const r = joinParagraphs(input, 'zh');
  const lines = r.content.split('\n\n');
  assert.ok(lines.includes('<!-- p:2 -->'));
  assert.ok(lines.includes('前一段。'));
  assert.ok(lines.includes('后一段。'));
});

test('joinParagraphs zh: PAGE_BREAK comment stays alone (legacy keep mode)', () => {
  const input = '段一。\n<!-- PAGE_BREAK -->\n段二。';
  const r = joinParagraphs(input, 'zh');
  assert.ok(r.content.includes('<!-- PAGE_BREAK -->'));
});

test('joinParagraphs en: uses Latin sentence-end', () => {
  const input = 'This is a sentence.\nA new one starts here\nand continues.';
  const r = joinParagraphs(input, 'en');
  assert.ok(r.content.includes('This is a sentence.'));
  // "starts here" + "and continues." should join (no sentence-end on first line)
  assert.ok(r.content.includes('A new one starts hereand continues.'));
});

test('joinParagraphs: blank lines stripped before join', () => {
  const input = '段一。\n\n\n段二。';
  const r = joinParagraphs(input, 'zh');
  // Each ends with 。 → both standalone paragraphs
  const paragraphs = r.content.split('\n\n');
  assert.equal(paragraphs.length, 2);
});

test('joinParagraphs: returns linesJoined count', () => {
  const r = joinParagraphs('a\nb\nc。', 'zh');
  // 2 broken lines (a, b) joined into "abc。"
  assert.ok(r.joinedCount >= 2);
});
