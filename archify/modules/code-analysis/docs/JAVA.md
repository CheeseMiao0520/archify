# Java source analysis

From the `archify/` package directory:

```sh
node bin/archify.mjs code-analysis check /path/to/java-repo --language java --out out/java
```

The diagram workflow accepts the same `--language java`. A run analyzes one
language; roots whose configured scan matches multiple supported languages
require an explicit choice. The run reports omitted other-language files. `build/` directories and Java sources under
`target/` are excluded by default; JS/TS and Python files under `target/` are
still analyzed as before. `src/test/` files are extracted as tests and excluded
from the dependency graph by the existing role policy.

Upgrade note: a JS/TS or Python tree whose configured scan also includes
`.java` files (for example a React Native `android/` folder) was previously analyzed without
`--language`. It now stops with `extract/adapter-ambiguous`; pass
`--language ts` or `--language py` to keep the previous run. The default
configuration also changed, so the first comparison after upgrading reports
`config-changed` and is not directly comparable.

The adapter reads captured UTF-8 source, accepts a UTF-8 BOM, and retains the
decoded text and source locations. Broken or unsupported files remain in
`files` and `parse_errors` and contribute no dependencies or function metrics.
The adapter does not run Java code, Maven/Gradle builds, annotation processors
or an LLM, and does not require a JDK.

## Dependencies

Declarations, rather than directory layout, map canonical type names to files.
A dependency is recorded only when the analyzed source index identifies one
unambiguous declaration in one file. Dependencies within a file do not produce
file edges.

Recorded reference forms:

- Import declarations: single-type imports, and static imports whose owner
  declares the member. Static members are static fields and methods, enum
  constants, interface constants, and member types that are explicitly static
  or implicitly static (member enums, records and interfaces, and every member
  type of an interface).
- Type positions: field, parameter, local, return and type-argument types,
  `extends`/`implements`/`permits`, `throws`, `catch`, casts, `instanceof`,
  array types and annotations.
- Instance creation `new T(…)` (including the type of an anonymous class),
  constructor references `T::new` and `T[]::new`, and class literals `T.class`.

Resolution follows lexical type scope, declarations in the file, single-type
imports and same-package types. Fully qualified names use the source index.
The guards below leave uncertain bindings unresolved.

Remaining unresolved, by design:

- Duplicate declarations (for example main and test source sets), and member
  types whose enclosing type is declared more than once, on every lookup path
  including static imports.
- Conflicting imports, type-parameter shadowing, names shadowed by a local
  type anywhere in the file, and simple names introduced by a single static
  import (the import itself is still recorded). Types declared in any block (methods, interface
  methods, constructors, initializers, lambdas, switch-rule blocks) are local
  and are not indexed.
- References inside the body of a class, interface, enum or record that
  extends or implements any type, since an inherited member type could bind the
  name. Ordinary class and interface declaration headers are outside this
  body guard; the other scope guards still apply.
- References inside local and anonymous class bodies, whose member and
  inherited scopes are not modeled. Their methods still receive complexity
  metrics.
- On-demand (`*`) imports, which are never expanded to every file in a
  package, and names that need wildcard or classpath lookup.
- Qualified creation `outer.new Inner()` (relative to the outer instance's
  type), other method references `X::m`, and static calls or field accesses
  such as `X.m()` and `X.F`, whose qualifier may be an expression.
- Reflective loading such as `Class.forName("…")` or `ServiceLoader`, which is
  not modeled and therefore not counted as `opaque`.

This is a conservative source dependency graph, not complete Java type or
method-call resolution.

The unresolved counters keep the shared meaning described in the
[technical guide](TECH-GUIDE.md#5-the-four-kinds-of-unresolved-why-they-are-counted-separately):
`external` is outside the analyzed sources and `unknown` is an internal
resolution gap. Every import declaration is recorded; an unresolved one is
`external` when no analyzed file declares its package (JDK, third party) and
`unknown` otherwise (for example build-generated types in a project package).
A type reference is recorded only while it may denote an analyzed type: it
matches an analyzed type name or lies in an analyzed package. Type parameters,
local type names, names bound to an external import (represented by that
import) and names no analyzed file declares (`String`, `Override`) produce no
record, as uses of external modules produce none in the JS/TS adapter. An
unresolved recorded reference counts as `unknown`; for Java this mostly
measures the conservative rules above. `imports[].kind = "static"` means a statically recorded dependency
in the shared contract; it does not specifically mean Java's `import static`
keyword. Edge weights count dependency records, including recorded imports
and type references, rather than import declarations alone.

File cycles and module cycles are informational structural findings. Their
messages, task exports and UI do not infer Python-style partial initialization
or claim a Java runtime failure. Directory grouping and explicit `modules.groups`
still control modules; Java package names, Maven modules and JPMS modules are
not substituted for that existing contract.

## Complexity

Methods, interface methods with bodies, constructors and record compact
constructors emit the existing `functions` contract. Abstract/native methods
without bodies are skipped. Qualified names follow the shared `Class.method`
and `outer.<locals>.inner` form, with parameter types added, such as
`Service.save(String,int...)`: Java overloads each have a body, and a source-order
`#2` suffix would rename later overloads whenever one is added above them.
Local and anonymous class methods, including enum constant bodies, are measured
separately. Lambdas contribute to their containing method. Code outside any
method is measured on its own, as module-level callbacks are in the JS/TS
adapter: static and instance initializer blocks as `Class.<static initializer>`
and `Class.<instance initializer>` (`#2` for further blocks of the same kind),
and a field whose initializer contains a lambda under the field's name, such as
`Registry.COMPARATOR`. Other field initializers are not measured.

Complexity starts at 1, then adds 1 for each `if`, loop, `catch`, conditional
expression, non-default switch label, pattern guard, `&&` and `||`. A label
containing several case constants counts once. Nesting counts if/loop/switch/
try/synchronized blocks; `else if` stays at the preceding if's depth, and
catch/finally blocks stay at their try's depth. Comments and strings do not add
branches. Existing thresholds and source-evidence views are reused.

## Parser choice and boundaries

The implementation pins `java-parser@3.0.1`, a synchronous JavaScript parser
producing a CST with token offsets and line/column locations.

Syntax probes cover Java 8-style generics/lambdas, records and compact
constructors, sealed types, text blocks, module descriptors and Java 21 switch
patterns/guards. These probes do not establish complete coverage of every Java
release or preview feature. Unsupported syntax is reported as a parse error.

One known misparse is corrected: `java-parser@3.0.1`
reads a member record whose body is empty, such as `record Value(int x) {}`, as
a method returning type `record`. No such method compiles, so the adapter
rewrites these nodes into record declarations.

Java Unicode escapes are expanded before lexing, including inside comments.
This parser does not implement that preprocessing. Files containing a
`\uXXXX`-style sequence are therefore reported as unsupported, including
sequences inside strings and those preceded by another backslash, rather than
risking silently missing code. Other source
encodings, build-aware symbol resolution, generated/Lombok symbols, Spring
injection, inheritance/call graphs and class initialization analysis are outside
this adapter's scope.

Small hand-counted fixtures protect dependency and complexity correctness. Real
repository checks should fix a source revision, start with a submodule, then
expand to the full tree. Report parse failures and unresolved coverage alongside
runtime and memory; completion alone does not establish complete dependency
coverage.
