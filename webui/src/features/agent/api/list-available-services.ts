import { apiFetch } from "@/api"
import { useQuery } from "@tanstack/react-query"
import { AUTO_LLM_OPTION, defaultServices, type Services } from "../types/services"
import { useChatStore } from "../store/chat-store"
import { useEffect } from "react"
import { useIsSignedIn } from "@/lib/auth"


/**
 * One reachable model as served by the backend catalog.
 */
export interface AvailableLlm {
  id: string
  label: string
  family: string
  tier?: string
  provider?: string
}


/**
 * Response structure for listing available services.
 */
export interface ListAvailableServicesResponse {
  llm: AvailableLlm[]
  search: string[]
  // The backend still names the fetch service "navigate" (legacy, retires in G5);
  // it's mapped to `services.fetch` client-side in updateDefaultServices.
  navigate: string[]
  code: string[]
  image_generation: string[]
}


/**
 * Update the default services with the available services from the server.
 *
 * @param availableServices - The available services from the server.
 * @returns Updated services with availability status.
 */
const updateDefaultServices = ({
  availableServices,
}: {
  availableServices: ListAvailableServicesResponse
}): Services => {
  // This function can be used to update the DefaultServices constant
  const services: Services = defaultServices()
  // The backend returns exactly the reachable models; render them as-is, with
  // the synthetic "auto" option always first.
  services.llm = [
    AUTO_LLM_OPTION,
    ...availableServices.llm.map((model) => ({
      name: model.id,
      label: model.label,
      family: model.family,
      tier: model.tier,
      provider: model.provider,
      available: true,
    })),
  ]
  services.search = services.search.map((service) => ({
    ...service,
    available: availableServices.search.includes(service.name),
  }))
  services.fetch = services.fetch.map((service) => ({
    ...service,
    available: availableServices.navigate.includes(service.name),
  }))
  services.code = services.code.map((service) => ({
    ...service,
    available: availableServices.code.includes(service.name),
  }))
  services.imageGeneration = services.imageGeneration.map((service) => ({
    ...service,
    available: availableServices.image_generation.includes(service.name),
  }))

  return services
}


/**
 * Fetch the list of available services from the server.
 *
 * @returns A promise that resolves to the available services.
 */
export async function listAvailableServices(): Promise<Services> {
  const res = await apiFetch<{ data: ListAvailableServicesResponse }>({
    path: `/utils/services`,
    method: "GET",
  })

  return updateDefaultServices({ availableServices: res.data })
}


/**
 * React Query hook to list available services.
 *
 * @returns Query result containing the available services.
 */
export const useListAvailableServices = () => {
  const syncDefaults = useChatStore((state) => state.syncDefaults)
  const signedIn = useIsSignedIn()

  const { data: availableServices } = useQuery({
    queryKey: ["listAvailableServices"],
    queryFn: () => listAvailableServices(),
    // Server-side MCP connectors: never needed logged-out or on a device-only
    // board (the local agent runs via BYOK), and firing it logged-out 401s.
    enabled: signedIn,
    staleTime: Infinity,
  })

  useEffect(() => {
    if (availableServices) {
      syncDefaults(availableServices)
    }
  }, [availableServices, syncDefaults])

  return { availableServices }
}