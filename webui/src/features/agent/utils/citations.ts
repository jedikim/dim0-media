/**
 * URL-citation correction — a TS port of the backend's `post_process_url_citations`
 * (battle-tested). The model sometimes emits a truncated or slightly-mangled
 * source URL; this snaps each `http(s)://…` in the answer back to the nearest
 * real source URL (from the web-search results) via a char trie. Pure + framework
 * -free; the sources panel then renders straight from the (corrected) answer text.
 */

/** A `true` leaf marks a complete URL; char keys branch. */
type TrieNode = { [key: string]: TrieNode | true }

const END = "#END#"

/** Min matched chars before we trust a fuzzy completion (mirrors the backend). */
export const MIN_MATCHES = 10

const URL_RE = /https?:\/\/[^\s()<>[\]]*/g


const createTrie = (urls: Iterable<string>): TrieNode => {
  const root: TrieNode = {}
  for (const url of urls) {
    let node = root
    for (const ch of url) {
      const next = node[ch]
      if (!next || next === true) node[ch] = {}
      node = node[ch] as TrieNode
    }
    node[END] = true
  }
  return root
}


/**
 * Nearest valid URL for `url` in the trie, or `url` unchanged when not confident.
 * Non-matching characters are skipped (tolerates noise); once ≥ MIN_MATCHES chars
 * have matched, a single-path tail is greedily completed to the URL's end.
 */
const getValidUrl = (url: string, trie: TrieNode): string => {
  let node = trie
  let validUrl = ""
  let numMatches = 0

  for (const ch of url) {
    const next = node[ch]
    if (next && next !== true) {
      validUrl += ch
      node = next
      if (END in node) return validUrl
      numMatches += 1
    }
  }

  if (numMatches < MIN_MATCHES) return url

  while (!(END in node)) {
    const key = Object.keys(node)[0]
    if (key === undefined) break
    validUrl += key
    node = node[key] as TrieNode
  }
  return validUrl
}


/** Correct every URL in `answer` against the set of real source `validUrls`. */
export const postProcessUrlCitations = (answer: string, validUrls: string[]): string => {
  if (validUrls.length === 0) return answer
  const validSet = new Set(validUrls)
  const trie = createTrie(validSet)
  return answer.replace(URL_RE, (match) => {
    if (validSet.has(match)) return match
    return getValidUrl(match, trie)
  })
}
