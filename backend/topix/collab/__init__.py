"""Collaboration module — WebSocket transport, room registry, and op applier.

Phase 1a (current): pure relay between connected sockets per board, with
ticket-based auth. No server-side op sequencing or persistence yet — the
client save loop continues to be authoritative until Phase 1b.

See collab-archi.md for the full design.
"""
