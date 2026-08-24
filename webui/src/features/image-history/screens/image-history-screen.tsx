import { useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { listImageModels, type ImageModel } from "@/features/board/api/image-generation"
import { useCheckEleInView } from "@/hooks/use-check-ele-in-view"
import { cn } from "@/lib/utils"
import {
  useImageHistoryPages,
  useImageHistorySummary,
  type ImageHistoryItem,
  type ImageHistoryMetrics,
  type ImageHistoryStatus,
  type ImageHistorySummaryMetrics,
} from "../api/image-history"
import { formatKnownCostUsd, imageHistoryUserLabel } from "../format"
import { useHistoryImage } from "../hooks/use-history-image"


const STATUS_OPTIONS: Array<{ value: ImageHistoryStatus | "all", label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "started", label: "started" },
  { value: "retryable", label: "retryable" },
  { value: "succeeded", label: "succeeded" },
  { value: "failed", label: "failed" },
]


/** Render a nullable provider usage value without turning missing into zero. */
function usageValue(value: number | null): string {
  return value === null ? "Not reported" : value.toLocaleString()
}


/** Render a stable local timestamp or a fixed unavailable marker. */
function timestamp(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString()
}


/** Return a compact duration while retaining exact timestamps beside it. */
function duration(startedAt: string, completedAt: string | null): string | null {
  if (!completedAt) return null
  const elapsed = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  if (!Number.isFinite(elapsed) || elapsed < 0) return null
  if (elapsed < 1_000) return `${elapsed}ms`
  return `${(elapsed / 1_000).toFixed(1)}s`
}


/** Distinguish legacy provider defaults from options a model never exposes. */
function generationOption(
  value: string | null | undefined,
  supported: string[] | null | undefined,
): string {
  if (value !== null && value !== undefined) return value
  if (supported === null) return "Unsupported"
  return supported === undefined ? "Not reported" : "Provider default (not recorded)"
}


/** Display known cost and explicitly retain the number of unreported attempts. */
function CostLabel({ metrics }: { metrics: ImageHistoryMetrics }) {
  return (
    <span>
      {formatKnownCostUsd(metrics.known_cost_usd)}
      {metrics.cost_unreported_attempt_count > 0 && (
        <> · cost unreported for {metrics.cost_unreported_attempt_count} {metrics.cost_unreported_attempt_count === 1 ? "attempt" : "attempts"}</>
      )}
    </span>
  )
}


/** Display the four provider-reported usage counters without local summation. */
function UsageLabel({ metrics }: { metrics: ImageHistoryMetrics }) {
  return (
    <span>
      input {usageValue(metrics.usage.input_units)} · output {usageValue(metrics.usage.output_units)} · total {usageValue(metrics.usage.total_units)} · generated images {usageValue(metrics.usage.generated_images)}
    </span>
  )
}


/** Load one history image near the viewport and show a safe placeholder on failure. */
function HistoryThumbnail({
  generationUid,
  assetUid,
  alt,
  className,
}: {
  generationUid: string
  assetUid: string
  alt: string
  className?: string
}) {
  const { ref, inView } = useCheckEleInView<HTMLDivElement>({ once: true, margin: "240px" })
  const { url, failed } = useHistoryImage(generationUid, assetUid, inView)
  return (
    <div ref={ref} className={cn("grid place-items-center overflow-hidden rounded-md border border-border bg-muted/40", className)}>
      {url ? (
        <img src={url} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <span className="px-2 text-center text-[10px] text-muted-foreground">
          {failed ? "Image unavailable" : "Loading image"}
        </span>
      )}
    </div>
  )
}


/** Show the shared global or per-user aggregate definitions. */
function SummaryMetrics({ metrics }: { metrics: ImageHistorySummaryMetrics }) {
  const cells = [
    ["Total generations", metrics.generation_count],
    ["Succeeded", metrics.succeeded_count],
    ["Failed", metrics.failed_count],
    ["In progress", metrics.active_count],
    ["Total attempts", metrics.attempt_count],
    ["Priced attempts", metrics.priced_attempt_count],
  ] as const
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cells.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border/70 bg-muted/20 p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{value.toLocaleString()}</div>
          </div>
        ))}
      </div>
      <div className="space-y-1 text-sm">
        <div><span className="text-muted-foreground">Provider-reported known cost: </span><CostLabel metrics={metrics} /></div>
        <div><span className="text-muted-foreground">Provider-reported usage: </span><UsageLabel metrics={metrics} /></div>
      </div>
    </div>
  )
}


