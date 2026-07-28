/**
 * Minimal `{{ key }}` interpolation — the only Jinja feature our ported prompts
 * use (skill prompts are static). Replaces a server-side template engine.
 */
export const renderPrompt = (template: string, vars: Record<string, string> = {}): string =>
  template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => vars[key] ?? "")
