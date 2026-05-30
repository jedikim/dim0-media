"""Sharing router.

Share-link mint / list / revoke + accept + preview + member list /
remove (with live kick).
"""

import logging

from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Request, Response

from topix.api.utils.decorators import with_standard_response
from topix.api.utils.security import (
    get_current_user_uid,
    verify_board_owner,
)
from topix.sharing import acceptance, links
from topix.store.graph import GraphStore

logger = logging.getLogger(__name__)


router = APIRouter(
    tags=["sharing"],
    responses={404: {"description": "Not found"}},
)


# ---------------------------------------------------------------------------
# Owner-side endpoints — prefix `/boards/{graph_id}/share-links`
# ---------------------------------------------------------------------------


@router.post("/boards/{graph_id}/share-links/", include_in_schema=False)
@router.post("/boards/{graph_id}/share-links")
@with_standard_response
async def mint_share_link(
    response: Response,
    request: Request,
    graph_id: Annotated[str, Path(description="Graph ID")],
    user_id: Annotated[str, Depends(get_current_user_uid)],
    _: Annotated[None, Depends(verify_board_owner)],
    body: Annotated[
        dict, Body(description="{ role: 'member' | 'viewer' }"),
    ],
):
    """Mint a new share link with the requested role. Owner-only."""
    role = body.get("role")
    if role not in ("member", "viewer"):
        raise HTTPException(status_code=400, detail="role must be 'member' or 'viewer'")

    store: GraphStore = request.app.graph_store
    async with store._pg_pool.acquire() as conn:
        token = await links.mint_link(
            conn, graph_uid=graph_id, role=role, created_by_uid=user_id,
        )
    return {"token": token, "role": role}


@router.get("/boards/{graph_id}/share-links/", include_in_schema=False)
@router.get("/boards/{graph_id}/share-links")
@with_standard_response
async def list_share_links(
    response: Response,
    request: Request,
    graph_id: Annotated[str, Path(description="Graph ID")],
    user_id: Annotated[str, Depends(get_current_user_uid)],
    _: Annotated[None, Depends(verify_board_owner)],
):
    """List active share links for this board (owner-only)."""
    store: GraphStore = request.app.graph_store
    async with store._pg_pool.acquire() as conn:
        rows = await links.list_active_links(conn, graph_uid=graph_id)
    return {"links": rows}


@router.delete("/boards/{graph_id}/share-links/{token}/", include_in_schema=False)
@router.delete("/boards/{graph_id}/share-links/{token}")
@with_standard_response
async def delete_share_link(
    response: Response,
    request: Request,
    graph_id: Annotated[str, Path(description="Graph ID")],
    token: Annotated[str, Path(description="Share link token to revoke")],
    user_id: Annotated[str, Depends(get_current_user_uid)],
    _: Annotated[None, Depends(verify_board_owner)],
):
    """Revoke a single share link. Owner-only. Idempotent."""
    store: GraphStore = request.app.graph_store
    async with store._pg_pool.acquire() as conn:
        revoked = await links.revoke(conn, graph_uid=graph_id, token=token)
    return {"revoked": revoked}


@router.delete("/boards/{graph_id}/share-links/", include_in_schema=False)
@router.delete("/boards/{graph_id}/share-links")
@with_standard_response
async def revoke_all_share_links(
    response: Response,
    request: Request,
    graph_id: Annotated[str, Path(description="Graph ID")],
    user_id: Annotated[str, Depends(get_current_user_uid)],
    _: Annotated[None, Depends(verify_board_owner)],
):
    """Revoke EVERY active share link on this board. Owner-only.

    Used by the "Disable sharing" button in the share dialog. Existing
    memberships are NOT removed — only future accepts are blocked.
    """
    store: GraphStore = request.app.graph_store
    async with store._pg_pool.acquire() as conn:
        count = await links.revoke_all(conn, graph_uid=graph_id)
    return {"revoked_count": count}


# ---------------------------------------------------------------------------
# Recipient-side endpoints — prefix `/share-links/{token}`
# ---------------------------------------------------------------------------


