"""Unit tests for chat message reasoning formatting."""

from topix.agents.datatypes.outputs import (
    CodeInterpreterOutput,
    CreateNoteOutput,
    GetNoteOutput,
    MemorySearchOutput,
    WebSearchOutput,
    WriteNoteOutput,
)
from topix.agents.datatypes.reasoning_step import ReasoningStep
from topix.agents.datatypes.tool_call import MAX_COMPACT_TEXT_LENGTH, ToolCall
from topix.agents.datatypes.tools import AgentToolName
from topix.datatypes.chat.chat import Message, MessageProperties
from topix.datatypes.property import ReasoningProperty, TextProperty
from topix.datatypes.resource import RichText


def test_tool_call_to_compact_step_description_formats_arguments():
    """Tool calls should render as compact XML-like blocks."""
    step = ToolCall(
        id="step-1",
        name=AgentToolName.WEB_SEARCH,
        output=WebSearchOutput(search_results=[]),
        arguments={"query": "best pizza paris", "scope": "fresh"},
    )

    assert (
        step.to_compact_step_description()
        == (
            '<ToolCall name="web_search">\n'
            '<Input>query="best pizza paris", scope="fresh"</Input>\n'
            '<Output>0 search results</Output>\n'
            '</ToolCall>'
        )
    )


def test_tool_call_to_compact_step_description_truncates_long_arguments():
    """Tool call formatting should cap very long compact input strings."""
    long_query = "x" * (MAX_COMPACT_TEXT_LENGTH + 50)
    step = ToolCall(
        id="step-2",
        name=AgentToolName.WEB_SEARCH,
        output=WebSearchOutput(search_results=[]),
        arguments={"query": long_query},
    )

    result = step.to_compact_step_description()

    assert result.startswith('<ToolCall name="web_search">\n<Input>query="')
    assert result.endswith('</Output>\n</ToolCall>')
    assert "...</Input>" in result


def test_message_to_chat_message_includes_reasoning_and_content():
    """Assistant messages should prepend compact reasoning before the content body."""
    step = ToolCall(
        id="step-3",
        name=AgentToolName.CREATE_NOTE,
        output=CreateNoteOutput(
            note_id="note-1",
            graph_uid="graph-1",
            label="Ideas",
            note_type="rectangle",
        ),
        arguments={"content": "Key idea", "label": "Ideas"},
    )
    message = Message(
        role="assistant",
        content=RichText(markdown="Final answer body"),
        properties=MessageProperties(
            reasoning=ReasoningProperty(reasoning=[step]),
        ),
    )

    chat_message = message.to_chat_message()

    assert chat_message["role"] == "assistant"
    assert chat_message["content"].startswith('<Reasoning>\n\n<ToolCall name="create_note">')
    assert '<Output>created rectangle note_id="note-1" "Ideas"</Output>' in chat_message["content"]
    assert "Final answer body" in chat_message["content"]


def test_reasoning_step_to_compact_step_description_merges_reasoning_and_message():
    """Reasoning steps should render as compact XML-like blocks."""
    step = ReasoningStep(
        reasoning="Need one quick search",
        message="Checking the latest numbers",
    )

    assert (
        step.to_compact_step_description()
        == (
            "<ReasoningStep>\n"
            "<Thought>Need one quick search</Thought>\n"
            "<Message>Checking the latest numbers</Message>\n"
            "</ReasoningStep>"
        )
    )


def test_message_to_chat_message_supports_mixed_reasoning_steps():
    """Mixed reasoning/tool step lists should remain compact and ordered."""
    reasoning_step = ReasoningStep(
        reasoning="Need one quick search",
        message="Checking the latest numbers",
    )
    tool_step = ToolCall(
        id="step-3b",
        name=AgentToolName.WEB_SEARCH,
        output=WebSearchOutput(search_results=[]),
        arguments={"query": "latest inflation france"},
    )
    message = Message(
        role="assistant",
        content=RichText(markdown="Inflation slowed."),
        properties=MessageProperties(
            reasoning=ReasoningProperty(reasoning=[reasoning_step, tool_step]),
        ),
    )

    chat_message = message.to_chat_message()

    assert "<ReasoningStep>" in chat_message["content"]
    assert "<Thought>Need one quick search</Thought>" in chat_message["content"]
    assert '<ToolCall name="web_search">' in chat_message["content"]
    assert "<Output>0 search results</Output>" in chat_message["content"]
    assert chat_message["content"].endswith("Inflation slowed.")


