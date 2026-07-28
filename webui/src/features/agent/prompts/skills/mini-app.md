You are authoring a sandboxed interactive React mini-app for the board. Follow this skill over generic note-writing habits.

Your goal is to produce one component and store it via `write_note(content_type="mini-app", content=<JSX source>)`.

---

## What you're authoring

A sandboxed React component that renders inside the canvas. Use it for anything custom-rendered — charts, dashboards, diagrams, visual explainers (an annotated diagram or labeled illustration that walks through how something works), flashcards, comparison tables, counters, todo lists, steppers, quizzes, calculators, algorithm visualizers. Whenever the user asks for something visual or interactive that isn't a sheet, code-sandbox, or document, this is the format.

Mini-apps live inside a sandboxed iframe on a different origin. Two consequences:
- The agent cannot make the widget talk to the host's auth, cookies, storage, parent DOM, or your collab WS. It is genuinely isolated.
- The widget *can* persist its own per-user state via `host.saveState(...)`, but can't reach any other host capability except the four `host.*` methods listed below.

---

## The exact contract

You write **one** JSX source string. The runtime compiles it via sucrase and renders the component named `Widget` (or `App` as a fallback). Anything else is rejected at validate time.

**Conventions:**
- Define a top-level `function Widget() { ... }` or `const Widget = () => { ... }`.
- Return a single React element from `Widget`.
- TypeScript annotations are fine — sucrase strips them.
- Do not write `import` statements. The runtime injects everything you may use as bare identifiers (see scope below).
- Do not call `host.test(...)` — the testing harness lands in a later version.

**Strict rules — these always reject:**
- Referencing globals: `window`, `document`, `fetch`, `localStorage`, `setTimeout`, `setInterval`, `console` (except `console.log` during dev), `globalThis`, `parent`, `top`, `eval`, `Function`. They don't exist in this sandbox.
- Importing anything. No `import "react"`, no `require(...)`.
- Multiple files or named exports beyond `Widget`/`App`. One source string, one component.

---

## Scope (what the agent can use)

Every identifier listed below is available as a bare name. Anything not listed is a `ReferenceError`.

### React + hooks
- `React` — only needed if you compose `React.createElement(...)` by hand. JSX works without referencing it explicitly.
- `useState<T>(initial: T): [T, (next: T) => void]` — local widget state; persists for the iframe's lifetime.
- `useMemo<T>(fn, deps): T`
- `useEffect(fn, deps?): void`
- `useCallback<F>(fn, deps): F`
- `useRef<T>(initial: T): { current: T }`

### Component library
- `<Card className?>{children}</Card>`, `<CardHeader>`, `<CardTitle>`, `<CardContent>`, `<CardFooter>`
- `<Button variant? size? onClick?>{children}</Button>` — variants: `default | destructive | outline | secondary | ghost | link`

### Charts, graphs + maps
- `<Chart kind data? datasets? labels? yAxis? xAxis? legend? tooltip? height? />` — cartesian or pie chart.
  - `kind`: `"bar" | "line" | "area" | "scatter" | "pie" | "composed"`
  - **Shorthand (one series):** `data={[42, 58, 71]}` + `kind="line"`.
  - **Multi-series:** `datasets={[{ label: "Revenue", data: [...], color: "primary" }, ...]}`. Use either `data` OR `datasets`, never both.
  - `labels` default to `"0", "1", "2", ...` when omitted.
  - Colors take palette names (`"primary"`, `"destructive"`, `"chart-1"`…`"chart-5"`, `"card"`, `"muted"`, etc.) and re-theme automatically. Raw hex / `rgb()` is allowed but does **not** theme — see the Colors section below before reaching for it.
  - For `kind="pie"`: pass `data` as `[{ name: "A", value: 30 }, ...]`.

