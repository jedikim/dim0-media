import { cn } from '@/lib/utils'
import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from 'react'

const DotLottieReact = lazy(async () => {
  const m = await import('@lottiefiles/dotlottie-react')
  return { default: m.DotLottieReact }
})

const MASCOTS = [
  {
    name: 'Dog',
    file: 'Dog.lottie',
    message: "Ask me anything — I’ll sniff through the web and fetch the best insights!",
  },
  {
    name: 'Cat',
    file: 'Cat.lottie',
    message: 'Curiosity compiled — I pounce on citations so you don’t have to.',
  },
  {
    name: 'Shark',
    file: 'Shark.lottie',
    message: 'I circle the docs and bite into the signal — fast, sharp answers.',
  },
  {
    name: 'Mouse',
    file: 'Mouse.lottie',
    message: 'Tiny agent, mighty findings — I’ll nibble through noise to signal.',
  },
  {
    name: 'Panda',
    file: 'Panda.lottie',
    message: 'Open-source and bamboo-strong — calm, focused, and ready to reason things out.',
  },
  {
    name: 'Dolphin',
    file: 'Dolphin.lottie',
    message: 'Sleek, social, and smart — I’ll dive deep for data and surface insights.',
  },
  {
    name: 'Elephant',
    file: 'Elephant.lottie',
    message: 'I never forget a fact — big memory, bigger context.',
  },
  {
    name: 'Dove',
    file: 'Dove.lottie',
    message: 'Peaceful queries, pure answers — I’ll keep your search serene.',
  },
  {
    name: 'Penguin',
    file: 'Penguin.lottie',
    message: 'Cool under pressure — I glide across data and surface crisp answers.',
  },
  {
    name: 'Toucan',
    file: 'Toucan.lottie',
    message: 'Two can play at that game — I’ll squawk up the right sources.',
  },
  {
    name: 'Starfish',
    file: 'Starfish.lottie',
    message: 'Many arms, one mission — reaching across sources to bring answers together.',
  },
  {
    name: 'Spider',
    file: 'Spider.lottie',
    message: 'Spinning a web of open data — I catch insights others miss.',
  },
  {
    name: 'Pig',
    file: 'Pig.lottie',
    message: 'Rooting through the noise — I’ll sniff out the truffles of truth.',
  },
] as const

export type MascotName = typeof MASCOTS[number]['name']

function useRandomMascot() {
  const [index, setIndex] = useState<number | null>(null)

  useEffect(() => {
    setIndex(Math.floor(Math.random() * MASCOTS.length))
  }, [])

  const mascot = useMemo(() => (index == null ? null : MASCOTS[index]), [index])

  return { mascot, reshuffle: () => setIndex(Math.floor(Math.random() * MASCOTS.length)) }
}

function Oc({ file, size = 100 }: { file: string; size?: number }) {
  const src = `${import.meta.env.BASE_URL}animations/${file}`
  const box = { width: size, height: size }
  return (
    <Suspense fallback={<div style={box} />}>
      <DotLottieReact src={src} autoplay loop style={box} />
    </Suspense>
  )
}

/**
 * Render the shared centered mascot welcome layout used across chat surfaces.
 */
function WelcomeLayout({
  file,
  message,
  className,
  showShuffle = false,
  onShuffle,
  afterContent,
}: {
  file: string
  message: string
  className?: string
  showShuffle?: boolean
  onShuffle?: () => void
  afterContent?: ReactNode
}) {
  return (
    <div className={cn('relative w-full flex flex-col items-center justify-center text-center', className)}>
      <div className='flex justify-center'>
        <Oc file={file} />
      </div>
      <div className='mt-2 text-xl text-card-foreground'>
        <span>{message}</span>
      </div>
      {showShuffle && onShuffle ? (
        <button
          type='button'
          className='mt-3 rounded-md px-3 py-1 text-xs font-medium text-accent-foreground/50 bg-accent hover:bg-muted shadow-sm hover:text-accent-foreground transition-colors'
          onClick={onShuffle}
          aria-label='Shuffle welcome message'
        >
          Shuffle
        </button>
      ) : null}
      {afterContent ? <div className='mt-4 flex justify-center'>{afterContent}</div> : null}
    </div>
  )
}

export function WelcomeMessage({ afterContent }: { afterContent?: ReactNode }) {
  const { mascot, reshuffle } = useRandomMascot()

  if (!mascot) {
    return (
      <div className='relative w-full flex flex-col items-center justify-center text-center'>
        <div style={{ width: 100, height: 100 }} />
        <div className='mt-2 text-xl text-card-foreground'>
          <span>Loading your open‑source sidekick…</span>
        </div>
      </div>
    )
  }

  return (
    <WelcomeLayout
      file={mascot.file}
      message={mascot.message}
      showShuffle
      onShuffle={reshuffle}
      afterContent={afterContent}
    />
  )
}


/**
 * Render a fixed mascot variant with the shared welcome layout.
 */
export function ThemedWelcome({ name, message, className, afterContent }: { name: MascotName, message?: string, className?: string, afterContent?: ReactNode }) {
  const mascot = MASCOTS.find(m => m.name === name) ?? MASCOTS[0]

  const customMessage = message ?? mascot.message

  return (
    <WelcomeLayout
      file={mascot.file}
      message={customMessage}
      className={className}
      afterContent={afterContent}
    />
  )
}
