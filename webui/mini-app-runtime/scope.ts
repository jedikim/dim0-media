// Curated identifiers the agent's mini-app source may reference.
//
// This file is the *single source of truth*:
//   - The runtime (main.tsx) passes the values to compileMiniApp() so the
//     agent's code can use them as bare identifiers.
//   - The agent's skill prompt is built from `renderScopeManifest()` so
//     what the agent thinks is available matches what's actually wired.
//
// Adding a new component or hook is a single-line change here. No schema
// updates, no parity tests, no prompt edits — just an entry.
//
// React is in scope on purpose: the compile pipeline uses sucrase with the
// classic JSX runtime (jsxRuntime: "classic"), which emits
// `React.createElement(...)` calls. Without `React` bound in scope, every
// `<div/>` would throw.

import * as React from "react"

import { ChartElement } from "@/components/charts"
import { GraphElement } from "@/components/charts"
import { MapElement } from "@/components/charts"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

import { host } from "./rpc"


interface ScopeEntry {
  /** The actual JS value injected into the agent's code at runtime. */
  value: unknown
  /** One-line signature for the agent prompt (shown in renderScopeManifest). */
  signature: string
  /** Optional one-line behavior note for the agent prompt. */
  doc?: string
}


export const MINI_APP_SCOPE: Record<string, ScopeEntry> = {
  // React itself — required by the classic JSX runtime.
  React: {
    value: React,
    signature: "React (createElement, Fragment — used implicitly by JSX)",
  },

  // Hooks — the agent uses these directly without an import.
  useState: {
    value: React.useState,
    signature: "useState<T>(initial: T): [T, (next: T) => void]",
    doc: "Local widget state. Persists for the lifetime of this iframe mount.",
  },
  useMemo: {
    value: React.useMemo,
    signature: "useMemo<T>(fn: () => T, deps: unknown[]): T",
  },
  useEffect: {
    value: React.useEffect,
    signature: "useEffect(fn: () => void | (() => void), deps?: unknown[]): void",
  },
  useCallback: {
    value: React.useCallback,
    signature: "useCallback<F>(fn: F, deps: unknown[]): F",
  },
  useRef: {
    value: React.useRef,
    signature: "useRef<T>(initial: T): { current: T }",
  },

  // Component library (subset). More entries land in later phases as the
  // examples in the skill prompt grow.
  Card:        { value: Card,        signature: "<Card className?>{children}</Card>" },
  CardHeader:  { value: CardHeader,  signature: "<CardHeader>{children}</CardHeader>" },
  CardTitle:   { value: CardTitle,   signature: "<CardTitle>{children}</CardTitle>" },
  CardContent: { value: CardContent, signature: "<CardContent>{children}</CardContent>" },
  CardFooter:  { value: CardFooter,  signature: "<CardFooter>{children}</CardFooter>" },
  Button: {
    value: Button,
    signature: "<Button variant? size? onClick?>{children}</Button>",
    doc: "variant: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'.",
  },

  // Chart + graph primitives — implementations live in
  // src/components/charts/ and are shared with the host bundle.
  Chart: {
    value: ChartElement,
    signature:
      "<Chart kind data? datasets? labels? yAxis? xAxis? legend? tooltip? height? />",
    doc:
      "Cartesian/pie chart. kind: 'bar' | 'line' | 'area' | 'scatter' | 'pie' | 'composed'. " +
      "Shorthand: data=[1,2,3] for one series; full form: datasets=[{label, data, color?}]. " +
      "Use either `data` OR `datasets`, never both. " +
      "Auto-labels '0','1','2',... when `labels` omitted. " +
      "Colors accept palette names ('primary' | 'destructive' | 'chart-1'..'chart-5') or CSS color literals.",
  },
  Graph: {
    value: GraphElement,
    signature:
      "<Graph nodes edges layout? directed? root? viewBox? height? />",
    doc:
      "Node-link diagram. nodes=[{id, label?, sublabel?, color?, border?, textColor?, x?, y?}]; " +
      "edges=[{a, b, label?, color?}] (a→b). " +
      "layout: 'force' (auto-arrange networks — the default when x/y omitted) | " +
      "'tree' (top-down hierarchy; edges read parent→child, set root? or it's inferred) | " +
      "'manual' (you supply x/y per node — for grids/algorithm steps). " +
      "directed=true draws arrowheads. viewBox auto-computed when omitted. " +
      "Use for dependency graphs, taxonomies, state machines, algorithm visualizers.",
  },

  // World map — choropleth (regions shaded by data) + optional markers.
  // Geometry is bundled + lazily loaded; the agent supplies only data.
  Map: {
    value: MapElement,
    signature: "<Map data? markers? color? height? />",
    doc:
      "World choropleth. data=[{id, value?, color?}] where id is a country's " +
      "English name ('France') or ISO numeric code; value shades `color` " +
      "(default 'chart-1') by magnitude, color overrides per region. " +
      "markers=[{lat, lng, label?, color?, r?}] overlays points/bubbles. " +
      "Unknown regions are dropped. Use for geographic data, country " +
      "comparisons, location maps.",
  },

  // Tailwind class-merge helper. Agents often want to compose conditional
  // classes — without `cn` they end up with messy template literals.
  cn: {
    value: cn,
    signature: "cn(...classes: (string | undefined | false)[]): string",
    doc: "Merge tailwind classes, with later classes winning conflicts.",
  },

  // Bridge into the host app. Methods round-trip through postMessage;
  // see rpc.ts for the protocol. Agent reads `host.initialState` for
  // persisted state on mount and writes via `host.saveState(...)`.
  host: {
    value: host,
    signature:
      "host.initialState: unknown; host.saveState(state); host.toast(message, level?)",
    doc:
      "RPC bridge to the host. saveState persists per-user state for this " +
      "widget mount; toast surfaces a transient message in the host app.",
  },
}


/** Names of all scope entries, in declaration order. */
export const MINI_APP_SCOPE_NAMES: string[] = Object.keys(MINI_APP_SCOPE)


/** Values aligned with MINI_APP_SCOPE_NAMES — pass to compileMiniApp. */
export const MINI_APP_SCOPE_VALUES: unknown[] = MINI_APP_SCOPE_NAMES.map(
  (name) => MINI_APP_SCOPE[name].value,
)


/**
 * Render the scope as a markdown bullet list for the agent prompt.
 *
 * The intent is that the backend reads a generated manifest (or this
 * function's output baked at build time) and embeds it directly in the
 * mini-app skill prompt, so the agent's allowlist always matches the
 * runtime's allowlist.
 */
export function renderScopeManifest(): string {
  return MINI_APP_SCOPE_NAMES.map((name) => {
    const { signature, doc } = MINI_APP_SCOPE[name]
    return doc
      ? `- \`${name}\`: ${signature}\n  ${doc}`
      : `- \`${name}\`: ${signature}`
  }).join("\n")
}
