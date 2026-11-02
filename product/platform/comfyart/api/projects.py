import asyncio
import json

from aiohttp import web

from . import chat_store, project_store
from ._common import bad_request, error, json_body, request_user, routes
from .bot import remove_chat
from .project_import import ensure_imported


async def _user(request: web.Request) -> str:
    user = request_user(request)
    await asyncio.to_thread(ensure_imported, user)
    return user


def _snapshot(body: dict) -> str:
    snapshot = body.get("snapshot")
    if not isinstance(snapshot, dict):
        raise bad_request("snapshot must be an object")
    return json.dumps(snapshot, ensure_ascii=False)


def _strings(value, name: str) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(x, str) for x in value):
        raise bad_request(f"{name} must be an array of strings")
    return value


@routes.get("/comfyart/projects")
async def list_projects(request: web.Request) -> web.Response:
    return web.json_response({"projects": project_store.list_projects(await _user(request))})


@routes.get("/comfyart/projects/{pid}")
async def get_project(request: web.Request) -> web.Response:
    snapshot = project_store.get_snapshot(await _user(request), request.match_info["pid"])
    if snapshot is None:
        return error("project not found", 404)
    return web.Response(text=snapshot, content_type="application/json")


@routes.put("/comfyart/projects/{pid}")
async def save_project(request: web.Request) -> web.Response:
    user = await _user(request)
    body = await json_body(request)
    entry = project_store.save_project(user, request.match_info["pid"], _snapshot(body), str(body.get("name") or ""),
                                       _strings(body.get("covers", []), "covers"))
    return web.json_response(entry)


@routes.patch("/comfyart/projects/{pid}")
async def update_project(request: web.Request) -> web.Response:
    user = await _user(request)
    body = await json_body(request)
    entry = project_store.update_project(
        user, request.match_info["pid"],
        name=str(body["name"]) if "name" in body else None,
        pinned=bool(body["pinned"]) if "pinned" in body else None,
        covers=_strings(body["covers"], "covers") if "covers" in body else None)
    return web.json_response(entry) if entry else error("project not found", 404)


@routes.delete("/comfyart/projects/{pid}")
async def delete_project(request: web.Request) -> web.Response:
    user, pid = await _user(request), request.match_info["pid"]
    project_store.delete_project(user, pid)
    for chat in chat_store.list_chats(user, pid, include_archived=True):
        await remove_chat(chat)
    return web.json_response({"ok": True})


@routes.post("/comfyart/projects/{pid}/duplicate")
async def duplicate_project(request: web.Request) -> web.Response:
    user = await _user(request)
    body = await json_body(request)
    new_id = str(body.get("id") or "")
    if not new_id:
        return error("id required", 400)
    entry = project_store.duplicate_project(user, request.match_info["pid"], new_id, str(body.get("name") or ""))
    return web.json_response(entry) if entry else error("project not found", 404)


@routes.get("/comfyart/projects/{pid}/versions")
async def list_versions(request: web.Request) -> web.Response:
    return web.json_response({"versions": project_store.list_versions(await _user(request), request.match_info["pid"])})


@routes.post("/comfyart/projects/{pid}/versions")
async def save_version(request: web.Request) -> web.Response:
    user = await _user(request)
    body = await json_body(request)
    stamp = project_store.save_version(user, request.match_info["pid"], _snapshot(body), int(body.get("count") or 0))
    return web.json_response({"time": stamp}) if stamp else error("project not found", 404)


@routes.get("/comfyart/projects/{pid}/versions/{time}")
async def get_version(request: web.Request) -> web.Response:
    try:
        stamp = int(request.match_info["time"])
    except ValueError:
        return error("time must be a number", 400)
    snapshot = project_store.get_version(await _user(request), request.match_info["pid"], stamp)
    if snapshot is None:
        return error("version not found", 404)
    return web.Response(text=snapshot, content_type="application/json")
