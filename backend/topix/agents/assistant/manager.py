"""Main agent manager."""
from __future__ import annotations

import logging
import re

from collections.abc import AsyncGenerator

from topix.agents.assistant.auto_model import classify_auto_model_complexity
from topix.agents.assistant.plan import Plan
from topix.agents.config import AssistantManagerConfig
from topix.agents.datatypes.context import ReasoningContext
from topix.agents.datatypes.outputs import CreateNoteOutput, LinkNotesOutput, WriteNoteOutput
from topix.agents.datatypes.reasoning_step import ReasoningStep
from topix.agents.datatypes.stream import (
    AgentStreamMessage,
    ContentType,
    StreamingMessageType,
)
from topix.agents.datatypes.tool_call import ToolCall, ToolCallState
from topix.agents.datatypes.tools import AgentToolName
from topix.agents.notes.layout import rearrange_created_notes
from topix.agents.run import AgentRunner
from topix.agents.sessions import AssistantSession
from topix.agents.utils.text import post_process_url_citations
from topix.collab.agent_bridge import AgentBoardBridge
from topix.config import catalog
from topix.datatypes.chat.chat import Message
from topix.datatypes.property import ReasoningProperty, TextProperty
from topix.datatypes.resource import RichText
from topix.store.graph import GraphStore
from topix.store.qdrant.store import ContentStore
from topix.utils.common import gen_uid

logger = logging.getLogger(__name__)

def _auto_base_model() -> str:
    """Cheapest/fastest available model for the auto-mode base plan."""
    return catalog.require_model_code("lite")


def _auto_complex_model() -> str:
    """Most capable available model for complex auto-mode requests."""
    return catalog.require_model_code("pro")


# Hard ceiling on plan-agent turns (one turn = one LLM invocation, which may
# fire several parallel tool calls). This is a runaway-loop backstop, not a
# working target: normal answers finish in a handful of turns. Sized generously
# so research-heavy turns (memory + several searches + writes + links + a
# re-read) complete rather than getting cut off mid-build.
ASSISTANT_MAX_TURNS = 30


