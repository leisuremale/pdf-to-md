# pdf-to-md

> JSON-driven, one-shot PDF → clean Markdown. Dual-engine: text extraction + OCR. Built for LLM agents, works great for humans too.

## Why this exists

PDF-to-Markdown conversion looks like a solved problem. It's not.

- **Text PDFs**: converters spew broken headings, shattered paragraphs, and phantom CJK spaces. Every `###` is suspect. Every line is on its own island.
- **Scanned PDFs**: text converters return nothing. You need a completely different OCR stack with its own quirks — memory blowups, no caching, one bad page kills the job.
- **The result**: you spend more time fixing than converting. Then you repeat the same manual steps every time.

**pdf-to-md is different because it doesn't just extract text — it understands what it extracted and fixes it.** Heading mislabeled? Fixed. Paragraph in pieces? Joined. CJK spaces eating your document structure? Handled. Scanned PDF? Auto-detected and OCR'd in parallel with resumable caching.

```
Before:  choose tool → convert → inspect → fix headings → strip tags → join paragraphs → done
After:   pipeline.js '{"pdf":"...","output":"..."}' → done
```

## Dual-engine architecture

One pipeline, two engines. Auto-detection or manual override.

| Engine | Command | Best for | Speed | Output |
|--------|---------|----------|-------|--------|
| **pdf2md** | `converter: "pdf2md"` | Text-based PDFs | 1-2s | 347K chars, 13K lines |
| **OCR** | `converter: "ocr"` | Scanned/image PDFs | parallel, ~2 min/400pp on 8 cores | 324K chars, 7.5K lines |
| **Auto** | default | Universal | pdf2md first, low density → OCR | auto-fallback |

```bash
# Text PDF — instant
node pipeline.js '{"pdf":"book.pdf","output":"book.md"}'

# Scanned PDF — OCR mode
node pipeline.js '{"pdf":"scanned.pdf","output":"out.md","converter":"ocr"}'

# Config file (instead of inline JSON)
node pipeline.js --config job.json

# Preview without writing
node pipeline.js --dry-run '{"pdf":"book.pdf","output":"book.md"}'
```

## What makes it different

Most PDF→Markdown tools do one thing: extract text. They stop there. **pdf-to-md starts where they stop** — it's a full post-processing pipeline that cleans, structures, and polishes the output until it's actually readable.

|  | Typical PDF→MD tools | pdf-to-md |
|---|---|---|
| **Interface** | CLI args, positional params, shell scripting | One JSON string or `--config <file>`. Agent-native. |
| **Output** | Mixed stdout (logs + content), needs parsing | One line of structured JSON with per-step stats |
| **OCR** | ❌ Not supported | ✅ Auto-fallback: text extraction first, then parallel OCR |
| **OCR resumability** | N/A | Per-page cache survives interruption. Crash mid-book? Resume. |
| **Heading repair** | Body paragraphs mislabeled as `###` / `####` headings | 7-layer heuristic fix engine with externalized rule files |
| **Heading–body split** | ❌ Merged into giant `###` lines | ✅ Auto-detects concatenated heading+body and splits them |
| **Paragraph joining** | Every line is an island | Sentence-end punctuation as boundaries. 4-5K lines rejoined per book. |
| **CJK space handling** | Spaces between every Chinese character (`我 们 对 自 己`) | Removes inter-CJK spaces — **preserving paragraph boundaries** (uses horizontal whitespace only, never eats newlines) |
| **Foreign names** | `苏?汤普金` (garbled middle dot) | Auto-fix: `苏·汤普金` |
| **Page citation** | Page numbers stripped | Optional `<!-- p:N -->` markers for LLM citation |
| **Nested TOC** | Flat, unreadable | Auto-indents by depth: 章→节→条→项 |
| **LLM-friendly** | Multiple calls, fragile regex/grep parsing | One call. Always valid JSON. `dryRun` for preview. |

## Complete pipeline