- `<Graph nodes edges layout? directed? root? viewBox? height? />` — node-link diagram.
  - `nodes`: `[{ id, label?, sublabel?, color?, border?, textColor?, x?, y? }]`.
  - `edges`: `[{ a, b, label?, color? }]` where `a`/`b` are node ids (read as `a → b`).
  - **`layout` picks how nodes are placed — you usually don't compute coordinates:**
    - `"force"` — auto-arranges a network. **This is the default when you omit `x`/`y`.** Reach for it for dependency graphs, relationships, state machines.
    - `"tree"` — top-down hierarchy; edges read parent → child. Set `root` to the top node, or it's inferred (the node with no incoming edge). Use for taxonomies, org charts, decision trees, file trees.
    - `"manual"` — you supply `x` and `y` on every node. Only for layouts that need exact placement: grids, geographic-ish maps, or algorithm visualizers that highlight fixed positions step by step.
  - `directed={true}` draws arrowheads along `a → b`.
  - `viewBox` auto-computed from node positions when omitted (you rarely set it).

- `<Map data? markers? color? height? />` — world choropleth + point overlay.
  - `data`: `[{ id, value?, color? }]`. `id` is a country's **common English name** (`"France"`, `"United States"`) or its ISO numeric code. `value` shades `color` (default `"chart-1"`) by magnitude across the dataset; `color` sets a region's fill outright. Regions with no entry render neutral; unknown ids are dropped.
  - `markers`: `[{ lat, lng, label?, color?, r? }]` — plot points/bubbles by latitude/longitude (cities, events; vary `r` for a bubble map).
  - The boundary geometry is built in — supply only data, never coordinates. Use for geographic distributions, country comparisons, location maps.

### Helpers
- `cn(...classes: (string | undefined | false)[]): string` — merge Tailwind classes, later classes win.

### Host RPC
- `host.initialState: unknown` — value the host stored for this user on this note via a previous `saveState`. `undefined` on first mount. **Shape may have changed** if you rewrote the widget — validate before use rather than dereferencing fields blindly. A safe pattern: `useState(isMyState(host.initialState) ? host.initialState : defaultState)`.
- `host.saveState(state): Promise<void>` — persist the given JSON value for the current user on the current note. Use in a `useEffect`, fire-and-forget.
- `host.toast(message: string, level?: "info" | "error"): Promise<void>` — flash a short message in the host app.

---

## Worked examples

### Counter
```jsx
function Widget() {
  const [count, setCount] = useState(host.initialState ?? 0)
  useEffect(() => { host.saveState(count) }, [count])
  return (
    <Card className="p-4 max-w-sm">
      <CardHeader><CardTitle>Counter</CardTitle></CardHeader>
      <CardContent>
        <div className="text-3xl font-bold mb-3">{count}</div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCount(count - 1)}>-</Button>
          <Button onClick={() => setCount(count + 1)}>+</Button>
          <Button variant="ghost" onClick={() => setCount(0)}>reset</Button>
        </div>
      </CardContent>
    </Card>
  )
}
```

### Todo list
```jsx
function Widget() {
  const initial = host.initialState ?? { items: [], draft: "" }
  const [state, setState] = useState(initial)
  useEffect(() => { host.saveState(state) }, [state])

  function addItem() {
    if (!state.draft.trim()) return
    setState({ items: [...state.items, { text: state.draft, done: false }], draft: "" })
  }

  function toggleItem(i) {
    const next = state.items.map((it, j) => j === i ? { ...it, done: !it.done } : it)
    setState({ ...state, items: next })
  }

  return (
    <Card className="p-4 max-w-md">
      <CardHeader><CardTitle>Todo</CardTitle></CardHeader>
      <CardContent>
        <div className="flex gap-2 mb-3">
          <input
            value={state.draft}
            onChange={(e) => setState({ ...state, draft: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") addItem() }}
            className="flex-1 rounded-md border px-2 py-1 text-sm"
            placeholder="add a task"
          />
          <Button onClick={addItem}>add</Button>
        </div>
        <ul className="space-y-1">
          {state.items.map((it, i) => (
            <li key={i} className="flex items-center gap-2">
              <input type="checkbox" checked={it.done} onChange={() => toggleItem(i)} />
              <span className={cn("text-sm", it.done && "line-through text-muted-foreground")}>{it.text}</span>
            </li>
          ))}
          {state.items.length === 0 && <li className="text-sm text-muted-foreground">no items yet</li>}
        </ul>
      </CardContent>
    </Card>
  )
}
```

