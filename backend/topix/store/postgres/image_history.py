"""PostgreSQL projections for authenticated global image history."""

from __future__ import annotations

import json

from collections.abc import Mapping
from typing import Any

import asyncpg

from topix.image_generation.history import (
    ImageHistoryAsset,
    ImageHistoryAssetScope,
    ImageHistoryBoard,
    ImageHistoryCursor,
    ImageHistoryMetrics,
    ImageHistoryPage,
    ImageHistoryReference,
    ImageHistoryRun,
    ImageHistorySummary,
    ImageHistorySummaryMetrics,
    ImageHistoryUsage,
    ImageHistoryUser,
    ImageHistoryUserSummary,
    encode_image_history_cursor,
)
from topix.image_generation.models import GenerationStatus, ImageGenerationParameters

_SUMMARY_SQL = """
WITH attempt_totals AS (
    SELECT
        generation_uid,
        COUNT(*)::bigint AS attempt_count,
        COUNT(cost_usd)::bigint AS priced_attempt_count,
        COUNT(*) FILTER (WHERE cost_usd IS NULL)::bigint AS cost_unreported_attempt_count,
        SUM(cost_usd) AS known_cost_usd,
        SUM((usage ->> 'input_units')::bigint) AS input_units,
        SUM((usage ->> 'output_units')::bigint) AS output_units,
        SUM((usage ->> 'total_units')::bigint) AS total_units,
        SUM((usage ->> 'generated_images')::bigint) AS generated_images
    FROM image_generation_attempt
    GROUP BY generation_uid
),
run_rollup AS (
    SELECT
        run.uid,
        run.user_uid,
        run.status,
        users.username,
        users.name,
        attempts.attempt_count,
        attempts.priced_attempt_count,
        attempts.cost_unreported_attempt_count,
        attempts.known_cost_usd,
        attempts.input_units,
        attempts.output_units,
        attempts.total_units,
        attempts.generated_images
    FROM image_generation_run AS run
    JOIN users ON users.uid = run.user_uid
    LEFT JOIN attempt_totals AS attempts ON attempts.generation_uid = run.uid
)
SELECT
    CASE WHEN GROUPING(user_uid) = 1 THEN 'overall' ELSE 'user' END AS scope,
    user_uid,
    username,
    name,
    COUNT(*)::bigint AS generation_count,
    COUNT(*) FILTER (WHERE status = 'succeeded')::bigint AS succeeded_count,
    COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed_count,
    COUNT(*) FILTER (WHERE status IN ('started', 'retryable'))::bigint AS active_count,
    COALESCE(SUM(attempt_count), 0)::bigint AS attempt_count,
    COALESCE(SUM(priced_attempt_count), 0)::bigint AS priced_attempt_count,
    COALESCE(SUM(cost_unreported_attempt_count), 0)::bigint AS cost_unreported_attempt_count,
    SUM(known_cost_usd) AS known_cost_usd,
    SUM(input_units)::bigint AS input_units,
    SUM(output_units)::bigint AS output_units,
    SUM(total_units)::bigint AS total_units,
    SUM(generated_images)::bigint AS generated_images
FROM run_rollup
GROUP BY GROUPING SETS ((), (user_uid, username, name))
ORDER BY GROUPING(user_uid) DESC, username ASC, user_uid ASC
"""

_ATTEMPT_AGGREGATES_SQL = """
SELECT
    generation_uid,
    COUNT(*)::bigint AS attempt_count,
    COUNT(cost_usd)::bigint AS priced_attempt_count,
    COUNT(*) FILTER (WHERE cost_usd IS NULL)::bigint AS cost_unreported_attempt_count,
    SUM(cost_usd) AS known_cost_usd,
    SUM((usage ->> 'input_units')::bigint) AS input_units,
    SUM((usage ->> 'output_units')::bigint) AS output_units,
    SUM((usage ->> 'total_units')::bigint) AS total_units,
    SUM((usage ->> 'generated_images')::bigint) AS generated_images,
    (ARRAY_AGG(error_code ORDER BY attempt_number DESC)
        FILTER (WHERE status = 'failed' AND completed_at IS NOT NULL))[1] AS latest_failed_error_code,
    (ARRAY_AGG(error_message ORDER BY attempt_number DESC)
        FILTER (WHERE status = 'failed' AND completed_at IS NOT NULL))[1] AS latest_failed_error_message
FROM image_generation_attempt
WHERE generation_uid = ANY($1::text[])
GROUP BY generation_uid
"""


