#!/usr/bin/env python3
"""OCR a scanned PDF to plain text using tesseract. Output: JSON to stdout."""
import json, sys, os
from pdf2image import convert_from_path
import pytesseract

def main():
    pdf_path = sys.argv[1]
    lang = sys.argv[2] if len(sys.argv) > 2 else 'chi_sim+eng'

    images = convert_from_path(pdf_path, dpi=150)
    pages_text = []
    total = len(images)
    for i, img in enumerate(images):
        text = pytesseract.image_to_string(img, lang=lang)
        pages_text.append(text)
        print(f'[OCR] page {i+1}/{total} ({len(text)} chars)', file=sys.stderr, flush=True)

    full_text = '\n\n<!-- PAGE_BREAK -->\n\n'.join(pages_text)
    print(json.dumps({
        "ok": True,
        "text": full_text,
        "stats": {
            "pages": len(images),
            "outputLength": len(full_text),
            "lineCount": full_text.count('\n') + 1,
        }
    }))

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)
