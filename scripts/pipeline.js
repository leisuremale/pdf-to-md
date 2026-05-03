#!/usr/bin/env node
/**
 * One-shot PDF-to-MD pipeline: convert + fix + remove page breaks.
 *
 * Usage:
 *   node pipeline.js '<json-config>'
 *
 * JSON config fields:
 *   pdf              (required)  Path to the PDF file
 *   output           (required)  Path for the output .md file
 *   fix              (optional)  Run fix-md after conversion?       default: true
 *   removePageBreaks (optional)  Remove <!-- PAGE_BREAK --> tags?   default: true
 *
 * Example:
 *   node pipeline.js '{"pdf":"/path/to/book.pdf","output":"/path/to/book.md"}'
 *
 * Output: always a single line of JSON to stdout.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Parse config ────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

let config;
try {
  config = JSON.parse(process.argv[2] || '{}');
} catch {
  console.log(JSON.stringify({ ok: false, error: 'Invalid JSON config. Usage: node pipeline.js \'{"pdf":"...","output":"..."}\'' }));
  process.exit(1);
}

const pdfPath  = config.pdf;
const outPath  = config.output;
const doFix    = config.fix !== false;            // default true
const rmBreaks = config.removePageBreaks !== false; // default true
const doJoin   = config.joinParagraphs !== false;   // default true

if (!pdfPath || !outPath) {
  console.log(JSON.stringify({ ok: false, error: 'Missing required fields: pdf, output' }));
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function loadModule(relativePath) {
  return import(resolve(__dirname, relativePath));
}

// Inline fix-md logic so we don't need to shell out
function makeSlug(text) {
  return text.toLowerCase().replace(/[^一-龥a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function fixMarkdown(content, removePageBreaks) {
  const lines = content.split('\n');
  const fixed = [];
  let fixedCount = 0;
  let pageBreaksRemoved = 0;

  for (const line of lines) {
    if (line.trim() === '<!-- PAGE_BREAK -->') {
      if (removePageBreaks) { pageBreaksRemoved++; continue; }
      fixed.push(line);
      continue;
    }

    const trimmed = line.trim();

    // TOC: ### heading with dots → linked heading
    if (/^#{1,3}\s+[^\n]+\.{5,}/.test(trimmed)) {
      const clean = trimmed.replace(/\*{2}/g, '');
      const m = clean.match(/^(#{1,3})\s+(.+?)\.{5,}\s*(\d+)\s*$/);
      if (m) {
        fixed.push(`${m[1]} [${m[2].trim()}](#${makeSlug(m[2].trim())})`);
        fixedCount++;
        continue;
      }
    }

    // TOC: plain chapter/section lines with dots
    const tocCandidate = trimmed.replace(/^目\s+录\s*/, '');
    if (/^(?:第[一二三四五六七八九十\d]+章|第[一二三四五六七八九十\d]+[节部篇卷])/.test(tocCandidate)) {
      const clean = trimmed.replace(/\*{2}/g, '');
      if (/\.{5,}\s*\d+\s*$/.test(clean)) {
        const m = clean.match(/^(.+?)\s+\.{5,}\s*(\d+)\s*$/);
        if (m) {
          let title = m[1].trim();
          title = title.replace(/^目\s+录\s*/, '');
          fixed.push(`- [${title}](#${makeSlug(title)})`);
          fixedCount++;
          continue;
        }
      }
    }

    // Fix paragraphs incorrectly marked as ## / ### / #### headings
    if (/^#{2,4}\s+[^\n]+$/.test(line) && !line.trim().endsWith('-->')) {
      const text = line.replace(/^#{2,4}\s+/, '');
      const t = text.trim();

      const endsWithPunctuation = /[。！？，；：、）\}\)」』》…—\-]$/.test(t);
      const containsClausePunct = /[，；：、]/.test(t);   // mid-sentence punct → body text
      const containsSentenceEnd = /[。！？]/.test(t);     // sentence end punct → body text
      const isLong = t.length > 35;
      const startsWithConjunction = /^(?:但是|然而|因此|所以|而且|不过|如果|因为|虽然|于是|接着|然后|另外|此外|当然|于是乎|事实上|基本上|换句话说|对我而言|对我来讲|就|便|却|才|又|也|还|更|只|很|非常|比较|尤其|相当|特别|无论|不论|不管|除非|只要|只有|或者|还是)/.test(t);
      const looksLikeBodyStart = /^[一-龥]{1,2}(?:是|在|有|会|能|可以|可能|必须|需要|应该|已经|曾经|一直|没有|不是|如同|像|就像|仿佛|似乎|的|对|和|与|或|而|但|来|被|把|将|从|到|向|跟|替|除了|有关|关于|至于|对于|随着|通过|经过|根据|按照|为了)/.test(t);
      const isFragment = /^(?:[一-龥]{1,3}|[一-龥a-zA-Z]{1,3})[。！？，；：、]/.test(t); // starts with 1-3 chars then punct → continuation

      const isRealHeading = (
        !isLong &&
        !endsWithPunctuation &&
        !containsClausePunct &&
        !containsSentenceEnd &&
        !startsWithConjunction &&
        !looksLikeBodyStart &&
        !isFragment &&
        /^[#一-龥a-zA-Z0-9\s\-–—""''·，。！？：；（）【】《》「」『』、·％＋－—…]+$/.test(t) &&
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

  return { content: fixed.join('\n'), fixedCount, pageBreaksRemoved };
}

/**
 * Join broken lines back into paragraphs.
 * PDF converters insert a blank line between every line, so we can't use
 * blank lines to detect paragraph boundaries. Instead we use content rules:
 * a line ending with CJK sentence-ending punctuation marks a paragraph end;
 * otherwise the next line is a continuation and should be joined.
 */
function joinParagraphs(content) {
  // Strip all blank lines first — they're artifacts from the PDF converter
  const rawLines = content.split('\n').filter(l => l.trim() !== '');
  const out = [];
  let buf = '';
  let joinedCount = 0;

  const isHeading = (line) => /^#{1,4}\s/.test(line.trim());
  const isSentenceEnd = (line) => /[。！？」』》\)]$/.test(line.trim());

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    // Headings always stand alone
    if (isHeading(line)) {
      if (buf) { out.push(buf.trimEnd()); buf = ''; joinedCount++; }
      out.push(line);
      continue;
    }

    // Accumulate body text
    if (buf) {
      buf += line;  // join without space (CJK text has no inter-word spaces)
    } else {
      buf = line;
    }

    // End of paragraph? (sentence-ending punctuation, or next line is a heading)
    const nextIsHeading = i + 1 < rawLines.length && isHeading(rawLines[i + 1]);
    if (isSentenceEnd(line) || nextIsHeading) {
      out.push(buf.trimEnd());
      buf = '';
      if (nextIsHeading && !isSentenceEnd(line)) joinedCount++;
    } else {
      joinedCount++;
    }
  }
  if (buf) { out.push(buf.trimEnd()); }

  return { content: out.join('\n\n'), joinedCount };
}

