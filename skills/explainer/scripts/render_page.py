#!/usr/bin/env python3
"""Screenshot an explainer page with headless Chrome/Chromium.

Usage:
  python render_page.py page.html --out shots/ [--langs zh,en] [--only SECTION_ID]
                        [--width 1280] [--height 12000] [--tile 2400] [--dark]

Writes one full screenshot per language plus cropped tiles (<name>_<lang>_<n>.png)
so each tile is readable, and prints script errors reported by the browser.
--only hides every <section> except the given id in a temporary copy, which is
the easy way to look at one figure in a long page. Pages without <html> (artifact
fragments) are wrapped automatically. Tiles need Pillow; without it only the full
screenshot is written.
"""
import argparse, re, shutil, subprocess, sys, tempfile
from pathlib import Path

CHROMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("page")
    ap.add_argument("--out", default="shots")
    ap.add_argument("--langs", default="", help="comma list of URL hashes, e.g. zh,en; default: detect from data-l")
    ap.add_argument("--only", default="")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=12000)
    ap.add_argument("--tile", type=int, default=2400)
    ap.add_argument("--dark", action="store_true", help="force dark theme via data-theme")
    a = ap.parse_args()

    chrome = next((shutil.which(c) for c in CHROMES if shutil.which(c)), None)
    if not chrome:
        sys.exit("no Chrome/Chromium found on PATH")
    src = Path(a.page).read_text(encoding="utf-8")
    if "<html" not in src.lower():
        src = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + src + "</body></html>"
    inject = ""
    if a.only:
        inject += ("<script>addEventListener('load',()=>{document.querySelectorAll('section').forEach(s=>{"
                   f"if(s.id!=={a.only!r})s.style.display='none';else{{s.classList.remove('collapsed');}}}});scrollTo(0,0);}});</script>")
    theme = "light"
    if a.dark:
        theme = "dark"
    inject += f"<script>document.documentElement.setAttribute('data-theme','{theme}');</script>"
    src = src.replace("</body>", inject + "</body>") if "</body>" in src else src + inject

    langs = [x for x in a.langs.split(",") if x] or sorted(set(re.findall(r'data-l="([^"]+)"', src))) or [""]
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp()) / "page.html"
    tmp.write_text(src, encoding="utf-8")
    stem = Path(a.page).stem + (f"_{a.only}" if a.only else "")
    try:
        from PIL import Image
    except ImportError:
        Image = None

    for lang in langs:
        shot = out / f"{stem}_{lang or 'page'}.png"
        url = tmp.as_uri() + (f"#{lang}" if lang else "")
        r = subprocess.run([chrome, "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
                            "--enable-logging=stderr", "--v=0", f"--window-size={a.width},{a.height}",
                            "--virtual-time-budget=8000", f"--screenshot={shot}", url],
                           capture_output=True, text=True, timeout=180)
        errs = [l for l in r.stderr.splitlines() if re.search(r"Uncaught|ReferenceError|TypeError|SyntaxError", l)]
        print(f"{shot}  script errors: {len(errs)}")
        for e in errs[:5]:
            print("   ", e.strip()[:200])
        if Image and shot.exists():
            im = Image.open(shot).convert("RGB")
            px = im.load(); bg = px[im.width - 3, im.height - 3]
            end = im.height
            for y in range(im.height - 1, 0, -8):  # trim trailing background
                if any(sum(abs(p - q) for p, q in zip(px[x, y], bg)) > 30 for x in range(0, im.width, 16)):
                    end = min(im.height, y + 40); break
            for i, y in enumerate(range(0, end, a.tile)):
                tile = out / f"{stem}_{lang or 'page'}_{i}.png"
                im.crop((0, y, im.width, min(y + a.tile, end))).save(tile)
                print("   tile", tile)


if __name__ == "__main__":
    main()
