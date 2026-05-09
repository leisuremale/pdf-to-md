// Conversion engines: pdf2md (text PDFs) and OCR (scanned PDFs via tesseract).
// Both return { markdown, inputSize }.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import pdf2md from '@opendocsg/pdf2md';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = resolve(__dirname, '..');

const OCR_MAX_BUFFER = 256 * 1024 * 1024; // 256 MB
const OCR_TIMEOUT_MS = 600_000;             // 10 min

export async function runPdf2md(pdfPath) {
  const pdfBuffer = readFileSync(pdfPath);
  const markdown = await pdf2md(pdfBuffer);
  return { markdown, inputSize: pdfBuffer.length };
}

export function resolvePython(configBin) {
  if (configBin) return configBin;
  if (process.env.PYTHON) return process.env.PYTHON;
  return process.platform === 'win32' ? 'python' : 'python3';
}

// Resolve cache directory: true → "<pdf>.ocr-cache" next to the PDF;
// string → use that path directly; false/undefined → no cache.
function resolveCacheDir(cache, pdfPath) {
  if (cache === false || cache == null) return null;
  if (typeof cache === 'string') return cache;
  return `${pdfPath}.ocr-cache`;
}

export function runOcr(pdfPath, { lang = 'chi_sim+eng', pythonBin, dpi, workers, cache } = {}) {
  const ocrScript = resolve(SCRIPTS_DIR, 'ocr.py');
  const bin = resolvePython(pythonBin);
  // Always pass positional args in order so optional later ones can be supplied.
  // ocr.py: <pdf> <lang> <dpi> <workers> <cacheDir>
  const args = [ocrScript, pdfPath, lang, String(dpi ?? 300), String(workers ?? 0)];
  const cacheDir = resolveCacheDir(cache, pdfPath);
  if (cacheDir) args.push(cacheDir);

  // shell:false + array args = no command injection from PDF path with quotes/backticks.
  // stderr inherited so OCR per-page progress lines surface live to the parent.
  const r = spawnSync(bin, args, {
    stdio: ['ignore', 'pipe', 'inherit'],
    timeout: OCR_TIMEOUT_MS,
    encoding: 'utf8',
    maxBuffer: OCR_MAX_BUFFER,
    shell: false,
  });

  if (r.error) {
    if (r.error.code === 'ENOENT') {
      throw new Error(`Python interpreter not found: ${bin}. Set config.pythonBin or PYTHON env var.`);
    }
    throw r.error;
  }
  if (r.status !== 0) {
    throw new Error(`OCR exited with status ${r.status}`);
  }

  const parsed = JSON.parse(r.stdout.trim());
  if (!parsed.ok) throw new Error(parsed.error || 'OCR failed');
  return { markdown: parsed.text, inputSize: readFileSync(pdfPath).length };
}