```
convert → page breaks → fix headings → join paragraphs → remove CJK spaces → fix middle-dot → promote topics → write
```

One JSON in, full stats out:

```json
{
  "ok": true,
  "lang": "zh",
  "outputPath": "/path/to/book.md",
  "dryRun": false,
  "preview": null,
  "converter": "ocr (fallback)",
  "convert":    { "inputSize": 51657593, "outputLength": 323732, "lineCount": 14725 },
  "pageBreaks": { "mode": "remove", "removed": 252, "numbered": 0 },
  "fix":        { "totalLines": 14725, "fixedLines": 6225 },
  "join":       { "linesJoined": 5095 },
  "polish":     { "cjkSpacesRemoved": 36840, "middleDotsFixed": 132, "topicsPromoted": 43 },
  "durationMs": 1442
}
```

### Remove CJK spaces

PDF text extraction often inserts a space between every CJK character:

```
Before:  我 们 对 自 己 的 身 份 认 同
After:   我们对自己的身份认同
```

The regex uses **lookbehind/lookahead** (`(?<=cjk)[^\S\n]+(?=cjk)`) targeting **horizontal whitespace only** — spaces and tabs between CJK characters are removed, but **newlines are never consumed**. This is critical: `\s` would eat `\n\n` between a heading and the next paragraph, collapsing structural boundaries into one giant `###` line. On a 350-page book, this fix alone prevents **1,200+ paragraph boundary collapses**. Neighbors aren't consumed during global replace, so consecutive spaces are all removed (not just every other one).

## CLI

```
node pipeline.js [flags] '<json>'
node pipeline.js [flags] --config <file>
node pipeline.js [flags] --config=<file>
```

Flags:

| Flag | Effect |
|------|--------|
| `--config <file>` | Load JSON config from a file |
| `--dry-run` | Run the full pipeline but skip writing the output file. JSON includes a `preview` field |
| `--quiet` | Suppress per-stage `[pipeline]` progress on stderr |

## JSON config

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `pdf` | yes | — | Path to the PDF file |
| `output` | yes | — | Path for the output `.md` file |
| `converter` | no | `auto` | `pdf2md` / `ocr` / `auto` |
| `lang` | no | `auto` | `zh` / `en` / `auto` |
| `pythonBin` | no | platform default | Python interpreter path for OCR. Falls back to `$PYTHON`, then `python` (Windows) or `python3` |
| `ocrDpi` | no | `300` | Render DPI for OCR. ≥ 300 recommended for CJK small fonts |
| `ocrWorkers` | no | `cpu_count - 1` | Parallel OCR workers |
| `ocrCache` | no | `true` | Per-page OCR cache. `true` → `<pdf>.ocr-cache/`; string → custom dir; `false` to disable. Resumable across crashes; auto-invalidated when PDF mtime/size, DPI, or lang change |
| `fix` | no | `true` | Run heading/TOC fix engine |
| `removePageBreaks` | no | `true` | Remove `<!-- PAGE_BREAK -->` tags. Equivalent to `pageBreakStyle: "remove"` |
| `pageBreakStyle` | no | `remove` | `remove` / `number` / `keep`. `number` rewrites markers to `<!-- p:N -->` for LLM citation |
| `nestedToc` | no | `false` | Emit nested chapter→section→item TOC instead of flat list |
| `heuristicsPath` | no | bundled | Override path to `heuristics.json` (custom conjunctions / verbs / topic-skip rules) |
| `joinParagraphs` | no | `true` | Join broken lines into paragraphs |
| `dryRun` | no | `false` | Skip the final write. Same as `--dry-run` |

## Heal broken paragraphs

PDF converters insert hard line breaks mid-sentence, turning every line into an island:

```
Before (fragmented):         After (joined):
我们对自己的身份认同。      我们对自己的身份认同。我们认为重要和光荣的事。
我们认为重要和光荣的事。    我们最热衷的事物。生命力。重要性。自尊。
我们最热衷的事              启蒙。我们的意志。目的和未来的目标。
物。生命力。重要性。        我们获得的赏识。对我而言，精确地诠释太阳的意义...
```

