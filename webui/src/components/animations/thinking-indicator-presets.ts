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
