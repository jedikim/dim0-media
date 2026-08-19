"""Unit tests for the managed LLM proxy (`POST /ai/llm`).

Monkeypatches the catalog / auto classifier / entitlement / litellm seams so the
endpoint's own logic — model resolution, tier gating, `auto` clamping, and the
OpenAI-shaped response mapping — is exercised deterministically without network.
"""

import json

from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

import topix.api.router.ai as ai_module

from topix.api.router.ai import meter_run_managed, router
from topix.api.utils.security import get_current_user_uid


async def _no_meter() -> None:
    return None


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(router)

    async def _uid():
        return "user-1"

    app.dependency_overrides[get_current_user_uid] = _uid
    app.dependency_overrides[meter_run_managed] = _no_meter
    return TestClient(app)


def _install(
    monkeypatch,
    *,
    tiers: set[str],
    complexity: str = "simple",
    allowed_model: str = "allowed-model",
    message=None,
):
    """Wire deterministic fakes; return a dict that captures the litellm kwargs."""
    captured: dict = {}

    async def _entitlement(_request, _uid):
        return SimpleNamespace(plan="free")

    monkeypatch.setattr(ai_module, "resolve_entitlement_context", _entitlement)
    monkeypatch.setattr(ai_module, "resolve_allowed_model_tiers", lambda _plan: set(tiers))

    async def _classify(_msgs):
        return complexity

    monkeypatch.setattr(ai_module, "classify_auto_model_complexity", _classify)
    monkeypatch.setattr(ai_module.catalog, "default_resolved",
                        lambda tier=None: SimpleNamespace(call=f"call-{tier or 'any'}"))
    monkeypatch.setattr(ai_module.catalog, "is_model_allowed",
                        lambda model, _tiers: model == allowed_model)
    monkeypatch.setattr(ai_module.catalog, "resolve_code",
                        lambda model: "call-explicit" if model == allowed_model else None)

    msg = message if message is not None else SimpleNamespace(content="hello", tool_calls=None)

    async def _acompletion(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=msg)])

    monkeypatch.setattr(ai_module.litellm, "acompletion", _acompletion)
    return captured


def _post(client, body):
    """Post one turn to the endpoint."""
    return client.post("/ai/llm", json=body)


def test_auto_complex_on_pro_plan_uses_pro_model(monkeypatch):
    """Auto + complex on a pro plan escalates to the pro model."""
    cap = _install(monkeypatch, tiers={"lite", "pro"}, complexity="complex")
    res = _post(_client(), {"model": "auto", "messages": [{"role": "user", "content": "hi"}]})
    assert res.status_code == 200
    assert cap["model"] == "call-pro"


def test_auto_simple_uses_lite_model(monkeypatch):
    """Auto + simple resolves to the lite model."""
    cap = _install(monkeypatch, tiers={"lite", "pro"}, complexity="simple")
    _post(_client(), {"model": "auto", "messages": [{"role": "user", "content": "hi"}]})
    assert cap["model"] == "call-lite"


def test_auto_complex_clamped_to_lite_on_free_plan(monkeypatch):
    """Auto + complex is clamped to lite when the plan lacks pro."""
    # free plan → only lite allowed, so a "complex" classification must NOT escalate.
    cap = _install(monkeypatch, tiers={"lite"}, complexity="complex")
    _post(_client(), {"model": "auto", "messages": [{"role": "user", "content": "hi"}]})
    assert cap["model"] == "call-lite"


def test_explicit_allowed_model_resolves_to_its_call_code(monkeypatch):
    """An explicit in-tier model resolves to its provider call code."""
    cap = _install(monkeypatch, tiers={"lite", "pro"})
    res = _post(_client(), {"model": "allowed-model", "messages": [{"role": "user", "content": "x"}]})
    assert res.status_code == 200
    assert cap["model"] == "call-explicit"


def test_explicit_out_of_tier_model_is_403_and_never_calls_provider(monkeypatch):
    """An out-of-tier explicit model is 403 and never calls the provider."""
    cap = _install(monkeypatch, tiers={"lite"}, allowed_model="allowed-model")
    res = _post(_client(), {"model": "forbidden-pro-model", "messages": [{"role": "user", "content": "x"}]})
    assert res.status_code == 403
    assert cap == {}  # provider never called