### Stepper (no persistence — ephemeral state is fine too)
```jsx
function Widget() {
  const steps = ["Buy ingredients", "Mix batter", "Bake at 180°C for 25min", "Cool + frost"]
  const [i, setI] = useState(0)
  return (
    <Card className="p-4 max-w-sm">
      <CardHeader><CardTitle>Step {i + 1} of {steps.length}</CardTitle></CardHeader>
      <CardContent>
        <p className="mb-3">{steps[i]}</p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={i === 0} onClick={() => setI(i - 1)}>back</Button>
          <Button disabled={i === steps.length - 1} onClick={() => setI(i + 1)}>next</Button>
        </div>
      </CardContent>
    </Card>
  )
}
```

### Bar chart (shorthand single-series)
```jsx
function Widget() {
  return (
    <Card className="p-4 max-w-md">
      <CardHeader><CardTitle>Q4 sales (k$)</CardTitle></CardHeader>
      <CardContent>
        <Chart
          kind="bar"
          labels={["Oct", "Nov", "Dec"]}
          data={[42, 58, 71]}
          color="primary"
          height={220}
        />
      </CardContent>
    </Card>
  )
}
```

### Multi-series line chart (full datasets form)
```jsx
function Widget() {
  return (
    <Card className="p-4 max-w-md">
      <CardHeader><CardTitle>Revenue vs cost</CardTitle></CardHeader>
      <CardContent>
        <Chart
          kind="line"
          labels={["Jan", "Feb", "Mar", "Apr", "May"]}
          datasets={[
            { label: "Revenue", data: [120, 132, 145, 160, 178], color: "chart-1" },
            { label: "Cost",    data: [80,  88,  95,  102, 110], color: "chart-2" },
          ]}
          height={220}
        />
      </CardContent>
    </Card>
  )
}
```

### Network graph (force layout — no coordinates needed)
```jsx
function Widget() {
  // Just declare what connects to what. `layout="force"` arranges it; this
  // is also the default when you omit x/y, so you could drop the prop.
  const nodes = [
    { id: "api", label: "API" },
    { id: "web", label: "Web" },
    { id: "db", label: "DB", color: "chart-1" },
    { id: "cache", label: "Cache" },
    { id: "queue", label: "Queue" },
  ]
  const edges = [
    { a: "web", b: "api" }, { a: "api", b: "db" },
    { a: "api", b: "cache" }, { a: "api", b: "queue" }, { a: "queue", b: "db" },
  ]
  return (
    <Card className="p-4 max-w-md">
      <CardHeader><CardTitle className="font-handwriting text-xl">Service graph</CardTitle></CardHeader>
      <CardContent>
        <Graph nodes={nodes} edges={edges} layout="force" directed height={240} />
      </CardContent>
    </Card>
  )
}
```

### Taxonomy (tree layout — edges read parent → child)
```jsx
function Widget() {
  const nodes = [
    { id: "animal", label: "Animal" },
    { id: "mammal", label: "Mammal" }, { id: "bird", label: "Bird" },
    { id: "dog", label: "Dog" }, { id: "cat", label: "Cat" }, { id: "owl", label: "Owl" },
  ]
  const edges = [
    { a: "animal", b: "mammal" }, { a: "animal", b: "bird" },
    { a: "mammal", b: "dog" }, { a: "mammal", b: "cat" }, { a: "bird", b: "owl" },
  ]
  return (
    <Card className="p-4 max-w-md">
      <CardHeader><CardTitle className="font-handwriting text-xl">Taxonomy</CardTitle></CardHeader>
      <CardContent>
        <Graph nodes={nodes} edges={edges} layout="tree" root="animal" directed height={220} />
      </CardContent>
    </Card>
  )
}
```

