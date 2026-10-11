# Explainer: a concise visual answer

## Product contract

An Agent's long answer is tiring to read and its main point is hard to find. Explainer puts the conclusion first, explains the reasons with structure and useful diagrams, and leaves room for visual refinement. This is a reading surface. The implementation uses Archify's own author format, renderer and native diagram runtime.

## Content model

`diagram_type: "explainer"` uses schema version 1. The document contains `meta`, `answer`, `panels` and `sources`.

- `answer.summary`: required direct conclusion.
- `answer.reasons`: optional flat list, at most four items.
- `answer.scope`: optional applicability and qualifications.
- Panels contain prose, list, comparison, callout, facts, metric, steps, code, diff, image or native diagram blocks. Each panel and block has a stable ID.
- Sources contain a title and optional safe URL or repository position (`path`, `lines`, `revision`). Sources are a numbered footer list. Code blocks load committed Git bytes from their source location.
- Internal revisions support patch and delivery identity. They are not displayed.

A restricted Markdown draft compiles to the same JSON model. The first paragraph after `# title` is the summary; an immediately following flat bullet list supplies reasons; `@answer scope="..."` supplies the applicability line. Detailed grammar and examples live in [the authoring guide](../../archify/references/explainer-authoring.md).

## Board layout

The conclusion is the first item inside `.board`, with `id="answer"` and classes `panel answer-panel spanN`. There is no separate conclusion banner.

| Content | Preferred columns |
| --- | ---: |
| Conclusion | 5 |
| Comparison | 7; 8 if more than three total columns |
| Diagram | 8; 12 if its viewBox exceeds 760 units |
| Steps, list, short prose | 4 |
| Code or diff | 7 |

A mixed panel uses the largest applicable width. Pack in document order; if the next panel does not fit, start a new row. Assign remaining columns to the flexible panel with the most content, including on the final row. Preserve authored spans exactly. When every panel in a partial row has a fixed span, an inert spacer completes the 12-column row. Panel heights stretch to the same height within a row. Responsive and print rules remain in place.

This change only removes obsolete CSS and adds structural span/citation rules. Color, typography, spacing and the next visual iteration are outside its scope.

## References

`[text](source:id)` becomes normal text plus `<sup class="cite"><a href="#source-id">n</a></sup>`. Empty labels are allowed. Number sources by their first appearance in reading order, then append unused sources in declaration order. Repeated references keep their number. Source items contain only title, link or repository location.

Native diagram links retain real node, route and edge checks. Linked steps open the full Viewer already focused on the intended targets. Static SVG remains available for reading and printing.

## Runtime and cost

`finalize explainer` runs validate, atomic deliver and check. Explainer delivery and acceptance require these three static gates; browser acceptance is outside this workflow. Compact and full receipts record the browser gate as not requested and not run. Native diagram types retain their prior behavior.

Code excerpts still read a pinned commit and actual file lines. Contained images and native HTML are frozen into the delivery. Check validates source/asset hashes, document references and native geometry; this protects the artifact contract rather than rating its conclusions.

Writing checks advise “把限定条件写进 scope 或来源” for qualifier wording in summary, reasons and body. Scope and sources are excluded. Unsupported author syntax fails with a line, component, reason and repair example.

## Examples and acceptance

- [Comparison](explainer/examples/comparison.md): modular monolith or microservices.
- [Mechanism](explainer/examples/mechanism.md): cache miss without a diagram.
- [Diagram](explainer/examples/diagram.md): cache miss with a native sequence and linked steps.

Build with `node docs/specs/explainer/prototypes/build.mjs /tmp/explainer-board`. No installation is required.

Required regression coverage: summary/reasons/scope parsing and bounds; first-panel placement; 12-column row sums and fixed spans; first-use citations and empty labels; qualifier exclusions; fast finalize receipts; unchanged native finalize; Git excerpt safety; patch, packaged runtime, no-JavaScript, print and native target navigation.

Run `node --test test/explainer-*.test.mjs` and `npm test`. Measure all three fast finalizations. Tests confirm behavior; visual tuning remains a separate task.
