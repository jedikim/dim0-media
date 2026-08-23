import type { ImageHistoryUser } from "./api/image-history"


/** Format creator identity consistently across summaries, filters, and rows. */
export function imageHistoryUserLabel(user: ImageHistoryUser): string {
  const name = user.name?.trim()
  return name ? `${name} · @${user.username}` : `@${user.username}`
}


/** Format a server-summed Decimal cost without binary floating-point conversion. */
export function formatKnownCostUsd(value: string | null): string {
  if (value === null) return "미보고"
  if (value.length > 128) return "비용 표시 오류"
  const match = /^(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value)
  if (!match) return "비용 표시 오류"
  const fraction = match[2] ?? ""
  const exponent = BigInt(match[3] ?? "0")
  if (exponent < -100n || exponent > 100n) return "비용 표시 오류"
  let digits = `${match[1]}${fraction}`.replace(/^0+/, "")
  if (!digits) return "$0.0000"

  let scale = BigInt(fraction.length) - exponent
  while (digits.endsWith("0")) {
    digits = digits.slice(0, -1)
    scale -= 1n
  }
  const integerDigits = BigInt(digits.length) - scale
  if (scale > 10n || integerDigits > 10n) return "비용 표시 오류"

  const scaleNumber = Number(scale)
  let dollars: string
  let decimals: string
  if (scaleNumber <= 0) {
    dollars = `${digits}${"0".repeat(-scaleNumber)}`
    decimals = ""
  } else if (digits.length <= scaleNumber) {
    dollars = "0"
    decimals = `${"0".repeat(scaleNumber - digits.length)}${digits}`
  } else {
    dollars = digits.slice(0, -scaleNumber)
    decimals = digits.slice(-scaleNumber)
  }
  return `$${dollars}.${decimals.padEnd(4, "0")}`
}
