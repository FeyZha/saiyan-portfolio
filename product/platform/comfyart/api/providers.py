from ..bot import CodexCodeProvider, register_provider
from ._common import app_path

register_provider(CodexCodeProvider(home_dir=app_path("bot-home-codex")))
