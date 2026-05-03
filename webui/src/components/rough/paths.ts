/**
 * Pure geometry helpers shared by the rough.js shape components and their
 * CSS/SVG fill layers. These return SVG path strings (no rendering).
 */


/** Plain rectangle path. */
export function rectPath(x: number, y: number, w: number, h: number): string {
  return `M${x},${y} h${w} v${h} h-${w} Z`
}


/** Excalidraw-style rounded rectangle using quadratic Béziers at the corners. */
export function excalidrawRoundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): string {
  const R = Math.max(0, Math.min(r, Math.min(w, h) / 2))
  const x0 = x
  const y0 = y
  const x1 = x + w
  const y1 = y + h

  return [
    `M ${x0 + R} ${y0}`,
    `L ${x1 - R} ${y0}`,
    `Q ${x1} ${y0}, ${x1} ${y0 + R}`,
    `L ${x1} ${y1 - R}`,
    `Q ${x1} ${y1}, ${x1 - R} ${y1}`,
    `L ${x0 + R} ${y1}`,
    `Q ${x0} ${y1}, ${x0} ${y1 - R}`,
    `L ${x0} ${y0 + R}`,
    `Q ${x0} ${y0}, ${x0 + R} ${y0}`,
    `Z`
  ].join(' ')
}


/** Sharp-cornered diamond inscribed in the given box. */
export function sharpDiamondPath(x0: number, y0: number, x1: number, y1: number): string {
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  return [
    `M ${cx} ${y0}`,
    `L ${x1} ${cy}`,
    `L ${cx} ${y1}`,
    `L ${x0} ${cy}`,
    `Z`
  ].join(' ')
}


/**
 * Rounded diamond: trim each 45° edge by r·√2 and connect the trim points
 * around each corner with a quadratic curve through the corner vertex.
 */
export function roundedDiamondPath(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number
): string {
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2

  const T = { x: cx, y: y0 }
  const R = { x: x1, y: cy }
  const B = { x: cx, y: y1 }
  const L = { x: x0, y: cy }

  const along = (A: { x: number, y: number }, B: { x: number, y: number }, s: number) => {
    const dx = B.x - A.x
    const dy = B.y - A.y
    const len = Math.hypot(dx, dy) || 1
    const t = Math.max(0, Math.min(1, s / len))
    return { x: A.x + dx * t, y: A.y + dy * t }
  }

  const edgeLen = Math.hypot(R.x - T.x, R.y - T.y)
  let s = r * Math.SQRT2
  const sMax = Math.max(0, edgeLen / 2 - 0.01)
  s = Math.max(0, Math.min(s, sMax))
  if (s <= 0.0001) {
    return sharpDiamondPath(x0, y0, x1, y1)
  }

  const T_R = along(T, R, s)
  const R_T = along(R, T, s)
  const R_B = along(R, B, s)
  const B_R = along(B, R, s)
  const B_L = along(B, L, s)
  const L_B = along(L, B, s)
  const L_T = along(L, T, s)
  const T_L = along(T, L, s)

  return [
    `M ${T_R.x} ${T_R.y}`,
    `L ${R_T.x} ${R_T.y}`,
    `Q ${R.x} ${R.y}, ${R_B.x} ${R_B.y}`,

    `L ${B_R.x} ${B_R.y}`,
    `Q ${B.x} ${B.y}, ${B_L.x} ${B_L.y}`,

    `L ${L_B.x} ${L_B.y}`,
    `Q ${L.x} ${L.y}, ${L_T.x} ${L_T.y}`,

    `L ${T_L.x} ${T_L.y}`,
    `Q ${T.x} ${T.y}, ${T_R.x} ${T_R.y}`,
    `Z`
  ].join(' ')
}


/**
 * Single-path tag shape: pointed notch on the left flowing into a rounded body.
 * `notch` is the horizontal distance from the tip to the body edge.
 */
export function tagPath(
  w: number,
  h: number,
  notch: number,
  radius: number,
  tipRadius: number = 6
): string {
  const tipX = 0
  const tipY = h / 2

  const bodyLeft = Math.max(0, Math.min(notch, w))
  const right = w
  const bottom = h

  const rBody = Math.min(radius, h / 2, (right - bodyLeft) / 2)
  const rJoin = Math.min(radius, h * 0.45, bodyLeft * 0.8)

  if (bodyLeft <= 0.001) {
    const r = Math.min(radius, h / 2, w / 2)
    return [
      `M ${r} 0`,
      `L ${w - r} 0`,
      `Q ${w} 0 ${w} ${r}`,
      `L ${w} ${h - r}`,
      `Q ${w} ${h} ${w - r} ${h}`,
      `L ${r} ${h}`,
      `Q 0 ${h} 0 ${h - r}`,
      `L 0 ${r}`,
      `Q 0 0 ${r} 0`,
      `Z`,
    ].join(" ")
  }

  const pTop = { x: bodyLeft, y: rJoin }
  const pBot = { x: bodyLeft, y: bottom - rJoin }

  const unit = (ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy) || 1
    return { x: dx / len, y: dy / len, len }
  }

  const dTop = unit(pTop.x, pTop.y, tipX, tipY)
  const dBot = unit(pBot.x, pBot.y, tipX, tipY)

  const maxTipRound = Math.min(dTop.len, dBot.len) * 0.49
  const t = Math.max(0, Math.min(tipRadius, maxTipRound))

  const tipEnter = { x: tipX - dBot.x * t, y: tipY - dBot.y * t }
  const tipExit = { x: tipX - dTop.x * t, y: tipY - dTop.y * t }

  const k = rJoin * 0.65
  const topStart = { x: bodyLeft + rBody, y: 0 }
  const botEnd = { x: bodyLeft + rBody, y: bottom }

  return [
    `M ${topStart.x} ${topStart.y}`,
    `L ${right - rBody} 0`,
    `Q ${right} 0 ${right} ${rBody}`,

    `L ${right} ${bottom - rBody}`,
    `Q ${right} ${bottom} ${right - rBody} ${bottom}`,

    `L ${botEnd.x} ${botEnd.y}`,

    `C ${botEnd.x - k} ${bottom} ${pBot.x - dBot.x * k} ${pBot.y - dBot.y * k} ${pBot.x} ${pBot.y}`,

    `L ${t > 0 ? tipEnter.x : tipX} ${t > 0 ? tipEnter.y : tipY}`,

    ...(t > 0 ? [`Q ${tipX} ${tipY} ${tipExit.x} ${tipExit.y}`] : []),

    `L ${pTop.x} ${pTop.y}`,

    `C ${pTop.x + (-dTop.x) * k} ${pTop.y + (-dTop.y) * k} ${topStart.x - k} 0 ${topStart.x} 0`,

    `Z`,
  ].join(" ")
}