/**
 * Fix garbled middle-dot in foreign names.
 * PDF converters often render · (U+00B7) as ? between CJK characters.
 */
function fixMiddleDot(content) {
  let count = 0;
  const fixed = content.replace(/([一-龥A-Za-z])\?\s*([一-龥A-Za-z])/g, (_, a, b) => {
    count++;
    return a + '·' + b;
  });
  return { content: fixed, fixedCount: count };
}

/**
 * Promote planet-pair topic lines to #### headings.
 * e.g. "太阳─土星 自我否定。自律。..." → "#### 太阳─土星\n\n自我否定。自律。..."
 *      "水星─金星" → "#### 水星─金星"
 *      "月亮与四交点" → "#### 月亮与四交点"
 *
 * The pattern is: [PlanetA]─[PlanetB] [optional keyword traits]
 * The planet-pair part becomes a heading, the rest stays as body text.
 */
function promoteTopicHeadings(content) {
  const blocks = content.split('\n\n');
  let promoted = 0;

  const isHeading = (line) => /^#{1,4}\s/.test(line);

  // Planet-pair prefix: 太阳─土星, 水星──冥王星, 月亮-火星, 狮子——水瓶座
  const planetPairRE = /^([一-龥]{2,6}[─\-–—]{1,3}[一-龥]{2,8})(?:\s+(.+))?$/;

  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].split('\n');
    if (lines.length !== 1) continue;
    const line = lines[0].trim();
    if (isHeading(line)) continue;

    const m = line.match(planetPairRE);
    if (!m) continue;

    const heading = m[1];    // e.g. "太阳─土星"
    const body    = m[2];    // e.g. "自我否定。自律。自制。..." or undefined

    // Skip if the line looks like a regular sentence with just a dash
    // e.g. "月亮和银有关——包括色彩..." is body text, not a topic
    if (/^.{0,5}(?:有关|相关|代表|象征|意味|方面|包括|涉及|关于)/.test(body || '')) continue;
    // Skip if the heading part is too long (likely a sentence)
    if (heading.length > 20) continue;

    if (body) {
      blocks[i] = '#### ' + heading + '\n\n' + body;
    } else {
      blocks[i] = '#### ' + heading;
    }
    promoted++;
  }

  return { content: blocks.join('\n\n'), promoted };
}

// ── Main pipeline ───────────────────────────────────────────────────────────

try {
  const startedAt = Date.now();

  // Step 1: Convert PDF → Markdown
  const pdf2md = (await loadModule('./node_modules/@opendocsg/pdf2md/lib/pdf2md.js')).default;
  const pdfBuffer = readFileSync(pdfPath);
  let markdown = await pdf2md(pdfBuffer);

  const convertStats = {
    inputSize: pdfBuffer.length,
    outputLength: markdown.length,
    lineCount: markdown.split('\n').length,
  };

  // Step 2: Fix markdown (optional)
  let fixStats = null;
  if (doFix) {
    const result = fixMarkdown(markdown, rmBreaks);
    markdown = result.content;
    fixStats = {
      totalLines: convertStats.lineCount,
      fixedLines: result.fixedCount,
      pageBreaksRemoved: rmBreaks ? result.pageBreaksRemoved : 0,
    };
  }

  // Step 3: Join broken paragraphs (optional)
  let joinStats = null;
  if (doJoin) {
    const result = joinParagraphs(markdown);
    markdown = result.content;
    joinStats = { linesJoined: result.joinedCount };
  }

  // Step 4: Fix garbled middle-dot (? → · in foreign names)
  const dotResult = fixMiddleDot(markdown);
  markdown = dotResult.content;
  const dotStats = { middleDotsFixed: dotResult.fixedCount };

  // Step 5: Promote standalone topic lines to #### headings
  const topicResult = promoteTopicHeadings(markdown);
  markdown = topicResult.content;
  const topicStats = { topicsPromoted: topicResult.promoted };

  // Step 6: Write output
  writeFileSync(outPath, markdown, 'utf8');

  const ms = Date.now() - startedAt;
  console.log(JSON.stringify({
    ok: true,
    outputPath: outPath,
    convert: convertStats,
    fix: fixStats,
    join: joinStats,
    polish: { ...dotStats, ...topicStats },
    durationMs: ms,
  }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
}
