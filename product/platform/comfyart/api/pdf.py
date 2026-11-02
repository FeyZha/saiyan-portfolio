import hashlib
import re
from pathlib import Path

import folder_paths
import pypdfium2
from aiohttp import web

from ._common import bad_request, routes

MAX_PAGES = 30
RENDER_LONG = 2048


@routes.post("/comfyart/pdf")
async def render_pdf(request: web.Request) -> web.Response:
    reader = await request.multipart()
    field = await reader.next()
    if field is None or field.name != "file":
        raise bad_request("expected a 'file' field")
    data = bytes(await field.read(decode=False))
    stem = re.sub(r"[^\w\-]+", "_", Path(field.filename or "document.pdf").stem)[:40] or "document"
    limit = min(int(request.query.get("max", MAX_PAGES)), MAX_PAGES)
    try:
        pdf = pypdfium2.PdfDocument(data)
    except pypdfium2.PdfiumError as e:
        raise bad_request(f"not a readable PDF: {e}")
    sub = f"comfyart/pdf/{stem}-{hashlib.sha1(data).hexdigest()[:10]}"
    out = Path(folder_paths.get_input_directory()) / sub
    out.mkdir(parents=True, exist_ok=True)
    pages = []
    try:
        for i in range(min(len(pdf), limit)):
            page = pdf[i]
            w, h = page.get_size()
            image = page.render(scale=RENDER_LONG / max(w, h)).to_pil()
            name = f"page-{i + 1}.png"
            image.save(out / name)
            pages.append({"name": name, "subfolder": sub, "type": "input", "width": image.width, "height": image.height, "text": page.get_textpage().get_text_range()})
    finally:
        pdf.close()
    return web.json_response({"pages": pages, "total": len(pages)})
