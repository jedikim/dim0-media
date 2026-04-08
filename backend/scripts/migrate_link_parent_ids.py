"""Backfill missing link parent_id values for nested board links.

This migration exists because older links did not store an explicit parent scope,
which makes nested-board reloads ambiguous. It infers parent_id only when at
least one attached endpoint note exists and all attached notes agree on the same
non-null parent within the same graph.

Usage:
    python3 scripts/migrate_link_parent_ids.py --stage local --env-file .env
    python3 scripts/migrate_link_parent_ids.py --stage local --env-file .env --apply
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import re

from qdrant_client.models import FieldCondition, Filter, MatchValue

from topix.datatypes.note.link import Link
from topix.datatypes.note.note import Note
from topix.datatypes.stage import StageEnum
from topix.setup import setup
from topix.store.graph import GraphStore
from topix.utils.logging import logging_config

logger = logging.getLogger(__name__)
RESOURCE_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")


def build_parser() -> argparse.ArgumentParser:
    """Build the CLI parser for the link parent migration script."""
    parser = argparse.ArgumentParser(
        description="Backfill missing link parent_id values from attached note endpoints.",
    )
    parser.add_argument(
        "--stage",
        default=StageEnum.LOCAL,
        choices=list(StageEnum),
        help="The stage to run the migration against.",
    )
    parser.add_argument(
        "--env-file",
        type=str,
        default=".env",
        help="The env filename to load before connecting to services.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Persist the inferred parent_id updates. Defaults to dry-run.",
    )
    return parser


async def load_links(store: GraphStore) -> list[Link]:
    """Load all links from Qdrant for migration analysis."""
    results = await store._content_store.filt(
        filters=Filter(
            must=[
                FieldCondition(key="type", match=MatchValue(value="link")),
            ],
        ),
        limit=1_000_000,
        order_by=None,
    )
    return [result.resource for result in results if isinstance(result.resource, Link)]


async def infer_parent_id(store: GraphStore, link: Link) -> str | object:
    """Infer a link parent_id from its attached endpoint notes.

    Returns:
    - `str` when the parent scope can be determined
    - `SKIP` when the link is ambiguous or cannot be inferred safely

    """
    endpoint_ids = [
        endpoint_id
        for endpoint_id in (link.source, link.target)
        if RESOURCE_ID_PATTERN.fullmatch(endpoint_id)
    ]
    if not endpoint_ids:
        return SKIP

    endpoint_nodes = await store.get_nodes(endpoint_ids)

    candidate_parents: set[str | None] = set()
    for node in endpoint_nodes:
        if not isinstance(node, Note):
            continue
        if node.graph_uid != link.graph_uid:
            continue
        candidate_parents.add(node.parent_id)

    if not candidate_parents:
        return SKIP

    if len(candidate_parents) > 1:
        return SKIP

    inferred_parent_id = next(iter(candidate_parents))
    if inferred_parent_id is None:
        return SKIP

    return inferred_parent_id


SKIP = object()


async def migrate_links(args: argparse.Namespace) -> int:
    """Run the link parent_id migration and return the number of updated links."""
    await setup(stage=args.stage, env_filename=args.env_file)

    store = GraphStore()
    await store.open()

    updated_count = 0
    skipped_count = 0
    missing_count = 0

    try:
        links = await load_links(store)
        logger.info("Loaded %s links for migration review.", len(links))

        for link in links:
            if link.parent_id is not None:
                continue

            inferred_parent_id = await infer_parent_id(store, link)
            if inferred_parent_id is SKIP:
                skipped_count += 1
                logger.info(
                    "Skipping link %s in graph %s because no unambiguous parent scope could be inferred.",
                    link.id,
                    link.graph_uid,
                )
                continue

            missing_count += 1
            logger.info(
                "Inferred parent_id=%s for link %s in graph %s.",
                inferred_parent_id,
                link.id,
                link.graph_uid,
            )

            if not args.apply:
                continue

            await store.update_link(
                link_id=link.id,
                data={
                    "id": link.id,
                    "parent_id": inferred_parent_id,
                },
            )
            updated_count += 1

        logger.info(
            "Migration finished. inferred=%s updated=%s skipped=%s dry_run=%s",
            missing_count,
            updated_count,
            skipped_count,
            not args.apply,
        )
        return updated_count
    finally:
        await store.close()


async def main() -> None:
    """Parse CLI args and run the migration."""
    logging_config()
    args = build_parser().parse_args()
    await migrate_links(args)


if __name__ == "__main__":
    asyncio.run(main())
