import asyncio
import hashlib
import json
import logging
import os
import re
import uuid
from urllib.parse import quote, urlencode

import aiohttp
import folder_paths
from aiohttp import web
from comfy.cli_args import args
from server import PromptServer

from ._common import app_path, bad_request, error, json_body, read_json, routes, write_json
from .cloud import ANNOTATED

PROBE = aiohttp.ClientTimeout(total=5, sock_connect=1)
TRANSFER = aiohttp.ClientTimeout(total=None, sock_connect=5, sock_read=120)
RELAY_S = 3600
PREFIX = "srv:"

_dispatch = asyncio.Lock()
_relays: set[asyncio.Task] = set()


def _fail(cls: type[web.HTTPException], message: str) -> web.HTTPException:
    return cls(text=json.dumps({"error": {"message": message}}), content_type="application/json")


def _file() -> str:
    return app_path("instances.json")


def list_instances() -> list[dict]:
    return read_json(_file(), [])


def _instance(iid: str) -> dict:
    found = next((i for i in list_instances() if i["id"] == iid), None)
    if found is None:
        raise _fail(web.HTTPNotFound, f"LAN instance {iid} is no longer registered")
    return found


def _local() -> dict:
    server = PromptServer.instance
    host = "127.0.0.1" if server.address in ("0.0.0.0", "::", "") else server.address
    scheme = "https" if args.tls_keyfile and args.tls_certfile else "http"
    return {"id": "local", "label": "local", "host": host, "port": server.port, "scheme": scheme}


def _base(inst: dict) -> str:
    host = f"[{inst['host']}]" if ":" in inst["host"] else inst["host"]
    return f"{inst.get('scheme', 'http')}://{host}:{inst['port']}"


def _session(timeout: aiohttp.ClientTimeout) -> aiohttp.ClientSession:
    return aiohttp.ClientSession(timeout=timeout, connector=aiohttp.TCPConnector(ssl=False))


def _fields(body: dict, base: dict) -> dict:
    host = str(body.get("host", base.get("host", ""))).strip()
    if not host:
        raise bad_request("host is required")
    try:
        port = int(body.get("port", base.get("port", 8188)))
    except (TypeError, ValueError):
        raise bad_request("port must be an integer")
    label = str(body.get("label") or base.get("label") or host).strip()
    return {**base, "label": label, "host": host, "port": port, "enabled": bool(body.get("enabled", base.get("enabled", True)))}


@routes.get("/comfyart/instances")
async def get_instances(_request: web.Request) -> web.Response:
    return web.json_response({"instances": list_instances()})


@routes.post("/comfyart/instances")
async def add_instance(request: web.Request) -> web.Response:
    item = _fields(await json_body(request), {"id": uuid.uuid4().hex[:8]})
    write_json(_file(), [*list_instances(), item])
    return web.json_response({"instance": item})


@routes.patch("/comfyart/instances/{iid}")
async def edit_instance(request: web.Request) -> web.Response:
    item = _fields(await json_body(request), _instance(request.match_info["iid"]))
    write_json(_file(), [item if i["id"] == item["id"] else i for i in list_instances()])
    return web.json_response({"instance": item})


@routes.delete("/comfyart/instances/{iid}")
async def delete_instance(request: web.Request) -> web.Response:
    iid = request.match_info["iid"]
    items = list_instances()
    if not any(i["id"] == iid for i in items):
        return error(f"LAN instance {iid} not found", 404)
    write_json(_file(), [i for i in items if i["id"] != iid])
    return web.json_response({"ok": True})


async def _load(session: aiohttp.ClientSession, inst: dict) -> int:
    async with session.get(f"{_base(inst)}/queue") as res:
        res.raise_for_status()
        queue = await res.json()
    return len(queue.get("queue_running") or []) + len(queue.get("queue_pending") or [])