/** Display one immutable read-only generation record. */
function HistoryItemCard({ item, model }: { item: ImageHistoryItem, model: ImageModel | undefined }) {
  const elapsed = duration(item.started_at, item.completed_at)
  const boardName = item.board.deleted ? "Deleted board" : item.board.name || "Untitled board"
  return (
    <Card data-generation-status={item.status}>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{imageHistoryUserLabel(item.user)}</CardTitle>
            <CardDescription title={item.user.uid}>User {item.user.uid.slice(0, 8)} · {boardName}</CardDescription>
          </div>
          <Badge variant={item.status === "failed" ? "destructive" : "outline"}>{item.status}</Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          Started {timestamp(item.started_at)} · Completed {timestamp(item.completed_at)}{elapsed ? ` · ${elapsed}` : ""}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
          {item.output ? (
            <HistoryThumbnail
              generationUid={item.generation_uid}
              assetUid={item.output.asset_uid}
              alt="Generated result"
              className="h-36 w-full"
            />
          ) : (
            <div className="grid h-36 place-items-center rounded-md border border-dashed border-border bg-muted/20 px-4 text-center text-xs text-muted-foreground">
              {item.status} · no result image
            </div>
          )}
          <div className="min-w-0 space-y-3 text-sm">
            <div><span className="text-muted-foreground">Provider: </span>{item.provider}</div>
            <div className="break-all"><span className="text-muted-foreground">Model: </span>{item.model_id}</div>
            <div>
              <span className="text-muted-foreground">Options: </span>
              Aspect ratio {generationOption(item.parameters.aspect_ratio, model?.supported_aspect_ratios)} · Resolution {generationOption(item.parameters.resolution, model?.supported_resolutions)} · Quality {generationOption(item.parameters.quality, model?.supported_qualities)} · Outputs {item.parameters.output_count ?? 1}
            </div>
            <div><span className="text-muted-foreground">Attempts: </span>{item.attempt_count}</div>
            <div><span className="text-muted-foreground">Provider-reported known cost: </span><CostLabel metrics={item} /></div>
            <div><span className="text-muted-foreground">Provider-reported usage: </span><UsageLabel metrics={item} /></div>
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Full generation prompt</div>
          <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm">{item.prompt}</p>
          <details className="mt-1 text-sm">
            <summary className="cursor-pointer text-xs text-primary">Show full prompt</summary>
            <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted/30 p-3">{item.prompt}</p>
          </details>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">Reference images: {item.references.length}</div>
          {item.references.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {item.references.map((reference) => (
                <div key={`${reference.ordinal}:${reference.asset_uid}`} className="relative">
                  <HistoryThumbnail
                    generationUid={item.generation_uid}
                    assetUid={reference.asset_uid}
                    alt={`Reference image ${reference.ordinal + 1}`}
                    className="size-20"
                  />
                  <span className="absolute bottom-0 left-0 rounded-tr bg-background/90 px-1 text-[10px] font-semibold">
                    {reference.ordinal + 1}
                  </span>
                </div>
              ))}
            </div>
          ) : <div className="text-xs text-muted-foreground">No reference images</div>}
        </div>

        {(item.error_code || item.error_message) && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <div className="font-medium">{item.error_code ?? "generation_failed"}</div>
            <div className="mt-1 text-muted-foreground">{item.error_message ?? "Image generation failed."}</div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}


/** Protected global read-only image history screen. */
export function ImageHistoryScreen() {
  const [userUid, setUserUid] = useState<string | null>(null)
  const [status, setStatus] = useState<ImageHistoryStatus | null>(null)
  const [models, setModels] = useState<Map<string, ImageModel>>(new Map())
  const summary = useImageHistorySummary()
  const history = useImageHistoryPages({ userUid, status })
  const items = useMemo(() => history.data?.pages.flatMap((page) => page.items) ?? [], [history.data])
  const failed = summary.isError || history.isError
  useEffect(() => {
    let active = true
    void listImageModels().then((catalog) => {
      if (active) setModels(new Map(catalog.map((model) => [model.model_id, model])))
    }).catch(() => {
      if (active) setModels(new Map())
    })
    return () => {
      active = false
    }
  }, [])

  const retry = (): void => {
    void summary.refetch()
    void history.refetch()
  }

  return (
    <div className="absolute inset-0 overflow-y-auto scrollbar-thin">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-5 py-24">
        <div>
          <h1 className="text-2xl font-semibold">AI image history</h1>
          <p className="mt-1 text-sm text-muted-foreground">Image-generation records and provider-reported cost and usage for all users.</p>
          <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-foreground">
            Signed-in Dim0 users can view private board names, prompts, results, and original user-uploaded reference images. Records currently have no per-item privacy control, opt-out, or user deletion option.
          </p>
        </div>

        {failed && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 p-4 text-sm">
            <span>AI image history could not be loaded.</span>
            <Button variant="outline" size="sm" onClick={retry}>Try again</Button>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Overall summary</CardTitle>
            <CardDescription>Provider-reported known cost and usage, not user charges, credits, or invoices.</CardDescription>
          </CardHeader>
          <CardContent>
            {summary.data ? <SummaryMetrics metrics={summary.data.overall} /> : <div className="text-sm text-muted-foreground">Loading summary…</div>}
          </CardContent>
        </Card>

        {summary.data && summary.data.users.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Summary by user</CardTitle>
              <CardDescription>Aggregated by creators with recorded usage.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4">User</th><th className="px-2">Generation</th><th className="px-2">Succeeded</th><th className="px-2">Failed</th><th className="px-2">In progress</th><th className="px-2">Attempt</th><th className="px-2">Cost</th><th className="px-2">Provider-reported usage</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.data.users.map((entry) => (
                    <tr key={entry.user.uid} className="border-b border-border/60 align-top">
                      <td className="py-3 pr-4"><div>{imageHistoryUserLabel(entry.user)}</div><div title={entry.user.uid} className="text-[11px] text-muted-foreground">{entry.user.uid.slice(0, 8)}</div></td>
                      <td className="px-2 py-3">{entry.generation_count}</td><td className="px-2 py-3">{entry.succeeded_count}</td><td className="px-2 py-3">{entry.failed_count}</td><td className="px-2 py-3">{entry.active_count}</td><td className="px-2 py-3">{entry.attempt_count}</td>
                      <td className="px-2 py-3"><CostLabel metrics={entry} /></td><td className="px-2 py-3"><UsageLabel metrics={entry} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap gap-3 rounded-lg border border-border bg-card p-4">
          <label className="flex min-w-60 flex-1 flex-col gap-1 text-xs text-muted-foreground">
            User
            <select
              aria-label="User filter"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              value={userUid ?? "all"}
              onChange={(event) => setUserUid(event.target.value === "all" ? null : event.target.value)}
            >
              <option value="all">All users</option>
              {summary.data?.users.map((entry) => (
                <option key={entry.user.uid} value={entry.user.uid}>{imageHistoryUserLabel(entry.user)}</option>
              ))}
            </select>
          </label>
          <label className="flex min-w-48 flex-col gap-1 text-xs text-muted-foreground">
            Status
            <select
              aria-label="Status filter"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              value={status ?? "all"}
              onChange={(event) => setStatus(event.target.value === "all" ? null : event.target.value as ImageHistoryStatus)}
            >
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        <div className="space-y-4">
          {history.isPending && <div className="py-10 text-center text-sm text-muted-foreground">Loading history…</div>}
          {!history.isPending && !failed && items.length === 0 && <div className="py-16 text-center text-sm text-muted-foreground">No image-generation records yet.</div>}
          {items.map((item) => (
            <HistoryItemCard
              key={item.generation_uid}
              item={item}
              model={models.get(item.model_id)}
            />
          ))}
        </div>

        {history.hasNextPage && (
          <div className="flex justify-center pb-8">
            <Button variant="outline" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
              {history.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
