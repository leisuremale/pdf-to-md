// Markdown structural fixers: slug, page-break handling, heading heuristics,
// topic-line promotion, nested TOC. All pure functions.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CJK_IDEOGRAPHS } from './cjk.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Heuristics loading ─────────────────────────────────────────────────────
const DEFAULT_HEURISTICS_PATH = resolve(__dirname, 'heuristics.json');

export function loadHeuristics(overridePath) {
  const path = overridePath || DEFAULT_HEURISTICS_PATH;
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return {
    bodyConjunctions:  raw.bodyConjunctions  ?? [],
    bodyVerbSuffixes:  raw.bodyVerbSuffixes  ?? [],
    topicBodySkip:     raw.topicBodySkip     ?? [],
  };
}

// Compile regexes from the loaded word lists.
function compileHeuristics(h) {
  const conj = h.bodyConjunctions.join('|');
  const verb = h.bodyVerbSuffixes.join('|');
  const skip = h.topicBodySkip.join('|');
  return {
    BODY_CONJUNCTION_RE: new RegExp(`^(?:${conj})`),
    BODY_VERB_RE:        new RegExp(`^[${CJK_IDEOGRAPHS}]{1,2}(?:${verb})`),
    BODY_FRAGMENT_RE:    new RegExp(`^(?:[${CJK_IDEOGRAPHS}]{1,3}|[${CJK_IDEOGRAPHS}a-zA-Z]{1,3})[。！？，；：、]`),
    TOPIC_BODY_SKIP_RE:  new RegExp(`^.{0,5}(?:${skip})`),
  };
}

// ── Slug ───────────────────────────────────────────────────────────────────
const SLUG_CJK_LATIN_RE = new RegExp(`[^${CJK_IDEOGRAPHS}a-z0-9]+`, 'g');

export function makeSlug(text, lang) {
  const s = text.toLowerCase();
  if (lang === 'en') return s.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return s.replace(SLUG_CJK_LATIN_RE, '-').replace(/^-|-$/g, '');
}

// ── Page breaks ────────────────────────────────────────────────────────────
const PAGE_BREAK_LINE_RE = /^<!--\s*PAGE_BREAK\s*-->\s*$/;
const PAGE_BREAK_INLINE_RE = /<!--\s*PAGE_BREAK\s*-->/g;

export function stripPageBreaks(content) {
  let removed = 0;
  const out = content
    .split('\n')
    .filter(line => {
      if (PAGE_BREAK_LINE_RE.test(line.trim())) { removed++; return false; }
      return true;
    })
    .join('\n');
  return { content: out, removed };
}

// Rewrite each <!-- PAGE_BREAK --> to <!-- p:N --> where N is the page number
// AFTER the marker (i.e. each marker becomes the start-of-page marker for the
// next page). PDFs are concatenated as page1 + BREAK + page2 + BREAK + ...,
// so the K-th break begins page K+1.
export function numberPageBreaks(content) {
  let pageNum = 1; // page 1 is implicit at start; first break = start of page 2
  let count = 0;
  const out = content.replace(PAGE_BREAK_INLINE_RE, () => {
    pageNum++;
    count++;
    return `<!-- p:${pageNum} -->`;
  });
  return { content: out, count };
}

export function processPageBreaks(content, style) {
  switch (style) {
    case 'remove': {
      const r = stripPageBreaks(content);
      return { content: r.content, mode: 'remove', removed: r.removed, numbered: 0 };
    }
    case 'number': {
      const r = numberPageBreaks(content);
      return { content: r.content, mode: 'number', removed: 0, numbered: r.count };
    }
    case 'keep':
      return { content, mode: 'keep', removed: 0, numbered: 0 };
    default:
      throw new Error(`Unknown pageBreakStyle: ${style}`);
  }
}