def test_text_response_maps_to_message_content(monkeypatch):
    """A text turn maps to message.content with no tool_calls."""
    _install(monkeypatch, tiers={"lite"}, message=SimpleNamespace(content="the answer", tool_calls=None))
    res = _post(_client(), {"model": "auto", "messages": [{"role": "user", "content": "q"}]})
    msg = res.json()["data"]["choices"][0]["message"]
    assert msg["content"] == "the answer"
    assert "tool_calls" not in msg


def test_tool_calls_response_maps_through(monkeypatch):
    """A tool-call turn maps id/name/arguments through."""
    tc = SimpleNamespace(id="c1", function=SimpleNamespace(name="create_note", arguments='{"t":1}'))
    _install(monkeypatch, tiers={"lite"}, message=SimpleNamespace(content=None, tool_calls=[tc]))
    res = _post(_client(), {
        "model": "auto",
        "messages": [{"role": "user", "content": "make a note"}],
        "tools": [{"type": "function", "function": {"name": "create_note", "parameters": {}}}],
    })
    msg = res.json()["data"]["choices"][0]["message"]
    assert msg["tool_calls"][0]["id"] == "c1"
    assert msg["tool_calls"][0]["function"]["name"] == "create_note"


def test_tools_are_forwarded_with_tool_choice_auto(monkeypatch):
    """Tools are forwarded to the provider with tool_choice=auto."""
    cap = _install(monkeypatch, tiers={"lite"})
    _post(_client(), {
        "model": "auto",
        "messages": [{"role": "user", "content": "x"}],
        "tools": [{"type": "function", "function": {"name": "f", "parameters": {}}}],
    })
    assert cap["tool_choice"] == "auto"
    assert cap["tools"][0]["function"]["name"] == "f"


def _install_stream_resolution(monkeypatch):
    """Deterministic model resolution for the streaming endpoint (auto → lite)."""
    async def _entitlement(_request, _uid):
        return SimpleNamespace(plan="free")

    monkeypatch.setattr(ai_module, "resolve_entitlement_context", _entitlement)
    monkeypatch.setattr(ai_module, "resolve_allowed_model_tiers", lambda _plan: {"lite"})

    async def _classify(_msgs):
        return "simple"

    monkeypatch.setattr(ai_module, "classify_auto_model_complexity", _classify)
    monkeypatch.setattr(ai_module.catalog, "default_resolved",
                        lambda tier=None: SimpleNamespace(call="call-lite"))


def _lines(res):
    return [json.loads(line) for line in res.text.splitlines() if line.strip()]


def _delta_chunk(content):
    return SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=content, tool_calls=None))])


def _reasoning_chunk(text):
    """Build a chunk carrying only a reasoning delta (thinking-model output)."""
    return SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=None, tool_calls=None, reasoning_content=text))])


def test_stream_emits_text_deltas_then_final_message(monkeypatch):
    """Streaming yields a delta line per token, then a final assembled message."""
    _install_stream_resolution(monkeypatch)

    async def _gen():
        yield _delta_chunk("Hel")
        yield _delta_chunk("lo")

    async def _acompletion(**kwargs):
        assert kwargs.get("stream") is True
        return _gen()

    monkeypatch.setattr(ai_module.litellm, "acompletion", _acompletion)

    res = _client().post("/ai/llm/stream", json={"model": "auto", "messages": [{"role": "user", "content": "hi"}]})
    assert res.status_code == 200
    lines = _lines(res)
    assert lines[0] == {"type": "delta", "text": "Hel"}
    assert lines[1] == {"type": "delta", "text": "lo"}
    assert lines[-1]["type"] == "final"
    assert lines[-1]["message"]["content"] == "Hello"


