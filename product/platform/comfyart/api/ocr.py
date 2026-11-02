import asyncio
from functools import lru_cache

from aiohttp import web
from rapidocr import RapidOCR

from ._common import error, json_body, routes, view_path


@lru_cache(maxsize=1)
def _engine() -> RapidOCR:
    return RapidOCR()


def read_lines(url: str) -> list[dict]:
    result = _engine()(view_path(url))
    if result.boxes is None:
        return []
    return [{"box": [[round(float(x)), round(float(y))] for x, y in box], "text": text, "score": round(float(score), 3)}
            for box, text, score in zip(result.boxes, result.txts, result.scores)]


@routes.post("/comfyart/ocr")
async def ocr(request: web.Request) -> web.Response:
    body = await json_body(request)
    url = body.get("src")
    if not isinstance(url, str) or not url:
        return error("src must be a /api/view URL", 400)
    try:
        lines = await asyncio.to_thread(read_lines, url)
    except (ValueError, OSError) as e:
        return error(str(e), 404)
    return web.json_response({"lines": lines})
