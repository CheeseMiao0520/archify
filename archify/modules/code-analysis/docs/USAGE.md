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

Keep the terminal running. After changing source code, click **Re-analyze** on the overview: the repository is read again without restarting, the page reloads with the new result, and the overview shows what changed since the previous analysis (new, fixed, and findings whose code changed). If a re-analysis fails, the last good result stays in place and the reason is shown next to the button. Changes to the architecture JSON or to the `--config` file still need a restart.

Analysis reads the working tree, including uncommitted and untracked source files. Results are labeled **Working tree**; any base commit is context only. Source panels use the text captured during extraction, and working-tree results do not provide commit-based source links. The raw facts retain that source text and a snapshot digest so findings, graphs, and source panels refer to the same extraction. Non-Git directories are supported.

The source panel marks captured changes against the base commit: green gutters for added lines, amber for modified lines, and red deletion markers between lines. This includes staged and unstaged changes; files absent from the base are labeled **New file**. Markers stay tied to the captured source, so re-analyze to see later edits. Without a readable Git base, the panel reports that markers are unavailable rather than treating every line as new.

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

## Function complexity

Every Python and JS/TS function is measured the same way. **Cyclomatic complexity** is 1 plus one for each decision point:

| | Python | JS/TS |
| --- | --- | --- |
| Conditions | `if`/`elif` | `if`/`else if` |
| Loops | `for`/`while` | `for`/`for…in`/`for…of`/`while`/`do` |
| Error handling | `except` | `catch` |
| Conditional expressions | `x if c else y` | `c ? x : y` |
| Cases | non-default `case` | non-default `case` |
| Boolean operators | each extra `and`/`or` operand | each `&&`, `||`, `??` (and `&&=`, `||=`, `??=`) |
| Comprehensions | each `for`/`if` clause | — |

Optional chaining (`?.`) is not counted. **Nesting depth** is the deepest stack of blocks; `elif`/`else if` stays at its `if`'s depth.

Nested named functions are measured on their own:
- in Python: methods and nested `def`s;
- in JS/TS: methods, constructors, accessors, and arrow or function expressions assigned to a name.

Lambdas and anonymous callbacks count toward the function that contains them. A callback at module level has no such function, so it is measured on its own, named after the call it is passed to, such as `<callback of server.on>`. Test and generated files are skipped.

A function is reported as info from complexity 15 or nesting 5, and as a warning from complexity 25 or nesting 6. Function length is shown as context but never reported on its own. A high count is a maintenance signal, not a defect. The problem page links to the function's first line and its deepest nested block.

To change the thresholds, set any of them in the `--config` file; unset values keep their defaults:

```json
{ "rules": { "complexity": { "function": { "info": { "complexity": 12 }, "warning": { "complexity": 30, "nesting": 7 } } } } }
```


## Accepting known findings (baseline)

Real projects have findings the team knows about and has decided to leave for now. A baseline file records them, so the overview and CI focus on what is new:

```sh
node bin/archify.mjs code-analysis check "/path/to/project" --baseline analysis-baseline.json --update-baseline --reason "existing debt when analysis was adopted"
```

This writes every current finding to `analysis-baseline.json` with that reason. Edit the reasons per entry if you like, and commit the file. Pass it to the page with `--baseline analysis-baseline.json` (`npm start -- … --baseline …`) or to `check`.

- Accepted findings stay listed, marked **accepted** with their reason, but no longer count toward the verdict, the priorities, the diagram colours, or a CI failure.
- Each entry remembers a fingerprint of the code it was about. If that code changes, the finding is shown again as **accepted · evidence changed** so someone looks at it once more.
- Entries whose finding no longer occurs are listed as no longer found: the problem was fixed or moved, and the entry can be removed. Running `--update-baseline` again keeps existing reasons, adds new findings, and drops those entries.

## Terminal and CI: `code-analysis check`

`check` runs the same analysis without a diagram and exits with a status a pipeline can use:

```sh
node bin/archify.mjs code-analysis check "/path/to/project" --baseline analysis-baseline.json --fail-on warning --out .analysis
```

| Option | Meaning |
| --- | --- |
| `--fail-on error\|warning\|info\|never` | Fail when an open finding reaches this level (default `warning`). |
| `--baseline file` | Accepted findings do not fail the run unless their code changed. |
| `--out dir` | Write `raw-facts`, `module-graph`, `findings`, `review` and `overview` JSON. The previous `findings.json` in that directory is compared with automatically. |
| `--compare findings.json` | Compare with a specific earlier run instead. |
| `--new-only` | Fail only on findings that are new since the comparison, for gating pull requests. |
| `--update-baseline [--reason text]` | Write the baseline instead of checking. |
| `--json` | Print a machine-readable receipt instead of the summary. |

Exit codes: `0` passed, `1` the gate failed, `2` the analysis could not run (the diagnostic says why). The printed summary lists failing findings as `path:line` with their ids, the comparison counts, and stale baseline entries.

