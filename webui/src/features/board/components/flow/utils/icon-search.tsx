import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useSearchIcons } from "@/features/board/api/icon-search"
import { useDebouncedValue } from "@/features/board/hooks/use-debounce"
import { useState } from "react"
import { Icon } from "@iconify/react"
import { cn } from "@/lib/utils"
import { useAddNoteNode } from "@/features/board/hooks/use-add-node"

const ICON_NODE_SIZE = 220


/**
 * Example usage of the Icon component from Iconify.
 */
export default function ThemedIcon({ iconName, className }: { iconName: string, className?: string }) {
  const clName = cn("text-card-foreground", className)

  return (
    <Icon
      icon={iconName}
      width="32"
      className={clName}
    />
  )
}


export interface IconSearchDialogProps {
  openIconSearch: boolean
  setOpenIconSearch: (open: boolean) => void
}


/**
 * Lazy body for icon search. Mounted only while the dialog is open so the
 * iconify network/decoding cost for hundreds of icons doesn't linger
 * across open/close cycles.
 */
const IconSearchDialogBody = ({
  setOpenIconSearch,
}: {
  setOpenIconSearch: (open: boolean) => void
}) => {
  const [q, setQ] = useState<string>('')

  const debouncedQ = useDebouncedValue<string>({ value: q, delay: 1000 })

  const { data, isLoading } = useSearchIcons({ query: debouncedQ })

  const addNode = useAddNoteNode()

  const handleSelectIcon = (iconName: string) => {
    addNode({
      nodeType: "icon",
      icon: iconName,
      size: { width: ICON_NODE_SIZE, height: ICON_NODE_SIZE }
    })
    setOpenIconSearch(false)
  }

  return (
    <>
      <DialogHeader className='p-4 border-b text-secondary-foreground w-full text-center'>
        <DialogTitle>Search icons</DialogTitle>
      </DialogHeader>
      <div className='p-4'>
        <Input
          placeholder='Search Icon…'
          value={q}
          onChange={e => setQ(e.target.value)}
          autoFocus
          className='focus-visible:ring-2 focus-visible:ring-secondary-foreground/75 focus-visible:border-secondary-foreground'
        />
      </div>
      <div className='p-4 pt-2 h-full w-full flex-1 overflow-y-auto scrollbar-thin'>
        {isLoading ? (
          <div className='grid grid-cols-5 sm:grid-cols-10 gap-1 w-full'>
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className='aspect-square w-full' />
            ))}
          </div>
        ) : (
          <div className='grid grid-cols-5 sm:grid-cols-10 gap-1 w-full'>
            {data?.map(icon => (
              <button
                key={icon.url}
                className='group relative aspect-square rounded-md border hover:ring-2 hover:ring-secondary-foreground/75 grid place-items-center p-1 bg-card'
                title={icon.name}
                onClick={() => handleSelectIcon(icon.name)}
              >
                <ThemedIcon iconName={icon.name} />
              </button>
            ))}
            {debouncedQ && !data?.length && (
              <div className='col-span-full text-sm text-muted-foreground p-4'>No results</div>
            )}
          </div>
        )}
      </div>
    </>
  )
}


/**
 * Dialog component for searching and selecting icons.
 */
export const IconSearchDialog = ({
  openIconSearch,
  setOpenIconSearch
}: IconSearchDialogProps) => {
  return (
    <Dialog open={openIconSearch} onOpenChange={setOpenIconSearch}>
      <DialogContent className='sm:max-w-xl p-0 overflow-hidden sm:w-1/3 sm:h-[50vh] flex flex-col'>
        {openIconSearch && (
          <IconSearchDialogBody setOpenIconSearch={setOpenIconSearch} />
        )}
      </DialogContent>
    </Dialog>
  )
}
