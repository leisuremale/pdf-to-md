// Shared CJK utilities. Single source of truth for CJK character ranges.
//
// U+4E00–U+9FFF  CJK Unified Ideographs   (一–鿿)
// U+3400–U+4DBF  CJK Extension A          (㐀–䶿)
// U+3000–U+303F  CJK Symbols/Punctuation  (、。「」 etc)
// U+FF00–U+FFEF  Halfwidth/Fullwidth      (，。！？ etc)
export const CJK_IDEOGRAPHS = '\\u4e00-\\u9fff\\u3400-\\u4dbf';
export const CJK_PUNCT      = '\\u3000-\\u303f\\uff00-\\uffef';
export const CJK_ALL        = `${CJK_IDEOGRAPHS}${CJK_PUNCT}`;

const CJK_IDEOGRAPHS_RE = new RegExp(`[${CJK_IDEOGRAPHS}]`, 'g');

export function detectLang(text) {
  const cjkCount = (text.match(CJK_IDEOGRAPHS_RE) || []).length;
  const total = text.replace(/\s/g, '').length;
  return (total > 0 && cjkCount / total > 0.3) ? 'zh' : 'en';
}

// Remove single/multiple horizontal whitespace between CJK characters.
// Uses [^\\S\\n] (whitespace-except-newline) instead of \\s — newlines are
// paragraph boundaries, not CJK inter-character spacing.  Previously \\s+
// ate \\n\\n between a heading and the next paragraph, merging them into
// one giant ### heading line.
// Lookbehind/lookahead so neighbors aren't consumed — otherwise (cjk)\\s+(cjk)
// with /g would skip every other space (the matched right-CJK becomes the
// start point for the next search, leaving "我们 对 自己" instead of "我们对自己").
const CJK_SPACE_RE = new RegExp(`(?<=[${CJK_ALL}])[^\\S\\n]+(?=[${CJK_ALL}])`, 'g');

export function removeCJKSpaces(content, lang) {
  if (lang === 'en') return { content, removed: 0 };
  let removed = 0;
  const fixed = content.replace(CJK_SPACE_RE, () => { removed++; return ''; });
  return { content: fixed, removed };
}

// Fix garbled middle-dot in foreign names: PDF converters often render
// · (U+00B7) as "?" between CJK / Latin characters.
const MIDDLE_DOT_RE = new RegExp(`([${CJK_IDEOGRAPHS}A-Za-z])\\?\\s*([${CJK_IDEOGRAPHS}A-Za-z])`, 'g');

export function fixMiddleDot(content, lang) {
  if (lang === 'en') return { content, fixedCount: 0 };
  let count = 0;
  const fixed = content.replace(MIDDLE_DOT_RE, (_, a, b) => { count++; return a + '·' + b; });
  return { content: fixed, fixedCount: count };
}