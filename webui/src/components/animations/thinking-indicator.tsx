import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { THINKING_ICONS, THINKING_VERBS, type ThinkingIcon } from "./thinking-indicator-presets"


type SweepTextProps = {
  text: string
  msPerChar?: number
  className?: string
}


/**
 * Replaces the currently rendered text by running a two-slot cursor zone
 * (trailing underscore + block caret) through the word left → right.
 * Characters behind the cursor show the new text, characters ahead of it
 * still show the old one, and the cursor advances one slot per tick so the
 * swap reads as a terminal-style inline retype. Initial mount sweeps from
 * empty into the first verb so the indicator boots up rather than appearing
 * pre-typed. Assumes a monospaced font.
 */
const SweepText = ({ text, msPerChar = 90, className = "" }: SweepTextProps) => {
  const reduceMotion = useReducedMotion()
  const [display, setDisplay] = useState("")
  const [previous, setPrevious] = useState<string | null>(null)
  const [cursorIndex, setCursorIndex] = useState(-1)
  const timerRef = useRef<number | null>(null)
  const displayRef = useRef("")

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  // Layout effect (not effect) so the empty→first-verb sweep starts before
  // the first paint — avoids a 1-frame flash where the layout collapses to
  // zero width and the icon/dots jump in toward each other.
  useLayoutEffect(() => {
    if (reduceMotion) {
      displayRef.current = text
      setDisplay(text)
      setPrevious(null)
      setCursorIndex(-1)
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      return
    }

    if (text === displayRef.current) return

    const prev = displayRef.current
    displayRef.current = text

    setPrevious(prev)
    setDisplay(text)
    setCursorIndex(0)

    if (timerRef.current !== null) window.clearTimeout(timerRef.current)

    const totalSlots = Math.max(text.length, prev.length)
    let i = 0

    const step = () => {
      i += 1
      if (i > totalSlots) {
        setCursorIndex(-1)
        setPrevious(null)
        timerRef.current = null
        return
      }
      setCursorIndex(i)
      timerRef.current = window.setTimeout(step, msPerChar)
    }

    timerRef.current = window.setTimeout(step, msPerChar)
  }, [text, msPerChar, reduceMotion])

  const slots = useMemo(() => {
    const prev = previous ?? display
    const maxLen = Math.max(display.length, prev.length)

    return Array.from({ length: maxLen }, (_, i) => ({
      oldChar: prev[i] ?? "\u00A0",
      newChar: display[i] ?? "\u00A0",
    }))
  }, [display, previous])

  if (reduceMotion) {
    return <span className={`inline-flex font-mono ${className}`}>{text}</span>
  }

  const sweeping = previous !== null && cursorIndex >= 0

  return (
    <span className={`relative inline-flex font-mono ${className}`}>
      {slots.map((slot, i) => {
        let glyph: string = slot.newChar
        let isBlock = false

        if (sweeping) {
          if (i < cursorIndex - 1) {
            glyph = slot.newChar
          } else if (i === cursorIndex - 1) {
            glyph = "_"
          } else if (i === cursorIndex) {
            isBlock = true
            glyph = "\u00A0"
          } else {
            glyph = slot.oldChar
          }
        }

        return (
          <span key={i} className="relative inline-block">
            <span className={isBlock ? "invisible" : ""}>{glyph === " " ? "\u00A0" : glyph}</span>
            {isBlock && (
              <span
                aria-hidden
                className="pointer-events-none absolute top-[0.08em] bottom-[0.08em] left-0 right-0 rounded-[2px] bg-current"
              />
            )}
          </span>
        )
      })}
    </span>
  )
}


type ThinkingIndicatorProps = {
  verbs?: string[]
  icons?: ThinkingIcon[]
  iconInterval?: number
  textInterval?: number
  iconSize?: number
  className?: string
}


/**
 * Animated "thinking" status line: a Phosphor icon cycles in slot-machine
 * fashion (exit up, next enters from below) on its own fast cadence, while
 * the accompanying verb swaps character-by-character behind a sliding
 * selection highlight on a slower cadence. Intervals, icon set, and verb
 * list are all overridable so the same component can be retuned per surface.
 */
export const ThinkingIndicator = ({
  verbs = THINKING_VERBS,
  icons = THINKING_ICONS,
  iconInterval = 900,
  textInterval = 2200,
  iconSize = 16,
  className = "",
}: ThinkingIndicatorProps) => {
  const reduceMotion = useReducedMotion()
  const [iconStep, setIconStep] = useState(0)
  const [textStep, setTextStep] = useState(0)

  useEffect(() => {
    if (reduceMotion) return
    const id = window.setInterval(() => setIconStep(s => s + 1), iconInterval)
    return () => window.clearInterval(id)
  }, [iconInterval, reduceMotion])

  useEffect(() => {
    if (reduceMotion) return
    const id = window.setInterval(() => setTextStep(s => s + 1), textInterval)
    return () => window.clearInterval(id)
  }, [textInterval, reduceMotion])

  const iconEntry = icons[iconStep % icons.length]
  const verb = verbs[textStep % verbs.length]
  const Icon = iconEntry.Icon

  if (reduceMotion) {
    return (
      <span className={`inline-flex items-center gap-2 font-mono text-sm leading-none ${className}`}>
        <Icon size={iconSize} weight="duotone" />
        <span>{verb}…</span>
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center gap-2 font-mono text-sm leading-none ${className}`}
    >
      <span
        className="relative inline-block overflow-hidden"
        style={{ width: iconSize, height: iconSize }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={`${iconEntry.key}-${iconStep}`}
            initial={{ y: iconSize, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -iconSize, opacity: 0 }}
            transition={{
              y: { type: "spring", stiffness: 260, damping: 24 },
              opacity: { duration: 0.18 },
            }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <Icon size={iconSize} weight="duotone" />
          </motion.span>
        </AnimatePresence>
      </span>

      <SweepText text={verb} />

      <ThinkingDots />
    </span>
  )
}


/**
 * Three pulsing dots, phase-offset so they look like an ellipsis breathing.
 * Collapses to a static ellipsis when the user prefers reduced motion.
 */
export const ThinkingDots = () => {
  const reduceMotion = useReducedMotion()

  if (reduceMotion) {
    return <span aria-hidden className="inline-flex font-mono text-muted-foreground">…</span>
  }

  return (
    <span aria-hidden className="inline-flex font-mono text-muted-foreground">
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            delay: i * 0.18,
            ease: "easeInOut",
          }}
        >
          .
        </motion.span>
      ))}
    </span>
  )
}
