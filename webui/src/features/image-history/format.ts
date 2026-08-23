import type { ImageHistoryUser } from "./api/image-history"


/** Format creator identity consistently across summaries, filters, and rows. */
export function imageHistoryUserLabel(user: ImageHistoryUser): string {
  const name = user.name?.trim()
  return name ? `${name} · @${user.username}` : `@${user.username}`
}


/** Format a server-summed Decimal cost without binary floating-point conversion. */
export function formatKnownCostUsd(value: string | null): string {
  if (value === null) return "미보고"
  const match = /^(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value)
  if (!match) return "미보고"
  const fraction = match[2] ?? ""
  const exponent = Number(match[3] ?? "0")
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) return "미보고"
  const coefficient = BigInt(`${match[1]}${fraction}`)
  const scalePower = exponent - fraction.length + 4
  let scaled: bigint
  if (scalePower >= 0) {
    scaled = coefficient * 10n ** BigInt(scalePower)
  } else {
    const divisor = 10n ** BigInt(-scalePower)
    const quotient = coefficient / divisor
    const remainder = coefficient % divisor
    scaled = quotient + (remainder * 2n >= divisor ? 1n : 0n)
  }
  const dollars = scaled / 10_000n
  const decimals = (scaled % 10_000n).toString().padStart(4, "0")
  return `$${dollars}.${decimals}`
}