async def _status(session: aiohttp.ClientSession, inst: dict) -> dict:
    try:
        load = await _load(session, inst)
        async with session.get(f"{_base(inst)}/models/diffusion_models") as res:
            models = await res.json() if res.ok else []
    except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as e:
        return {"id": inst["id"], "online": False, "error": str(e) or type(e).__name__}
    return {"id": inst["id"], "online": True, "queue": load, "models": [m.replace("\\", "/").rsplit("/", 1)[-1] for m in models]}


@routes.get("/comfyart/instances/status")
async def instances_status(_request: web.Request) -> web.Response:
    async with _session(PROBE) as session:
        statuses = await asyncio.gather(*(_status(session, i) for i in list_instances() if i["enabled"]))
    return web.json_response({"statuses": statuses})


def _options(spec) -> list | None:
    if isinstance(spec, list) and spec:
        if isinstance(spec[0], list):
            return spec[0]
        if spec[0] == "COMBO" and len(spec) > 1 and isinstance(spec[1], dict):
            return spec[1].get("options")
    return None


async def _node_info(session: aiohttp.ClientSession, inst: dict, graph: dict) -> dict:
    classes = sorted({n["class_type"] for n in graph.values()})

    async def one(class_type: str):
        async with session.get(f"{_base(inst)}/object_info/{quote(class_type)}") as res:
            return (await res.json()).get(class_type) if res.ok else None

    found = await asyncio.gather(*(one(c) for c in classes))
    return {c: info for c, info in zip(classes, found) if info}


def _fit(graph: dict, info: dict) -> tuple[dict, list[str]]:
    out: dict = {}
    missing: list[str] = []
    for node_id, node in graph.items():
        spec = info.get(node["class_type"])
        if spec is None:
            missing.append(node["class_type"])
            out[node_id] = node
            continue
        specs = {**spec["input"].get("required", {}), **spec["input"].get("optional", {})}
        inputs = {}
        for name, value in node["inputs"].items():
            options = _options(specs.get(name))
            if isinstance(value, str) and options is not None and value not in options and not ANNOTATED.match(value):
                match = next((o for o in options if isinstance(o, str) and o.replace("\\", "/").rsplit("/", 1)[-1] == value), None)
                if match is None:
                    missing.append(value)
                else:
                    value = match
            inputs[name] = value
        out[node_id] = {**node, "inputs": inputs}
    return out, missing


async def _candidate(session: aiohttp.ClientSession, inst: dict, graph: dict):
    try:
        load = await _load(session, inst)
        fitted, missing = _fit(graph, await _node_info(session, inst, graph))
    except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as e:
        logging.info("[ComfyArt] skipping %s for dispatch: %s", inst["label"], e)
        return None
    return load, inst, fitted, missing


async def _pick(graph: dict) -> tuple[dict, dict]:
    targets = [_local(), *(i for i in list_instances() if i["enabled"])]
    async with _session(PROBE) as session:
        found = [c for c in await asyncio.gather(*(_candidate(session, t, graph) for t in targets)) if c]
    fits = [c for c in found if not c[3]]
    if fits:
        _, inst, fitted, _ = min(fits, key=lambda c: c[0])
        return inst, fitted
    local = next((c for c in found if c[1]["id"] == "local"), None)
    if local is None:
        raise _fail(web.HTTPBadGateway, "no ComfyUI instance is reachable")
    return local[1], local[2]


def _upload_name(path: str) -> str:
    stat = os.stat(path)
    digest = hashlib.sha1(f"{path}:{stat.st_mtime_ns}:{stat.st_size}".encode()).hexdigest()[:12]
    return f"{digest}-{os.path.basename(path)}"


async def _upload_inputs(session: aiohttp.ClientSession, inst: dict, graph: dict) -> None:
    uploaded: dict[str, str] = {}
    for node in graph.values():
        for name, value in node["inputs"].items():
            if not isinstance(value, str) or not ANNOTATED.match(value):
                continue
            path = folder_paths.get_annotated_filepath(value)
            if value not in uploaded and os.path.isfile(path):
                form = aiohttp.FormData()
                form.add_field("subfolder", "comfyart")
                form.add_field("type", "input")
                form.add_field("overwrite", "true")
                with open(path, "rb") as f:
                    form.add_field("image", f, filename=_upload_name(path), content_type="application/octet-stream")
                    async with session.post(f"{_base(inst)}/upload/image", data=form) as res:
                        if res.status != 200:
                            raise _fail(web.HTTPBadGateway, f"uploading {os.path.basename(path)} to {inst['label']} failed: {res.status}")
                        info = await res.json()
                uploaded[value] = f"{info.get('subfolder') or 'comfyart'}/{info['name']} [input]"
            node["inputs"][name] = uploaded.get(value, value)