// ── Fix engine ─────────────────────────────────────────────────────────────
const HEADING_CHARSET_RE = new RegExp(`^[#${CJK_IDEOGRAPHS}a-zA-Z0-9\\s\\-–—""''·，。！？：；（）【】《》「」『』、％＋－…]+$`);
const TOC_HEADING_DOTS_RE = /^#{1,3}\s+[^\n]+\.{5,}/;
const TOC_HEADING_FULL_RE = /^(#{1,3})\s+(.+?)\.{5,}\s*(\d+)\s*$/;
const TOC_CHAPTER_RE      = /^第[一二三四五六七八九十\d]+(?:章|节|部|篇|卷|条|项|款|目)/;
const TOC_DOTS_TAIL_RE    = /\.{5,}\s*\d+\s*$/;
const TOC_TITLE_PAGE_RE   = /^(.+?)\s+\.{5,}\s*(\d+)\s*$/;
const HEADING_LINE_RE     = /^#{2,4}\s+[^\n]+$/;

// Determine TOC indent depth: 第N章 = 0, 第N节/篇 = 1, 第N条/项 = 2.
const TOC_DEPTH_RE = [
  { depth: 0, re: /^第[一二三四五六七八九十\d]+章/ },
  { depth: 1, re: /^第[一二三四五六七八九十\d]+(?:节|篇|部|卷)/ },
  { depth: 2, re: /^第[一二三四五六七八九十\d]+(?:条|项|款|目)/ },
];

function tocDepth(title) {
  for (const { depth, re } of TOC_DEPTH_RE) if (re.test(title)) return depth;
  return 0;
}

const isHeadingMarker = line => /^#{1,4}\s/.test(line.trim());

export function fixMarkdown(content, lang, opts = {}) {
  const heuristics = opts.heuristics || compileHeuristics(loadHeuristics(opts.heuristicsPath));
  const { BODY_CONJUNCTION_RE, BODY_VERB_RE, BODY_FRAGMENT_RE } = heuristics;
  const nestedToc = opts.nestedToc === true;

  const lines = content.split('\n');
  const fixed = [];
  let fixedCount = 0;

  for (const line of lines) {
    // Page-break tags pass through unchanged; processPageBreaks handles them.
    if (PAGE_BREAK_LINE_RE.test(line.trim())) { fixed.push(line); continue; }

    const trimmed = line.trim();

    // TOC: "### Title ........... 42" → "### [Title](#title)"
    if (TOC_HEADING_DOTS_RE.test(trimmed)) {
      const clean = trimmed.replace(/\*{2}/g, '');
      const m = clean.match(TOC_HEADING_FULL_RE);
      if (m) {
        const title = m[2].trim();
        fixed.push(`${m[1]} [${title}](#${makeSlug(title, lang)})`);
        fixedCount++;
        continue;
      }
    }

    // TOC: plain "第三章 标题 ........... 42" → "- [Title](#title)" (or nested)
    const tocCandidate = trimmed.replace(/^目\s+录\s*/, '');
    if (TOC_CHAPTER_RE.test(tocCandidate)) {
      const clean = trimmed.replace(/\*{2}/g, '');
      if (TOC_DOTS_TAIL_RE.test(clean)) {
        const m = clean.match(TOC_TITLE_PAGE_RE);
        if (m) {
          const title = m[1].trim().replace(/^目\s+录\s*/, '');
          const indent = nestedToc ? '  '.repeat(tocDepth(title)) : '';
          fixed.push(`${indent}- [${title}](#${makeSlug(title, lang)})`);
          fixedCount++;
          continue;
        }
      }
    }

    // Demote ## / ### / #### headings that look like body-text fragments
    if (HEADING_LINE_RE.test(line) && !line.trim().endsWith('-->')) {
      const text = line.replace(/^#{2,4}\s+/, '');
      const t = text.trim();

      const endsWithPunctuation   = /[。！？，；：、）\}\)」』》…—\-]$/.test(t);
      const containsClausePunct   = /[，；：、]/.test(t);
      const containsSentenceEnd   = /[。！？]/.test(t);
      const isLong                = t.length > 35;
      const startsWithConjunction = BODY_CONJUNCTION_RE.test(t);
      const looksLikeBodyStart    = BODY_VERB_RE.test(t);
      const isFragment            = BODY_FRAGMENT_RE.test(t);

      const isRealHeading = (
        !isLong &&
        !endsWithPunctuation &&
        !containsClausePunct &&
        !containsSentenceEnd &&
        !startsWithConjunction &&
        !looksLikeBodyStart &&
        !isFragment &&
        HEADING_CHARSET_RE.test(t) &&
        !/\.{3,}/.test(t) &&
        !/\d+\s*$/.test(t)
      );

      if (!isRealHeading) {
        fixed.push(text);
        fixedCount++;
        continue;
      }
    }

    fixed.push(line);
  }

  return { content: fixed.join('\n'), fixedCount };
}

// ── Topic promotion ────────────────────────────────────────────────────────
const PLANET_PAIR_RE = new RegExp(`^([${CJK_IDEOGRAPHS}]{2,6}[─\\-–—]{1,3}[${CJK_IDEOGRAPHS}]{2,8})(?:\\s+(.+))?$`);

export function promoteTopicHeadings(content, lang, opts = {}) {
  if (lang === 'en') return { content, promoted: 0 };
  const heuristics = opts.heuristics || compileHeuristics(loadHeuristics(opts.heuristicsPath));
  const { TOPIC_BODY_SKIP_RE } = heuristics;

  const blocks = content.split('\n\n');
  let promoted = 0;

  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].split('\n');
    if (lines.length !== 1) continue;
    const line = lines[0].trim();
    if (isHeadingMarker(line)) continue;

    const m = line.match(PLANET_PAIR_RE);
    if (!m) continue;

    const heading = m[1];
    const body    = m[2];

    if (TOPIC_BODY_SKIP_RE.test(body || '')) continue;
    if (heading.length > 20) continue;

    blocks[i] = body ? `#### ${heading}\n\n${body}` : `#### ${heading}`;
    promoted++;
  }

  return { content: blocks.join('\n\n'), promoted };
}
