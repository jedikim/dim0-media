/** One provider route for a catalog model: the provider + its model string. */
export type ModelRoute = { via: string; model: string }


/**
 * A model from the public catalog (`GET /ai/models`). `id` is the canonical id a
 * MANAGED call sends; each route's `model` is the string a BYOK caller sends to
 * that provider (e.g. openai→"gpt-5.4", openrouter→"openai/gpt-5.4").
 */
export type PublicModel = {
  id: string
  label: string
  family: string
  tier?: string | null
  routes: ModelRoute[]
}


/**
 * Translate a chosen canonical id to the model string for a BYOK provider —
 * the route whose `via` matches. Undefined when the model has no route for that
 * provider (so it can't be reached with that key).
 */
export const byokModelForId = (
  models: PublicModel[],
  id: string,
  provider: string,
): string | undefined => models.find((m) => m.id === id)?.routes.find((r) => r.via === provider)?.model
