#!/usr/bin/env node
/**
 * PDF to Markdown converter using @opendocsg/pdf2md
 * Usage: node convert.js <pdf-path> [output-path]
 * Output: JSON { ok, markdown, stats, error }
 */

import { readFileSync, writeFileSync } from 'fs';
import pdf2md from '@opendocsg/pdf2md';

const args = process.argv.slice(2);
if (args.length < 1) {
  console.log(JSON.stringify({ ok: false, error: 'Usage: node convert.js <pdf-path> [output-path]' }));
  process.exit(1);
}

const pdfPath = args[0];
const outputPath = args[1] || null;

try {
  const pdfBuffer = readFileSync(pdfPath);
  const markdown = await pdf2md(pdfBuffer);

  const stats = {
    inputSize: pdfBuffer.length,
    outputLength: markdown.length,
    lineCount: markdown.split('\n').length,
  };

  if (outputPath) {
    writeFileSync(outputPath, markdown, 'utf8');
    console.log(JSON.stringify({ ok: true, stats, outputPath }));
  } else {
    console.log(JSON.stringify({ ok: true, stats }));
  }
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
}
