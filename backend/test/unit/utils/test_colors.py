"""Tests for the paper-adapted Tailwind palette (webui parity)."""

from __future__ import annotations

import re

import pytest

from topix.utils.colors import (
    BLUE_200,
    TAILWIND_200_ADAPTED,
    TAILWIND_200_RAW,
    adapt_tailwind_color,
    hex_to_rgb,
    rgb_to_hsl,
)

_HEX_RE = re.compile(r"^#[0-9a-f]{6}$")

# Expected outputs computed by running the webui math (tailwind.ts
# adaptTailwindColor + color.ts helpers) on the raw shade-200 inputs. These pin
# byte-for-byte parity with the frontend; if the warming constants change there,
# update them here too.
_FRONTEND_ADAPTED_200 = {
    "blue": "#cbeaf3",
    "orange": "#f5d9b5",
    "teal": "#a7eccb",
    "stone": "#e9e6e3",
    "red": "#f8d4d0",
    "slate": "#e5eaec",
}


@pytest.mark.parametrize(("family", "expected"), _FRONTEND_ADAPTED_200.items())
def test_adapt_matches_frontend(family, expected):
    """Adapted shade-200 values are byte-identical to the webui output."""
    assert adapt_tailwind_color(TAILWIND_200_RAW[family], 200) == expected


def test_palette_has_one_entry_per_family():
    """The adapted palette covers every raw family, in order."""
    assert len(TAILWIND_200_ADAPTED) == len(TAILWIND_200_RAW) == 23


def test_palette_entries_are_valid_hex():
    """Every adapted swatch is a normalized #rrggbb string."""
    assert all(_HEX_RE.match(c) for c in TAILWIND_200_ADAPTED)


def test_adaptation_warms_away_from_raw():
    """Warming actually changes the color (not a passthrough)."""
    assert adapt_tailwind_color("#bfdbfe", 200) != "#bfdbfe"


def test_blue_200_is_adapted_blue():
    """The exported BLUE_200 default is the adapted blue swatch."""
    assert BLUE_200 == adapt_tailwind_color(TAILWIND_200_RAW["blue"], 200)
    assert BLUE_200 == "#cbeaf3"


def test_hex_to_rgb_handles_short_and_long_form():
    """Both #abc and #aabbcc parse to the same RGB triple."""
    assert hex_to_rgb("#fff") == (255, 255, 255)
    assert hex_to_rgb("#000000") == (0, 0, 0)
    assert hex_to_rgb("#bfdbfe") == (191, 219, 254)


def test_rgb_to_hsl_known_values():
    """RGB→HSL returns hue in degrees and s/l as 0-100 integers."""
    assert rgb_to_hsl(255, 255, 255) == (0, 0, 100)
    assert rgb_to_hsl(0, 0, 0) == (0, 0, 0)
    h, s, _ = rgb_to_hsl(255, 0, 0)
    assert h == 0 and s == 100
