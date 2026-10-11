# Explainer authoring

Use `explainer` by default for answers with a conclusion and some structure: explanations, comparisons, decisions, diagnoses, reviews and plans. The page leads with the conclusion and replaces long text with panels and optional native diagrams. Small talk, one- or two-sentence answers, pure command output and plain-text requests stay text. A request to draw a system uses a native diagram type.

A small answer gets a small page: the conclusion plus one or two panels. Do not add panels to fill space.

## Draft

Write a restricted Markdown draft, or the equivalent JSON document. The first paragraph after the title is one direct conclusion. An optional flat list immediately after that paragraph supplies up to four reasons. Put qualifications in the optional scope line or source titles.

```md
# Should we split the service? {#service-choice}

Keep a **modular monolith** until independent scaling or releases become necessary.

- Local transactions keep the write path simple.
- Stable module boundaries make later extraction easier.[](source:boundaries)

@answer scope="An eight-person team with changing module boundaries and no scaling hotspot."
@meta locale=en
@source boundaries title="Monolith First" url=https://martinfowler.com/bliki/MonolithFirst.html

## What changes between the options? {#tradeoffs}

| Criterion | Modular monolith | Services |
| --- | --- | --- |
| Deployment | One unit {good:Simple} | Separate units {caution:More coordination} |

## What should happen next? {#next}

- Define module interfaces.
- Assign one owner for each data write.
```

The canonical `answer` has `summary`, optional `reasons` and optional `scope`. A reason list is flat and unordered. Arbitrary HTML, nested lists and arbitrary Markdown extensions fail with a located diagnostic. Quotes in directive attributes use JSON escaping. Literal code is preserved.

## Panels and layout

Each `##` starts a panel. Prefer a specific question as its title. Stable IDs (`{#tradeoffs}`) allow links and panel replacement. Add an optional span as `{#tradeoffs span=7}` (1–12). Omit span for automatic layout.

The conclusion is the first panel (`#answer`). Preferred widths on the 12-column board are: conclusion 5; comparison 7 (8 with more than three total columns); diagram 8 (12 for a wide viewBox); short prose, lists and steps 4; code and diff 7. Panels fill rows in source order. Spare columns go to the row's largest flexible panel. Authored spans never grow; if a row contains only fixed spans, a non-content spacer fills its remainder. Rows stretch to equal height. Mobile stacks panels.

## Content blocks

- Plain paragraphs, flat lists and comparison tables need no directive. Comparison cells may end with `{good:Label}`, `{caution:Label}` or `{bad:Label}`. Row labels may end with `{#row-id}`.
- `@prose id=...` followed by pipe rows gives a paragraph a stable ID.
- `@comparison id=... columns="A,B"`: rows contain criterion, then one cell per option.
- `@steps id=...`: rows contain ID, title, optional detail, optional diagram ID, optional node, optional `from~to` route and optional comma-separated edge IDs. Node and route are mutually exclusive. Clicking a linked step opens the full native Viewer at that target.
- `@callout level=note title="..."`: one text column; levels are `note`, `warning`, `open-question`.
- `@facts`: two columns, label and value.
- `@metric label="..." value=12 limit=20 unit=ms`: numeric content; value or limit is required. Optional `typical=true` and `note="..."` describe the value.
- `@code source=router language=js`: obtains a real excerpt from the source's Git commit and line range. It does not accept authored code text.
- `@diff caption="..."` followed by a fenced `diff` block: literal before/after lines, displayed with line numbers.
- `@image path=images/example.png alt="..."`: embeds a contained local PNG, JPEG, GIF or WebP. Symlinks, escaping paths, unsupported formats and oversize assets fail.
- `@diagram sequence source=request.sequence.json` references a same-directory native spec; `@sequence id=request` supports compact actor/message rows. Native types are architecture, workflow, sequence, dataflow, lifecycle, erd, class, tree, timeline and waterfall. A document may contain zero to four native diagrams. Native validation and geometry checks still apply.

Use a diagram only if its relationships or sequence help explain the answer. Do not add one as decoration.

## Inline links and sources

`**bold**`, inline code and safe HTTP(S) links are supported. `[Redis](node:request.redis)` and `[path](route:request.api~redis)` open the native Viewer at existing targets. `[details](block:next)` jumps within the page.

`[reference text](source:docs)` renders normal text followed by a numbered superscript. `[](source:docs)` renders only the superscript. Numbers follow first appearance in the conclusion, reasons, scope and then panels; repeated references share a number. Uncited sources follow in declaration order. The footer is one numbered list of titles and URLs or repository positions.

```md
@source docs title="GET command" url=https://redis.io/docs/latest/commands/get/
@source router title="Request handler" path=src/router.js lines=10:30
@code source=router language=js
```

Pass `--repo-root /path/to/repository` for code excerpts. The tool resolves origin and HEAD or accepts `@meta repo_url=... repo_revision=<full-commit>`. The commit, path and line range must exist; working-tree modifications cannot replace committed excerpt bytes. The generated page shows the source location without a status badge.

Typical-value annotations (`[5 ms](typical:Description of the value)`) become static footnotes, including in print.

## Delivery

```sh
node archify/bin/archify.mjs finalize explainer answer.md answer.html --json
```

Explainer delivery validates, atomically delivers and checks the HTML. It does not launch a browser. Its receipt includes `browserCheck.requested: false`, `browserCheck.ran: false` and a `browser-check: not-run` gate. These three static gates complete the explainer delivery workflow. Other diagram types keep their existing finalize gates.

Writing warnings flag qualifiers such as “示例”, “本例”, “不代表”, “未实测”, “仅供参考”, “illustrative” and “not measured” in conclusions, reasons and body text. Move these conditions into scope or sources. `--writing warn|strict|off` controls warnings; scope and source titles are excluded.

## Panel replacement

```sh
node archify/bin/archify.mjs patch explainer answer.html next replacement.md revised.html --json
```

The replacement contains one `##` panel with the same stable ID. The tool preserves untouched content and frozen assets. Revision and byte receipts are internal delivery metadata; they are not page furniture. Rerun finalize on a complete edited draft when changing shared sources, the conclusion or document-wide structure.

The page supports theme switching, printing, source navigation and native diagram exploration. It stores no reader data. Without JavaScript, it follows the system theme and remains readable; inactive controls are hidden. Printing preserves explanatory content and footnotes.
