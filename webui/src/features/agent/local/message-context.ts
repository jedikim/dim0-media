/**
 * Wrap a user prompt with the selected-note context block, mirroring the
 * backend's `<MessageContext>` envelope (assistant/manager.py) so the local
 * agent receives the same shape as the online path. Returns the bare prompt
 * when there's no usable context.
 */
export const wrapWithMessageContext = (prompt: string, context?: string): string => {
  const block = context?.trim()
  if (!block) return prompt
  return `<MessageContext>\n\n${block}\n\n</MessageContext>\n\n${prompt}`
}