def test_user_message_to_chat_message_keeps_context_prefix():
    """User messages should keep message context ahead of reasoning and content."""
    step = ToolCall(
        id="step-4",
        name=AgentToolName.EDIT_NOTE,
        output=CreateNoteOutput(
            note_id="note-2",
            graph_uid="graph-1",
            label="Renamed",
            note_type="rectangle",
        ),
        arguments={"note_id": "note-2"},
    )
    message = Message(
        role="user",
        content=RichText(markdown="Please update this note"),
        properties=MessageProperties(
            reasoning=ReasoningProperty(reasoning=[step]),
            context=TextProperty(text="Current board is roadmap"),
        ),
    )

    chat_message = message.to_chat_message()

    assert chat_message["content"].startswith("<MessageContext>")
    assert "Current board is roadmap" in chat_message["content"]
    assert "<Reasoning>" in chat_message["content"]
    assert "Please update this note" in chat_message["content"]


def test_write_note_output_to_compact_repr_uses_metadata_only():
    """Write note output should summarize the action, type, and label only."""
    output = WriteNoteOutput(
        action="rewritten",
        note_id="note-1",
        graph_uid="graph-1",
        label="Revenue chart",
        note_type="widget",
    )

    assert output.to_compact_repr() == 'rewritten widget note_id="note-1" "Revenue chart"'


def test_memory_search_output_to_compact_repr_prefers_reference_count():
    """Memory search output should summarize the number of references found."""
    output = MemorySearchOutput(answer="", references=[])

    assert output.to_compact_repr() == "0 references"


def test_code_interpreter_output_to_compact_repr_uses_status_and_duration():
    """Code interpreter output should summarize status and runtime."""
    output = CodeInterpreterOutput(status="success", duration_ms=842)

    assert output.to_compact_repr() == "success in 842ms"


def test_get_note_output_to_compact_repr_uses_note_metadata_only():
    """Get note output should summarize the fetched note by id, type, and label."""
    output = GetNoteOutput(
        note_id="note-7",
        graph_uid="graph-1",
        label="Roadmap",
        content="Full note content",
        note_type="sheet",
    )

    assert output.to_compact_repr() == 'read sheet note_id="note-7" "Roadmap"'


def test_tool_call_to_compact_step_description_summarizes_content_heavy_inputs():
    """Content-heavy inputs should be summarized instead of dumping raw payload text."""
    step = ToolCall(
        id="step-5",
        name=AgentToolName.WRITE_NOTE,
        output=WriteNoteOutput(
            action="rewritten",
            note_id="note-1",
            graph_uid="graph-1",
            note_type="widget",
        ),
        arguments={
            "note_id": "note-1",
            "content": {"markdown": "<style>.card{padding:16px}</style><div>Hello</div>"},
            "label": "Revenue chart",
        },
    )

    result = step.to_compact_step_description()

    assert result.startswith('<ToolCall name="write_note">\n<Input>note_id="note-1"')
    assert 'content="{ markdown=<' in result
    assert ' chars> }"' in result
    assert '<Output>rewritten widget note_id="note-1"</Output>' in result


def test_tool_call_to_compact_step_description_collapses_widget_skill_output():
    """Widget skill outputs should stay short in compact history because the tool can be recalled."""
    step = ToolCall(
        id="step-6",
        name=AgentToolName.LEARN_GENERATE_HTML_WIDGET,
        output="Very long widget instruction payload that should not be replayed in full.",
        arguments={},
    )

    assert (
        step.to_compact_step_description()
        == (
            '<ToolCall name="learn_generate_html_widget">\n'
            '<Output>loaded widget generation guidance</Output>\n'
            '</ToolCall>'
        )
    )
