import contextvars

BOT_CHAT_ID: contextvars.ContextVar[str] = contextvars.ContextVar("comfyart_bot_chat", default="")
PROJECT: contextvars.ContextVar[str] = contextvars.ContextVar("comfyart_project", default="")
