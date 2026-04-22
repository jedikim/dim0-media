import type { AppIconComponent } from "@/components/icons"
import {
  ClaudeBrandIcon,
  DeepSeekBrandIcon,
  Dim0Icon,
  GeminiBrandIcon,
  MistralBrandIcon,
  MoonshotBrandIcon,
  OpenAIBrandIcon,
  QwenBrandIcon,
  ZAiBrandIcon,
} from "@/components/icons"

export const LlmModels = [
  "auto",
  "openai/gpt-5.2",
  "openai/gpt-5.2-chat-latest",
  "openai/gpt-5.1",
  "openai/gpt-5.1-chat-latest",
  "openai/gpt-4o",
  "openai/gpt-4.1",
  "openai/gpt-5",
  "openai/gpt-5.4",
  "openai/gpt-5.4-mini",
  "openai/gpt-5.4-nano",
  "openai/gpt-5-mini",
  "openai/gpt-5-nano",
  "openrouter/anthropic/claude-opus-4.6",
  "openrouter/anthropic/claude-opus-4.5",
  "openrouter/anthropic/claude-opus-4.1",
  "openrouter/anthropic/claude-sonnet-4.6",
  "openrouter/anthropic/claude-haiku-4.5",
  "openrouter/google/gemini-3-pro-preview",
  "openrouter/google/gemini-2.5-pro",
  "openrouter/google/gemini-2.5-flash",
  "openrouter/mistralai/mistral-large-2512",
  "openrouter/mistralai/mistral-medium-3.1",
  "openrouter/deepseek/deepseek-v3.2",
  "openrouter/deepseek/deepseek-chat-v3.1",
  "openrouter/z-ai/glm-4.7:nitro",
  "openrouter/qwen/qwen3.5-plus-02-15",
  "openrouter/qwen/qwen3.6-plus-preview:free",
  "openrouter/moonshotai/kimi-k2.5:nitro"
] as const

export type LlmModel = typeof LlmModels[number]

export const LlmName: Record<LlmModel, string> = {
  "auto": "Auto",
  "openai/gpt-5.2": "GPT-5.2",
  "openai/gpt-5.2-chat-latest": "GPT-5.2 Chat",
  "openai/gpt-5.1-chat-latest": "GPT-5.1 Chat",
  "openai/gpt-5.1": "GPT-5.1",
  "openai/gpt-4o": "GPT-4o",
  "openai/gpt-4.1": "GPT-4.1",
  "openai/gpt-5": "GPT-5",
  "openai/gpt-5.4": "GPT-5.4",
  "openai/gpt-5.4-mini": "GPT-5.4 Mini",
  "openai/gpt-5.4-nano": "GPT-5.4 Nano",
  "openai/gpt-5-mini": "GPT-5 Mini",
  "openai/gpt-5-nano": "GPT-5 Nano",
  "openrouter/google/gemini-3-pro-preview": "Gemini 3 Pro Preview",
  "openrouter/google/gemini-2.5-pro": "Gemini 2.5 Pro",
  "openrouter/google/gemini-2.5-flash": "Gemini 2.5 Flash",
  "openrouter/anthropic/claude-opus-4.6": "Claude Opus 4.6",
  "openrouter/anthropic/claude-opus-4.5": "Claude Opus 4.5",
  "openrouter/anthropic/claude-opus-4.1": "Claude Opus 4.1",
  "openrouter/anthropic/claude-sonnet-4.6": "Claude Sonnet 4.6",
  "openrouter/anthropic/claude-haiku-4.5": "Claude Haiku 4.5",
  "openrouter/mistralai/mistral-large-2512": "Mistral Large",
  "openrouter/mistralai/mistral-medium-3.1": "Mistral Medium",
  "openrouter/deepseek/deepseek-v3.2": "DeepSeek",
  "openrouter/deepseek/deepseek-chat-v3.1": "DeepSeek Chat",
  "openrouter/z-ai/glm-4.7:nitro": "GLM-4.7",
  "openrouter/qwen/qwen3.5-plus-02-15": "Qwen 3.5 Plus",
  "openrouter/qwen/qwen3.6-plus-preview:free": "Qwen 3.6 Plus Preview",
  "openrouter/moonshotai/kimi-k2.5:nitro": "Kimi K2.5"
}