### Algorithm visualizer (manual layout — you place each node)
```jsx
function Widget() {
  const [step, setStep] = useState(host.initialState ?? 0)
  useEffect(() => { host.saveState(step) }, [step])

  const visited = ["A", "B", "C"].slice(0, step)
  // Semantic palette names — "chart-1" highlights visited nodes, "card"
  // is the resting fill. Both retheme automatically when the host flips
  // dark/light or swaps palettes.
  const fillFor = (id) =>
    visited.includes(id) ? "chart-1" : "card"

  // Step-throughs need fixed positions so nodes don't move between steps —
  // this is the case for layout="manual" (supply x/y on every node).
  const nodes = [
    { id: "A", x: 30,  y: 60, color: fillFor("A") },
    { id: "B", x: 110, y: 30, color: fillFor("B") },
    { id: "C", x: 110, y: 90, color: fillFor("C") },
    { id: "D", x: 200, y: 60 },
  ]
  const edges = [
    { a: "A", b: "B" }, { a: "A", b: "C" }, { a: "B", b: "D" }, { a: "C", b: "D" },
  ]

  return (
    <Card className="p-4 max-w-md">
      <CardHeader><CardTitle className="font-handwriting text-xl">BFS step {step}</CardTitle></CardHeader>
      <CardContent>
        <Graph nodes={nodes} edges={edges} layout="manual" viewBox="0 0 240 130" height={180} />
        <div className="flex gap-2 mt-3">
          <Button variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}>back</Button>
          <Button disabled={step === 3} onClick={() => setStep(step + 1)}>next</Button>
          <Button variant="ghost" onClick={() => setStep(0)}>reset</Button>
        </div>
      </CardContent>
    </Card>
  )
}
```

### World map (choropleth by value + a marker)
```jsx
function Widget() {
  // id is the country's English name; value shades chart-1 by magnitude.
  const data = [
    { id: "United States", value: 331 },
    { id: "Brazil", value: 214 },
    { id: "Nigeria", value: 223 },
    { id: "India", value: 1428 },
    { id: "France", value: 68 },
  ]
  return (
    <Card className="p-4 max-w-2xl">
      <CardHeader><CardTitle className="font-handwriting text-xl">Population (millions)</CardTitle></CardHeader>
      <CardContent>
        <Map
          data={data}
          color="chart-1"
          markers={[{ lat: 48.85, lng: 2.35, label: "Paris" }]}
          height={360}
        />
      </CardContent>
    </Card>
  )
}
```

---

## Style guidelines

- Default to compact widgets — `max-w-sm` for single-purpose, `max-w-md` for lists.
- Use `Card` as the outer container so the widget feels native to the board.
- Don't wrap your top-level widget in a scroll container — the host auto-resizes the iframe to fit content. If you need a bounded scroll area *inside* the widget (a long chat log, a fixed-height list with overflow), pair `overflow-y-auto` with the `scrollbar-thin` utility from the host theme: it gives you a 4px-wide thumb that fades in on hover, matching the rest of the app.

---

## Typography

Mix three families like a notebook layout — handwriting for headings, mono for code, sans for everything else. The fonts ship with the runtime; just use the utility classes.

- `font-handwriting` — titles, subtitles, callouts. Adds personality. Use sparingly, usually only on the `<CardTitle>` or a one-line subtitle. The host UI uses this for note titles, so widget titles match.
- `font-mono` — anything code-like: keyboard shortcuts, variable names, raw values, log lines, snippets inside `<code>` or `<pre>`.
- `font-sans` — the default; you usually don't need to spell it out. Body copy, labels, button text.
- `font-serif` — long-form prose if you ever need it (rare in widgets).

Example mixing all three:

```jsx
<CardHeader>
  <CardTitle className="font-handwriting text-2xl">Counter</CardTitle>
  <p className="text-sm text-muted-foreground">Press <kbd className="font-mono">+</kbd> to add</p>
</CardHeader>
```

Don't apply `font-handwriting` to long blocks — it's playful but tiring to read past a sentence.

---

## Colors

The host runs six themes × {light, dark}, and the iframe inherits whichever is active. The agent's job is to stay inside the semantic palette so the widget themes for free.

**Two rules that matter most:**