def test_stream_emits_reasoning_lines_separate_from_content(monkeypatch):
    """Reasoning deltas surface as {type:"reasoning"} lines, kept out of the answer body."""
    _install_stream_resolution(monkeypatch)

    async def _gen():
        yield _reasoning_chunk("Let me ")
        yield _reasoning_chunk("think.")
        yield _delta_chunk("Answer")

    async def _acompletion(**kwargs):
        return _gen()

    monkeypatch.setattr(ai_module.litellm, "acompletion", _acompletion)

    res = _client().post("/ai/llm/stream", json={"model": "auto", "messages": [{"role": "user", "content": "hi"}]})
    lines = _lines(res)
    assert lines[0] == {"type": "reasoning", "text": "Let me "}
    assert lines[1] == {"type": "reasoning", "text": "think."}
    assert {"type": "delta", "text": "Answer"} in lines
    assert lines[-1]["message"]["content"] == "Answer"  # reasoning never folded into content


def test_stream_ordinary_delta_emits_no_reasoning_line(monkeypatch):
    """Guard the getattr read: a reasoning-less delta emits no reasoning line, no crash.

    Mirrors litellm deleting the `reasoning_content` attribute when it is absent.
    """
    _install_stream_resolution(monkeypatch)

    async def _gen():
        yield _delta_chunk("hi")

    async def _acompletion(**kwargs):
        return _gen()

    monkeypatch.setattr(ai_module.litellm, "acompletion", _acompletion)

    res = _client().post("/ai/llm/stream", json={"model": "auto", "messages": [{"role": "user", "content": "hi"}]})
    assert res.status_code == 200
    assert all(line["type"] != "reasoning" for line in _lines(res))


def test_stream_assembles_tool_call_fragments(monkeypatch):
    """Tool-call fragments streamed by index are stitched into the final message."""
    _install_stream_resolution(monkeypatch)

    def _tc_chunk(index, tc_id=None, name=None, args=""):
        fn = SimpleNamespace(name=name, arguments=args)
        tc = SimpleNamespace(index=index, id=tc_id, function=fn)
        return SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=None, tool_calls=[tc]))])

    async def _gen():
        yield _tc_chunk(0, tc_id="c1", name="create_note", args='{"a"')
        yield _tc_chunk(0, args=":1}")

    async def _acompletion(**kwargs):
        return _gen()

    monkeypatch.setattr(ai_module.litellm, "acompletion", _acompletion)

    res = _client().post("/ai/llm/stream", json={
        "model": "auto",
        "messages": [{"role": "user", "content": "make a note"}],
        "tools": [{"type": "function", "function": {"name": "create_note", "parameters": {}}}],
    })
    final = _lines(res)[-1]
    assert final["type"] == "final"
    call = final["message"]["tool_calls"][0]
    assert call["id"] == "c1"
    assert call["function"]["name"] == "create_note"
    assert call["function"]["arguments"] == '{"a":1}'


def test_stream_announces_tool_start_before_args_finish(monkeypatch):
    """The tool name is announced (tool_start) as soon as it's known, once, before final."""
    _install_stream_resolution(monkeypatch)

    def _tc_chunk(index, tc_id=None, name=None, args=""):
        fn = SimpleNamespace(name=name, arguments=args)
        tc = SimpleNamespace(index=index, id=tc_id, function=fn)
        return SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=None, tool_calls=[tc]))])

    async def _gen():
        yield _tc_chunk(0, tc_id="c1", name="write_note", args="")  # name known, no args yet
        yield _tc_chunk(0, args='{"content":"a long note"}')        # args stream after

    async def _acompletion(**kwargs):
        return _gen()

    monkeypatch.setattr(ai_module.litellm, "acompletion", _acompletion)

    res = _client().post("/ai/llm/stream", json={
        "model": "auto",
        "messages": [{"role": "user", "content": "write a note"}],
        "tools": [{"type": "function", "function": {"name": "write_note", "parameters": {}}}],
    })
    lines = _lines(res)
    assert lines[0] == {"type": "tool_start", "id": "c1", "name": "write_note"}
    assert sum(1 for line in lines if line["type"] == "tool_start") == 1  # once, not per arg chunk
    assert lines[-1]["type"] == "final"
