#!/usr/bin/env python3
"""OCR a PDF to plain text using tesseract. Output: JSON to stdout.

Usage:
    ocr.py <pdf-path> [lang] [dpi] [workers] [cache-dir]

Defaults:
    lang      = chi_sim+eng
    dpi       = 300              (CJK small fonts need >= 300 for accuracy)
    workers   = max(cpu_count-1, 1)   (pass 0 to use this default)
    cache-dir = (none)           If set, cache each page's text to
                                  <cache-dir>/page-<N>.txt and skip pages
                                  whose cache file is fresh.

Cache invalidation: a fingerprint file <cache-dir>/.fingerprint.json stores
{pdf_mtime, pdf_size, dpi, lang}. If any field changes the cache is wiped.
"""
import json
import sys

try:
    import shutil
    import tempfile
    from concurrent.futures import ProcessPoolExecutor, as_completed
    from multiprocessing import cpu_count
    from pathlib import Path

    from pdf2image import convert_from_path, pdfinfo_from_path
    import pytesseract
except ImportError as _e:
    print(json.dumps({
        "ok": False,
        "error": f"Missing OCR dependency: {_e.name}. Install with: pip install pytesseract pdf2image",
    }))
    sys.exit(1)

PAGE_BREAK = '\n\n<!-- PAGE_BREAK -->\n\n'
DEFAULT_LANG = 'chi_sim+eng'
DEFAULT_DPI = 300


def ocr_one_page(pdf_path: str, page_num: int, dpi: int, lang: str):
    """Render a single PDF page, OCR it. Returns (page_num, text, error)."""
    try:
        with tempfile.TemporaryDirectory() as tmp:
            images = convert_from_path(
                pdf_path,
                dpi=dpi,
                first_page=page_num,
                last_page=page_num,
                fmt='png',
                output_folder=tmp,
            )
            if not images:
                return (page_num, '', f'no image rendered for page {page_num}')
            text = pytesseract.image_to_string(images[0], lang=lang)
            return (page_num, text, None)
    except Exception as e:  # pylint: disable=broad-except
        return (page_num, '', f'{type(e).__name__}: {e}')


def fingerprint_for(pdf_path: str, dpi: int, lang: str) -> dict:
    st = Path(pdf_path).stat()
    return {"pdf_mtime": st.st_mtime, "pdf_size": st.st_size, "dpi": dpi, "lang": lang}


def init_cache(cache_dir: Path, fp: dict) -> None:
    """Ensure cache_dir matches fingerprint fp; wipe and recreate if not."""
    fp_file = cache_dir / ".fingerprint.json"
    if cache_dir.exists():
        try:
            existing = json.loads(fp_file.read_text(encoding="utf-8"))
            if existing == fp:
                return
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        # Stale cache — wipe.
        shutil.rmtree(cache_dir, ignore_errors=True)
    cache_dir.mkdir(parents=True, exist_ok=True)
    fp_file.write_text(json.dumps(fp), encoding="utf-8")


def cache_get(cache_dir: Path, page_num: int):
    if cache_dir is None:
        return None
    f = cache_dir / f"page-{page_num:04d}.txt"
    if f.is_file():
        try:
            return f.read_text(encoding="utf-8")
        except OSError:
            return None
    return None


def cache_put(cache_dir: Path, page_num: int, text: str) -> None:
    if cache_dir is None:
        return
    f = cache_dir / f"page-{page_num:04d}.txt"
    f.write_text(text, encoding="utf-8")


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Usage: ocr.py <pdf-path> [lang] [dpi] [workers] [cache-dir]"}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    if not Path(pdf_path).is_file():
        print(json.dumps({"ok": False, "error": f"PDF not found: {pdf_path}"}))
        sys.exit(1)

    lang = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_LANG
    try:
        dpi          = int(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_DPI
        workers_arg  = int(sys.argv[4]) if len(sys.argv) > 4 else 0
    except ValueError as e:
        print(json.dumps({"ok": False, "error": f"Invalid integer arg: {e}"}))
        sys.exit(1)
    workers = workers_arg if workers_arg > 0 else max(1, cpu_count() - 1)
    cache_dir = Path(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] else None

    info = pdfinfo_from_path(pdf_path)
    page_count = int(info.get('Pages', 0))
    if page_count <= 0:
        print(json.dumps({"ok": False, "error": "Could not determine page count"}))
        sys.exit(1)

    workers = min(workers, page_count)

    if cache_dir is not None:
        init_cache(cache_dir, fingerprint_for(pdf_path, dpi, lang))

    print(f'[OCR] {page_count} pages | dpi={dpi} | workers={workers} | lang={lang}'
          + (f' | cache={cache_dir}' if cache_dir else ''),
          file=sys.stderr, flush=True)

    pages = [None] * page_count
    failed = []
    cached = 0

    # First pass: load whatever's cached.
    todo = []
    for n in range(1, page_count + 1):
        hit = cache_get(cache_dir, n)
        if hit is not None:
            pages[n - 1] = hit
            cached += 1
        else:
            todo.append(n)

    if cached:
        print(f'[OCR] cache hit on {cached}/{page_count} pages, OCR-ing {len(todo)} remaining',
              file=sys.stderr, flush=True)

    completed = 0
    if todo:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(ocr_one_page, pdf_path, n, dpi, lang): n
                for n in todo
            }
            for future in as_completed(futures):
                page_num, text, err = future.result()
                idx = page_num - 1
                if err:
                    pages[idx] = f'[OCR_FAILED page {page_num}: {err}]'
                    failed.append(page_num)
                else:
                    pages[idx] = text
                    cache_put(cache_dir, page_num, text)
                completed += 1
                print(f'[OCR] {completed}/{len(todo)} done (page {page_num}, {len(text)} chars)',
                      file=sys.stderr, flush=True)

    full_text = PAGE_BREAK.join(pages)
    print(json.dumps({
        "ok": True,
        "text": full_text,
        "stats": {
            "pages": page_count,
            "cachedPages": cached,
            "ocrPages": len(todo),
            "failedPages": failed,
            "outputLength": len(full_text),
            "lineCount": full_text.count('\n') + 1,
        },
    }))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # pylint: disable=broad-except
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}))
        sys.exit(1)
