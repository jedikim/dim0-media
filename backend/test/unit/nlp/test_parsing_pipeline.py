"""Unit tests for document parsing pipeline save behavior."""

import pytest

from topix.datatypes.file.chunk import Chunk
from topix.datatypes.file.document import Document
from topix.datatypes.note.link import Link
from topix.datatypes.note.note import Note
from topix.datatypes.resource import RichText
from topix.nlp.pipeline.parsing import ParsingPipeline


class DummyVectorStore:
    """Capture added resources without touching the real vector store."""

    def __init__(self) -> None:
        """Initialize the in-memory capture list."""
        self.added: list[object] = []

    async def add(self, elements: list[object]) -> None:
        """Record the elements passed to the vector store."""
        self.added = elements


@pytest.mark.asyncio
async def test_save_to_store_assigns_parent_id_to_document_links() -> None:
    """Ensure parsed links inherit the sub-board parent id before persistence."""
    pipeline = ParsingPipeline.__new__(ParsingPipeline)
    pipeline.vector_store = DummyVectorStore()

    async def fake_place_document_mindmap_outside_graph(
        graph_uid: str,
        root_id: str | None,
        nodes: list[Note | Document],
        links: list[Link],
    ) -> list[Note | Document]:
        """Return nodes unchanged so the test can focus on parent assignment."""
        return nodes

    pipeline.place_document_mindmap_outside_graph = fake_place_document_mindmap_outside_graph

    document = Document(label=RichText(markdown="Doc"))
    note = Note(label=RichText(markdown="Child note"))
    link = Link(source=document.id, target=note.id)
    chunk = Chunk(content=RichText(markdown="Chunk"))

    updated_document, updated_notes, updated_links = await pipeline.save_to_store(
        graph_uid="graph-1",
        root_id="folder-1",
        document=document,
        chunks=[chunk],
        notes=[note],
        links=[link],
    )

    assert updated_document.parent_id == "folder-1"
    assert updated_notes[0].parent_id == "folder-1"
    assert updated_links[0].parent_id == "folder-1"
    assert chunk.graph_uid == "graph-1"
    assert pipeline.vector_store.added[-1].parent_id == "folder-1"
