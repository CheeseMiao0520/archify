// Rule engine: every rule is a module exporting { code, dimension, severity,
// confidence, run({ graph, config }) -> Finding[] }. Rules are independent —
// none reads another's output — and every threshold they use is echoed in
// the finding's evidence so a reader can re-check the call.
import * as cycle from './rules/coupling/cycle.mjs';
import * as hub from './rules/coupling/hub.mjs';
import * as importCycle from './rules/coupling/import-cycle.mjs';
import { createHash } from 'node:crypto';

export const RULES = [importCycle, cycle, hub];

export function evaluate(graph, config = {}, facts = null) {
  const suppressed = new Set(config.ignore || []);
  const diagnostics = [];
  let suppressedCount = 0;
  for (const rule of RULES) {
    if (suppressed.has(rule.code)) { suppressedCount += 1; continue; }
    for (const finding of rule.run({ graph, config, facts })) diagnostics.push({ id: '', ...finding });
  }
  // Deterministic output order; ids do not depend on it (see assignIds).
  diagnostics.sort((a, b) => compareText(a.code, b.code) || compareText(JSON.stringify(a.subject), JSON.stringify(b.subject)));
  assignIds(diagnostics, graph);
  const summary = { errors: 0, warnings: 0, info: 0 };
  const key = { error: 'errors', warning: 'warnings', info: 'info' };
  for (const d of diagnostics) summary[key[d.severity]] += 1;
  return {
    schema_version: 1,
    repository: graph.repository,
    rules: RULES.map((r) => r.code),
    summary: { ...summary, suppressed: suppressedCount },
    diagnostics,
  };
}

// A finding id names the problem, not its position in the list: dimension
// prefix + a hash of the rule code and what the finding is about. Adding or
// fixing an unrelated finding leaves every other id unchanged, so ids can be
// compared across runs. Modules are identified by their grouping path, not by
// their generated id, which can change when another module's slug collides.
function assignIds(diagnostics, graph) {
  const anchors = moduleAnchors(graph);
  const taken = new Set();
  for (const d of diagnostics) {
    const identity = JSON.stringify([d.code, identityOf(d.subject, anchors)]);
    // Two findings with the same rule and subject should not exist; if one
    // ever does, the later one (in the deterministic order) is disambiguated.
    let id = idFor(d.dimension, identity);
    for (let n = 2; taken.has(id); n += 1) id = idFor(d.dimension, `${identity}#${n}`);
    taken.add(id);
    d.id = id;
  }
}

function idFor(dimension, identity) {
  return `${dimension.toUpperCase().slice(0, 4)}-${createHash('sha256').update(identity).digest('hex').slice(0, 12)}`;
}

function identityOf(subject, anchors) {
  const anchor = (id) => anchors.get(id) ?? `id:${id}`;
  if (Array.isArray(subject?.files)) return { files: [...subject.files].sort(compareText) };
  if (Array.isArray(subject?.modules)) return { modules: subject.modules.map(anchor).sort(compareText) };
  if (typeof subject?.module === 'string') return { module: anchor(subject.module) };
  return canonical(subject);
}

function moduleAnchors(graph) {
  const groups = new Set(graph?.grouping?.groups || []);
  const anchors = new Map();
  for (const m of graph?.modules || []) {
    // path '' is either a single root-level file (label = its path) or the root directory.
    const anchor = m.path ? (groups.has(m.path) ? `group:${m.path}` : `dir:${m.path}`) : m.label === '(root)' ? 'root' : `file:${m.label}`;
    anchors.set(m.id, anchor);
  }
  return anchors;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort(compareText).map((k) => [k, canonical(value[k])]));
  return value;
}

function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
