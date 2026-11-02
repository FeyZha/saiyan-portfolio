import os

from aiohttp import web
from server import PromptServer

from ._common import routes


@routes.get("/comfyart/userdata/{file}")
async def read_userdata(request: web.Request) -> web.StreamResponse:
    try:
        path = PromptServer.instance.user_manager.get_request_user_filepath(request, request.match_info["file"], create_dir=False)
    except KeyError:
        raise web.HTTPForbidden()
    if path is None:
        raise web.HTTPForbidden()
    if not os.path.isfile(path):
        return web.Response(status=204)
    return web.FileResponse(path, headers={"Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff", "Content-Disposition": "attachment"})
