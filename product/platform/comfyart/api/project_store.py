import json
import time
from typing import Optional

from sqlalchemy import delete, select

from . import db
from .db import Project, ProjectVersion

KEEP_VERSIONS = 30
DOCUMENT_KEY = "document:document"


def _entry(row: Project) -> dict:
    return {"id": row.id, "name": row.name, "updated": int(row.updated_at * 1000),
            "covers": json.loads(row.covers) if row.covers else None, "pinned": row.pinned}


def document_of(data: dict) -> Optional[dict]:
    doc = data.get("document", {}).get("store", {}).get(DOCUMENT_KEY)
    return doc if isinstance(doc, dict) else None


def _renamed(snapshot: str, name: str) -> str:
    data = json.loads(snapshot)
    doc = document_of(data)
    if doc is None:
        return snapshot
    doc["name"] = name
    return json.dumps(data, ensure_ascii=False)


def list_projects(user: str) -> list[dict]:
    with db.session() as s:
        rows = s.scalars(select(Project).where(Project.user == user).order_by(Project.pinned.desc(), Project.updated_at.desc()))
        return [_entry(r) for r in rows]


def get_snapshot(user: str, project_id: str) -> Optional[str]:
    with db.session() as s:
        row = s.get(Project, (user, project_id))
        return row.snapshot if row else None


def save_project(user: str, project_id: str, snapshot: str, name: str, covers: list[str]) -> dict:
    now = time.time()
    with db.session() as s:
        row = s.get(Project, (user, project_id))
        if row is None:
            row = Project(user=user, id=project_id, pinned=False, created_at=now)
            s.add(row)
        row.snapshot = snapshot
        row.name = name
        row.covers = json.dumps(covers, ensure_ascii=False)
        row.updated_at = now
        s.commit()
        return _entry(row)


def update_project(user: str, project_id: str, *, name: Optional[str] = None, pinned: Optional[bool] = None,
                   covers: Optional[list[str]] = None) -> Optional[dict]:
    with db.session() as s:
        row = s.get(Project, (user, project_id))
        if row is None:
            return None
        if name is not None:
            row.name = name
            row.snapshot = _renamed(row.snapshot, name)
        if pinned is not None:
            row.pinned = pinned
        if covers is not None:
            row.covers = json.dumps(covers, ensure_ascii=False)
        s.commit()
        return _entry(row)


def delete_project(user: str, project_id: str) -> bool:
    with db.session() as s:
        gone = s.execute(delete(Project).where(Project.user == user, Project.id == project_id)).rowcount > 0
        s.commit()
        return gone


def duplicate_project(user: str, project_id: str, new_id: str, name: str) -> Optional[dict]:
    now = time.time()
    with db.session() as s:
        row = s.get(Project, (user, project_id))
        if row is None:
            return None
        copy = Project(user=user, id=new_id, name=name, covers=row.covers, pinned=False,
                       snapshot=_renamed(row.snapshot, name), created_at=now, updated_at=now)
        s.add(copy)
        s.commit()
        return _entry(copy)


def list_versions(user: str, project_id: str) -> list[dict]:
    with db.session() as s:
        rows = s.execute(select(ProjectVersion.time, ProjectVersion.count)
                         .where(ProjectVersion.user == user, ProjectVersion.project == project_id)
                         .order_by(ProjectVersion.time.desc()))
        return [{"time": t, "count": c} for t, c in rows]


def save_version(user: str, project_id: str, snapshot: str, count: int) -> Optional[int]:
    stamp = int(time.time() * 1000)
    with db.session() as s:
        if s.get(Project, (user, project_id)) is None:
            return None
        s.add(ProjectVersion(user=user, project=project_id, time=stamp, count=count, snapshot=snapshot))
        s.flush()
        old = s.scalars(select(ProjectVersion.seq).where(ProjectVersion.user == user, ProjectVersion.project == project_id)
                        .order_by(ProjectVersion.time.desc()).offset(KEEP_VERSIONS)).all()
        if old:
            s.execute(delete(ProjectVersion).where(ProjectVersion.seq.in_(old)))
        s.commit()
        return stamp


def get_version(user: str, project_id: str, stamp: int) -> Optional[str]:
    with db.session() as s:
        return s.scalars(select(ProjectVersion.snapshot).where(
            ProjectVersion.user == user, ProjectVersion.project == project_id, ProjectVersion.time == stamp)).first()