The join engine uses **sentence-ending punctuation** (`。！？」』》`) as natural paragraph boundaries. On real-world Chinese books, it joins **4,000–5,000 broken lines** per 350-page volume. Standalone HTML comments (`<!-- p:N -->`, `<!-- PAGE_BREAK -->`) are preserved as paragraph boundaries — they never get glued into prose.

## Smart fix engine

Layered heuristics to distinguish real headings from converter noise. All rules live in `lib/heuristics.json` — override via `heuristicsPath`:

1. **Length gate** — headings < 35 chars. Paragraphs are longer.
2. **Punctuation gate** — body text contains `，；：、` or ends with `。！？`. Headings don't.
3. **Conjunction gate** — lines starting with `但是/因此/所以…` are body text. Single-char particles (`只/更/又/...`) deliberately excluded — they false-positive on real titles like `只为爱` or `更高的视角`.
4. **Sentence-pattern gate** — `XX是/在/有/会/必须/...` = body text. Pure particles (`的/对/和/与`) excluded for the same reason.
5. **Fragment gate** — 1-3 chars then punctuation = continuation from previous line.
6. **Heading–body split** — when a `###` line is too long and contains body-style punctuation, the engine doesn't just demote the whole line. It scans for the first structural break (CJK punctuation, em-dash, or length cutoff) and splits it into a clean heading + a body paragraph. Catches edge cases where PDF converters concatenate headings and body text on one line.
7. **Middle-dot fix** — `?` between CJK chars → `·` (132 names fixed in test).
8. **Topic promotion** — standalone planet-pair lines → `####` headings (43 promoted).

## OCR engine

Parallel, streaming, resumable. Each worker renders **one page at a time** to a temp dir, runs tesseract, and (if cache enabled) writes the result to `<pdf>.ocr-cache/page-NNNN.txt`. On rerun, cached pages are skipped — kill it mid-run and you keep what was done.

| Knob | Default | Notes |
|------|---------|-------|
| DPI | 300 | CJK small fonts benefit from 300+; was 150 before |
| Workers | `cpu_count - 1` | Each worker is a separate process (CPU-bound, GIL-free) |
| Cache | on | `<pdf>.ocr-cache/` next to the PDF, fingerprinted by mtime+size+dpi+lang |
| Per-page errors | tolerated | Bad page becomes `[OCR_FAILED page N: <err>]`, run continues |

## For LLM agents

The entire interface contract fits in 3 lines:

```
Input:  JSON string (or --config file) with pdf + output paths
Output: JSON string with ok + converter + stats + outputPath (+ preview when dry-run)
Errors: JSON string with ok:false + error message
```

No text parsing. No multi-step orchestration. No fragile grep/sed. Just structured data in, structured data out.

For agents that cite source pages, set `"pageBreakStyle": "number"` — every page boundary becomes `<!-- p:42 -->`, which the agent can quote back when answering.

## Installation

```bash
cd scripts
npm install

# OCR engine (only needed for scanned PDFs)
# macOS
brew install tesseract tesseract-lang poppler
# Ubuntu/Debian
sudo apt-get install tesseract-ocr tesseract-ocr-chi-sim poppler-utils
# Windows (PowerShell + Chocolatey)
choco install tesseract poppler

pip3 install pytesseract pdf2image
```

## Tests

```bash
cd scripts && npm test
```

55 unit + CLI tests in `scripts/test/`, runs in ~3 seconds, zero dev dependencies (uses `node --test`).

## Requirements

- Node.js ≥ 18 (tested on 18, 20, 22 across Ubuntu/macOS/Windows in CI)
- `@opendocsg/pdf2md` (auto-installed)
- OCR: `tesseract` + language data, `poppler` (for `pdftoppm`), `pytesseract` + `pdf2image`

## License

MIT — see [LICENSE](LICENSE).