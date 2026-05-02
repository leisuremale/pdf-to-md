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
| **Post-processing** | Manual (you fix headings, TOC, artifacts) | Built-in smart fix engine |
| **LLM-friendly** | ❌ Multiple calls, fragile parsing | ✅ One call, always valid JSON |
| **Chinese PDF support** | Hit or miss | Heuristic-based heading detection for CJK text |
| **Pipeline** | Separate scripts, manual chaining | `pipeline.js` does it all |

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

## What the fix engine does

PDF converters (especially `@opendocsg/pdf2md`) tend to mislabel body paragraphs as `###` headings. The fix engine uses layered heuristics to tell real headings from noise:

1. **Length gate** — headings are short (< 35 chars). Paragraphs are longer.
2. **Punctuation gate** — body text ends with `。！？，；：`. Headings don't.
3. **Conjunction gate** — lines starting with "但是/因此/所以…" are body text.
4. **Sentence-pattern gate** — "XX是/在/有/会…" openings signal body text.
5. **TOC transform** — `Chapter 1 .............. 42` becomes `[Chapter 1](#chapter-1)`.

In tests on a 350-page Chinese astrology book, the engine correctly removed 4,256 false `###` prefixes while preserving all 700 real section headings.

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
