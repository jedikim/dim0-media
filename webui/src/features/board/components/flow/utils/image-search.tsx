import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ImagePlaceholderIcon } from "@/components/icons"
import { useSearchImages } from "@/features/board/api/image-search"
import { useAddImageFromFile } from "@/features/board/hooks/use-add-image-from-file"
import { useAddNoteNode } from "@/features/board/hooks/use-add-node"
import { useDebouncedValue } from "@/features/board/hooks/use-debounce"
import { useRef, useState } from "react"

const IMAGE_NODE_MAX_DIMENSION = 420
const IMAGE_NODE_MIN_DIMENSION = 160
const FALLBACK_IMAGE_RATIO = 4 / 3

const loadImageDimensions = (url: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = "anonymous"
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = reject
    image.src = url
  })

const normalizeImageSize = (width?: number, height?: number) => {
  if (!width || !height) {
    return {
      width: IMAGE_NODE_MAX_DIMENSION,
      height: Math.round(IMAGE_NODE_MAX_DIMENSION / FALLBACK_IMAGE_RATIO)
    }
  }

  const ratio = width / height
  if (ratio >= 1) {
    let targetWidth = IMAGE_NODE_MAX_DIMENSION
    let targetHeight = targetWidth / ratio
    if (targetHeight < IMAGE_NODE_MIN_DIMENSION) {
      targetHeight = IMAGE_NODE_MIN_DIMENSION
      targetWidth = targetHeight * ratio
    }
    if (targetWidth > IMAGE_NODE_MAX_DIMENSION) {
      const scale = IMAGE_NODE_MAX_DIMENSION / targetWidth
      targetWidth = IMAGE_NODE_MAX_DIMENSION
      targetHeight *= scale
    }
    return { width: Math.round(targetWidth), height: Math.round(targetHeight) }
  }

  let targetHeight = IMAGE_NODE_MAX_DIMENSION
  let targetWidth = targetHeight * ratio
  if (targetWidth < IMAGE_NODE_MIN_DIMENSION) {
    targetWidth = IMAGE_NODE_MIN_DIMENSION
    targetHeight = targetWidth / ratio
  }
  if (targetHeight > IMAGE_NODE_MAX_DIMENSION) {
    const scale = IMAGE_NODE_MAX_DIMENSION / targetHeight
    targetHeight = IMAGE_NODE_MAX_DIMENSION
    targetWidth *= scale
  }
  return { width: Math.round(targetWidth), height: Math.round(targetHeight) }
}


export interface ImageSearchDialogProps {
  openImageSearch: boolean
  setOpenImageSearch: (open: boolean) => void
}


/**
 * Dialog component for searching and selecting images.
 */
export const ImageSearchDialog = ({ openImageSearch, setOpenImageSearch }: ImageSearchDialogProps) => {
  const [q, setQ] = useState<string>('')
  const [isImporting, setIsImporting] = useState<boolean>(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const debouncedQ = useDebouncedValue<string>({ value: q, delay: 1000 })

  const { data, isLoading } = useSearchImages({ query: debouncedQ })

  const addNode = useAddNoteNode()
  const addImageFromFile = useAddImageFromFile()

  const handleSelectImage = async (imgUrl: string) => {
    try {
      const { width, height } = await loadImageDimensions(imgUrl)
      const size = normalizeImageSize(width, height)
      addNode({ nodeType: 'image', imageUrl: imgUrl, size })
    } catch {
      addNode({ nodeType: 'image', imageUrl: imgUrl })
    } finally {
      setOpenImageSearch(false)
    }
  }

  const handleFilesPicked = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    setIsImporting(true)
    try {
      const files = Array.from(fileList)
      await Promise.all(
        files.map((file, index) =>
          addImageFromFile(file, {
            positionOffset: { x: index * 24, y: index * 24 },
          }),
        ),
      )
      setOpenImageSearch(false)
    } finally {
      setIsImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <Dialog open={openImageSearch} onOpenChange={setOpenImageSearch}>
      <DialogContent className='sm:max-w-2xl p-0 overflow-hidden sm:w-1/3 sm:h-[50vh] flex flex-col'>
        <DialogHeader className='p-4 border-b text-secondary-foreground w-full text-center'>
          <DialogTitle>Search images</DialogTitle>
        </DialogHeader>
        <div className='p-4'>
          <Input
            placeholder='Search Unsplash…'
            value={q}
            onChange={e => setQ(e.target.value)}
            autoFocus
            className='focus-visible:ring-2 focus-visible:ring-secondary-foreground/75 focus-visible:border-secondary-foreground'
          />
        </div>
        <div className='px-4 pb-2'>
          <button
            type='button'
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className='flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 px-4 py-3 text-sm text-muted-foreground hover:border-secondary-foreground/75 hover:text-secondary-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60 transition-colors'
          >
            <ImagePlaceholderIcon className='size-4 shrink-0' />
            <span>{isImporting ? 'Importing…' : 'Import from computer'}</span>
          </button>
          <input
            ref={fileInputRef}
            type='file'
            accept='image/*'
            multiple
            className='hidden'
            onChange={e => void handleFilesPicked(e.target.files)}
          />
        </div>
        <div className='p-4 pt-2 h-full w-full flex-1 overflow-y-auto scrollbar-thin'>
          {isLoading ? (
            <div className='grid grid-cols-2 sm:grid-cols-3 gap-3 w-full'>
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className='aspect-square w-full' />
              ))}
            </div>
          ) : (
            <div className='grid grid-cols-2 sm:grid-cols-3 gap-3 w-full'>
              {data?.map(img => (
                <button
                  key={img.url}
                  className='group relative aspect-square rounded-md overflow-hidden border hover:ring-2 hover:ring-secondary-foreground/75'
                  onClick={() => { void handleSelectImage(img.url) }}
                >
                  <img src={img.url} alt={img.description || 'image'} className='size-full object-cover' />
                </button>
              ))}
              {debouncedQ && !data?.length && (
                <div className='col-span-full text-sm text-muted-foreground p-4'>No results</div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