async def _forward_progress(ws: aiohttp.ClientWebSocketResponse, inst: dict, remote: asyncio.Future) -> None:
    remote_id = await remote
    prompt_id = f"{PREFIX}{inst['id']}:{remote_id}"
    async for msg in ws:
        if msg.type != aiohttp.WSMsgType.TEXT:
            continue
        event = json.loads(msg.data)
        data = event.get("data")
        if not isinstance(data, dict) or data.get("prompt_id") != remote_id:
            continue
        if event.get("type") == "progress":
            PromptServer.instance.send_sync("progress", {"prompt_id": prompt_id, "value": data.get("value", 0), "max": data.get("max", 0)})
        elif event.get("type") in ("execution_success", "execution_error", "execution_interrupted"):
            return


async def _relay(inst: dict, client_id: str, connected: asyncio.Future, remote: asyncio.Future) -> None:
    async with _session(TRANSFER) as session:
        try:
            ws = await session.ws_connect(f"{_base(inst).replace('http', 'ws', 1)}/ws?clientId={client_id}", heartbeat=30)
        except aiohttp.ClientError as e:
            logging.info("[ComfyArt] no progress from %s: %s", inst["label"], e)
            return
        finally:
            connected.set_result(None)
        async with ws:
            try:
                await asyncio.wait_for(_forward_progress(ws, inst, remote), RELAY_S)
            except asyncio.TimeoutError:
                pass


async def _submit_remote(inst: dict, graph: dict) -> web.Response:
    client_id = f"comfyart-{uuid.uuid4().hex[:12]}"
    loop = asyncio.get_running_loop()
    connected, remote = loop.create_future(), loop.create_future()
    relay = asyncio.create_task(_relay(inst, client_id, connected, remote))
    _relays.add(relay)
    relay.add_done_callback(_relays.discard)
    try:
        async with _session(TRANSFER) as session:
            await _upload_inputs(session, inst, graph)
            await connected
            async with session.post(f"{_base(inst)}/prompt", json={"prompt": graph, "client_id": client_id}) as res:
                body = await res.json(content_type=None)
    except aiohttp.ClientError as e:
        relay.cancel()
        raise _fail(web.HTTPBadGateway, f"cannot reach {inst['label']} ({inst['host']}:{inst['port']}): {e}")
    except BaseException:
        relay.cancel()
        raise
    if res.status >= 400:
        relay.cancel()
        return web.json_response(body, status=res.status)
    remote.set_result(body["prompt_id"])
    return web.json_response({"prompt_id": f"{PREFIX}{inst['id']}:{body['prompt_id']}", "instance": inst["label"]})


async def _submit_local(inst: dict, graph: dict, client_id: str, user: str | None) -> web.Response:
    headers = {"Comfy-User": user} if user else {}
    async with _session(TRANSFER) as session:
        async with session.post(f"{_base(inst)}/prompt", json={"prompt": graph, "client_id": client_id}, headers=headers) as res:
            body = await res.json(content_type=None)
    if res.status >= 400:
        return web.json_response(body, status=res.status)
    return web.json_response({"prompt_id": body["prompt_id"], "instance": inst["label"]})


