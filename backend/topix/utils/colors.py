"""Paper-adapted Tailwind palette — backend mirror of the webui color pipeline.

Faithful port of `webui/src/features/board/lib/colors/tailwind.ts` (and the HSL
helpers in `webui/src/features/board/utils/color.ts`). The canvas does NOT render
raw Tailwind: every shade is warmed toward a paper anchor (#f7f1e8) by
`adapt_tailwind_color`. Shapes the agent creates on the backend must draw from
the SAME adapted palette, otherwise their colors don't exist in the frontend's
swatches. Keep this in sync with tailwind.ts; the warming constants and the
ORIGINAL_TAILWIND_HEX ramp are the source of truth there.
"""

from __future__ import annotations

# Raw Tailwind shade-200, one entry per family (23), copied from
# ORIGINAL_TAILWIND_HEX in tailwind.ts. Only shade 200 is kept: it is the only
# shade the backend fills shapes with, and the warming math needs just the
# single source hex. If another shade is ever needed, copy its row from
# tailwind.ts and call adapt_tailwind_color with that shade.
TAILWIND_200_RAW: dict[str, str] = {
    "slate": "#e2e8f0",
    "gray": "#e5e7eb",
    "stone": "#e7e5e4",
    "neutral": "#e5e5e5",
    "zinc": "#e4e4e7",
    "brown": "#eaddd7",
    "red": "#fecaca",
    "rose": "#fecdd3",
    "pink": "#fbcfe8",
    "fuchsia": "#f5d0fe",
    "violet": "#ddd6fe",
    "purple": "#e9d5ff",
    "indigo": "#c7d2fe",
    "blue": "#bfdbfe",
    "sky": "#bae6fd",
    "cyan": "#a5f3fc",
    "teal": "#99f6e4",
    "emerald": "#a7f3d0",
    "green": "#bbf7d0",
    "lime": "#d9f99d",
    "yellow": "#fef08a",
    "amber": "#fde68a",
    "orange": "#fed7aa",
}

TAILWIND_SHADES = (50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950)
_SHADE_INDEX = {shade: index for index, shade in enumerate(TAILWIND_SHADES)}

# Warming anchor — mirrors PAPER_REFERENCE_HEX in tailwind.ts.
_PAPER_REFERENCE_HEX = "#f7f1e8"


def _clamp(value: float, low: float, high: float) -> float:
    """Clamp `value` into the inclusive [low, high] range."""
    return max(low, min(high, value))


def hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    """Parse a #rgb or #rrggbb string into an (r, g, b) tuple of 0-255 ints."""
    clean = hex_color.lstrip("#")
    if len(clean) == 3:
        clean = "".join(ch * 2 for ch in clean)
    num = int(clean[:6], 16)
    return (num >> 16) & 255, (num >> 8) & 255, num & 255


def rgb_to_hsl(r: int, g: int, b: int) -> tuple[int, int, int]:
    """Convert RGB (0-255) to HSL with hue in degrees and s/l as 0-100 ints."""
    rf, gf, bf = r / 255, g / 255, b / 255
    mx, mn = max(rf, gf, bf), min(rf, gf, bf)
    h = 0.0
    s = 0.0
    light = (mx + mn) / 2
    delta = mx - mn
    if delta != 0:
        s = delta / (2 - mx - mn) if light > 0.5 else delta / (mx + mn)
        if mx == rf:
            h = (gf - bf) / delta + (6 if gf < bf else 0)
        elif mx == gf:
            h = (bf - rf) / delta + 2
        else:
            h = (rf - gf) / delta + 4
        h /= 6
    return round(h * 360), round(s * 100), round(light * 100)


def _hsl_to_hex(h: float, s: float, lightness: float) -> str:
    """Convert HSL (hue degrees, s/l as 0-100) back to a #rrggbb string."""
    hue = ((h % 360) + 360) % 360
    sat = _clamp(s, 0, 100) / 100
    light = _clamp(lightness, 0, 100) / 100
    c = (1 - abs(2 * light - 1)) * sat
    x = c * (1 - abs(((hue / 60) % 2) - 1))
    m = light - c / 2
    if hue < 60:
        r, g, b = c, x, 0.0
    elif hue < 120:
        r, g, b = x, c, 0.0
    elif hue < 180:
        r, g, b = 0.0, c, x
    elif hue < 240:
        r, g, b = 0.0, x, c
    elif hue < 300:
        r, g, b = x, 0.0, c
    else:
        r, g, b = c, 0.0, x

    def channel(value: float) -> str:
        return format(round((value + m) * 255), "02x")

    return f"#{channel(r)}{channel(g)}{channel(b)}"


def _mix_hex(a: str, b: str, amount: float) -> str:
    """Linearly blend two hex colors; `amount` is the weight toward `b`."""
    ar, ag, ab = hex_to_rgb(a)
    br, bg, bb = hex_to_rgb(b)
    t = _clamp(amount, 0, 1)

    def channel(x: float, y: float) -> str:
        return format(round(x * (1 - t) + y * t), "02x")

    return f"#{channel(ar, br)}{channel(ag, bg)}{channel(ab, bb)}"


def _lerp_angle(frm: float, to: float, amount: float) -> float:
    """Interpolate between two hue angles along the shortest arc."""
    delta = ((((to - frm) % 360) + 540) % 360) - 180
    return (frm + delta * amount + 360) % 360


_PAPER_REFERENCE_HSL = rgb_to_hsl(*hex_to_rgb(_PAPER_REFERENCE_HEX))


def adapt_tailwind_color(hex_color: str, shade: int) -> str:
    """Warm a Tailwind color toward the paper anchor, preserving family identity.

    Direct port of `adaptTailwindColor` in tailwind.ts — same blend/hue/sat/light
    constants — so the output matches the swatches the canvas renders.
    """
    shade_index = _SHADE_INDEX.get(shade, 0)
    shade_progress = shade_index / (len(TAILWIND_SHADES) - 1)
    paper_blend = 0.28 - shade_progress * 0.14
    hue_pull = 0.06 + (1 - shade_progress) * 0.06
    saturation_scale = 0.9 - (1 - shade_progress) * 0.08

    mixed = _mix_hex(hex_color, _PAPER_REFERENCE_HEX, paper_blend)
    mixed_h, mixed_s, mixed_l = rgb_to_hsl(*hex_to_rgb(mixed))
    _, _, base_l = rgb_to_hsl(*hex_to_rgb(hex_color))

    return _hsl_to_hex(
        _lerp_angle(mixed_h, _PAPER_REFERENCE_HSL[0], hue_pull),
        _clamp(mixed_s * saturation_scale, 6, 92),
        _clamp(base_l + (mixed_l - base_l) * 0.18, 18, 96),
    )


# Pre-built adapted shade-200 palette — the swatch set the canvas uses for
# random shape fills (matches webui `pickRandomColorOfShade(200)`).
TAILWIND_200_ADAPTED: list[str] = [
    adapt_tailwind_color(raw, 200) for raw in TAILWIND_200_RAW.values()
]

# Default rectangle fill — mirrors webui `BLUE_200` (resolveFamilyShade("blue", 200)).
BLUE_200: str = adapt_tailwind_color(TAILWIND_200_RAW["blue"], 200)
