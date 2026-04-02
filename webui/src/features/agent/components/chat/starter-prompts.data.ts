import type { IconSvgElement } from "@hugeicons/react"
import {
  AiLearningIcon,
  AiProgrammingIcon,
  ChartBubble02Icon,
  Note02Icon,
} from "@hugeicons/core-free-icons"


export type StarterPromptDefinition = {
  id: string
  label: string
  description: string
  prompt: string
  icon: IconSvgElement
}


export const STARTER_PROMPTS: StarterPromptDefinition[] = [
  {
    id: "learn",
    label: "Learn",
    description: "Understand a topic from scratch with a few clarifying questions first.",
    icon: AiLearningIcon,
    prompt: `Hi! Could you help me understand a complex topic from scratch? If you need more information from me, ask me 1-2 key questions right away, like what topic I want to learn and what level I’m at now. If you think I should give you more context to help you do a better job, let me know. Use any tools you have access to, like web search or documents already available in the workspace, if they’ll help. If it makes sense, create something we can look at together, like a visual, a checklist, a comparison table, or something interactive. Thanks for your help!`,
  },
  {
    id: "visualize",
    label: "Visualize",
    description: "Turn a topic or process into a diagram, concept map, or visual explainer.",
    icon: ChartBubble02Icon,
    prompt: `Hi! Could you help me create a visual explainer for a topic, idea, or process? If you need more information from me, ask me 1-2 key questions right away, like what I want to explain, who it’s for, and what kind of visual would be most useful. If you think I should give you more context to help you do a better job, let me know. Use any tools you have access to if they’ll help. If it makes sense, create something we can look at together, like a diagram, a flow, a concept map, a checklist, or something interactive. Thanks for your help!`,
  },
  {
    id: "write-note",
    label: "Write note",
    description: "Research a topic and organize the result into a detailed sticky note.",
    icon: Note02Icon,
    prompt: `Hi! Could you help me research a topic and turn what you find into a detailed sticky note? If you need more information from me, ask me 1-2 key questions right away, like what topic I want covered and what depth or angle I care about most. If you think I should give you more context to help you do a better job, let me know. Use any tools you have access to, like web search or documents already available in the workspace, if they’ll help. If it makes sense, organize the result into a clear, useful note with the most important points, supporting details, and a structure that’s easy to skim. Thanks for your help!`,
  },
  {
    id: "code",
    label: "Code",
    description: "Write a simple Python algorithm with examples and a short explanation.",
    icon: AiProgrammingIcon,
    prompt: `Hi! Could you help me write a simple implementation of an algorithm in Python? If you need more information from me, ask me 1-2 key questions right away, like what the algorithm should do, what inputs and outputs I want, and any constraints or edge cases I care about. If you think I should give you more context to help you do a better job, let me know. Use any tools you have access to if they’ll help. If it makes sense, include a clean Python implementation, a short explanation of how it works, and a few example inputs and outputs. Thanks for your help!`,
  },
]