@routes.post("/comfyart/remote/prompt")
async def remote_prompt(request: web.Request) -> web.Response:
    body = await json_body(request)
    graph = body.get("prompt")
    if not isinstance(graph, dict):
        return error("prompt must be an object", 400)
    target = str(body.get("target") or "auto")
    async with _dispatch:
        if target == "auto":
            inst, fitted = await _pick(graph)
        else:
            inst = _instance(target)
            try:
                async with _session(PROBE) as session:
                    fitted, _ = _fit(graph, await _node_info(session, inst, graph))
            except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                raise _fail(web.HTTPBadGateway, f"cannot reach {inst['label']} ({inst['host']}:{inst['port']}): {e}")
        if inst["id"] == "local":
            return await _submit_local(inst, fitted, str(body.get("client_id") or ""), request.headers.get("Comfy-User"))
        return await _submit_remote(inst, fitted)


def _slug(text: str) -> str:
    return re.sub(r"[^\w.-]+", "_", text).strip("_") or "lan"


async def _download(session: aiohttp.ClientSession, inst: dict, remote_id: str, item: dict) -> dict:
    kind = item.get("type") if item.get("type") in ("output", "temp") else "output"
    subfolder = item.get("subfolder", "")
    stem, ext = os.path.splitext(os.path.basename(item["filename"]))
    filename = f"{stem.rstrip('_')}_{_slug(inst['label'])}-{remote_id[:8]}{ext}"
    root = os.path.abspath(folder_paths.get_directory_by_type(kind))
    path = os.path.abspath(os.path.join(root, subfolder, filename))
    if os.path.commonpath([root, path]) != root:
        raise _fail(web.HTTPBadGateway, f"unexpected output path {item['filename']}")
    if not os.path.isfile(path):
        query = urlencode({"filename": item["filename"], "subfolder": subfolder, "type": item.get("type", "output")})
        async with session.get(f"{_base(inst)}/view?{query}") as res:
            res.raise_for_status()
            data = await res.read()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path + ".part", "wb") as f:
            f.write(data)
        os.replace(path + ".part", path)
    return {**item, "filename": filename, "subfolder": subfolder, "type": kind}


def _queued(queue: dict, remote_id: str) -> bool:
    return any(len(e) > 1 and e[1] == remote_id for e in (queue.get("queue_running") or []) + (queue.get("queue_pending") or []))


@routes.get("/comfyart/remote/history/{iid}/{pid}")
async def remote_history(request: web.Request) -> web.Response:
    inst = _instance(request.match_info["iid"])
    remote_id = request.match_info["pid"]
    prompt_id = f"{PREFIX}{inst['id']}:{remote_id}"
    try:
        async with _session(TRANSFER) as session:
            async with session.get(f"{_base(inst)}/history/{remote_id}") as res:
                entry = (await res.json()).get(remote_id)
            if entry is None:
                async with session.get(f"{_base(inst)}/queue") as res:
                    queue = await res.json()
                if not _queued(queue, remote_id):
                    return web.json_response({})
                return web.json_response({prompt_id: {"status": {"completed": False, "status_str": "running", "messages": []}, "outputs": {}}})
            outputs: dict = {}
            for node_id, out in (entry.get("outputs") or {}).items():
                outputs[node_id] = {}
                for key, items in out.items():
                    if isinstance(items, list):
                        items = [await _download(session, inst, remote_id, it) if isinstance(it, dict) and "filename" in it else it for it in items]
                    outputs[node_id][key] = items
    except aiohttp.ClientError as e:
        raise _fail(web.HTTPBadGateway, f"cannot reach {inst['label']} ({inst['host']}:{inst['port']}): {e}")
    return web.json_response({prompt_id: {**entry, "outputs": outputs}})


@routes.post("/comfyart/remote/cancel/{iid}/{pid}")
async def remote_cancel(request: web.Request) -> web.Response:
    inst = _instance(request.match_info["iid"])
    remote_id = request.match_info["pid"]
    async with _session(PROBE) as session:
        async with session.get(f"{_base(inst)}/queue") as res:
            queue = await res.json()
        if any(len(e) > 1 and e[1] == remote_id for e in queue.get("queue_running") or []):
            await session.post(f"{_base(inst)}/interrupt", json={"prompt_id": remote_id})
        elif _queued(queue, remote_id):
            await session.post(f"{_base(inst)}/queue", json={"delete": [remote_id]})
    return web.json_response({})
