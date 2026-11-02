import os

import folder_paths
from aiohttp import web

from ._common import routes


def model_paths() -> dict[str, str]:
    paths: dict[str, str] = {}
    for folder, (_, extensions) in folder_paths.folder_names_and_paths.items():
        if folder_paths.supported_pt_extensions.isdisjoint(extensions):
            continue
        names = folder_paths.get_filename_list(folder)
        root = {n for n in names if os.path.basename(n) == n}
        for name in names:
            base = os.path.basename(name.replace("\\", "/"))
            if base != name and base not in root:
                paths.setdefault(base, name)
    return paths


@routes.get("/comfyart/model-paths")
async def get_model_paths(request: web.Request) -> web.Response:
    return web.json_response(model_paths())
