import os
import threading
from typing import Optional

from sqlalchemy import (
    Boolean,
    Engine,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    create_engine,
    event,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from ._common import app_path


class Base(DeclarativeBase):
    pass


class Chat(Base):
    __tablename__ = "comfyart_chats"
    __table_args__ = (Index("ix_comfyart_chats_user_project", "user", "project"),)

    id:           Mapped[str] = mapped_column(String, primary_key=True)
    user:         Mapped[str] = mapped_column(String)
    project:      Mapped[str] = mapped_column(String)
    title:        Mapped[str] = mapped_column(String, default="", server_default="")
    provider:     Mapped[str] = mapped_column(String)
    resume_token: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    run_mode:     Mapped[str] = mapped_column(String, default="auto", server_default="auto")
    pinned:       Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    archived:     Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    created_at:   Mapped[float] = mapped_column(Float)
    updated_at:   Mapped[float] = mapped_column(Float)


class Message(Base):
    __tablename__ = "comfyart_messages"
    __table_args__ = (Index("ix_comfyart_messages_chat", "chat_id", "seq"), {"sqlite_autoincrement": True})

    seq:                Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id:                 Mapped[str] = mapped_column(String, unique=True)
    chat_id:            Mapped[str] = mapped_column(String, ForeignKey("comfyart_chats.id", ondelete="CASCADE"))
    parent_id:          Mapped[Optional[str]] = mapped_column(String, nullable=True)
    role:               Mapped[str] = mapped_column(String)
    blocks:             Mapped[str] = mapped_column(Text)
    status:             Mapped[str] = mapped_column(String)
    resume_token_after: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    usage:              Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at:         Mapped[float] = mapped_column(Float)


class Project(Base):
    __tablename__ = "comfyart_projects"

    user:       Mapped[str] = mapped_column(String, primary_key=True)
    id:         Mapped[str] = mapped_column(String, primary_key=True)
    name:       Mapped[str] = mapped_column(String, default="")
    covers:     Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    pinned:     Mapped[bool] = mapped_column(Boolean, default=False)
    snapshot:   Mapped[str] = mapped_column(Text)
    created_at: Mapped[float] = mapped_column(Float)
    updated_at: Mapped[float] = mapped_column(Float)


class ProjectVersion(Base):
    __tablename__ = "comfyart_project_versions"
    __table_args__ = (
        ForeignKeyConstraint(["user", "project"], ["comfyart_projects.user", "comfyart_projects.id"], ondelete="CASCADE"),
        Index("ix_comfyart_project_versions", "user", "project", "time"),
        {"sqlite_autoincrement": True},
    )

    seq:      Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user:     Mapped[str] = mapped_column(String)
    project:  Mapped[str] = mapped_column(String)
    time:     Mapped[int] = mapped_column(Integer)
    count:    Mapped[int] = mapped_column(Integer, default=0)
    snapshot: Mapped[str] = mapped_column(Text)


class Migration(Base):
    __tablename__ = "comfyart_migrations"

    user:    Mapped[str] = mapped_column(String, primary_key=True)
    name:    Mapped[str] = mapped_column(String, primary_key=True)
    done_at: Mapped[float] = mapped_column(Float)


_engines: dict[str, Engine] = {}
_lock = threading.Lock()


def _engine() -> Engine:
    path = app_path("data.db")
    with _lock:
        engine = _engines.get(path)
        if engine is None:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})

            @event.listens_for(engine, "connect")
            def _pragmas(dbapi_conn, _):
                cur = dbapi_conn.cursor()
                cur.execute("PRAGMA journal_mode=WAL")
                cur.execute("PRAGMA foreign_keys=ON")
                cur.close()

            Base.metadata.create_all(engine)
            _engines[path] = engine
        return engine


def session() -> Session:
    return Session(_engine(), expire_on_commit=False)
