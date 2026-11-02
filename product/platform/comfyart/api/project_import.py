import json
import logging
import os
import re
import threading
import time

import folder_paths

from . import db
from ._common import app_path
from .db import Migration, Project, ProjectVersion
from .project_store import document_of

MIGRATION = "json-projects"
VERSION_FILE = re.compile(r"^(\d+)-(\d+)\.json$")

_done: set[str] = set()
_lock = threading.Lock()
_log = logging.getLogger(__name__)


def _read(path: str) -> tuple[str, dict] | None:
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
        return text, json.loads(text)
    except (OSError, ValueError) as e:
        _log.warning("[ComfyArt] skipping unreadable project file %s: %s", path, e)
        return None


def _import(s, user: str, root: str) -> int:
    projects_dir = os.path.join(root, "projects")
    if not os.path.isdir(projects_dir):
        return 0
    try:
        with open(os.path.join(root, "index.json"), encoding="utf-8") as f:
            index = json.load(f)
    except (OSError, ValueError):
        index = {}
    count = 0
    for file in sorted(os.listdir(projects_dir)):
        if not file.endswith(".json"):
            continue
        project_id = file[:-5]
        path = os.path.join(projects_dir, file)
        read = _read(path)
        if read is None or s.get(Project, (user, project_id)) is not None:
            continue
        snapshot, data = read
        doc = document_of(data) or {}
        meta = index.get(project_id) if isinstance(index.get(project_id), dict) else {}
        updated = meta["updated"] / 1000 if isinstance(meta.get("updated"), (int, float)) else os.path.getmtime(path)
        covers = meta.get("covers")
        s.add(Project(user=user, id=project_id, name=str(meta.get("name") or doc.get("name") or ""),
                      covers=json.dumps(covers, ensure_ascii=False) if isinstance(covers, list) else None,
                      pinned=bool(meta.get("pinned")), snapshot=snapshot, created_at=os.path.getmtime(path), updated_at=updated))
        history = os.path.join(root, "history", project_id)
        for name in sorted(os.listdir(history)) if os.path.isdir(history) else []:
            m = VERSION_FILE.match(name)
            version = _read(os.path.join(history, name)) if m else None
            if version is not None:
                s.add(ProjectVersion(user=user, project=project_id, time=int(m[1]), count=int(m[2]), snapshot=version[0]))
        count += 1
    return count


def ensure_imported(user: str) -> None:
    key = f"{app_path('data.db')}|{user}"
    if key in _done:
        return
    with _lock:
        if key in _done:
            return
        with db.session() as s:
            if s.get(Migration, (user, MIGRATION)) is None:
                root = folder_paths.get_public_user_directory(user)
                count = _import(s, user, os.path.join(root, "comfyart")) if root else 0
                s.add(Migration(user=user, name=MIGRATION, done_at=time.time()))
                s.commit()
                if count:
                    _log.info("[ComfyArt] imported %d projects of user %s from JSON files into the database", count, user)
        _done.add(key)
