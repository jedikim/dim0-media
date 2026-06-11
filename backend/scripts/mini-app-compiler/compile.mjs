// Stdin → JSON-on-stdout sucrase compile + static "is this a Widget?" check.
//
// Invoked from Python via `topix.mini_app.compile.compile_mini_app_source`:
//
//   node compile.mjs < <source>
//   { ok: true } | { ok: false, error: { kind, message, line?, column? } }
//
// We do NOT execute the agent's code here. Server-side execution would
// give the user's code access to Node's globals (fs, child_process,
// fetch) — that's a remote-code-execution surface we very much don't
// want. The contract is "this string can be sucrase-transpiled and
// declares a Widget/App at the top level"; the iframe runtime catches
// anything subtler at render time.

import { transform } from "sucrase"


/** Read all of stdin as a UTF-8 string. */
async function readStdin() {
  let data = ""
  for await (const chunk of process.stdin) {
    data += chunk.toString("utf-8")
  }
  return data
}


/**
 * Pull `(line:col)` out of a sucrase error message.
 * Returns {} when not found rather than throwing — we still want to
 * surface the message even without position.
 */
function parsePosition(message) {
  const match = /\((\d+):(\d+)\)/.exec(message)
  if (!match) return {}
  return { line: Number(match[1]), column: Number(match[2]) }
}


/**
 * Static check that the source declares a top-level `Widget` or `App`.
 *
 * Uses a regex on the *original* source rather than the transpiled
 * output — function/const/let/var declarations survive sucrase's JSX
 * transform unchanged, so a regex on either works, but matching the
 * source keeps the check independent of sucrase output quirks.
 *
 * False positives ("looks like Widget exists but actually broken") are
 * fine — the iframe runtime's compile pipeline catches them at render
 * time and shows a runtime error card. False negatives would be worse
 * (rejecting a valid widget), so the regex is intentionally loose.
 */
function hasWidgetDeclaration(source) {
  return /\b(?:function|const|let|var)\s+(?:Widget|App)\b/.test(source)
}


function emit(payload) {
  process.stdout.write(JSON.stringify(payload))
}


async function main() {
  const source = await readStdin()

  if (!source.trim()) {
    emit({
      ok: false,
      error: {
        kind: "empty",
        message: "mini-app source is empty",
      },
    })
    return
  }

  let result
  try {
    result = transform(source, {
      transforms: ["jsx", "typescript"],
      jsxRuntime: "classic",
      production: true,
    })
  } catch (err) {
    const message = err?.message ?? String(err)
    emit({
      ok: false,
      error: { kind: "compile", message, ...parsePosition(message) },
    })
    return
  }

  if (!hasWidgetDeclaration(source)) {
    emit({
      ok: false,
      error: {
        kind: "no_widget",
        message:
          "no Widget or App component found — define " +
          "`function Widget() { ... }` (or `const Widget = () => ...`) " +
          "at the top level of your source",
      },
    })
    return
  }

  // Sanity: ensure sucrase produced *something*. If transpiled is
  // empty for some weird reason, the runtime would fail with a
  // confusing error.
  if (!result.code.trim()) {
    emit({
      ok: false,
      error: {
        kind: "compile",
        message: "sucrase returned empty output for a non-empty source",
      },
    })
    return
  }

  emit({ ok: true })
}


main().catch((err) => {
  // Last-resort safety net so the python wrapper always sees JSON
  // even if main() itself throws. Exit 0 because the *contract* with
  // the python side is "JSON on stdout"; non-zero exit would make
  // the wrapper treat this as subprocess failure.
  emit({
    ok: false,
    error: { kind: "compile", message: err?.message ?? String(err) },
  })
  process.exit(0)
})
