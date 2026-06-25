"""Plan-based room capacity for collab sessions.

The board's owner pays for the room. Their plan sets the maximum
number of WebSocket clients allowed in the room at one time. See
sharing-archi.md §6.6 for rationale.

| Plan  | Max actors per board |
| ----- | -------------------- |
| free  |                    5 |
| plus  |                   20 |

The cap counts ALL real WS clients — owner, members, viewers, and any
extra tabs the same user opens. The agent does NOT count: it uses
`AgentBoardBridge` to broadcast without holding a `Client` slot in
`room.clients`.
"""

import logging

from typing import Final

from topix.datatypes.user_billing import effective_plan
from topix.store.graph import GraphStore
from topix.store.user_billing import UserBillingStore

logger = logging.getLogger(__name__)


_ROOM_CAPS: Final[dict[str, int]] = {
    "free": 5,
    "plus": 20,
}

DEFAULT_PLAN: Final[str] = "free"
DEFAULT_CAP: Final[int] = _ROOM_CAPS[DEFAULT_PLAN]


def cap_for_plan(plan: str | None) -> int:
    """Return the capacity for `plan`, falling back to the free-tier cap."""
    if plan is None:
        return DEFAULT_CAP
    return _ROOM_CAPS.get(plan, DEFAULT_CAP)


async def get_room_cap_for_board(
    *,
    graph_store: GraphStore,
    user_billing_store: UserBillingStore,
    board_uid: str,
) -> int:
    """Look up the owner's plan and return the corresponding cap.

    - Board without an owner row → conservative default (free cap).
    - Owner without a `user_billing` row → free cap (they haven't paid).
    """
    owner_uid = await graph_store.get_owner_uid(board_uid)
    if owner_uid is None:
        logger.warning("collab capacity: board %s has no owner; using default cap", board_uid)
        return DEFAULT_CAP
    billing = await user_billing_store.get_user_billing(owner_uid)
    # Gate on status so a never-paid (`incomplete`) subscription does not grant
    # the paid room capacity.
    plan = effective_plan(billing.plan, billing.status) if billing else DEFAULT_PLAN
    return cap_for_plan(plan)
