# Contributing to Dim0

Thanks for being here. Dim0 is early and the team behind it is small, so the
most valuable contribution right now isn't necessarily code — it's **trying it
and telling us what happened.** What clicked, what broke, what you wish it did.
That feedback shapes what we build next.

This guide keeps things light on purpose. When in doubt, open an issue or a
discussion and ask.

## The best ways to help (in rough order)

1. **Use it and report back.** File a [bug report](https://github.com/vcmf/dim0/issues/new/choose)
   when something breaks, or start a [discussion](https://github.com/vcmf/dim0/discussions)
   for anything open-ended — questions, ideas, a board you built.
2. **Sharpen an idea.** Concrete feature requests with a clear "here's the
   problem I hit" are gold.
3. **Improve docs.** If a setup step tripped you up, a small README or comment
   fix helps the next person.
4. **Send code.** Bug fixes and well-scoped improvements are welcome — see below.

## Before you open a PR

Because we're small, a quick heads-up saves everyone time:

- **For anything non-trivial, open an issue or discussion first.** A short note
  about what you want to change lets us flag overlaps or direction before you
  invest hours. Small fixes (typos, obvious bugs) can go straight to a PR.
- **Keep PRs focused.** One logical change per PR is far easier to review and
  merge than a sweeping one.

## Local setup

Everything you need to run Dim0 locally is in the
[README](./README.md#quickstart-under-a-minute) — the quickstart gets you going
on Docker in under a minute, and "Run from source" covers the backend/frontend
dev loop.

Repo layout at a glance:

- `backend/` — FastAPI API, agent logic, prompts, model integrations
- `webui/` — React + TypeScript frontend (canvas, chat, board UX)
- `build/` — Docker Compose and build helpers

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/) via
Commitizen:

```
type(scope): short imperative message
```

- **Scope is required** and specific — e.g. `agent`, `webui`, `backend`,
  `prompts`, `collab`.
- Keep the message short, imperative, and lowercase (no trailing period).
- One commit = one logical change.

Examples:

```
fix(webui): keep node selection after undo
feat(agent): add mini-app export tool
docs(readme): document the three required API keys
```

## Code style

- **Frontend:** TypeScript (`.ts`/`.tsx`), no semicolons, named exports (no
  `export default` for components), avoid `any`. Match the style of the files
  around you.
- **Backend:** Python with type hints and Pydantic models where they fit.
- Add a short docstring to new or changed functions/classes — focus on intent
  and behavior, not line-by-line detail.

## PR checklist

- [ ] Branched off `main`
- [ ] PR title follows the Conventional Commit format above
- [ ] Linked the related issue (if any)
- [ ] Ran the app locally and checked the change actually works
- [ ] Kept the change focused on one thing

## Code of conduct

Participation in this project is covered by our
[Code of Conduct](./CODE_OF_CONDUCT.md). Be kind; assume good faith.

## Questions

Not sure where something goes? Open a
[discussion](https://github.com/vcmf/dim0/discussions) or email
**contact@dim0.net**. We'd rather you ask than stay stuck.
