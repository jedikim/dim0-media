import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "@/api"
import type { PublicModel } from "../types/model-catalog"
import { useChatStore } from "../store/chat-store"


/** Fetch the public model catalog (`GET /ai/models`) — no auth, so it works for
 *  signed-out / BYOK users too. */
const fetchModelCatalog = async (): Promise<PublicModel[]> => {
  const res = await apiFetch<{ data: { llm: PublicModel[] } }>({
    path: "/ai/models",
    method: "GET",
    noAuth: true,
  })
  return res.data.llm
}


/**
 * Load the model catalog into the chat store so the picker lists real models
 * (grouped by family, with tiers) for everyone — including signed-out BYOK,
 * which the old signed-in-only `/utils/services` fetch left showing just "Auto".
 */
export const useModelCatalog = (): void => {
  const setModelCatalog = useChatStore((s) => s.setModelCatalog)
  const { data } = useQuery({
    queryKey: ["aiModels"],
    queryFn: fetchModelCatalog,
    staleTime: Infinity,
  })
  useEffect(() => {
    if (data) setModelCatalog(data)
  }, [data, setModelCatalog])
}
