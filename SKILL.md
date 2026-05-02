# pdf-to-md — PDF 转 Markdown

## 使用方式

一条命令完成：转换 → 修复格式 → 去分页标记 → 写入文件。

```bash
node ~/.openclaw/workspace-xiao-zhi/skills/pdf-to-md/scripts/pipeline.js '<json>'
```

**JSON 字段**：

| 字段 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `pdf` | ✅ | — | PDF 文件绝对路径 |
| `output` | ✅ | — | 输出 .md 文件绝对路径 |
| `fix` | ❌ | `true` | 是否修复 `### ` 误标 + 目录链接 |
| `removePageBreaks` | ❌ | `true` | 是否删除 `<!-- PAGE_BREAK -->` |

**示例**：
```bash
node ~/.openclaw/workspace-xiao-zhi/skills/pdf-to-md/scripts/pipeline.js \
  '{"pdf":"/path/to/book.pdf","output":"/path/to/book.md"}'
```

**返回 JSON**：
```json
{
  "ok": true,
  "outputPath": "/path/to/book.md",
  "convert": { "inputSize": 1600449, "outputLength": 347584, "lineCount": 13520 },
  "fix": { "totalLines": 13520, "fixedLines": 5774, "pageBreaksRemoved": 227 },
  "durationMs": 1442
}
```

## 安装

```bash
cd ~/.openclaw/workspace-xiao-zhi/skills/pdf-to-md/scripts && npm install
```

要求 node >= 18。