def _usage(row: Mapping[str, Any]) -> ImageHistoryUsage:
    """Build nullable provider usage totals without inventing zero values."""
    return ImageHistoryUsage(
        input_units=row["input_units"],
        output_units=row["output_units"],
        total_units=row["total_units"],
        generated_images=row["generated_images"],
    )


def _metrics(row: Mapping[str, Any]) -> ImageHistoryMetrics:
    """Build safe attempt metrics from one aggregate row."""
    return ImageHistoryMetrics(
        attempt_count=row["attempt_count"],
        priced_attempt_count=row["priced_attempt_count"],
        cost_unreported_attempt_count=row["cost_unreported_attempt_count"],
        known_cost_usd=row["known_cost_usd"],
        usage=_usage(row),
    )


def _summary_metrics(row: Mapping[str, Any]) -> ImageHistorySummaryMetrics:
    """Build one summary using the same status and attempt aggregation fields."""
    return ImageHistorySummaryMetrics(
        generation_count=row["generation_count"],
        succeeded_count=row["succeeded_count"],
        failed_count=row["failed_count"],
        active_count=row["active_count"],
        **_metrics(row).model_dump(),
    )


async def get_image_history_summary(conn: asyncpg.Connection) -> ImageHistorySummary:
    """Aggregate global and per-user history with shared status definitions."""
    rows = await conn.fetch(_SUMMARY_SQL)
    if not rows:
        empty = ImageHistorySummaryMetrics(
            generation_count=0,
            succeeded_count=0,
            failed_count=0,
            active_count=0,
            attempt_count=0,
            priced_attempt_count=0,
            cost_unreported_attempt_count=0,
            known_cost_usd=None,
            usage=ImageHistoryUsage(),
        )
        return ImageHistorySummary(overall=empty)

    overall: ImageHistorySummaryMetrics | None = None
    users: list[ImageHistoryUserSummary] = []
    for row in rows:
        if row["scope"] == "overall":
            overall = _summary_metrics(row)
            continue
        users.append(
            ImageHistoryUserSummary(
                user=ImageHistoryUser(uid=row["user_uid"], username=row["username"], name=row["name"]),
                metrics=_summary_metrics(row),
            )
        )
    if overall is None:
        raise RuntimeError("Image history summary omitted the overall row")
    return ImageHistorySummary(overall=overall, users=tuple(users))


def _history_page_filter(
    *,
    limit: int,
    cursor: ImageHistoryCursor | None,
    user_uid: str | None,
    status: GenerationStatus | None,
) -> tuple[str, list[object]]:
    """Build a parameterized history WHERE clause and limit arguments."""
    args: list[object] = []
    conditions: list[str] = []
    if user_uid is not None:
        args.append(user_uid)
        conditions.append(f"run.user_uid = ${len(args)}")
    if status is not None:
        args.append(status.value)
        conditions.append(f"run.status = ${len(args)}")
    if cursor is not None:
        args.extend((cursor.started_at, cursor.generation_uid))
        conditions.append(f"(run.started_at, run.uid) < (${len(args) - 1}, ${len(args)})")
    args.append(limit + 1)
    return (f"WHERE {' AND '.join(conditions)}" if conditions else "", args)


async def _history_references(
    conn: asyncpg.Connection,
    generation_uids: list[str],
) -> dict[str, list[ImageHistoryReference]]:
    """Batch ordered reference projections for all runs on one page."""
    rows = await conn.fetch(
        "SELECT reference.generation_uid, reference.ordinal, reference.asset_uid AS uid, "
        "reference.asset_snapshot ->> 'mime_type' AS mime_type, "
        "(reference.asset_snapshot ->> 'width')::integer AS width, "
        "(reference.asset_snapshot ->> 'height')::integer AS height "
        "FROM image_generation_reference AS reference "
        "WHERE reference.generation_uid = ANY($1::text[]) "
        "ORDER BY reference.generation_uid, reference.ordinal",
        generation_uids,
    )
    references: dict[str, list[ImageHistoryReference]] = {uid: [] for uid in generation_uids}
    for row in rows:
        references[row["generation_uid"]].append(
            ImageHistoryReference(
                uid=row["uid"],
                ordinal=row["ordinal"],
                mime_type=row["mime_type"],
                width=row["width"],
                height=row["height"],
            )
        )
    return references


