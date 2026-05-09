import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  makeSlug,
  stripPageBreaks,
  numberPageBreaks,
  processPageBreaks,
  fixMarkdown,
  promoteTopicHeadings,
  loadHeuristics,
} from '../lib/fix.js';

// ── makeSlug ───────────────────────────────────────────────────────────────
test('makeSlug: en lowercases and collapses non-alnum', () => {
  assert.equal(makeSlug('Hello World!', 'en'), 'hello-world');
});

test('makeSlug: zh keeps CJK characters', () => {
  assert.equal(makeSlug('第一章 引言', 'zh'), '第一章-引言');
});

test('makeSlug: trims leading/trailing dashes', () => {
  assert.equal(makeSlug('!!!hello!!!', 'en'), 'hello');
});

// ── Page breaks ────────────────────────────────────────────────────────────
test('stripPageBreaks: removes all PAGE_BREAK lines', () => {
  const r = stripPageBreaks('a\n<!-- PAGE_BREAK -->\nb\n<!-- PAGE_BREAK -->\nc');
  assert.equal(r.content, 'a\nb\nc');
  assert.equal(r.removed, 2);
});

test('numberPageBreaks: rewrites to <!-- p:N --> sequentially', () => {
  const r = numberPageBreaks('p1\n\n<!-- PAGE_BREAK -->\n\np2\n\n<!-- PAGE_BREAK -->\n\np3');
  assert.ok(r.content.includes('<!-- p:2 -->'));
  assert.ok(r.content.includes('<!-- p:3 -->'));
  assert.ok(!r.content.includes('PAGE_BREAK'));
  assert.equal(r.count, 2);
});

test('processPageBreaks: routes by mode', () => {
  const input = 'a\n<!-- PAGE_BREAK -->\nb';
  assert.equal(processPageBreaks(input, 'remove').mode, 'remove');
  assert.equal(processPageBreaks(input, 'number').mode, 'number');
  assert.equal(processPageBreaks(input, 'keep').content, input);
});

test('processPageBreaks: throws on unknown mode', () => {
  assert.throws(() => processPageBreaks('x', 'bogus'), /Unknown pageBreakStyle/);
});

// ── fixMarkdown ────────────────────────────────────────────────────────────
test('fixMarkdown: real heading passes through unchanged', () => {
  const r = fixMarkdown('## 第三章 引言', 'zh');
  assert.equal(r.content, '## 第三章 引言');
  assert.equal(r.fixedCount, 0);
});

test('fixMarkdown: body sentence mislabeled as heading is demoted', () => {
  const r = fixMarkdown('### 但是这就是问题，并且影响很大。', 'zh');
  assert.ok(!r.content.startsWith('#'), 'demoted to body');
  assert.equal(r.fixedCount, 1);
});

test('fixMarkdown: single-char "只" no longer false-positive', () => {
  const r = fixMarkdown('### 只为爱', 'zh');
  assert.equal(r.content, '### 只为爱');
});

test('fixMarkdown: single-char "更" no longer false-positive', () => {
  const r = fixMarkdown('### 更高的视角', 'zh');
  assert.equal(r.content, '### 更高的视角');
});

test('fixMarkdown: multi-char compound "只要" still demotes', () => {
  const r = fixMarkdown('### 只要还活着', 'zh');
  assert.ok(!r.content.startsWith('#'));
});

test('fixMarkdown: TOC with hash and dots becomes link', () => {
  const r = fixMarkdown('### 第一章 引言 ........... 42', 'zh');
  assert.match(r.content, /^### \[第一章 引言\]\(#/);
});

test('fixMarkdown: plain TOC line becomes flat list item', () => {
  const r = fixMarkdown('第三章 标题 ........... 100', 'zh');
  assert.match(r.content, /^- \[第三章 标题\]\(#/);
});

test('fixMarkdown: nested TOC indents by chapter/section/item', () => {
  const input = [
    '第一章 引言 ........................ 1',
    '第一节 背景 ........................ 3',
    '第一条 数据采集 ................... 12',
  ].join('\n');
  const r = fixMarkdown(input, 'zh', { nestedToc: true });
  const lines = r.content.split('\n');
  assert.match(lines[0], /^- /,     'depth 0');
  assert.match(lines[1], /^  - /,   'depth 1');
  assert.match(lines[2], /^    - /, 'depth 2');
});

test('fixMarkdown: flat TOC by default (no nestedToc)', () => {
  const input = '第一章 引言 ......... 1\n第一节 背景 ........ 3';
  const r = fixMarkdown(input, 'zh');
  const lines = r.content.split('\n');
  assert.match(lines[0], /^- \[/);
  assert.match(lines[1], /^- \[/);
  assert.ok(!lines[1].startsWith('  '));
});

test('fixMarkdown: page-break lines pass through', () => {
  const input = '## 标题\n<!-- PAGE_BREAK -->\n## 下一章';
  const r = fixMarkdown(input, 'zh');
  assert.ok(r.content.includes('<!-- PAGE_BREAK -->'));
});

// ── promoteTopicHeadings ───────────────────────────────────────────────────
test('promoteTopicHeadings: planet pair with body becomes heading + body', () => {
  const r = promoteTopicHeadings('太阳─土星 自我否定。自律。', 'zh');
  assert.equal(r.content, '#### 太阳─土星\n\n自我否定。自律。');
  assert.equal(r.promoted, 1);
});

test('promoteTopicHeadings: planet pair alone becomes heading', () => {
  const r = promoteTopicHeadings('水星─金星', 'zh');
  assert.equal(r.content, '#### 水星─金星');
});

test('promoteTopicHeadings: skips body containing "有关"', () => {
  const r = promoteTopicHeadings('月亮和银有关——色彩、味道。', 'zh');
  assert.equal(r.promoted, 0);
});

test('promoteTopicHeadings: en lang short-circuits', () => {
  const r = promoteTopicHeadings('Sun-Moon body text here.', 'en');
  assert.equal(r.promoted, 0);
});

// ── Heuristics loading ─────────────────────────────────────────────────────
test('loadHeuristics: default file has expected keys', () => {
  const h = loadHeuristics();
  assert.ok(Array.isArray(h.bodyConjunctions) && h.bodyConjunctions.length > 0);
  assert.ok(Array.isArray(h.bodyVerbSuffixes) && h.bodyVerbSuffixes.length > 0);
  assert.ok(Array.isArray(h.topicBodySkip)    && h.topicBodySkip.length > 0);
  assert.ok(h.bodyConjunctions.includes('但是'));
});

test('loadHeuristics: override path replaces defaults', () => {
  const path = join(tmpdir(), `heuristics-test-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify({
    bodyConjunctions: ['QQQ'],
    bodyVerbSuffixes: ['XX'],
    topicBodySkip:    ['YY'],
  }), 'utf8');
  try {
    const h = loadHeuristics(path);
    assert.deepEqual(h.bodyConjunctions, ['QQQ']);
    assert.deepEqual(h.bodyVerbSuffixes, ['XX']);
  } finally {
    unlinkSync(path);
  }
});