#!/usr/bin/env node
/**
 * One-shot PDF-to-MD pipeline: convert + fix + remove page breaks.
 *
 * Usage:
 *   node pipeline.js '<json-config>'
 *   node pipeline.js --config <file.json>
 *   node pipeline.js --config=<file.json>
 *   node pipeline.js [--dry-run] [--quiet] '<json>'   # CLI flags can come before/after config
 *
 * JSON config fields:
 *   pdf              (required)  Path to the PDF file
 *   output           (required)  Path for the output .md file
 *   converter        (optional)  "pdf2md" / "ocr" / "auto"           default: "auto"
 *   lang             (optional)  "zh" / "en" / "auto"                default: "auto"
 *   pythonBin        (optional)  Python interpreter path for OCR     default: platform-specific
 *   ocrDpi           (optional)  Render DPI for OCR (300 recommended for CJK)
 *   ocrWorkers       (optional)  Parallel OCR workers                default: cpu_count - 1
 *   ocrCache         (optional)  Per-page OCR cache: true/false/<dir> default: true
 *   fix              (optional)  Run heading/TOC fix engine?         default: true
 *   removePageBreaks (optional)  Remove <!-- PAGE_BREAK --> tags?    default: true (when pageBreakStyle="remove")
 *   pageBreakStyle   (optional)  "remove" / "number" / "keep"        default: "remove"
 *                                "number" rewrites markers to <!-- p:N --> for LLM citation
 *   nestedToc        (optional)  Emit nested chapter→section list    default: false
 *   heuristicsPath   (optional)  Override path to heuristics.json
 *   joinParagraphs   (optional)  Join broken lines into paragraphs?  default: true
 *   dryRun           (optional)  Preview only — don't write output   default: false
 *
 * Example:
 *   node pipeline.js '{"pdf":"/path/to/book.pdf","output":"/path/to/book.md"}'
 *   node pipeline.js --config job.json
 *   node pipeline.js --dry-run '{"pdf":"...","output":"..."}'
 *
 * Output: always a single line of JSON to stdout.
 */

import { writeFileSync, readFileSync } from 'fs';
import { runPdf2md, runOcr } from './lib/convert.js';
import { detectLang, removeCJKSpaces, fixMiddleDot } from './lib/cjk.js';
import { processPageBreaks, fixMarkdown, promoteTopicHeadings } from './lib/fix.js';
import { joinParagraphs } from './lib/join.js';

// ── Parse argv ──────────────────────────────────────────────────────────────
function parseArgv(argv) {
  const args = argv.slice(2);
  const flags = { dryRun: false, quiet: false };
  let configSource = null; // either { kind: 'inline', json: '...' } or { kind: 'file', path: '...' }

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') { flags.dryRun = true; continue; }
    if (a === '--quiet')   { flags.quiet = true;  continue; }
    if (a === '--config')  { configSource = { kind: 'file', path: args[++i] }; continue; }
    if (a.startsWith('--config=')) { configSource = { kind: 'file', path: a.slice('--config='.length) }; continue; }
    if (a.startsWith('--')) {
      throw new Error(`Unknown flag: ${a}`);
    }
    // First positional is inline JSON
    if (!configSource) configSource = { kind: 'inline', json: a };
  }

  let config = {};
  if (configSource?.kind === 'file') {
    if (!configSource.path) throw new Error('--config requires a file path');
    config = JSON.parse(readFileSync(configSource.path, 'utf8'));
  } else if (configSource?.kind === 'inline') {
    config = JSON.parse(configSource.json || '{}');
  }
  return { config, flags };
}

let config, flags;
try {
  ({ config, flags } = parseArgv(process.argv));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: `Invalid CLI args: ${e.message}` }));
  process.exit(1);
}

const log = flags.quiet ? () => {} : (msg) => console.error(`[pipeline] ${msg}`);

const pdfPath        = config.pdf;
const outPath        = config.output;
const converter      = config.converter || 'auto';
const langArg        = config.lang || 'auto';
const pythonBin      = config.pythonBin;
const ocrDpi         = config.ocrDpi;
const ocrWorkers     = config.ocrWorkers;
const ocrCache       = config.ocrCache !== false; // default true; can be path string
const doFix          = config.fix !== false;
const rmBreaks       = config.removePageBreaks !== false;
const pageBreakStyle = config.pageBreakStyle || (rmBreaks ? 'remove' : 'keep');
const nestedToc      = config.nestedToc === true;
const heuristicsPath = config.heuristicsPath;
const doJoin         = config.joinParagraphs !== false;
const dryRun         = flags.dryRun || config.dryRun === true;

const ocrOpts = { pythonBin, dpi: ocrDpi, workers: ocrWorkers, cache: ocrCache, pdfPath };