@router.get("/share-links/{token}/preview/", include_in_schema=False)
@router.get("/share-links/{token}/preview")
@with_standard_response
async def preview_share_link(
    response: Response,
    request: Request,
    token: Annotated[str, Path(description="Share link token")],
):
    """Peek at what the link grants without consuming it.

    Intentionally unauthenticated — the landing page renders the
    preview before a sign-up commitment. Returns 404 if the link is
    unknown or revoked.
    """
    store: GraphStore = request.app.graph_store
    async with store._pg_pool.acquire() as conn:
        info = await links.preview(conn, token=token)
    if info is None:
        raise HTTPException(status_code=404, detail="Share link not found or revoked")
    return {"graph_uid": info["graph_uid"], "role": info["role"]}


@router.get("/boards/{graph_id}/members/", include_in_schema=False)
@router.get("/boards/{graph_id}/members")
@with_standard_response
async def list_board_members(
    response: Response,
    request: Request,
    graph_id: Annotated[str, Path(description="Graph ID")],
    user_id: Annotated[str, Depends(get_current_user_uid)],
    _: Annotated[None, Depends(verify_board_owner)],
):
    """Owner-only listing of everyone with access to this board.

    Returns owner first, then members, then viewers, alphabetical by
    email within each group. Used by the share dialog's "People with
    access" panel.
    """
    store: GraphStore = request.app.graph_store
    members = await store.list_members(graph_id)
    return {"members": members}


@router.delete("/boards/{graph_id}/members/{user_uid}/", include_in_schema=False)
@router.delete("/boards/{graph_id}/members/{user_uid}")
@with_standard_response
async def remove_board_member(
    response: Response,
    request: Request,
    graph_id: Annotated[str, Path(description="Graph ID")],
    user_uid: Annotated[str, Path(description="UID of the user to remove")],
    user_id: Annotated[str, Depends(get_current_user_uid)],
    _: Annotated[None, Depends(verify_board_owner)],
):
    """Owner-only: drop a user's access AND kick their live sockets.

    Refuses to remove the owner (400 — "owner cannot be removed").
    For unknown / not-yet-member users, returns 404. On success, drops
    the `graph_user` row, then iterates the room's live clients and
    closes any belonging to that user with `kick { reason:
    "access-revoked" }`.
    """
    store: GraphStore = request.app.graph_store

    # Defensive: the owner cannot be self-removed or removed by another
    # caller (the latter is impossible here since this is owner-only,
    # but the same endpoint will guard if we ever extend it).
    target_role = await store.get_graph_role(graph_uid=graph_id, user_uid=user_uid)
    if target_role == "owner":
        raise HTTPException(
            status_code=400,
            detail="The board owner cannot be removed. Transfer ownership first.",
        )

    removed = await store.remove_member(graph_id, user_uid)
    if removed == 0:
        raise HTTPException(status_code=404, detail="User is not a member of this board")

    # Best-effort live kick — pull the live Room if any, send `kick`
    # to every socket belonging to the removed user.
    registry = request.app.collab_rooms
    room = registry.get(graph_id)
    kicked = 0
    if room is not None:
        kicked = await room.kick_user(user_uid, reason="access-revoked")
        logger.info(
            "share: removed user=%s from board=%s; kicked %d live session(s)",
            user_uid, graph_id, kicked,
        )

    return {"removed": True, "kicked_sessions": kicked}


@router.post("/share-links/{token}/accept/", include_in_schema=False)
@router.post("/share-links/{token}/accept")
@with_standard_response
async def accept_share_link(
    response: Response,
    request: Request,
    token: Annotated[str, Path(description="Share link token")],
    user_id: Annotated[str, Depends(get_current_user_uid)],
):
    """Consume a share link for the signed-in user.

    Idempotent: re-clicking the same link as an existing member is a
    no-op. Returns the board's uid + the user's effective role
    post-accept.
    """
    store: GraphStore = request.app.graph_store
    async with store._pg_pool.acquire() as conn:
        result = await acceptance.accept_link(conn, token=token, user_uid=user_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Share link not found or revoked")
    return result
