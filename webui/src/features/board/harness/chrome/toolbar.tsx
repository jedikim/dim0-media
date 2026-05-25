import {
  ChevronDownIcon,
  CircleClusterIcon,
  CircleShapeIcon,
  ConnectorPathIcon,
  CursorSelectIcon,
  DiamondShapeIcon,
  GraphViewIcon,
  GridViewIcon,
  HandGrabIcon,
  HandPanIcon,
  LayerStackIcon,
  ListViewIcon,
  NotepadIcon,
  PresentationIcon,
  ShapesMenuIcon,
  SquareShapeIcon,
  TagIcon,
  TextTIcon,
  WeatherCloudIcon,
} from "@/components/icons"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useBoardAppStore } from "../store/board-app-store"
import { HarnessToolbarMore } from "./toolbar-more"


type ShapeTool = {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  shortcut?: string
}


/**
 * All built-in canvas-harness shape tools the user can pick from the
 * Shapes dropdown. Order + icon choices mirror prod's `top-bar.tsx`
 * shapeOptions. Tool ids are canvas-harness names (see
 * `convert/node-type.ts` for the dim0↔canvas mapping).
 */
const SHAPE_TOOLS: ReadonlyArray<ShapeTool> = [
  { id: "rect", label: "Rectangle", icon: SquareShapeIcon, shortcut: "R" },
  { id: "layered-rect", label: "Layered card", icon: LayerStackIcon },
  { id: "ellipse", label: "Ellipse", icon: CircleShapeIcon, shortcut: "O" },
  { id: "diamond", label: "Diamond", icon: DiamondShapeIcon, shortcut: "D" },
  { id: "soft-diamond", label: "Double diamond", icon: DiamondShapeIcon },
  { id: "layered-diamond", label: "Layered diamond", icon: LayerStackIcon },
  { id: "layered-ellipse", label: "Layered circle", icon: CircleClusterIcon },
  { id: "tag", label: "Tag", icon: TagIcon },
  { id: "thought-cloud", label: "Cloud", icon: WeatherCloudIcon },
  { id: "capsule", label: "Capsule", icon: TagIcon },
]


const SHAPE_TOOL_IDS = new Set(SHAPE_TOOLS.map((t) => t.id))


const baseButtonClass =
  "transition-colors !p-2.5 rounded-lg flex items-center justify-center gap-2"
const inactiveClass = `${baseButtonClass} text-card-foreground hover:bg-secondary hover:text-secondary-foreground`
const activeClass = `${baseButtonClass} bg-secondary text-secondary-foreground`


/**
 * Compact keyboard hint badge in the corner of a tool button.
 */
const ShortcutHint = ({ shortcut }: { shortcut: string }) => (
  <span className="pointer-events-none absolute -bottom-1 -right-1 px-0 text-[9px] font-semibold leading-none text-muted-foreground/80">
    {shortcut}
  </span>
)


/**
 * Floating tool tray for the canvas-harness board — center-top. Mirrors
 * prod's `TopBar` styling (sidebar surface, rounded-xl, blurred bg) and
 * icon set while preserving the harness's tool-mode contract (each
 * button sets `tool` on board-app-store; canvas-harness reacts to it).
 */
const VIEW_OPTIONS = [
  { id: "board" as const, label: "Board", icon: GraphViewIcon },
  { id: "files" as const, label: "Files", icon: GridViewIcon },
  { id: "list" as const, label: "List", icon: ListViewIcon },
]


