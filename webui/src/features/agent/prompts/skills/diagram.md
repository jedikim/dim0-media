You are composing a structured answer as a set of linked notes — a mindmap, taxonomy, schema, or flowchart. Follow this skill over generic note-writing habits.

Your goal is to produce a set of notes via parallel `write_note` calls plus the `link_notes` calls that connect them, so the result reads at a glance.

---

## Keep each node tight

The whole point of a multi-note answer is that **structure carries the meaning**. If a node needs a paragraph to explain itself, you're writing a sheet, not a diagram.

- **Label:** ≤6 words, one idea, no "and" / commas.
- **Content body:** a short phrase or single short sentence. Never a paragraph.
- A reader skimming the board should grasp each node in under a second.

If you find yourself writing more than ~20 words in `content`, stop and split it into two linked nodes instead.

---

## Spotlight the key term

Node content is lite-markdown. Mark the one word or number that carries the node — a spotlight, not decoration:

- `**bold**` the key term, `==highlight==` a critical value or verdict, `` `code` `` an identifier.
- At most one mark per node, and most nodes need none. The structure already carries the meaning; a clean node beats an over-marked one.

---

## Use shapes to carry meaning

Shapes are semantic, not decoration. The whole vocabulary:

| Shape | When the node represents |
|---|---|
| `rectangle` | Generic concept, fact, branch, or step (default — when in doubt, this) |
| `layered-circle` | The hub of a mindmap / taxonomy — the single root the tree radiates from |
| `ellipse` | Terminal point in a flow — a start, an end, a final outcome |
| `diamond` / `soft-diamond` | A decision or fork — any branching point in a flow |

That's the entire vocabulary for now. Other shapes exist but are not part of this skill — don't reach for them.

For pure taxonomies / mindmaps (parent → child → grandchild — "kingdoms of life", "parts of an atom"), make the **root a `layered-circle`** and every child and grandchild a `rectangle`. The circle anchors the eye on the center; the tree shape carries the rest — don't vary the branch shapes further.

For **flows** (a sequence with branches/decisions — sign-up flow, request lifecycle) and **schemas** (different kinds of things linked together — entity relationships, system architecture), reach for `ellipse` and `diamond` so the reader sees structure at a glance. **Aim for ~3 shapes per flow, not 8** — the minimum variety needed to be legible.

---

## Worked examples

### Pure taxonomy — layered-circle hub, rectangle branches

> "Explain the kingdoms of life."

```
write_note label="Living things"   type="layered-circle"  content="The **six kingdoms** across three domains."
write_note label="Bacteria"        type="rectangle"  content="Single-celled **prokaryotes**, no nucleus."
write_note label="Archaea"         type="rectangle"  content="Extremophile prokaryotes."
write_note label="Eukarya"         type="rectangle"  content="Cells with a membrane-bound **nucleus**."
write_note label="Animals"         type="rectangle"  content="Multicellular, no cell walls, heterotrophic."
write_note label="Plants"          type="rectangle"  content="Multicellular, cell walls, photosynthetic."
write_note label="Fungi"           type="rectangle"  content="Decomposers; cell walls of chitin."
link_notes source="Living things" target="Bacteria"
link_notes source="Living things" target="Archaea"
link_notes source="Living things" target="Eukarya"
link_notes source="Eukarya"       target="Animals"
link_notes source="Eukarya"       target="Plants"
link_notes source="Eukarya"       target="Fungi"
```

### Flowchart — mixed shapes

> "What happens when a user signs up?"

```
write_note label="Sign-up form"     type="ellipse"   content="User submits email + password."
write_note label="Validate input"   type="rectangle" content="Length, format, required fields."
write_note label="Email taken?"     type="diamond"   content="Check the users table."
write_note label="Show error"       type="ellipse"   content="Email already in use."
write_note label="Create account"   type="rectangle" content="Insert row, send confirmation email."
write_note label="Welcome screen"   type="ellipse"   content="Logged in, first-time view."
link_notes source="Sign-up form"   target="Validate input"
link_notes source="Validate input" target="Email taken?"
link_notes source="Email taken?"   target="Show error"     label="yes"
link_notes source="Email taken?"   target="Create account" label="no"
link_notes source="Create account" target="Welcome screen"
```

Three shapes, each one carries meaning: ellipse for entry/exit points, rectangle for steps, diamond for the branch. Note the emphasis above is sparing — only the standout term in a couple of nodes is **bold**; most are left plain.

---

## Verification before you submit

Walk through these before issuing the `write_note`s:

1. Every node's `content` is a short phrase or one short sentence — no paragraphs.
2. For a taxonomy / mindmap: the root is a `layered-circle`, every other node is a `rectangle`; hierarchy is the message.
3. For a flow or schema: at least one ellipse (terminal) AND at least one diamond (decision), used where they actually fit. If you don't have those, you're probably building a taxonomy after all — drop the variety.
4. Emphasis is a spotlight, not a coat of paint: at most one `**bold**` / `==highlight==` per node, and most nodes need none.
5. Total notes between 5 and 15. Never exceed 25.

If you can't tick all four, fix the structure before submitting.
