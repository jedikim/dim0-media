"""Regression tests for `get_file_path` data-root confinement (security F1)."""

from __future__ import annotations

import pytest

from topix.utils.file import DATADIR, REP_DATADIR, get_file_path, save_file


class TestGetFilePathConfinement:
    """`get_file_path` must never resolve to a path outside the data root."""

    @pytest.mark.parametrize(
        "rep_path",
        [
            f"{REP_DATADIR}/../../.env",  # traversal out via the /data prefix
            "../../../../etc/passwd",  # bare relative traversal
            "/etc/passwd",  # absolute path outside the root
            "file:///etc/passwd",  # file:// scheme stripped, still escapes
        ],
    )
    def test_rejects_paths_that_escape_the_data_root(self, rep_path: str):
        """Traversal / absolute / file:// escapes raise ValueError (→ 404 at the router)."""
        with pytest.raises(ValueError):
            get_file_path(rep_path)

    def test_allows_a_normal_in_root_data_path(self):
        """A plain /data path resolves to a location inside the data root."""
        result = get_file_path(f"{REP_DATADIR}/files/example.png")
        assert result.startswith(str(DATADIR.resolve()))

    def test_allows_dotdot_that_stays_within_the_root(self):
        """`..` segments that resolve back inside the data root are still allowed."""
        result = get_file_path(f"{REP_DATADIR}/files/../images/x.png")
        assert result.startswith(str(DATADIR.resolve()))

    def test_data_prefix_is_a_segment_match(self):
        """A `/data`-substring path like `/database/x` is NOT treated as in-root."""
        with pytest.raises(ValueError):
            get_file_path("/database/secret")


class TestSaveFileConfinement:
    """save_file must refuse to write outside the data root (write mirror of F1)."""

    @pytest.mark.parametrize(
        "filename",
        [
            "../../evil",  # climbs out of DATADIR/files
            "../../../etc/cron.d/evil",  # deeper traversal
            "/etc/passwd",  # absolute filename replaces the join → outside root
        ],
    )
    def test_rejects_filenames_that_escape_the_data_root(self, filename: str):
        """A traversal/absolute filename raises ValueError before any write."""
        with pytest.raises(ValueError):
            save_file(filename, b"x", cat="files")
