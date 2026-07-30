import { GlobeIcon, CodeInterpreterIcon, BrowserSearchIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useToolConfirm, type ToolConfirmRequest } from "@/features/agent/engine/tool-confirm-store"


const asString = (value: unknown): string => (typeof value === "string" ? value : "")


/** Human-facing copy + preview for a pending off-board tool request. */
const describe = (req: ToolConfirmRequest): { title: string; hint: string; preview: string; Icon: typeof GlobeIcon } => {
  if (req.name === "fetch") {
    return {
      title: "Allow the assistant to fetch a web page?",
      hint: "It will send this request from your session. Only allow URLs you trust — a page or document on your board could try to smuggle your data into one.",
      preview: asString(req.args.url),
      Icon: GlobeIcon,
    }
  }
  if (req.name === "web_search") {
    return {
      title: "Allow the assistant to search the web?",
      hint: "It will send this query to a search provider. Content on your board could try to steer the query — check it says what you expect.",
      preview: asString(req.args.query),
      Icon: BrowserSearchIcon,
    }
  }
  return {
    title: "Allow the assistant to run this code?",
    hint: "It runs in a sandbox, but only allow code you understand — content on your board could try to make it exfiltrate data.",
    preview: asString(req.args.code),
    Icon: CodeInterpreterIcon,
  }
}


/**
 * Confirmation for off-board agent tools (`fetch` / `web_search` / `code_interpreter`).
 * Mounted at the board level whenever the browser engine runs (LocalBoardScreen
 * for local boards, BoardView for synced ones); shows the exact URL/query/code
 * and pauses the run until the user decides (see `useToolConfirm` + the agent
 * loop's CONFIRM_TOOLS). The preview is plain text — never HTML — so it can't
 * inject markup.
 */
export const ToolConfirmDialog = () => {
  const pending = useToolConfirm((s) => s.pending)
  const resolve = useToolConfirm((s) => s.resolve)
  if (!pending) return null

  const { title, hint, preview, Icon } = describe(pending)

  return (
    <AlertDialog open onOpenChange={(open) => !open && resolve("deny")}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Icon className="size-4 shrink-0 text-primary" strokeWidth={2} />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>{hint}</AlertDialogDescription>
        </AlertDialogHeader>
        {preview && (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/40 p-2 text-xs">
            {preview}
          </pre>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => resolve("deny")}>Don't allow</AlertDialogCancel>
          {/* "Allow once" gates the next call again; "Allow for this request"
              auto-approves further calls to this tool for the rest of the run. */}
          <Button variant="outline" onClick={() => resolve("once")}>Allow once</Button>
          <Button onClick={() => resolve("always")}>Allow for this request</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