def _history_run(
    row: Mapping[str, Any],
    attempt: Mapping[str, Any],
    references: list[ImageHistoryReference],
) -> ImageHistoryRun:
    """Build one safe history record from batched database projections."""
    parameters = row["parameters"]
    if isinstance(parameters, str):
        parameters = json.loads(parameters)
    error_code = row["run_error_code"] if row["status"] == "failed" else None
    error_message = row["run_error_message"] if row["status"] == "failed" else None
    if row["status"] == "retryable":
        error_code = attempt["latest_failed_error_code"]
        error_message = attempt["latest_failed_error_message"]
    output = None
    if row["output_uid"] is not None:
        output = ImageHistoryAsset(
            uid=row["output_uid"],
            mime_type=row["output_mime_type"],
            width=row["output_width"],
            height=row["output_height"],
        )
    return ImageHistoryRun(
        generation_uid=row["generation_uid"],
        user=ImageHistoryUser(uid=row["user_uid"], username=row["username"], name=row["user_name"]),
        board=ImageHistoryBoard(uid=row["board_uid"], name=row["board_name"], deleted=row["board_deleted"]),
        provider=row["provider"],
        model_id=row["model_id"],
        prompt=row["prompt"],
        parameters=ImageGenerationParameters.model_validate(parameters),
        status=row["status"],
        started_at=row["started_at"],
        completed_at=row["completed_at"],
        metrics=_metrics(attempt),
        error_code=error_code,
        error_message=error_message,
        output=output,
        references=tuple(references),
    )


async def list_image_history(
    conn: asyncpg.Connection,
    *,
    limit: int,
    cursor: ImageHistoryCursor | None,
    user_uid: str | None,
    status: GenerationStatus | None,
) -> ImageHistoryPage:
    """Read one newest-first page plus batched attempts and references."""
    if limit < 1 or limit > 50:
        raise ValueError("image history limit must be between 1 and 50")
    where_sql, args = _history_page_filter(
        limit=limit,
        cursor=cursor,
        user_uid=user_uid,
        status=status,
    )
    rows = await conn.fetch(
        "SELECT run.uid AS generation_uid, run.board_uid, run.user_uid, "
        "users.username, users.name AS user_name, "
        "CASE WHEN graph.deleted_at IS NOT NULL THEN NULL ELSE NULLIF(BTRIM(graph.label), '') END AS board_name, "
        "(graph.deleted_at IS NOT NULL) AS board_deleted, "
        "run.provider, run.model_id, run.prompt, run.parameters, run.status, "
        "run.started_at, run.completed_at, run.error_code AS run_error_code, "
        "run.error_message AS run_error_message, "
        "asset.uid AS output_uid, asset.mime_type AS output_mime_type, "
        "asset.width AS output_width, asset.height AS output_height "
        "FROM image_generation_run AS run "
        "JOIN users ON users.uid = run.user_uid "
        "JOIN graphs AS graph ON graph.uid = run.board_uid "
        "LEFT JOIN image_asset AS asset ON asset.uid = run.output_asset_uid "
        "AND asset.board_uid = run.board_uid "
        f"{where_sql} ORDER BY run.started_at DESC, run.uid DESC LIMIT ${len(args)}",
        *args,
    )
    has_more = len(rows) > limit
    page_rows = rows[:limit]
    if not page_rows:
        return ImageHistoryPage(items=(), next_cursor=None)

    generation_uids = [row["generation_uid"] for row in page_rows]
    attempt_rows = await conn.fetch(_ATTEMPT_AGGREGATES_SQL, generation_uids)
    attempts = {row["generation_uid"]: row for row in attempt_rows}
    references = await _history_references(conn, generation_uids)
    items: list[ImageHistoryRun] = []
    for row in page_rows:
        attempt = attempts.get(row["generation_uid"])
        if attempt is None:
            raise RuntimeError("Image generation history run has no audit attempt")
        items.append(_history_run(row, attempt, references[row["generation_uid"]]))
    next_cursor = None
    if has_more:
        last = page_rows[-1]
        next_cursor = encode_image_history_cursor(last["started_at"], last["generation_uid"])
    return ImageHistoryPage(items=tuple(items), next_cursor=next_cursor)


async def get_image_history_asset_scope(
    conn: asyncpg.Connection,
    *,
    generation_uid: str,
    asset_uid: str,
) -> ImageHistoryAssetScope | None:
    """Authorize an asset only when it is output or an ordered reference of a run."""
    row = await conn.fetchrow(
        "SELECT run.board_uid FROM image_generation_run AS run "
        "JOIN image_asset AS asset ON asset.uid = $2 AND asset.board_uid = run.board_uid "
        "WHERE run.uid = $1 AND (run.output_asset_uid = asset.uid OR EXISTS ("
        "SELECT 1 FROM image_generation_reference AS reference "
        "WHERE reference.generation_uid = run.uid "
        "AND reference.board_uid = run.board_uid AND reference.asset_uid = asset.uid))",
        generation_uid,
        asset_uid,
    )
    return ImageHistoryAssetScope(board_uid=row["board_uid"]) if row is not None else None
