import { getDomain } from 'tldts'
import type { AgentResponse } from '../types/stream'
import type { UrlAnnotation } from '../types/tool-outputs'
import { isToolCallStep } from '../types/stream'

/**
 * Extracts the main domain from a URL or hostname.
 * Returns null for invalid or non-domain inputs (e.g. IPs, localhost).
 */
export function extractMainDomain(input: string): string | null {
  return getDomain(input, { allowPrivateDomains: true }) ?? null
}

// Extract deduped source URLs from any web_search-typed tool step (web_search
// and fetch/navigate both emit this output) to build the end-of-message sources.
export function extractAnswerWebSources(answer: AgentResponse): UrlAnnotation[] {
  const sources: UrlAnnotation[] = []
  for (const step of answer.steps) {
    if (isToolCallStep(step) && typeof step.output !== "string" && step.output.type === "web_search") {
      step.output.searchResults.forEach(result => {
        const exist = sources.find(s => s.url === result.url)
        if (!exist) {
          sources.push(result)
        }
      })
    }
  }
  return sources
}
