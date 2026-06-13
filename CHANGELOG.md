## v0.3.38 (2026-06-13)

### Fix

- **mini-app**: allowlist mini-app.dim0.net in vite preview Host filter (#113)

## v0.3.37 (2026-06-13)

### Fix

- **mini-app**: allowedHosts:true so vite preview doesn't 403 behind Caddy (#112)

## v0.3.36 (2026-06-13)

## v0.3.35 (2026-06-12)

## v0.3.34 (2026-06-11)

### Fix

- parchment secondary color (#104)

## v0.3.33 (2026-06-11)

### Feat

- mini app iframe runtime (#103)

## v0.3.32 (2026-06-07)

## v0.3.31 (2026-06-07)

### Fix

- sheet breadcrumb and subpage icons (#100)

## v0.3.30 (2026-06-05)

### Feat

- add sheet note icon picker (#99)

## v0.3.29 (2026-06-03)

### Feat

- minor ui fixes and alignments (#98)

## v0.3.28 (2026-06-02)

### Fix

- persist note properties on wire (#97)

## v0.3.27 (2026-06-02)

## v0.3.26 (2026-06-01)

### Fix

- **collab**: only emit dimensions actually in the wire patch (#95)

## v0.3.25 (2026-06-01)

## v0.3.24 (2026-05-31)

### Fix

- **board**: persist viewport on camera event + 200ms debounce (#93)

## v0.3.23 (2026-05-31)

### Feat

- node traffic lights (#92)

## v0.3.22 (2026-05-30)

## v0.3.21 (2026-05-30)

### Feat

- add board collab (#90)

## v0.3.20 (2026-05-28)

### Fix

- **board**: close board-switch race that swapped content between boards (#89)

## v0.3.19 (2026-05-27)

## v0.3.18 (2026-05-26)

### Feat

- **webui**: set free plan board limit to 5 (#87)

## v0.3.17 (2026-05-26)

### Feat

- **board**: double-click to create text node + solid editor surface (#86)

## v0.3.16 (2026-05-26)

### Feat

- markdown view directives (#84)

## v0.3.15 (2026-05-25)

## v0.3.14 (2026-05-25)

### Feat

- canvas harness (#81)

### Fix

-   - dim0StyleToCanvas       opacity: s.opacity (no divide)
  - dim0LinkStyleToCanvas   inherits via spread, fixed automatically
  - canvasStyleToDim0       opacity: s?.opacity ?? 100 (no * 100)
  - canvasEdgeStyleToDim0Link  same

## v0.3.13 (2026-05-11)

### Feat

- theme variants (#78)

## v0.3.12 (2026-05-10)

### Fix

- board empty state copy (#77)

## v0.3.11 (2026-05-09)

### Perf

- migrate dialog to base UI (#76)

## v0.3.10 (2026-05-09)

### Perf

- floating island subscriptions (#75)

## v0.3.9 (2026-05-09)

### Feat

- add forget password reset (#74)

## v0.3.8 (2026-05-08)

### Perf

- content visibility cull (#73)

## v0.3.7 (2026-05-08)

### Perf

- content visibility cull (#72)

## v0.3.6 (2026-05-08)

### Perf

- graph subscriptions and edges (#71)

## v0.3.5 (2026-05-07)

## v0.3.4 (2026-05-07)

### Fix

- **agents**: scope rearrange anchor to current folder, not root board (#69)

## v0.3.3 (2026-05-07)

### Fix

- share postgres pool (#68)

## v0.3.2 (2026-05-04)

## v0.3.1 (2026-05-04)

### Feat

- **edge**: add misalignment style from spider-verse (#66)

## v0.3.0 (2026-05-03)

## v0.2.8 (2026-04-30)

### Fix

- minor fixes improving md editor typing exp (#64)

## v0.2.7 (2026-04-29)

### Fix

- **webui**: preserve transparent picks for node colors (#63)

## v0.2.6 (2026-04-29)

### Fix

- **agents**: inherit root_id as parent_id for new links (#62)

## v0.2.5 (2026-04-28)

### Fix

- improve node layout and fix image-related issues in rich-text nodes (#59)

## v0.2.4 (2026-04-28)

### Feat

- *****: editor polish (#58)

## v0.2.3 (2026-04-26)

## v0.2.2 (2026-04-24)

### Feat

- **board-agent**: add tool steps overview in floating island (#55)

## v0.2.1 (2026-04-22)

### Feat

- *****: add tiptap editor and major ui revamps (#54)

## v0.2.0 (2026-04-22)

### Feat

- *****: add tiptap editor and major ui revamps (#52)

## v0.1.44 (2026-04-12)

### Feat

- *****: add auto model routing - choose best model per task (#49)

## v0.1.43 (2026-04-11)

### Fix

- **backend**: scope parsed document links to sub-board (#48)

## v0.1.42 (2026-04-10)

## v0.1.41 (2026-04-10)

## v0.1.40 (2026-04-09)

### Feat

- *****: add list view and improve perf of widget nodes (#42)

## v0.1.39 (2026-04-08)

### Fix

- **board**: add parent_id to links (#41)

## v0.1.38 (2026-04-08)

## v0.1.37 (2026-04-07)

## v0.1.36 (2026-04-07)

### Feat

- **agent**: show ai limit dialog (#38)

## v0.1.35 (2026-04-07)

### Feat

- **webui**: add legal consent copy to auth screens (#37)

## v0.1.34 (2026-04-07)

## v0.1.33 (2026-04-04)

### Fix

- *****: fix sub-board redirection in agent note tools and copy cut cross-board and sub-board (#35)

## v0.1.32 (2026-04-04)

### Perf

- **agent**: improve history messages context handling (#34)

## v0.1.31 (2026-04-03)

### Fix

- **board**: route ai spark mapify actions correctly (#33)

## v0.1.30 (2026-04-02)

## v0.1.29 (2026-04-02)

## v0.1.28 (2026-04-02)

## v0.1.27 (2026-04-02)

### Feat

- **board**: add write tool and revamp agent front-end (#29)

## v0.1.26 (2026-03-31)

### Feat

- *****: integrate qwen 3.6 plus preview + minor bug fixes + openai prompt caching (#28)

## v0.1.25 (2026-03-30)

## v0.1.24 (2026-03-29)

### Fix

- **board**: persist canonical sheet size (#26)

## v0.1.23 (2026-03-29)

### Fix

- **backend**: allow note tool outputs without labels (#25)

## v0.1.22 (2026-03-29)

### Feat

- *****: add pwa (#24)

## v0.1.21 (2026-03-28)

### Fix

- *****: fix svg and google connect issues (#23)

## v0.1.20 (2026-03-25)

### Fix

- *****: minor small bug fixes (#21)

## v0.1.19 (2026-03-24)

### Fix

- **build**: fix backend docker runtime (#20)

## v0.1.18 (2026-03-24)

### Fix

- **backend**: use uv lock in docker build (#19)

## v0.1.17 (2026-03-24)

### Fix

- **webui**: allow app dim0 host in vite (#18)

## v0.1.16 (2026-03-24)

## v0.1.15 (2026-03-23)

## v0.1.14 (2026-03-23)

### Fix

- *****: board sheet size fix + minor ui fixes (#15)

## v0.1.13 (2026-03-23)

## v0.1.12 (2026-03-23)

## v0.1.11 (2026-03-23)

## v0.1.10 (2026-03-23)

## v0.1.9 (2026-03-22)

### Refactor

- *****: minor renames (#11)

## v0.1.8 (2026-03-22)

## v0.1.7 (2026-03-22)

## v0.1.6 (2026-03-22)

### Feat

- **build**: improve and add dockerization action (#8)

## v0.1.5 (2026-03-22)

### Feat

- **webui**: show app version in sidebar (#7)

## v0.1.4 (2026-03-22)

### Fix

- **board**: refine linear note behavior (#6)

## v0.1.3 (2026-03-21)

## v0.1.2 (2026-03-21)

## v0.1.1 (2026-03-21)

## v0.1.0 (2026-03-21)

### Feat

- *****: setup semantic versioning (#2)
- *****: first commit (#1)
