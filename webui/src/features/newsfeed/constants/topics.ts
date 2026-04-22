import type { AppIconComponent } from "@/components/icons"
import { LearnWidgetIcon, PropertyIcon, StethoscopeIcon, GlobeIcon, MemorySearchIcon } from "@/components/icons"

export const PREDEFINED_TOPICS = ['ai', 'technology', 'health', 'climate', 'finance'] as const
export type PredefinedTopic = typeof PREDEFINED_TOPICS[number]

/**
 * A human-readable display name for each predefined topic.
 */
export const TOPIC_DISPLAY: Record<PredefinedTopic, string> = {
  ai: 'Artificial Intelligence',
  technology: 'Technology',
  health: 'Health',
  climate: 'Climate',
  finance: 'Finance'
}

/**
 * An emoji to represent each predefined topic.
 */
export const TOPIC_EMOJI: Record<PredefinedTopic, AppIconComponent> = {
  ai: PropertyIcon,
  technology: MemorySearchIcon,
  health: StethoscopeIcon,
  climate: GlobeIcon,
  finance: LearnWidgetIcon
}

/**
 * If the given name matches a predefined topic (case-insensitive, trimmed),
 */
export const matchPredefined = (name: string | undefined) => {
  const n = (name ?? '').trim().toLowerCase()
  const found = PREDEFINED_TOPICS.find(t => t === n)
  return found
}