if (!pdfPath || !outPath) {
  console.log(JSON.stringify({ ok: false, error: 'Missing required fields: pdf, output' }));
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const statsFor = (markdown, inputSize) => ({
  inputSize,
  outputLength: markdown.length,
  lineCount: markdown.split('\n').length,
});

// Auto-fallback judge: empty alone isn't enough — scanned PDFs often yield
// a few hundred chars of page numbers / headers, so we threshold on density.
function looksScanned(markdown) {
  const trimmed = markdown.trim();
  if (!trimmed) return { scanned: true, wordChars: 0, pages: 0, perPage: 0 };
  const wordChars = (trimmed.match(/[一-鿿㐀-䶿A-Za-z0-9]/g) || []).length;
  const pageBreaks = (trimmed.match(/<!--\s*PAGE_BREAK\s*-->/g) || []).length;
  const pages = Math.max(1, pageBreaks + 1);
  const perPage = wordChars / pages;
  return { scanned: wordChars < 200 || perPage < 50, wordChars, pages, perPage };
}

// ── Main pipeline ───────────────────────────────────────────────────────────
try {
  const startedAt = Date.now();

  // Step 1: convert
  log(`step 1: convert (${converter})`);
  let markdown, converterUsed, convertStats;

  if (converter === 'ocr') {
    const r = runOcr(pdfPath, ocrOpts);
    markdown = r.markdown;
    converterUsed = 'ocr';
    convertStats = statsFor(markdown, r.inputSize);
  } else if (converter === 'pdf2md') {
    const r = await runPdf2md(pdfPath);
    markdown = r.markdown;
    converterUsed = 'pdf2md';
    convertStats = statsFor(markdown, r.inputSize);
  } else {
    const r = await runPdf2md(pdfPath);
    markdown = r.markdown;
    convertStats = statsFor(markdown, r.inputSize);
    const judge = looksScanned(markdown);
    if (judge.scanned) {
      log(`pdf2md output looks scanned (chars=${judge.wordChars}, pages~${judge.pages}, perPage~${Math.round(judge.perPage)}), falling back to OCR...`);
      const r2 = runOcr(pdfPath, ocrOpts);
      markdown = r2.markdown;
      converterUsed = 'ocr (fallback)';
      convertStats = statsFor(markdown, r2.inputSize);
    } else {
      converterUsed = 'pdf2md';
    }
  }

  const detectedLang = langArg === 'auto' ? detectLang(markdown) : langArg;
  log(`detected lang: ${detectedLang}`);

  // Step 2a: page breaks
  log(`step 2a: page breaks (${pageBreakStyle})`);
  const pb = processPageBreaks(markdown, pageBreakStyle);
  markdown = pb.content;
  const pageBreakStats = { mode: pb.mode, removed: pb.removed, numbered: pb.numbered };

  // Step 2b: heading / TOC fix
  let fixStats = null;
  if (doFix) {
    log(`step 2b: fix headings + TOC${nestedToc ? ' (nested)' : ''}`);
    const r = fixMarkdown(markdown, detectedLang, { heuristicsPath, nestedToc });
    markdown = r.content;
    fixStats = {
      totalLines: convertStats.lineCount,
      fixedLines: r.fixedCount,
    };
  }

  // Step 3: paragraph join
  let joinStats = null;
  if (doJoin) {
    log('step 3: join paragraphs');
    const r = joinParagraphs(markdown, detectedLang);
    markdown = r.content;
    joinStats = { linesJoined: r.joinedCount };
  }

  // Step 4: CJK polish (spaces → middle-dot → topic headings)
  log('step 4: CJK polish');
  const space = removeCJKSpaces(markdown, detectedLang); markdown = space.content;
  const dot   = fixMiddleDot(markdown, detectedLang);   markdown = dot.content;
  const topic = promoteTopicHeadings(markdown, detectedLang, { heuristicsPath }); markdown = topic.content;

  // Step 5: write (or preview, when dry-run)
  let writtenPath = outPath;
  let preview = null;
  if (dryRun) {
    log('step 5: dry-run — skipping write');
    writtenPath = null;
    preview = {
      head: markdown.slice(0, 500),
      tail: markdown.length > 1000 ? markdown.slice(-500) : '',
      length: markdown.length,
    };
  } else {
    log(`step 5: write → ${outPath}`);
    writeFileSync(outPath, markdown, 'utf8');
  }

  console.log(JSON.stringify({
    ok: true,
    lang: detectedLang,
    outputPath: writtenPath,
    dryRun,
    preview,
    converter: converterUsed,
    convert: convertStats,
    pageBreaks: pageBreakStats,
    fix: fixStats,
    join: joinStats,
    polish: {
      cjkSpacesRemoved: space.removed,
      middleDotsFixed: dot.fixedCount,
      topicsPromoted: topic.promoted,
    },
    durationMs: Date.now() - startedAt,
  }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
}
