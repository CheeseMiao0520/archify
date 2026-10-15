# Code Analysis Quick Start

From the `archify/` package directory inside the Archify repository:

```sh
npm ci
npm start -- "/path/to/project" --ir architecture.json
```

Use the project's architecture JSON prepared with Archify as `architecture.json`. Your project can stay in its own directory.

1. Open the **Archify** URL printed in the terminal to view the architecture diagram.
2. Click **Code Analysis** in the upper-right corner to start analysis.
3. Read the project overview, then choose a finding or a component. The same reading column shows the selected page; Back returns to the previous page. View diagram folds the column, and Show analysis restores it.
4. Click a source link for a short captured excerpt. Show full file expands it, and Show excerpt returns to the short view. References without a line show a file preview, not a finding location.
5. Click **Code Analysis** again to return to the architecture view.

Keep the terminal running. After changing source code, stop the server with `Ctrl+C`, restart it, open the new URL, and click **Code Analysis** again.

Analysis reads the working tree, including uncommitted and untracked source files. Results are labeled **Working tree**; any base commit is context only. Source panels use the text captured during extraction, and working-tree results do not provide commit-based source links. The raw facts retain that source text and a snapshot digest so findings, graphs, and source panels refer to the same extraction. Non-Git directories are supported.

The source panel marks captured changes against the base commit: green gutters for added lines, amber for modified lines, and red deletion markers between lines. This includes staged and unstaged changes; files absent from the base are labeled **New file**. Markers stay tied to the captured source, so restart analysis to see later edits. Without a readable Git base, the panel reports that markers are unavailable rather than treating every line as new.

If the architecture JSON changes or becomes unavailable after startup, the analysis request is rejected and the page asks you to regenerate the diagram. Restart with the updated JSON and open the new URL. The server never rewrites your input JSON or silently combines a new architecture with the previous diagram.

Python and JS/TS are supported. For mixed-language projects, add `--language py` or `--language ts`; each run analyzes one language. Add `--map overlay-map.json` when you need an explicit mapping between diagram components and code modules.

Output defaults to a system temporary directory. Add `--out out/my-project` to choose a persistent output directory. Use the printed URL: double-clicking a static HTML file cannot start local code analysis.

You can also run `node bin/archify.mjs start "/path/to/project" --ir architecture.json` directly. The legacy `code-analysis serve` command remains supported.

## Architecture boundaries

To check that layers only depend on what they should, pass a config file with `--config analysis.config.json`:

```json
{
  "boundaries": {
    "layers": {
      "domain": ["src/domain/**"],
      "ui": ["src/ui/**", "src/components/**"],
      "shared": ["src/shared/**"]
    },
    "rules": [
      { "from": "domain", "disallow": ["ui"], "reason": "domain logic stays UI-free" },
      { "from": "shared", "allow": [] }
    ]
  }
}
```

Each rule names a `from` layer and either `disallow` (layers it must not import) or `allow` (the only other layers it may import; `[]` means none). A file matching several layers belongs to the first one listed. Imports involving files outside every layer, and test or generated files, are not checked. Every import that breaks a rule is listed as evidence, grouped into one finding per layer pair.

Boundaries come only from this config. The architecture diagram is not used as a rule: a missing arrow on the diagram does not forbid a dependency. Without `boundaries`, the overview lists architecture boundaries as not checked. Coverage shows how many files each layer matched; a layer matching no files usually means a mistyped glob. An invalid `boundaries` block stops analysis with `config/boundaries-invalid`.

## Function complexity (Python)

For Python projects, every function is measured: cyclomatic complexity (1 plus each `if`/`elif`, loop, `except`, conditional expression, non-default `case`, comprehension `for`/`if`, and each extra `and`/`or` operand) and nesting depth (`elif` stays at its `if`'s depth). Nested functions are measured on their own; lambdas count toward the function that contains them. Test and generated files are skipped.

A function is reported as info from complexity 15 or nesting 5, and as a warning from complexity 25 or nesting 6. Function length is shown as context but never reported on its own. A high count is a maintenance signal, not a defect. The problem page links to the function's first line and its deepest nested block.

To change the thresholds, set any of them in the `--config` file; unset values keep their defaults:

```json
{ "rules": { "complexity": { "function": { "info": { "complexity": 12 }, "warning": { "complexity": 30, "nesting": 7 } } } } }
```

JS/TS functions are not measured yet; for those projects the overview lists complexity as not checked.

