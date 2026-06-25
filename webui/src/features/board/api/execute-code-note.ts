import camelcaseKeys from "camelcase-keys"

import { apiFetch } from "@/api"


export type CodeExecutionResult = {
  status: "success" | "error" | "timeout"
  stdout: string
  stderr: string
  durationMs: number
}


// Languages the Daytona backend can actually run (mirrors RUNNABLE_LANGUAGES
// in backend/topix/agents/assistant/code.py). A code-sandbox note whose
// language is outside this set renders as a plain code node — no Execute
// action, no stdout/stderr panel.
export const RUNNABLE_LANGUAGES = new Set(["python", "javascript"])


/** Whether a code node's language can be executed in a sandbox. */
export function isRunnable(language: string | undefined): boolean {
  return !!language && RUNNABLE_LANGUAGES.has(language)
}


export const DEFAULT_CODE_LANGUAGE = "python"


/**
 * Execute a code sandbox note on the backend and return stdout/stderr.
 */
export async function executeCodeNote(
  boardId: string,
  noteId: string,
): Promise<CodeExecutionResult> {
  const res = await apiFetch<{ data: Record<string, unknown> }>({
    path: `/boards/${boardId}/notes/${noteId}:execute`,
    method: "POST",
  })

  return camelcaseKeys(res.data, { deep: true }) as CodeExecutionResult
}
