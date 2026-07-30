# Architecture Decision Records

Durable, load-bearing decisions — one per file, stable ID, terse on *what* /
detailed on *why*, with `Applies to` globs and a `Verify` command. Cite an ADR
by ID from other docs instead of restating the decision (each fact lives once).

| ID | Decision |
|----|----------|
| [ADR-AGENT-001](./ADR-AGENT-001-opaque-transcript-storage.md) | Browser-agent chat transcripts are stored as opaque JSON, not the server `Message` model. |
| [ADR-AGENT-002](./ADR-AGENT-002-tool-confirm-gate-and-result-contract.md) | Off-board tool confirm gate + unified `ToolFailure` result contract. |
