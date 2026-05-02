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

    // Fix paragraphs incorrectly marked as ### headings
    if (/^###\s+[^\n]+$/.test(line) && !line.trim().endsWith('-->')) {
      const text = line.replace(/^###\s+/, '');
      const t = text.trim();

      const endsWithPunctuation = /[。！？，；：、）\}\)」』》…—\-]$/.test(t);
      const isLong = t.length > 35;
      const startsWithConjunction = /^(?:但是|然而|因此|所以|而且|不过|如果|因为|虽然|于是|接着|然后|另外|此外|当然|于是乎|事实上|基本上|换句话说)/.test(t);
      const looksLikeBodyStart = /^[一-龥]{1,2}(?:是|在|有|会|能|可以|可能|必须|需要|应该|已经|曾经|一直|没有|不是|如同|像|就像|仿佛|似乎)/.test(t);

      const isRealHeading = (
        !isLong &&
        !endsWithPunctuation &&
        !startsWithConjunction &&
        !looksLikeBodyStart &&
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

  // Step 3: Write output
  writeFileSync(outPath, markdown, 'utf8');

  const ms = Date.now() - startedAt;
  console.log(JSON.stringify({
    ok: true,
    outputPath: outPath,
    convert: convertStats,
    fix: fixStats,
    durationMs: ms,
  }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
}
