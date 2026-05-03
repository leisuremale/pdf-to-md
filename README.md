# pdf-to-md

> JSON-driven, one-shot PDF → clean Markdown. Dual-engine: text extraction + OCR. Built for LLM agents, works great for humans too.

## Why this exists

Most PDF-to-Markdown tools force you through a multi-step mess: run a converter, inspect the output, manually fix broken headings, strip artifacts, chain shell commands. And when you hit a scanned PDF? Start over with a completely different tool.

**pdf-to-md collapses everything into one JSON-in / JSON-out call — with automatic engine selection.**

```
Before:  choose tool → convert → inspect → fix headings → strip tags → join paragraphs → done
After:   pipeline.js '{"pdf":"...","output":"..."}' → done
```

## 🔥 Dual-engine architecture

One pipeline, two engines. Auto-detection or manual override.

| Engine | Command | Best for | Speed | Output |
|--------|---------|----------|-------|--------|
| **pdf2md** | `converter: "pdf2md"` | Text-based PDFs | 1-2s | 347K chars, 13K lines |
| **OCR** | `converter: "ocr"` | Scanned/image PDFs | ~10min/400pp | 324K chars, 7.5K lines |
| **Auto** | default | Universal | pdf2md first, empty→OCR | auto-fallback |

```bash
# Text PDF — instant
node pipeline.js '{"pdf":"book.pdf","output":"book.md"}'

# Scanned PDF — OCR mode
node pipeline.js '{"pdf":"scanned.pdf","output":"out.md","converter":"ocr"}'
```

## What makes it different

| | Typical pdf2md tools | pdf-to-md |
|---|---|---|
| **Interface** | CLI args / positional params | Single JSON config string |
| **Output** | Mixed stdout (logs + content) | One line of structured JSON |
| **Scanned PDF** | ❌ Zero output / error | ✅ Auto OCR via tesseract + chi_sim |
| **Headings** | Body text mislabeled as `###` / `####` | Smart fix engine (6-layer heuristics) |
| **Paragraphs** | Sentences shattered across lines | Auto-join: heals PDF line-break artifacts |
| **Names** | `苏?汤普金` (garbled middle dot) | Auto-fix: `苏·汤普金` |
| **LLM-friendly** | ❌ Multiple calls, fragile parsing | ✅ One call, always valid JSON |

## Complete pipeline

```
convert → fix headings → join paragraphs → fix middle-dot → promote topics → write
```

One JSON in, full stats out:

```json
{
  "ok": true,
  "outputPath": "/path/to/book.md",
  "converter": "ocr (fallback)",
  "convert": { "inputSize": 51657593, "outputLength": 323732, "lineCount": 14725 },
  "fix": { "fixedLines": 6225, "pageBreaksRemoved": 252 },
  "join": { "linesJoined": 5095 },
  "polish": { "middleDotsFixed": 132, "topicsPromoted": 43 },
  "durationMs": 1442
}
```

## JSON config

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `pdf` | ✅ | — | Absolute path to PDF file |
| `output` | ✅ | — | Absolute path for output `.md` |
| `converter` | ❌ | `auto` | `pdf2md` / `ocr` / `auto` |
| `fix` | ❌ | `true` | Run smart fix engine |
| `removePageBreaks` | ❌ | `true` | Remove `<!-- PAGE_BREAK -->` tags |
| `joinParagraphs` | ❌ | `true` | Join broken lines into paragraphs |

## 🔥 Heal broken paragraphs

PDF converters insert hard line breaks mid-sentence, turning every line into an island:

```
Before (fragmented):         After (joined):
我们对自己的身份认同。      我们对自己的身份认同。我们认为重要和光荣的事。
我们认为重要和光荣的事。    我们最热衷的事物。生命力。重要性。自尊。
我们最热衷的事              启蒙。我们的意志。目的和未来的目标。
物。生命力。重要性。        我们获得的赏识。对我而言，精确地诠释太阳的意义...
```

The join engine uses **sentence-ending punctuation** (`。！？」』》`) as natural paragraph boundaries. On real-world Chinese books, it joins **4,000–5,000 broken lines** per 350-page volume.

## Smart fix engine

Layered heuristics to distinguish real headings from converter noise:

1. **Length gate** — headings < 35 chars. Paragraphs are longer.
2. **Punctuation gate** — body text contains `，；：、` or ends with `。！？`. Headings don't.
3. **Conjunction gate** — lines starting with "但是/因此/所以…" are body text.
4. **Sentence-pattern gate** — "XX是/在/有/会…" = body text.
5. **Fragment gate** — 1-3 chars then punctuation = continuation from previous line.
6. **Middle-dot fix** — `?` between CJK chars → `·` (132 names fixed in test).
7. **Topic promotion** — standalone planet-pair lines → `####` headings (43 promoted).

## Real-world results

Tested on three Chinese astrology books (total ~900 pages, 1.8MB Markdown):

| Book | Engine | Lines | False headings fixed | Lines joined | Pages OCR'd |
|------|--------|-------|---------------------|--------------|-------------|
| 当代占星研究 | pdf2md | 3,891 | 5,957 | 4,622 | — |
| 占星相位研究 | pdf2md | 2,920 | 6,225 | 5,095 | — |
| 人生的十二个面向 | OCR | 7,498 | — | 7,226 | 449 |

## For LLM agents

The entire interface contract fits in 3 lines:

```
Input:  JSON string with pdf + output paths
Output: JSON string with ok + converter + stats + outputPath
Errors: JSON string with ok:false + error message
```

No text parsing. No multi-step orchestration. No fragile grep/sed. Just structured data in, structured data out.

## Installation

```bash
cd scripts && npm install

# OCR engine (optional — only needed for scanned PDFs)
brew install tesseract tesseract-lang poppler
pip3 install pytesseract pdf2image
```

## Requirements

- Node.js >= 18
- `@opendocsg/pdf2md` (auto-installed)
- OCR: tesseract + chi_sim language data

## License

MIT
