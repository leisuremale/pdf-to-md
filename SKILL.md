# pdf-to-md — PDF 转 Markdown

## 使用方式

一条命令完成：转换 → 修复格式 → 合并段落 → 去分页标记 → 写入文件。

```bash
node ~/.openclaw/workspace-xiao-zhi/skills/pdf-to-md/scripts/pipeline.js '<json>'
```

**JSON 字段**：

| 字段 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `pdf` | ✅ | — | PDF 文件绝对路径 |
| `output` | ✅ | — | 输出 .md 文件绝对路径 |
| `converter` | ❌ | `auto` | `pdf2md`（文字型）/ `ocr`（扫描版）/ `auto`（自动） |
| `fix` | ❌ | `true` | 是否修复误标标题 + 目录链接 |
| `removePageBreaks` | ❌ | `true` | 是否删除 `<!-- PAGE_BREAK -->` |
| `joinParagraphs` | ❌ | `true` | 是否合并断行段落 |

**示例**：
```bash
# 普通文字型 PDF
node pipeline.js '{"pdf":"/path/to/book.pdf","output":"/path/to/book.md"}'

# 扫描/图片 PDF（OCR 模式）
node pipeline.js '{"pdf":"/path/to/scanned.pdf","output":"/path/to/out.md","converter":"ocr"}'
```

**converter 模式**：

| converter | 引擎 | 适用 | 速度 |
|-----------|------|------|------|
| `pdf2md` | @opendocsg/pdf2md | 文字型 PDF | 秒级 |
| `ocr` | tesseract + chi_sim | 扫描/图片 PDF | 按页 OCR（449页~10分钟） |
| `auto`（默认） | pdf2md → 空则降级 ocr | 通用 | 自动检测 |

## 安装

```bash
cd ~/.openclaw/workspace-xiao-zhi/skills/pdf-to-md/scripts && npm install

# OCR 模式额外依赖
brew install tesseract tesseract-lang poppler
pip3 install pytesseract pdf2image
```

要求 node >= 18。
