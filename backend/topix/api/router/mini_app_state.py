"""Per-user, per-note state for mini-app widgets.

Wire format:
  * ``GET  /mini-app-state/{note_id}`` → ``{ state: <json> | None }``
  * ``PUT  /mini-app-state/{note_id}`` body ``{ state: <json> }`` → ``200``

The state is whatever JSON the widget passes to ``host.saveState(...)``
in the iframe runtime. Per-user: two viewers of the same note have
independent state rows. See mini-app-archi.md §12.

Access control in v1: auth only. We check the caller has a valid
access token but **do not** verify they have access to the note's
graph — per-user state is naturally private (no cross-user reads),
and resolving note→graph→membership requires a qdrant round-trip
that's not worth the latency for this endpoint. If a malicious user
writes state for a note they shouldn't see, the worst case is an
orphan DB row. Phase 4 hardens this.
"""

from __future__ import annotations

import logging

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.params import Path
from pydantic import BaseModel

from topix.api.utils.decorators import with_standard_response
from topix.api.utils.security import get_current_user_uid
from topix.store.mini_app_state import MiniAppStateStore

logger = logging.getLogger(__name__)


router = APIRouter(
    prefix="/mini-app-state",
    tags=["mini-app"],
    responses={404: {"description": "Not found"}},
)


class PutStateRequest(BaseModel):
    """Body for ``PUT /mini-app-state/{note_id}``."""

    state: Any


@router.get("/{note_id}/", include_in_schema=False)
@router.get("/{note_id}")
@with_standard_response
async def get_mini_app_state(
    response: Response,
    request: Request,
    note_id: Annotated[str, Path(description="Note UID")],
    user_uid: Annotated[str, Depends(get_current_user_uid)],
):
    """Return the saved widget state for ``(note_id, current user)``."""
    store: MiniAppStateStore = request.app.mini_app_state_store
    state = await store.get_state(note_uid=note_id, user_uid=user_uid)
    return {"state": state}


@router.put("/{note_id}/", include_in_schema=False)
@router.put("/{note_id}")
@with_standard_response
async def put_mini_app_state(
    response: Response,
    request: Request,
    note_id: Annotated[str, Path(description="Note UID")],
    payload: PutStateRequest,
    user_uid: Annotated[str, Depends(get_current_user_uid)],
):
    """Upsert the saved widget state for ``(note_id, current user)``."""
    store: MiniAppStateStore = request.app.mini_app_state_store
    await store.save_state(
        note_uid=note_id,
        user_uid=user_uid,
        state=payload.state,
    )
    return None
