# pdf-to-md — PDF 转 Markdown

## 使用方式

一条命令完成：转换 → 处理分页 → 修复格式 → 合并段落 → CJK 抛光 → 写入文件。

```bash
node scripts/pipeline.js '<json>'
node scripts/pipeline.js --config job.json
node scripts/pipeline.js --dry-run '<json>'   # 不写文件，只预览
node scripts/pipeline.js --quiet '<json>'     # 关闭 stderr 阶段进度
```

**JSON 字段**：

| 字段 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `pdf` | ✅ | — | PDF 文件路径 |
| `output` | ✅ | — | 输出 .md 文件路径 |
| `converter` | ❌ | `auto` | `pdf2md`（文字型）/ `ocr`（扫描版）/ `auto`（自动） |
| `lang` | ❌ | `auto` | `zh` / `en` / `auto` |
| `pythonBin` | ❌ | 平台默认 | OCR 用的 Python 路径，回退到 `$PYTHON` 再回退到 `python`/`python3` |
| `ocrDpi` | ❌ | `300` | OCR 渲染 DPI；中文小字号建议 ≥ 300 |
| `ocrWorkers` | ❌ | `cpu_count - 1` | OCR 并行进程数 |
| `ocrCache` | ❌ | `true` | 单页 OCR 缓存。`true` → `<pdf>.ocr-cache/`；字符串 → 自定义路径；`false` 关闭。中断后可恢复，PDF/DPI/lang 任一变更自动失效 |
| `fix` | ❌ | `true` | 是否修复误标标题 + 目录链接 |
| `removePageBreaks` | ❌ | `true` | 是否删除 `<!-- PAGE_BREAK -->`，等价于 `pageBreakStyle: "remove"` |
| `pageBreakStyle` | ❌ | `remove` | `remove` / `number` / `keep`。`number` 改写为 `<!-- p:N -->` 供 LLM 引用页码 |
| `nestedToc` | ❌ | `false` | 按章/节/条 自动缩进目录 |
| `heuristicsPath` | ❌ | 内置 | 覆盖 `heuristics.json`（连词/动词/话题跳过规则） |
| `joinParagraphs` | ❌ | `true` | 是否合并断行段落 |
| `dryRun` | ❌ | `false` | 不写文件，等价于 `--dry-run` |

**示例**：

```bash
# 普通文字型 PDF
node scripts/pipeline.js '{"pdf":"/path/to/book.pdf","output":"/path/to/book.md"}'

# 扫描/图片 PDF（OCR 模式 + 提高 DPI）
node scripts/pipeline.js '{"pdf":"/path/to/scanned.pdf","output":"/path/to/out.md","converter":"ocr","ocrDpi":400}'

# 给 LLM 用：保留页码标记
node scripts/pipeline.js '{"pdf":"book.pdf","output":"book.md","pageBreakStyle":"number"}'

# 嵌套目录
node scripts/pipeline.js '{"pdf":"book.pdf","output":"book.md","nestedToc":true}'

# 关掉 OCR 缓存
node scripts/pipeline.js '{"pdf":"x.pdf","output":"x.md","converter":"ocr","ocrCache":false}'
```

**converter 模式**：

| converter | 引擎 | 适用 | 速度 |
|-----------|------|------|------|
| `pdf2md` | @opendocsg/pdf2md | 文字型 PDF | 秒级 |
| `ocr` | tesseract + chi_sim，多进程并行 | 扫描/图片 PDF | 8 核约 2 分钟/400 页 |
| `auto`（默认） | pdf2md → 字符密度低则降级 ocr | 通用 | 自动检测 |

## 管道步骤

```
convert → page breaks → fix headings → join paragraphs → remove CJK spaces → fix middle-dot → promote topics → write
```

- **CJK spaces**：用 lookahead `(?<=cjk)\s+(?=cjk)` 移除中文字间空格，不影响英文词间距和中英混排。
- **page breaks**：默认 `remove`；`number` 模式改成 `<!-- p:42 -->` 让 LLM 能引用页码；`keep` 模式原样保留。
- **fix headings**：6 层启发式 + 外置词表（`scripts/lib/heuristics.json`）。

## 安装

```bash
cd scripts && npm install

# OCR 模式额外依赖
# macOS
brew install tesseract tesseract-lang poppler
# Ubuntu/Debian
sudo apt-get install tesseract-ocr tesseract-ocr-chi-sim poppler-utils
# Windows
choco install tesseract poppler

pip3 install pytesseract pdf2image
```

要求 Node.js ≥ 18（CI 覆盖 18/20/22 × Ubuntu/macOS/Windows）。

## 测试

```bash
cd scripts && npm test
```

55 个单元 + CLI 测试，~3 秒跑完，零开发依赖（`node --test`）。