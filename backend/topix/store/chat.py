"""Chat Store Module."""

from typing import Literal

import asyncpg

from topix.datatypes.chat.chat import Chat, Message
from topix.store.postgres.chat import (
    _dangerous_hard_delete_chat_by_uid,
    create_chat,
    delete_chat_by_uid,
    get_chat_by_uid,
    list_chats_by_user_uid,
    update_chat_by_uid,
)
from topix.store.postgres.chat_transcript import (
    list_transcripts_by_board as _list_transcripts_by_board,
)
from topix.store.postgres.chat_transcript import (
    upsert_transcript as _upsert_transcript,
)
from topix.store.postgres.pool import create_pool
from topix.store.qdrant.store import ContentStore


class ChatStore:
    """Store for chat messages."""

    def __init__(self):
        """Initialize the chat store."""
        self._pg_pool: asyncpg.Pool | None = None
        self._owns_pool = False
        self._content_store = ContentStore.from_config()

    async def open(self, pool: asyncpg.Pool | None = None):
        """Open the store. Pass a shared pool, or omit to create a private one."""
        if pool is None:
            self._pg_pool = await create_pool()
            self._owns_pool = True
        else:
            self._pg_pool = pool
            self._owns_pool = False

    async def create_chat(self, chat: Chat):
        """Create a new chat."""
        async with self._pg_pool.acquire() as conn:
            await create_chat(conn, chat)

    async def get_chat(self, chat_uid: str) -> Chat | None:
        """Retrieve a chat by its UID."""
        async with self._pg_pool.acquire() as conn:
            return await get_chat_by_uid(conn, chat_uid)

    async def update_chat(self, chat_uid: str, data: dict):
        """Update a chat's information."""
        async with self._pg_pool.acquire() as conn:
            await update_chat_by_uid(conn, chat_uid, data)

    async def delete_chat(self, chat_uid: str, hard_delete: bool = False):
        """Delete a chat by its UID."""
        async with self._pg_pool.acquire() as conn:
            if hard_delete:
                await _dangerous_hard_delete_chat_by_uid(conn, chat_uid)
            else:
                await delete_chat_by_uid(conn, chat_uid)

        # delete associated messages in Qdrant
        await self._content_store.delete_by_filters(
            filters={
                "must": [
                    {
                        "key": "type",
                        "match": {"value": "message"}
                    },
                    {
                        "key": "chat_uid",
                        "match": {"value": chat_uid}
                    }
                ]
            },
            hard_delete=hard_delete
        )

    async def list_chats(
        self,
        user_uid: str,
        graph_uid: str | Literal["none", "any"] | None = None,
        offset: int = 0,
        limit: int = 100
    ) -> list[Chat]:
        """List all chats for a user.

        Args:
            user_uid: str - User UID to filter chats.
            graph_uid: str | Literal["none", "any"] | None - Optional Graph UID to filter chats.
                "none" filters for chats without a graph; "any" for chats with any graph attached.
            offset: int - Pagination offset.
            limit: int - Pagination limit.

        Returns:
            List[Chat]: List of Chat objects.

        """
        async with self._pg_pool.acquire() as conn:
            return await list_chats_by_user_uid(conn, user_uid, graph_uid, offset, limit)

    async def add_messages(self, chat_uid: str, messages: list[dict | Message]):
        """Add messages to the chat store."""
        for msg in messages:
            if isinstance(msg, Message):
                msg.chat_uid = chat_uid
            else:
                msg["chat_uid"] = chat_uid

        def _convert(msg: dict | Message) -> Message:
            if isinstance(msg, Message):
                return msg
            return Message(**msg)

        chat_messages = [_convert(msg) for msg in messages]
        await self._content_store.add(chat_messages)

    async def update_message(self, message_id: str, data: dict):
        """Update a message in the chat store."""
        data["id"] = message_id
        await self._content_store.update([data])

    async def get_messages(self, chat_uid: str, limit: int = 100) -> list[Message]:
        """Get latest messages for a specific chat."""
        message_results = await self._content_store.filt(
            filters={
                "must": [
                    {
                        "key": "type",
                        "match": {"value": "message"}
                    },
                    {
                        "key": "chat_uid",
                        "match": {"value": chat_uid}
                    }
                ]
            },
            include=True,
            limit=limit
        )
        messages = [result.resource for result in message_results]
        return messages[::-1]  # Reverse order to get latest messages first

    async def pop_message(self, chat_uid: str) -> Message | None:
        """Pop the last message from a chat."""
        messages = await self.get_messages(chat_uid, limit=1)
        if not messages:
            return None
        await self._content_store.delete([messages[0].id])
        return messages[0]

    async def upsert_transcript(
        self,
        chat_uid: str,
        user_uid: str,
        board_id: str | None,
        label: str | None,
        transcript: list,
    ):
        """Store a browser-agent chat transcript verbatim (opaque client JSON).

        Owner-scoped by ``user_uid``; overwrites any prior transcript for this
        chat. No Qdrant/embedding — this is backup + cross-device seed only.
        """
        async with self._pg_pool.acquire() as conn:
            await _upsert_transcript(conn, chat_uid, user_uid, board_id, label, transcript)

    async def list_transcripts_by_board(self, user_uid: str, board_id: str) -> list[dict]:
        """List this user's browser-agent transcripts for a board (seed source)."""
        async with self._pg_pool.acquire() as conn:
            return await _list_transcripts_by_board(conn, user_uid, board_id)

    async def close(self):
        """Close the store. Only closes the pool if this store created it."""
        if self._pg_pool and self._owns_pool:
            await self._pg_pool.close()
        await self._content_store.close()
