# pdf-to-md

> JSON-driven, one-shot PDF → clean Markdown. Built for LLM agents, works great for humans too.

## Why this exists

Most PDF-to-Markdown tools force you through a multi-step mess: run a converter, inspect the output, manually fix broken headings, strip artifacts, chain shell commands. If you're an LLM agent, that means multiple rounds of tool calls, parsing intermediate JSON, and holding state.

**pdf-to-md collapses the entire pipeline into one JSON-in / JSON-out call.**

```
Before:  convert.js → read output → fix-md.js → read output → strip tags → done
After:   pipeline.js '{"pdf":"...","output":"..."}' → done
```

## What makes it different

| | Typical pdf2md tools | pdf-to-md |
|---|---|---|
| **Interface** | CLI args / positional params | Single JSON config string |
| **Output** | Mixed stdout (logs + content) | One line of structured JSON |
| **Headings** | Body text mislabeled as `###` / `####` | Smart fix engine (4-layer heuristics) |
| **Paragraphs** | Sentences shattered across lines | Auto-join: heals PDF line-break artifacts |
| **LLM-friendly** | ❌ Multiple calls, fragile parsing | ✅ One call, always valid JSON |
| **Chinese PDF** | Hit or miss | CJK-tuned detection (punctuation, conjunctions, fragments) |
| **Pipeline** | Separate scripts, manual chaining | `pipeline.js`: convert → fix → join → clean |

### 🔥 Heal broken paragraphs

PDF converters insert hard line breaks mid-sentence, turning every line into an island:

```
Before (fragmented):         After (joined):
我们对自己的身份认同。      我们对自己的身份认同。我们认为重要和光荣的事。我们最热衷的事物。
我们认为重要和光荣的事。    生命力。重要性。自尊。启蒙。我们的意志。目的和未来的目标。
我们最热衷的事              我们获得的赏识。对我而言，精确地诠释太阳的意义是很困难的事，
物。生命力。重要性。        有时它会被描述成代表自我的象征符号。
自尊。启蒙。我们的意志。
目的和未来的目标。
我们获得的赏识。
```

The join engine uses **sentence-ending punctuation** (`。！？」』》`) as natural paragraph boundaries — no blank-line heuristics, no fragile regex. On real-world Chinese books, it joins **4,000–5,000 broken lines** per 350-page volume while preserving every heading and paragraph structure.

## Quick start

```bash
cd scripts && npm install
```

```bash
node scripts/pipeline.js '{"pdf":"/path/to/book.pdf","output":"/path/to/book.md"}'
```

That's it. One command. The script converts, fixes, cleans, and writes — returning structured stats:

```json
{
  "ok": true,
  "outputPath": "/path/to/book.md",
  "convert": { "inputSize": 1600449, "outputLength": 347584, "lineCount": 13520 },
  "fix": { "totalLines": 13520, "fixedLines": 5774, "pageBreaksRemoved": 227 },
  "join": { "linesJoined": 4622 },
  "durationMs": 1442
}
```

## JSON config

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `pdf` | ✅ | — | Absolute path to PDF file |
| `output` | ✅ | — | Absolute path for output `.md` |
| `fix` | ❌ | `true` | Run smart fix engine after conversion |
| `removePageBreaks` | ❌ | `true` | Remove `<!-- PAGE_BREAK -->` tags |
| `joinParagraphs` | ❌ | `true` | Join broken lines into readable paragraphs |

## What the fix engine does

PDF converters (especially `@opendocsg/pdf2md`) tend to mislabel body paragraphs as `###` headings. The fix engine uses layered heuristics to tell real headings from noise:

1. **Length gate** — headings are short (< 35 chars). Paragraphs are longer.
2. **Punctuation gate** — body text ends with `。！？，；：`. Headings don't.
3. **Conjunction gate** — lines starting with "但是/因此/所以…" are body text.
4. **Sentence-pattern gate** — "XX是/在/有/会…" openings signal body text.
5. **TOC transform** — `Chapter 1 .............. 42` becomes `[Chapter 1](#chapter-1)`.

On a 350-page Chinese astrology book: **5,957** false heading prefixes removed, **4,622** broken lines healed into paragraphs, **227** page-break artifacts stripped — all 700 real headings preserved. One command, under 2 seconds.

## For LLM agents

The entire interface contract fits in 3 lines:

```
Input:  JSON string with pdf + output paths
Output: JSON string with ok + stats + outputPath
Errors: JSON string with ok:false + error message
```

No text parsing. No multi-step orchestration. No fragile grep/sed. Just structured data in, structured data out.

## Requirements

- Node.js >= 18
- `@opendocsg/pdf2md` (auto-installed via `npm install`)

## License

MIT
