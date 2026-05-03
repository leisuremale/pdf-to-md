#!/usr/bin/env node
/**
 * Fix markdown formatting issues from PDF conversion
 * Usage: node fix-md.js [--remove-page-breaks] <md-path> [output-path]
 * Output: JSON { ok, stats, error }
 */

import { readFileSync, writeFileSync } from 'fs';

const args = process.argv.slice(2);
const removePageBreaks = args.includes('--remove-page-breaks');
const positionalArgs = args.filter(a => !a.startsWith('--'));

if (positionalArgs.length < 1) {
  console.log(JSON.stringify({ ok: false, error: 'Usage: node fix-md.js [--remove-page-breaks] <md-path> [output-path]' }));
  process.exit(1);
}

const mdPath = positionalArgs[0];
const outputPath = positionalArgs[1] || null;

function makeSlug(text) {
  return text.toLowerCase().replace(/[^一-龥a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function convertTocLine(line) {
  let title = line.trim();
  title = title.replace(/^目\s+录\s*/, ''); // strip "目 录" prefix
  return `- [${title}](#${makeSlug(title)})`;
}

try {
  let content = readFileSync(mdPath, 'utf8');
  const lines = content.split('\n');
  const fixed = [];
  let fixedCount = 0;
  let pageBreaksRemoved = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === '<!-- PAGE_BREAK -->') {
      if (removePageBreaks) {
        pageBreaksRemoved++;
        continue;
      }
      fixed.push(line);
      continue;
    }

    const trimmed = line.trim();

    // Detect TOC entry with # prefix (e.g. "### Chapter Title ...... 3")
    if (/^#{1,3}\s+[^\n]+\.{5,}/.test(trimmed)) {
      const cleanLine = trimmed.replace(/\*{2}/g, '');
      const match = cleanLine.match(/^(#{1,3})\s+(.+?)\.{5,}\s*(\d+)\s*$/);
      if (match) {
        const headingLevel = match[1];
        const title = match[2].trim();
        fixed.push(`${headingLevel} [${title}](#${makeSlug(title)})`);
        fixedCount++;
        continue;
      }
    }

    // Detect plain-text TOC entry: starts with chapter/section markers
    const tocCandidate = trimmed.replace(/^目\s+录\s*/, '');
    if (/^(?:第[一二三四五六七八九十\d]+章|第[一二三四五六七八九十\d]+[节部篇卷])/.test(tocCandidate)) {
      const cleanLine = trimmed.replace(/\*{2}/g, '');
      if (/\.{5,}\s*\d+\s*$/.test(cleanLine)) {
        const m2 = cleanLine.match(/^(.+?)\s+\.{5,}\s*(\d+)\s*$/);
        if (m2) {
          fixed.push(convertTocLine(m2[1]));
          fixedCount++;
          continue;
        }
      }
    }

    // Fix paragraphs incorrectly marked as ## / ### / #### headings
    if (/^#{2,4}\s+[^\n]+$/.test(line) && !line.trim().endsWith('-->')) {
      const text = line.replace(/^#{2,4}\s+/, '');
      const trimmedText = text.trim();

      // Heuristics: a real heading is short, doesn't end with punctuation,
      // doesn't contain mid-sentence punctuation, doesn't start with a
      // conjunction, and isn't a body-text fragment.
      const endsWithPunctuation = /[。！？，；：、）\}\)」』》…—\-]$/.test(trimmedText);
      const containsClausePunct = /[，；：、]/.test(trimmedText);
      const containsSentenceEnd = /[。！？]/.test(trimmedText);
      const isLong = trimmedText.length > 35;
      const startsWithConjunction = /^(?:但是|然而|因此|所以|而且|不过|如果|因为|虽然|于是|接着|然后|另外|此外|当然|于是乎|事实上|基本上|换句话说|对我而言|对我来讲|就|便|却|才|又|也|还|更|只|很|非常|比较|尤其|相当|特别|无论|不论|不管|除非|只要|只有|或者|还是)/.test(trimmedText);
      const looksLikeBodyStart = /^[一-龥]{1,2}(?:是|在|有|会|能|可以|可能|必须|需要|应该|已经|曾经|一直|没有|不是|如同|像|就像|仿佛|似乎|的|对|和|与|或|而|但|来|被|把|将|从|到|向|跟|替|除了|有关|关于|至于|对于|随着|通过|经过|根据|按照|为了)/.test(trimmedText);
      const isFragment = /^(?:[一-龥]{1,3}|[一-龥a-zA-Z]{1,3})[。！？，；：、]/.test(trimmedText);

      const isRealHeading = (
        !isLong &&
        !endsWithPunctuation &&
        !containsClausePunct &&
        !containsSentenceEnd &&
        !startsWithConjunction &&
        !looksLikeBodyStart &&
        !isFragment &&
        /^[#一-龥a-zA-Z0-9\s\-–—""''·，。！？：；（）【】《》「」『』、·％＋－—…]+$/.test(trimmedText) &&
        !/\.{3,}/.test(trimmedText) &&
        !/\d+\s*$/.test(trimmedText)
      );

      if (!isRealHeading) {
        fixed.push(text);
        fixedCount++;
        continue;
      }
    }

    fixed.push(line);
  }

  const resultContent = fixed.join('\n');
  const writePath = outputPath || mdPath;
  writeFileSync(writePath, resultContent, 'utf8');

  const stats = {
    totalLines: lines.length,
    fixedLines: fixedCount,
    pageBreaksRemoved: removePageBreaks ? pageBreaksRemoved : undefined,
    outputPath: outputPath || mdPath,
  };

  console.log(JSON.stringify({ ok: true, stats }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
}