export function HarnessToolbar() {
  const tool = useBoardAppStore((s) => s.tool)
  const setTool = useBoardAppStore((s) => s.setTool)
  const chromeDialog = useBoardAppStore((s) => s.chromeDialog)
  const setChromeDialog = useBoardAppStore((s) => s.setChromeDialog)
  const slidesPanelOpen = useBoardAppStore((s) => s.slidesPanelOpen)
  const setSlidesPanelOpen = useBoardAppStore((s) => s.setSlidesPanelOpen)
  const viewMode = useBoardAppStore((s) => s.viewMode)
  const setViewMode = useBoardAppStore((s) => s.setViewMode)

  const isBoard = viewMode === "board"
  const isPan = tool === "pan"
  const isSelect = tool === "select"
  const isShape = SHAPE_TOOL_IDS.has(tool)
  const ActiveShape = SHAPE_TOOLS.find((s) => s.id === tool)?.icon ?? ShapesMenuIcon
  const shapeMenuOpen = chromeDialog === "shape-menu"
  const activeView = VIEW_OPTIONS.find((v) => v.id === viewMode) ?? VIEW_OPTIONS[0]
  const ActiveViewIcon = activeView.icon

  return (
    <div
      className={cn(
        "absolute left-1/2 top-2 z-50 flex -translate-x-1/2 items-center gap-1",
        "rounded-xl border border-border/60 shadow-md backdrop-blur-md backdrop-saturate-150",
        "bg-sidebar text-sidebar-foreground supports-[backdrop-filter]:bg-sidebar/80",
        "p-1",
      )}
      role="toolbar"
      aria-label="Board toolbar"
    >
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Change view"
                className={activeClass}
              >
                <ActiveViewIcon className="size-4 shrink-0" />
                <span className="sr-only text-[10px] md:not-sr-only">
                  {activeView.label}
                </span>
                <ChevronDownIcon className="hidden size-3 shrink-0 text-muted-foreground md:block" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={10}>Change view</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" side="bottom" sideOffset={8} className="min-w-[160px]">
          {VIEW_OPTIONS.map((option) => {
            const Icon = option.icon
            return (
              <DropdownMenuItem
                key={option.id}
                onSelect={() => setViewMode(option.id)}
                className="gap-2 text-sm"
              >
                <Icon className="size-4 shrink-0" />
                <span>{option.label}</span>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="hidden md:!h-6 md:block" />

      {/*
        Canvas-only tools are hidden in non-board view modes. The
        view dropdown and the More menu (create-only actions) stay
        visible everywhere so users can navigate + create from any
        surface.
      */}
      {isBoard && (
      <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setTool("pan")}
            aria-label="Pan"
            aria-pressed={isPan}
            className={isPan ? activeClass : inactiveClass}
          >
            <div className="relative">
              {isPan ? (
                <HandGrabIcon className="size-4 shrink-0" weight="fill" />
              ) : (
                <HandPanIcon className="size-4 shrink-0" />
              )}
              <ShortcutHint shortcut="P" />
            </div>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={10}>Pan</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setTool("select")}
            aria-label="Select"
            aria-pressed={isSelect}
            className={isSelect ? activeClass : inactiveClass}
          >
            <div className="relative">
              <CursorSelectIcon
                className="size-4 shrink-0"
                weight={isSelect ? "fill" : undefined}
              />
              <ShortcutHint shortcut="V" />
            </div>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={10}>Select</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="hidden md:!h-6 md:block" />

      <DropdownMenu
        open={shapeMenuOpen}
        onOpenChange={(open) => setChromeDialog(open ? "shape-menu" : null)}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Add shape"
                className={isShape ? activeClass : inactiveClass}
              >
                <div className="relative flex flex-col items-center gap-0.5">
                  <ActiveShape className="size-4 shrink-0" />
                  <ShortcutHint shortcut="S" />
                  <ChevronDownIcon className="absolute inset-x-0 -bottom-3.5 size-3 text-muted-foreground" />
                </div>
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={10}>Shapes</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="center" side="bottom" sideOffset={8} className="min-w-[180px]">
          {SHAPE_TOOLS.map((s) => {
            const Icon = s.icon
            return (
              <DropdownMenuItem
                key={s.id}
                onSelect={() => setTool(s.id)}
                className="gap-2 text-sm"
              >
                <Icon className="size-4 shrink-0" />
                <span>{s.label}</span>
                {s.shortcut ? <DropdownMenuShortcut>{s.shortcut}</DropdownMenuShortcut> : null}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setTool("arrow")}
            aria-label="Connector"
            aria-pressed={tool === "arrow"}
            className={tool === "arrow" ? activeClass : inactiveClass}
          >
            <div className="relative">
              <ConnectorPathIcon className="size-4 shrink-0" />
              <ShortcutHint shortcut="A" />
            </div>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={10}>Connector</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setTool("text")}
            aria-label="Text"
            aria-pressed={tool === "text"}
            className={tool === "text" ? activeClass : inactiveClass}
          >
            <div className="relative">
              <TextTIcon className="size-4 shrink-0" />
              <ShortcutHint shortcut="T" />
            </div>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={10}>Text</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setTool("sheet")}
            aria-label="Note"
            aria-pressed={tool === "sheet"}
            className={tool === "sheet" ? activeClass : inactiveClass}
          >
            <div className="relative">
              <NotepadIcon className="size-4 shrink-0" />
              <ShortcutHint shortcut="N" />
            </div>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={10}>Note</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="hidden md:!h-6 md:block" />

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setSlidesPanelOpen(!slidesPanelOpen)}
            aria-label="Slides"
            aria-pressed={slidesPanelOpen}
            className={slidesPanelOpen ? activeClass : inactiveClass}
          >
            <div className="relative">
              <PresentationIcon
                className="size-4 shrink-0"
                weight={slidesPanelOpen ? "fill" : undefined}
              />
              <ShortcutHint shortcut="M" />
            </div>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={10}>Slides</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="hidden md:!h-6 md:block" />
      </>
      )}

      <HarnessToolbarMore />
    </div>
  )
}
