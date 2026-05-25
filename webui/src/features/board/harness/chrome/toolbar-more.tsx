import {
  CodeFileIcon,
  DocumentFileIcon,
  EllipsisIcon,
  FolderPlusActionIcon,
  ImageStackIcon,
  LearnWidgetIcon,
  PuzzlePieceIcon,
} from "@/components/icons"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useBoardAppStore } from "../store/board-app-store"
import { DocumentUploadDialog } from "./document-upload-dialog"
import { IconSearchDialog } from "./icon-search-dialog"
import { ImageSearchDialog } from "./image-search-dialog"


const moreButtonClass =
  "transition-colors !p-2.5 rounded-lg flex items-center justify-center gap-2 text-card-foreground hover:bg-secondary hover:text-secondary-foreground"


/**
 * Overflow menu mounted at the right edge of the harness toolbar.
 * Mirrors prod's `⋯` More dropdown: Icons / Images / Sub-board /
 * Document / Code sandbox / Widget. Open state for the icon + image
 * search dialogs lives on board-app-store so keyboard shortcuts can
 * toggle them too. Sub-board / code-sandbox / widget set `tool` so the
 * next canvas click materializes the node.
 */
export function HarnessToolbarMore() {
  const setTool = useBoardAppStore((s) => s.setTool)
  const chromeDialog = useBoardAppStore((s) => s.chromeDialog)
  const setChromeDialog = useBoardAppStore((s) => s.setChromeDialog)

  const openImageSearch = chromeDialog === "image-search"
  const openIconSearch = chromeDialog === "icon-search"
  const openDocumentUpload = chromeDialog === "document-upload"

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="More actions"
                className={cn(moreButtonClass)}
              >
                <EllipsisIcon className="size-4 shrink-0" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={10}>More actions</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="end"
          side="bottom"
          sideOffset={8}
          className="min-w-[190px]"
        >
          <DropdownMenuItem
            onSelect={() => setChromeDialog("icon-search")}
            className="gap-2 text-sm"
          >
            <PuzzlePieceIcon className="size-4 shrink-0" />
            <span>Icons</span>
            <DropdownMenuShortcut>G</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setChromeDialog("image-search")}
            className="gap-2 text-sm"
          >
            <ImageStackIcon className="size-4 shrink-0" />
            <span>Images</span>
            <DropdownMenuShortcut>I</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setTool("folder")}
            className="gap-2 text-sm"
          >
            <FolderPlusActionIcon className="size-4 shrink-0" />
            <span>Sub-board</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setChromeDialog("document-upload")}
            className="gap-2 text-sm"
          >
            <DocumentFileIcon className="size-4 shrink-0" />
            <span>Document</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setTool("code-sandbox")}
            className="gap-2 text-sm"
          >
            <CodeFileIcon className="size-4 shrink-0" />
            <span>Code sandbox</span>
            <DropdownMenuShortcut>Y</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setTool("widget")}
            className="gap-2 text-sm"
          >
            <LearnWidgetIcon className="size-4 shrink-0" />
            <span>Widget</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ImageSearchDialog
        open={openImageSearch}
        onOpenChange={(open) => setChromeDialog(open ? "image-search" : null)}
      />
      <IconSearchDialog
        open={openIconSearch}
        onOpenChange={(open) => setChromeDialog(open ? "icon-search" : null)}
      />
      <DocumentUploadDialog
        open={openDocumentUpload}
        onOpenChange={(open) => setChromeDialog(open ? "document-upload" : null)}
      />
    </>
  )
}