1. **Every colored background needs its matching foreground.** A `bg-*` token always has a paired `*-foreground` made to be legible on it — use them together, never one without the other:
   - `bg-primary text-primary-foreground`
   - `bg-secondary text-secondary-foreground`
   - `bg-destructive text-destructive-foreground`
   - `bg-muted text-muted-foreground` / `bg-accent text-accent-foreground`
   Putting default body text on a colored background is the #1 cause of unreadable widgets.

2. **`primary` is a high-contrast extreme — use it sparingly.** In several themes it's a near-black (light mode) or bright (dark mode) "ink" color, made for the *one* main action. Don't tile surfaces or color many elements with it, and never use `bg-primary` without `text-primary-foreground`. **Reach for `secondary` (with `text-secondary-foreground`) as your default themed surface** — chips, secondary buttons, highlighted rows — it carries the theme's character without screaming. `muted` / `accent` are the calm neutral surfaces.

**For variety and categorical color, use the `chart-1`…`chart-5` ramp.** These five slots are tuned per theme × mode to be vivid *and* harmonious — they're the right palette for graph node groups, chart series, tags, status pills, and anything where you want several distinct colors that still look themed. Available both as `color="chart-1"` props (Chart/Graph) and as `bg-chart-1` / `text-chart-1` / `border-chart-1` classes.

**Semantic token cheat-sheet.**

| Want | Class |
|---|---|
| Card background | `bg-card` |
| Page background | `bg-background` |
| Default themed surface | `bg-secondary text-secondary-foreground` |
| Main action (use once) | `bg-primary text-primary-foreground` |
| Muted / neutral surface | `bg-muted` / `bg-accent` |
| Body text | `text-foreground` (default) |
| Subdued text | `text-muted-foreground` |
| Destructive action | `bg-destructive text-destructive-foreground` |
| Categorical color | `bg-chart-1`…`bg-chart-5` (and `text-`/`border-`) |
| Border | `border` |
| Focus ring | `ring-ring` |

For charts and graphs, pass `color="chart-1"`…`"chart-5"` (or `"primary"` / `"destructive"`) rather than literal hex. A `<Graph>` with `layout="force"` or `"tree"` auto-colors its nodes from the chart ramp, so you usually don't set node colors at all.

**Last-resort — use a theme-stable color literal.**

If you genuinely need a color outside the palette (e.g. a domain-specific colour like "danger orange" in a fire-risk widget), use **OKLCH** with mid-range lightness so it reads in both modes:

```jsx
<div style={{ background: "oklch(0.62 0.18 60)" }} />  // warm amber that survives dark/light
```

Pick lightness in `0.50`–`0.65`, chroma `0.10`–`0.20`, and a hue that fits the warm parchment-ish default palette (red 25°, orange 60°, yellow 90°, green 145°, teal 195°, blue 240°, purple 295°).

**Never.**

- Raw hex (`#965e30`), `rgb()`, or named colors (`"red"`, `"navy"`) — these don't theme.
- Pure black (`#000`) or pure white (`#fff`) — use `text-foreground` / `bg-background` instead so dark mode inverts correctly.

---

## Theming is automatic

The iframe inherits the host's active palette + light/dark mode. When the user flips themes in the app, the widget retheme without remounting — your `useState` survives. The only thing you have to do is **stay inside the semantic palette** (above). Hardcoded hex values won't update on theme change, semantic tokens will.

---

## Verification before you submit

Walk through these in your head before calling `write_note`:

1. The source declares `function Widget()` (or `const Widget = () => ...`) at the top level.
2. Every identifier in the source is in the scope above OR is a JSX intrinsic (`div`, `span`, etc.) OR is locally defined in the function body.
3. No `import`, no `window`, no `fetch`, no `setTimeout`.
4. If the widget has persistent state, it reads from `host.initialState` on first render and writes via `host.saveState` on every change.

If you can't tick all four, fix the source before submitting. The compile validator will reject anything that fails (1) or returns errors at parse time; the iframe's runtime error boundary catches anything that fails (2) at render time.
