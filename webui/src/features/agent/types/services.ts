/**
 * Represents a service option with its availability and provider.
 */
export interface ServiceOption {
  name: string
  available: boolean
  provider?: string
}

/**
 * A selectable LLM, carrying the display metadata the picker needs. `name` is
 * the canonical model id sent back to the backend (or "auto").
 */
export interface LlmOption extends ServiceOption {
  label: string
  family: string
  tier?: string
}


/**
 * Services grouped by category.
 */
export interface Services {
  llm: LlmOption[]
  search: ServiceOption[]
  navigate: ServiceOption[]
  code: ServiceOption[]
  imageGeneration: ServiceOption[]
}

// Constant array of service category names
export const SERVICE_NAMES = ["llm", "search", "navigate", "code", "imageGeneration"] as const

// Type representing the names of the service categories
export type ServiceName = typeof SERVICE_NAMES[number]


/**
 * Default services with their availability status.
 *
 * Note: All services are marked as unavailable by default.
 */
export const AUTO_LLM_OPTION: LlmOption = {
  name: "auto",
  label: "Auto",
  family: "dim0",
  provider: "dim0",
  available: true,
}


export const defaultServices: () => Services = () => ({
  // The real model list is filled in from the backend (keys-aware); only the
  // synthetic "auto" option is known client-side.
  llm: [AUTO_LLM_OPTION],
  search: [
    { name: "linkup", available: false, provider: "linkup" },
    { name: "exa", available: false, provider: "exa" },
    { name: "perplexity", available: false, provider: "perplexity" },
    { name: "tavily", available: false, provider: "tavily" },
    { name: "openai", available: false, provider: "openai" },
  ],
  navigate: [
    { name: "tavily", available: false, provider: "tavily" },
  ],
  code: [
    { name: "openai", available: false, provider: "openai" },
  ],
  imageGeneration: [
    { name: "openrouter", available: false, provider: "openrouter" },
  ],
})


/**
 * Check if a service option is available.
 *
 * @param option - The name of the service option to check.
 * @param serviceName - The category of the service.
 * @param services - The services object containing availability info.
 * @returns True if the option is available, false otherwise.
 */
export function assertAvailable({
  option, serviceName, services
}: { option: string, serviceName: ServiceName, services: Services }): boolean {
  return services[serviceName].some((service) => service.name === option && service.available)
}