export const LlmDescription: Record<LlmModel, string> = {
  "auto": "Choose the best model per task complexity",
  "openai/gpt-5.2": "Next-generation model offering advanced reasoning and broader skill coverage",
  "openai/gpt-5.2-chat-latest": "Latest GPT-5.2 model optimized for chat applications with enhanced capabilities",
  "openai/gpt-5.1": "Next-generation model offering advanced reasoning and broader skill coverage",
  "openai/gpt-5.1-chat-latest": "Latest GPT-5.1 model optimized for chat applications with enhanced capabilities",
  "openai/gpt-4o": "High-quality, fast, and capable model with strong reasoning and low latency",
  "openai/gpt-4.1": "Enhanced GPT-4 model with balanced performance across reasoning and creativity",
  "openai/gpt-5": "Next-generation model offering advanced reasoning and broader skill coverage",
  "openai/gpt-5.4": "Latest GPT-5.4 model offering advanced reasoning and broader skill coverage",
  "openai/gpt-5.4-mini": "Compact GPT-5.4 variant optimized for efficiency and responsiveness",
  "openai/gpt-5.4-nano": "Ultra-light GPT-5.4 variant ideal for quick or edge tasks",
  "openai/gpt-5-mini": "Compact GPT-5 version optimized for efficiency and responsiveness",
  "openai/gpt-5-nano": "Ultra-light GPT-5 variant ideal for quick or edge tasks",
  "openrouter/google/gemini-3-pro-preview": "Cutting-edge Gemini model with advanced reasoning and multimodal capabilities",
  "openrouter/google/gemini-2.5-pro": "Powerful Gemini model designed for professional applications with enhanced understanding",
  "openrouter/google/gemini-2.5-flash": "Lightweight Gemini variant optimized for speed and efficiency",
  "openrouter/anthropic/claude-opus-4.6": "Top-tier Claude model known for its long-context reasoning and safety alignment",
  "openrouter/anthropic/claude-opus-4.5": "Top-tier Claude model known for its long-context reasoning and safety alignment",
  "openrouter/anthropic/claude-opus-4.1": "Top-tier Claude model known for its long-context reasoning and safety alignment",
  "openrouter/anthropic/claude-sonnet-4.6": "Balanced Claude model combining speed with nuanced understanding",
  "openrouter/anthropic/claude-haiku-4.5": "Lightweight and responsive Claude variant suited for everyday tasks",
  "openrouter/mistralai/mistral-large-2512": "Powerful Mistral model excelling in complex reasoning and creativity",
  "openrouter/mistralai/mistral-medium-3.1": "Efficient Mistral model offering strong multilingual and structured reasoning",
  "openrouter/deepseek/deepseek-v3.2": "Advanced open-source model with strong performance across various tasks",
  "openrouter/deepseek/deepseek-chat-v3.1": "High-performance open-source model with advanced reasoning and adaptability",
  "openrouter/z-ai/glm-4.7:nitro": "Fast general-purpose model from Z.ai with strong reasoning and coding ability",
  "openrouter/qwen/qwen3.5-plus-02-15": "Versatile Qwen model tuned for strong multilingual reasoning and tool use",
  "openrouter/qwen/qwen3.6-plus-preview:free": "Preview of Qwen 3.6 with stronger reasoning, agentic behavior, and coding performance",
  "openrouter/moonshotai/kimi-k2.5:nitro": "Fast Moonshot model tuned for stronger reasoning, coding, and agentic tasks"
}


export const LlmTiers = ["Rapid", "Balanced", "Elite"] as const
export type LlmTier = typeof LlmTiers[number]


