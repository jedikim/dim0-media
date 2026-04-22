import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import {
  AcornIcon,
  DropSimpleIcon,
  LightningIcon,
  LogIcon,
  MountainsIcon,
  SailboatIcon,
  SnowflakeIcon,
  StarFourIcon,
  SunIcon,
  TreeIcon,
  type Icon as PhosphorIconType,
} from "@phosphor-icons/react"


export type ThinkingIcon = {
  key: string
  Icon: PhosphorIconType
}


/**
 * Default nature/weather icon set used for the thinking indicator.
 * Kept in declaration order so callers can reshuffle or trim as needed.
 */
export const THINKING_ICONS: ThinkingIcon[] = [
  { key: "snowflake", Icon: SnowflakeIcon },
  { key: "lightning", Icon: LightningIcon },
  { key: "sun", Icon: SunIcon },
  { key: "tree", Icon: TreeIcon },
  { key: "log", Icon: LogIcon },
  { key: "starFour", Icon: StarFourIcon },
  { key: "mountains", Icon: MountainsIcon },
  { key: "acorn", Icon: AcornIcon },
  { key: "drop", Icon: DropSimpleIcon },
  { key: "sailboat", Icon: SailboatIcon },
]


/**
 * Twenty present-participle verbs used to label the thinking state.
 * Tone is inspired by Claude Code's playful status line.
 */
export const THINKING_VERBS: string[] = [
  "Thinking",
  "Pondering",
  "Musing",
  "Cooking",
  "Brewing",
  "Wandering",
  "Dreaming",
  "Sketching",
  "Noodling",
  "Crafting",
  "Weaving",
  "Plotting",
  "Sifting",
  "Reasoning",
  "Reflecting",
  "Untangling",
  "Distilling",
  "Imagining",
  "Mulling",
  "Conjuring",
]


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
 * swap reads as a terminal-style inline retype. Assumes a monospaced font.
 */
const SweepText = ({ text, msPerChar = 90, className = "" }: SweepTextProps) => {
  const [display, setDisplay] = useState(text)
  const [previous, setPrevious] = useState<string | null>(null)
  const [cursorIndex, setCursorIndex] = useState(-1)
  const timerRef = useRef<number | null>(null)
  const displayRef = useRef(display)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  useEffect(() => {
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
  }, [text, msPerChar])

  const slots = useMemo(() => {
    const prev = previous ?? display
    const maxLen = Math.max(display.length, prev.length)

    return Array.from({ length: maxLen }, (_, i) => ({
      oldChar: prev[i] ?? "\u00A0",
      newChar: display[i] ?? "\u00A0",
    }))
  }, [display, previous])

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
  const [iconStep, setIconStep] = useState(0)
  const [textStep, setTextStep] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setIconStep(s => s + 1), iconInterval)
    return () => window.clearInterval(id)
  }, [iconInterval])

  useEffect(() => {
    const id = window.setInterval(() => setTextStep(s => s + 1), textInterval)
    return () => window.clearInterval(id)
  }, [textInterval])

  const iconEntry = icons[iconStep % icons.length]
  const verb = verbs[textStep % verbs.length]
  const Icon = iconEntry.Icon

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
 */
const ThinkingDots = () => (
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
