"""User-owned AI conversation storage."""

from __future__ import annotations

from typing import Any


def _as_dict(row: Any) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


class ConversationRepository:
    """Persist conversations and messages with explicit per-user scoping."""

    def __init__(self, conn: Any):
        self.conn = conn

    def create(self, user_id: str, title: str = "New chat") -> dict[str, Any]:
        row = self.conn.execute(
            """
            INSERT INTO ai_conversations (user_id, title)
            VALUES (?, ?)
            RETURNING id, user_id, title, summary, created_at, updated_at
            """,
            (user_id, title.strip() or "New chat"),
        ).fetchone()
        self.conn.commit()
        result = _as_dict(row)
        if result is None:
            raise RuntimeError("Conversation could not be created")
        return result

    def list_for_user(self, user_id: str, limit: int = 100) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            """
            SELECT
                c.id,
                c.title,
                c.summary,
                c.created_at,
                c.updated_at,
                (
                    SELECT m.content
                    FROM ai_messages AS m
                    WHERE m.conversation_id = c.id AND m.user_id = c.user_id
                    ORDER BY m.id DESC
                    LIMIT 1
                ) AS last_message
            FROM ai_conversations AS c
            WHERE c.user_id = ?
            ORDER BY c.updated_at DESC, c.id DESC
            LIMIT ?
            """,
            (user_id, max(1, min(limit, 100))),
        ).fetchall()
        return [dict(row) for row in rows]

    def get(self, user_id: str, conversation_id: int) -> dict[str, Any] | None:
        row = self.conn.execute(
            """
            SELECT id, user_id, title, summary, created_at, updated_at
            FROM ai_conversations
            WHERE id = ? AND user_id = ?
            """,
            (conversation_id, user_id),
        ).fetchone()
        return _as_dict(row)

    def messages(
        self,
        user_id: str,
        conversation_id: int,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            """
            SELECT id, conversation_id, role, content, metadata, created_at
            FROM (
                SELECT id, conversation_id, role, content, metadata, created_at
                FROM ai_messages
                WHERE conversation_id = ? AND user_id = ?
                ORDER BY id DESC
                LIMIT ?
            ) AS recent
            ORDER BY id ASC
            """,
            (conversation_id, user_id, max(1, min(limit, 100))),
        ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            metadata = item.get("metadata")
            if isinstance(metadata, str):
                import json

                try:
                    item["metadata"] = json.loads(metadata)
                except ValueError:
                    item["metadata"] = {}
            result.append(item)
        return result

    def add_message(
        self,
        user_id: str,
        conversation_id: int,
        role: str,
        content: str,
        *,
        title_from_first_message: bool = False,
    ) -> dict[str, Any]:
        row = self.conn.execute(
            """
            INSERT INTO ai_messages (conversation_id, user_id, role, content)
            SELECT id, user_id, ?, ?
            FROM ai_conversations
            WHERE id = ? AND user_id = ?
            RETURNING id, conversation_id, role, content, metadata, created_at
            """,
            (role, content, conversation_id, user_id),
        ).fetchone()
        if row is None:
            self.conn.rollback()
            raise LookupError("Conversation not found")
        if title_from_first_message and role == "user":
            title = " ".join(content.split())[:72]
            if len(" ".join(content.split())) > 72:
                title = title.rstrip() + "…"
            self.conn.execute(
                """
                UPDATE ai_conversations
                SET title = CASE WHEN title = 'New chat' THEN ? ELSE title END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND user_id = ?
                """,
                (title or "New chat", conversation_id, user_id),
            )
        else:
            self.conn.execute(
                """
                UPDATE ai_conversations
                SET updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND user_id = ?
                """,
                (conversation_id, user_id),
            )
        self.conn.commit()
        return _as_dict(row) or {}

    def rename(
        self,
        user_id: str,
        conversation_id: int,
        title: str,
    ) -> dict[str, Any] | None:
        self.conn.execute(
            """
            UPDATE ai_conversations
            SET title = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
            """,
            (title.strip(), conversation_id, user_id),
        )
        self.conn.commit()
        return self.get(user_id, conversation_id)

    def delete(self, user_id: str, conversation_id: int) -> bool:
        cursor = self.conn.execute(
            "DELETE FROM ai_conversations WHERE id = ? AND user_id = ?",
            (conversation_id, user_id),
        )
        self.conn.commit()
        return cursor.rowcount > 0