export const LlmBadge: Record<LlmModel, LlmTier> = {
  "auto": "Balanced",
  "openai/gpt-5.2": "Elite",
  "openai/gpt-5.2-chat-latest": "Elite",
  "openai/gpt-5.1-chat-latest": "Elite",
  "openai/gpt-5.1": "Elite",
  "openai/gpt-4o": "Balanced",
  "openai/gpt-4.1": "Balanced",
  "openai/gpt-5": "Elite",
  "openai/gpt-5.4": "Elite",
  "openai/gpt-5.4-mini": "Rapid",
  "openai/gpt-5.4-nano": "Rapid",
  "openai/gpt-5-mini": "Rapid",
  "openai/gpt-5-nano": "Rapid",
  "openrouter/google/gemini-3-pro-preview": "Elite",
  "openrouter/google/gemini-2.5-pro": "Elite",
  "openrouter/google/gemini-2.5-flash": "Rapid",
  "openrouter/anthropic/claude-opus-4.6": "Elite",
  "openrouter/anthropic/claude-opus-4.5": "Elite",
  "openrouter/anthropic/claude-opus-4.1": "Elite",
  "openrouter/anthropic/claude-sonnet-4.6": "Balanced",
  "openrouter/anthropic/claude-haiku-4.5": "Rapid",
  "openrouter/mistralai/mistral-large-2512": "Elite",
  "openrouter/mistralai/mistral-medium-3.1": "Balanced",
  "openrouter/deepseek/deepseek-v3.2": "Balanced",
  "openrouter/deepseek/deepseek-chat-v3.1": "Balanced",
  "openrouter/z-ai/glm-4.7:nitro": "Balanced",
  "openrouter/qwen/qwen3.5-plus-02-15": "Balanced",
  "openrouter/qwen/qwen3.6-plus-preview:free": "Balanced",
  "openrouter/moonshotai/kimi-k2.5:nitro": "Balanced"
}

export const LlmFamilies = [
  "dim0",
  "openai",
  "google",
  "anthropic",
  "mistralai",
  "deepseek",
  "z-ai",
  "qwen",
  "moonshotai"
]

export type LlmFamily = typeof LlmFamilies[number]

export const LlmFamilyMap: Record<LlmModel, LlmFamily> = {
  "auto": "dim0",
  "openai/gpt-5.2": "openai",
  "openai/gpt-5.2-chat-latest": "openai",
  "openai/gpt-5.1-chat-latest": "openai",
  "openai/gpt-5.1": "openai",
  "openai/gpt-4o": "openai",
  "openai/gpt-4.1": "openai",
  "openai/gpt-5": "openai",
  "openai/gpt-5.4": "openai",
  "openai/gpt-5.4-mini": "openai",
  "openai/gpt-5.4-nano": "openai",
  "openai/gpt-5-mini": "openai",
  "openai/gpt-5-nano": "openai",
  "openrouter/google/gemini-3-pro-preview": "google",
  "openrouter/google/gemini-2.5-pro": "google",
  "openrouter/google/gemini-2.5-flash": "google",
  "openrouter/anthropic/claude-opus-4.6": "anthropic",
  "openrouter/anthropic/claude-opus-4.5": "anthropic",
  "openrouter/anthropic/claude-opus-4.1": "anthropic",
  "openrouter/anthropic/claude-sonnet-4.6": "anthropic",
  "openrouter/anthropic/claude-haiku-4.5": "anthropic",
  "openrouter/mistralai/mistral-large-2512": "mistralai",
  "openrouter/mistralai/mistral-medium-3.1": "mistralai",
  "openrouter/deepseek/deepseek-v3.2": "deepseek",
  "openrouter/deepseek/deepseek-chat-v3.1": "deepseek",
  "openrouter/z-ai/glm-4.7:nitro": "z-ai",
  "openrouter/qwen/qwen3.5-plus-02-15": "qwen",
  "openrouter/qwen/qwen3.6-plus-preview:free": "qwen",
  "openrouter/moonshotai/kimi-k2.5:nitro": "moonshotai"
}


export const LlmFamilyIcon: Record<LlmFamily, AppIconComponent> = {
  dim0: Dim0Icon,
  openai: OpenAIBrandIcon,
  google: GeminiBrandIcon,
  anthropic: ClaudeBrandIcon,
  mistralai: MistralBrandIcon,
  deepseek: DeepSeekBrandIcon,
  "z-ai": ZAiBrandIcon,
  qwen: QwenBrandIcon,
  moonshotai: MoonshotBrandIcon
}
