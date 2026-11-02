import asyncio

from aiohttp import web

from ..bot import BotEvent, TurnHandle, TurnRequest, get_provider, list_providers
from ._common import error, json_body, routes
from .bot_media import ATTACH_MAX_COUNT, MEDIA_ERRORS, render_attachment
from .bot_turns import provider_model
from .settings import bot_disabled, bot_enabled, get_setting


async def default_provider():
    saved = get_provider(str(get_setting("bot-provider")))
    if saved is not None and (await saved.probe()).available:
        return saved
    for provider in list_providers():
        if (await provider.probe()).available:
            return provider
    return None


@routes.post("/comfyart/bot/complete")
async def bot_complete(request: web.Request) -> web.Response:
    if not bot_enabled():
        return bot_disabled()
    body = await json_body(request)
    text = str(body.get("text") or "").strip()
    system = str(body.get("system") or "").strip()
    images = body.get("images") or []
    if not text or not isinstance(images, list):
        return error("text and an images list are required", 400)
    provider = await default_provider()
    if provider is None:
        return error("no agent is available; set one up in Agent settings", 400)
    if images and not provider.capabilities().attachments:
        return error(f"{provider.label} cannot read images; pick another default agent in Agent settings", 400)
    try:
        attachments = [await asyncio.to_thread(render_attachment, str(u)) for u in images[:ATTACH_MAX_COUNT]]
    except MEDIA_ERRORS as e:
        return error(str(e), 400)
    parts: list[str] = []

    async def emit(ev: BotEvent) -> None:
        if ev.t == "delta":
            parts.append(ev.text)

    result = await provider.send(TurnRequest(
        chat_id="complete",
        user_text=f"{system}\n\n{text}" if system else text,
        attachments=attachments,
        model=provider_model(provider.id),
    ), emit, TurnHandle())
    if result.error:
        return error(f"{provider.label}: {result.error}", 502)
    return web.json_response({"text": "".join(parts), "provider": provider.id})
