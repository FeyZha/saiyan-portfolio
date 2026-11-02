import re
import zipfile
from xml.etree import ElementTree

import pypdfium2

from ._common import view_path
from .bot_media import jpeg

DOC_EXT = (".pdf", ".docx", ".md", ".markdown", ".txt")
DOC_CHAR_CAP = 30_000
PDF_PAGE_IMAGES = 3
PDF_RENDER_LONG = 1024
DOC_ERRORS = (ValueError, OSError, KeyError, zipfile.BadZipFile, ElementTree.ParseError, pypdfium2.PdfiumError)

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _docx_text(path: str) -> str:
    with zipfile.ZipFile(path) as z:
        root = ElementTree.fromstring(z.read("word/document.xml"))
    lines = []
    for p in root.iter(f"{_W}p"):
        text = "".join(t.text or "" for t in p.iter(f"{_W}t"))
        style = p.find(f"{_W}pPr/{_W}pStyle")
        level = re.match(r"Heading(\d)", style.get(f"{_W}val", "")) if style is not None else None
        lines.append(f"{'#' * int(level.group(1))} {text}" if level and text else text)
    return "\n".join(lines).strip()


def _pdf(path: str) -> tuple[str, int, list[dict]]:
    pdf = pypdfium2.PdfDocument(path)
    try:
        pages = [f"--- page {i + 1} ---\n{pdf[i].get_textpage().get_text_range().strip()}" for i in range(len(pdf))]
        images = []
        for i in range(min(len(pdf), PDF_PAGE_IMAGES)):
            w, h = pdf[i].get_size()
            images.append(jpeg(pdf[i].render(scale=PDF_RENDER_LONG / max(w, h)).to_pil()))
        return "\n".join(pages), len(pdf), images
    finally:
        pdf.close()


def read_document(url: str) -> tuple[str, int, list[dict]]:
    path = view_path(url)
    ext = path.lower().rsplit(".", 1)[-1]
    if ext == "pdf":
        return _pdf(path)
    if ext == "docx":
        return _docx_text(path), 0, []
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read(), 0, []


def document_line(name: str, url: str, text: str, pages: int, images: int) -> str:
    size = f", {pages} pages" if pages else ""
    shown = f"; the first {images} page images are attached" if images else ""
    cut = len(text) > DOC_CHAR_CAP
    body = text[:DOC_CHAR_CAP] + ("\n[… text cut off here]" if cut else "")
    return f'[Attached document "{name}"{size} — {url}{shown}. Its text:]\n{body.strip() or "(no text found)"}\n[End of "{name}"]'