class AssistantManager:
    """Orchestrates the full flow: query rewrite, planning, searching ..."""

    def __init__(
        self,
        plan_agent: Plan,
        auto_mode: bool = False,
        graph_store: GraphStore | None = None,
        graph_uid: str | None = None,
        root_id: str | None = None,
        allowed_tiers: set[str] | None = None,
        agent_bridge: AgentBoardBridge | None = None,
    ):
        """Init method.

        `allowed_tiers` caps which model tiers auto-mode may route to (None =
        unrestricted); used to keep lower plans off the `pro` tier.
        """
        self.plan_agent = plan_agent
        self.auto_mode = auto_mode
        self.graph_store = graph_store
        self.graph_uid = graph_uid
        self.root_id = root_id
        self.allowed_tiers = allowed_tiers
        self.agent_bridge = agent_bridge

    @classmethod
    def from_config(
        cls,
        content_store: ContentStore,
        config: AssistantManagerConfig,
        memory_filters: dict | None = None,
        graph_store: GraphStore | None = None,
        graph_uid: str | None = None,
        root_id: str | None = None,
        auto_mode: bool = False,
        allowed_tiers: set[str] | None = None,
        agent_bridge: AgentBoardBridge | None = None,
    ) -> AssistantManager:
        """Create an instance of AssistantManager from configuration."""
        config_ = config.model_copy(deep=True)
        if auto_mode:
            config_.plan.model = _auto_base_model()

        plan_agent = Plan.from_config(
            content_store,
            config_.plan,
            memory_filters=memory_filters,
            graph_store=graph_store,
            graph_uid=graph_uid,
            root_id=root_id,
            agent_bridge=agent_bridge,
        )

        return cls(
            plan_agent,
            auto_mode=auto_mode,
            graph_store=graph_store,
            graph_uid=graph_uid,
            root_id=root_id,
            allowed_tiers=allowed_tiers,
            agent_bridge=agent_bridge,
        )

    def _set_plan_model(self, model: str) -> None:
        """Swap the concrete model used by the plan agent for this request."""
        self.plan_agent.model = model
        self.plan_agent.__post_init__()

    async def _select_plan_model(self, agent_input: list[dict[str, str]]) -> str:
        """Resolve the concrete plan model for this request."""
        if not self.auto_mode:
            return self.plan_agent.model

        complexity = await classify_auto_model_complexity(agent_input)
        logger.info(f"Auto model classified complexity as {complexity}")

        pro_allowed = self.allowed_tiers is None or "pro" in self.allowed_tiers
        if complexity == "complex" and pro_allowed:
            return _auto_complex_model()
        return _auto_base_model()

    async def _compose_input(
        self,
        context: ReasoningContext,
        query: str,
        session: AssistantSession | None = None,
        message_context: str | None = None,
    ) -> list[dict[str, str]]:
        if message_context is not None and message_context.strip() != "":
            query = (
                "<MessageContext>\n\n"
                f"{message_context}\n\n"
                f"</MessageContext>\n\n{query}"
            )
        if session:
            history = await session.get_items()
            if history:
                context.chat_history = history
                return history + [{"role": "user", "content": query}]
            else:
                return [{"role": "user", "content": query}]
        return [{"role": "user", "content": query}]

    def _collect_created_note_ids(self, context: ReasoningContext) -> list[str]:
        """Pick note ids that this turn just created, in first-seen order.

        Covers both `write_note(action="created")` and the older `create_note` tool.
        Rewrites and edits are excluded so the user's existing layout is respected.
        """
        if self.graph_uid is None:
            return []

        created: list[str] = []
        seen: set[str] = set()
        for call in context.tool_calls:
            if call.state != ToolCallState.COMPLETED:
                continue
            output = call.output
            if isinstance(output, CreateNoteOutput):
                pass  # falls through to the id extraction below
            elif isinstance(output, WriteNoteOutput):
                if output.action != "created":
                    continue
            else:
                continue

            if output.graph_uid != self.graph_uid:
                continue
            if output.note_id in seen:
                continue
            seen.add(output.note_id)
            created.append(output.note_id)
        return created

    def _collect_created_link_ids(self, context: ReasoningContext) -> list[str]:
        """Pick link ids that this turn just created, in first-seen order."""
        if self.graph_uid is None:
            return []

        created: list[str] = []
        seen: set[str] = set()
        for call in context.tool_calls:
            if call.state != ToolCallState.COMPLETED:
                continue
            output = call.output
            if not isinstance(output, LinkNotesOutput):
                continue
            if output.graph_uid != self.graph_uid:
                continue
            if output.link_id in seen:
                continue
            seen.add(output.link_id)
            created.append(output.link_id)
        return created

    async def _rearrange_turn_notes(self, context: ReasoningContext) -> None:
        """Flex-wrap any notes the planner created this turn. Non-fatal on error."""
        if self.graph_store is None or self.graph_uid is None:
            return
        created_ids = self._collect_created_note_ids(context)
        if len(created_ids) < 2:
            return
        created_link_ids = self._collect_created_link_ids(context)
        try:
            await rearrange_created_notes(
                self.graph_store,
                self.graph_uid,
                created_ids,
                created_link_ids=created_link_ids,
                root_id=self.root_id,
                agent_bridge=self.agent_bridge,
            )
        except Exception:
            logger.exception(
                "rearrange_created_notes failed; notes left at their creation positions"
            )

    async def _postprocess_answer(  # noqa: C901
        self,
        answer: str,
        context: ReasoningContext,
    ) -> str:
        """Post process the final answer from the synthesis agent."""
        graph_uid: str | None
        if context.memory_search_filter is not None:
            graph_uid = context.memory_search_filter.get("graph_uid")
        else:
            graph_uid = None

        short_ref_re = re.compile(r"\(/(?P<rtype>[a-z_]+)/(?P<prefix>[a-zA-Z0-9]{4,})\)")

        valid_urls = []
        for tool_call in context.tool_calls:
            if tool_call.name == AgentToolName.WEB_SEARCH:
                search_results = tool_call.output.search_results
                for result in search_results:
                    valid_urls.append(result.url)

            # Correct shortened URLs in the answer by replacing shortened IDs with full IDs
            elif tool_call.name == AgentToolName.MEMORY_SEARCH:
                if graph_uid is not None:
                    refs = tool_call.output.references

                    # Each ref is a full ID; we match on any prefix the model emits.
                    def replace_match(match: re.Match[str]) -> str:
                        # Replace /:type/:prefix with the first matching full ID for that type.
                        rtype = match.group("rtype")
                        prefix = match.group("prefix")
                        found = None

                        for ref in refs:
                            if ref.ref_type != rtype:
                                continue
                            if ref.ref_id.startswith(prefix):
                                found = ref
                                break

                        if not found:
                            return match.group(0)

                        target_type = found.parent_type or found.ref_type
                        target_id = found.parent_id or found.ref_id

                        return f"(/boards/{graph_uid}/{target_type}s/{target_id})"

                    answer = short_ref_re.sub(replace_match, answer)

        return post_process_url_citations(answer, valid_urls)

    async def run(
        self,
        context: ReasoningContext,
        query: str,
        session: AssistantSession | None = None,
        message_id: str | None = None,
        max_turns: int = ASSISTANT_MAX_TURNS,
        message_context: str | None = None
    ) -> str:
        """Run the assistant agent with the provided context and query."""
        agent_input = await self._compose_input(
            context,
            query,
            session,
            message_context=message_context
        )

        if session:
            user_message = Message(
                id=message_id or gen_uid(),
                role="user",
                content=RichText(markdown=query)
            )
            if message_context is not None and message_context.strip() != "":
                user_message.properties.context = TextProperty(text=message_context)

            await session.add_items([user_message])

        # launch plan:
        res = ""
        try:
            self._set_plan_model(await self._select_plan_model(agent_input))
            res = await AgentRunner.run(
                self.plan_agent, input=agent_input, context=context, max_turns=max_turns
            )
        except Exception:
            logger.info(f"Max turns exceeded: {max_turns}", exc_info=True)

        await self._rearrange_turn_notes(context)

        if session:
            await session.add_items(
                [{"id": gen_uid(), "role": "assistant", "content": {"markdown": res}}]
            )

        res = await self._postprocess_answer(res, context)

        return res

    async def run_streamed(  # noqa: C901
        self,
        context: ReasoningContext,
        query: str,
        session: AssistantSession | None = None,
        message_id: str | None = None,
        max_turns: int = ASSISTANT_MAX_TURNS,
        message_context: str | None = None
    ) -> AsyncGenerator[AgentStreamMessage | ToolCall, str]:
        """Run the assistant agent with the provided context and query.

        If a session is provided, use it to store the user query and retrieve the chat history.
        Otherwise, do not use any chat history.

        Yields:
            AgentStreamMessage: The messages from the agent.

        """
        # Notify the start of the agent stream
        agent_input = await self._compose_input(
            context,
            query,
            session,
            message_context=message_context
        )

        if session:
            user_message = Message(
                id=message_id or gen_uid(),
                role="user",
                content=RichText(markdown=query)
            )
            if message_context is not None and message_context.strip() != "":
                user_message.properties.context = TextProperty(text=message_context)
            await session.add_items([user_message])

        current_message_buffer: list[str] = []
        current_reasoning_buffer: list[str] = []
        persisted_steps: list[ReasoningStep | ToolCall] = []
        current_raw_tool_id: str | None = None
        reasoning_step_index = 0

        def flush_current_buffers() -> None:
            """Flush the current text buffers into one persisted reasoning step."""
            nonlocal reasoning_step_index, current_raw_tool_id

            message = "".join(current_message_buffer)
            reasoning = "".join(current_reasoning_buffer)
            if not message and not reasoning:
                return

            step_prefix = current_raw_tool_id or "raw_message"
            persisted_steps.append(
                ReasoningStep(
                    id=f"{step_prefix}:{reasoning_step_index}",
                    reasoning=reasoning,
                    message=message,
                )
            )
            reasoning_step_index += 1
            current_message_buffer.clear()
            current_reasoning_buffer.clear()

        def build_message_content() -> str:
            """Build the persisted assistant message content from reasoning steps."""
            return "".join(
                step.message for step in persisted_steps
                if isinstance(step, ReasoningStep)
            )

        try:
            self._set_plan_model(await self._select_plan_model(agent_input))
            res = AgentRunner.run_streamed(
                self.plan_agent, input=agent_input, context=context, max_turns=max_turns
            )

            async for message in res:
                if isinstance(message, ToolCall):
                    flush_current_buffers()
                    persisted_steps.append(message)
                    yield message
                    continue

                if message.tool_name == AgentToolName.RAW_MESSAGE:
                    current_raw_tool_id = message.tool_id
                    if (
                        message.content
                        and message.content.type in [ContentType.MESSAGE, ContentType.TOKEN]
                    ):
                        if message.type == StreamingMessageType.STREAM_MESSAGE:
                            current_message_buffer.append(message.content.text)
                        elif message.type == StreamingMessageType.STREAM_REASONING_MESSAGE:
                            current_reasoning_buffer.append(message.content.text)

                    if message.is_stop:
                        flush_current_buffers()

                yield message
        except Exception as e:
            logger.error(
                f"Plan agent execution error {e}, may due to Max turns exceeded",
                exc_info=True,
            )

        flush_current_buffers()

        await self._rearrange_turn_notes(context)

        final_reasoning_step = next(
            (
                step
                for step in reversed(persisted_steps)
                if isinstance(step, ReasoningStep) and step.message
            ),
            None,
        )
        if final_reasoning_step is not None:
            final_reasoning_step.message = await self._postprocess_answer(
                final_reasoning_step.message,
                context,
            )

        persisted_content = build_message_content()

        if session:
            await session.add_items(
                [
                    Message(
                        role="assistant",
                        content=RichText(markdown=persisted_content),
                        properties={
                            "reasoning": ReasoningProperty(
                                reasoning=persisted_steps
                            )
                        },
                    )
                ]
            )
