"""Sync the repo version into Python, web, and Tauri manifests."""

from __future__ import annotations

import argparse
import json
import re

from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
VERSION_FILE = ROOT / "VERSION"
BACKEND_PYPROJECT = ROOT / "backend" / "pyproject.toml"
WEBUI_PACKAGE = ROOT / "webui" / "package.json"
TAURI_CARGO = ROOT / "webui" / "src-tauri" / "Cargo.toml"
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")


def parse_args() -> argparse.Namespace:
    """Parse CLI flags for syncing or setting the shared repo version."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--set-version",
        dest="set_version",
        help="Write this semantic version to VERSION before syncing",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero when any manifest is out of sync",
    )
    return parser.parse_args()


def validate_version(version: str) -> str:
    """Validate a simple semantic version string like 1.2.3."""
    normalized = version.strip()
    if not SEMVER_RE.fullmatch(normalized):
        raise ValueError(f"Invalid semantic version: {version!r}")
    return normalized


def read_version() -> str:
    """Read and validate the repo version from VERSION."""
    return validate_version(VERSION_FILE.read_text(encoding="utf-8"))


def write_version(version: str) -> None:
    """Persist the shared repo version into VERSION."""
    VERSION_FILE.write_text(f"{validate_version(version)}\n", encoding="utf-8")


def replace_single_match(content: str, pattern: str, replacement: str, path: Path) -> str:
    """Replace exactly one version field in a text manifest."""
    updated, count = re.subn(pattern, replacement, content, count=1, flags=re.MULTILINE)
    if count != 1:
        raise ValueError(f"Could not update version in {path}")
    return updated


def sync_backend(version: str, check: bool) -> bool:
    """Sync the backend package version in pyproject.toml."""
    path = BACKEND_PYPROJECT
    original = path.read_text(encoding="utf-8")
    updated = replace_single_match(
        original,
        r'^version = "[^"]+"$',
        f'version = "{version}"',
        path,
    )
    if check:
        return original == updated
    path.write_text(updated, encoding="utf-8")
    return True


def sync_webui(version: str, check: bool) -> bool:
    """Sync the web UI package version in package.json."""
    path = WEBUI_PACKAGE
    original = path.read_text(encoding="utf-8")
    package_json = json.loads(original)
    package_json["version"] = version
    updated = json.dumps(package_json, indent=2) + "\n"
    if check:
        return original == updated
    path.write_text(updated, encoding="utf-8")
    return True


def sync_tauri(version: str, check: bool) -> bool:
    """Sync the Tauri application version in Cargo.toml."""
    path = TAURI_CARGO
    original = path.read_text(encoding="utf-8")
    updated = replace_single_match(
        original,
        r'^version = "[^"]+"$',
        f'version = "{version}"',
        path,
    )
    if check:
        return original == updated
    path.write_text(updated, encoding="utf-8")
    return True


def main() -> int:
    """Update every manifest to the shared repo version or verify sync state."""
    args = parse_args()
    if args.set_version:
        write_version(args.set_version)

    version = read_version()
    checks = [
        sync_backend(version, args.check),
        sync_webui(version, args.check),
        sync_tauri(version, args.check),
    ]

    if args.check and not all(checks):
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
