// Re-join broken paragraphs.
// PDF converters insert a blank line between every line, so blank lines can't
// be used as paragraph boundaries. We use sentence-ending punctuation instead:
// a line ending with 。！？」』》) closes a paragraph; otherwise the next line
// continues it.

const SENTENCE_END_ZH_RE = /[。！？」』》\)]$/;
const SENTENCE_END_EN_RE = /[.!?)"']$/;
const HEADING_RE         = /^#{1,4}\s/;
// A standalone HTML comment line (page-break marker, page-number marker, etc.)
// must not be glued into prose — treat it like a heading and let it stand alone.
const STANDALONE_COMMENT_RE = /^<!--.*-->$/;

export function joinParagraphs(content, lang) {
  const sentenceEndRE = lang === 'en' ? SENTENCE_END_EN_RE : SENTENCE_END_ZH_RE;
  const rawLines = content.split('\n').filter(l => l.trim() !== '');
  const out = [];
  let buf = '';
  let joinedCount = 0;

  const isHeading     = line => HEADING_RE.test(line.trim());
  const isStandalone  = line => isHeading(line) || STANDALONE_COMMENT_RE.test(line.trim());
  const isSentenceEnd = line => sentenceEndRE.test(line.trim());

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    if (isStandalone(line)) {
      if (buf) { out.push(buf.trimEnd()); buf = ''; joinedCount++; }
      out.push(line);
      continue;
    }

    // Join without space — CJK has no inter-word spaces. For English this is
    // a known imperfection: callers detect lang and route accordingly.
    buf = buf ? buf + line : line;

    const nextIsHeading = i + 1 < rawLines.length && isHeading(rawLines[i + 1]);
    if (isSentenceEnd(line) || nextIsHeading) {
      out.push(buf.trimEnd());
      buf = '';
      if (nextIsHeading && !isSentenceEnd(line)) joinedCount++;
    } else {
      joinedCount++;
    }
  }
  if (buf) out.push(buf.trimEnd());

  return { content: out.join('\n\n'), joinedCount };
}
