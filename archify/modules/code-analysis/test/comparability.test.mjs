// Config merging and run comparability: "no longer detected" is only evidence
// of a fix when both runs measured the same way.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { loadConfig, mergeConfig } from '../lib/analysis.mjs';
import { comparability, reviewFindings } from '../lib/review.mjs';
import { DiagnosticError } from '../extract/shared/diagnostics.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';
import { analyzeFixture, copySource } from './task-fixtures.mjs';
import { buildGraph, evaluateGraph, extractFacts } from '../lib/analysis.mjs';

const CONFIG = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'py-tasks', 'analysis.config.json');

test('config: objects merge at every depth, arrays and scalars replace', () => {
  const merged = mergeConfig(
    { include: ['a'], roles: { test: ['t/**'], generated: ['g/**'] }, rules: { complexity: { function: { info: { complexity: 15, nesting: 5 }, warning: { complexity: 25 } } } } },
    { include: ['b'], roles: { test: ['spec/**'] }, rules: { complexity: { function: { warning: { complexity: 30 } } } } },
  );
  assert.deepEqual(merged.include, ['b'], 'arrays replace');
  assert.deepEqual(merged.roles, { test: ['spec/**'], generated: ['g/**'] }, 'a role override keeps the other roles');
  assert.deepEqual(merged.rules.complexity.function, { info: { complexity: 15, nesting: 5 }, warning: { complexity: 30 } });
});

test('config: a file overriding one role keeps the default exclude list and other roles', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const defaults = loadConfig(null);
  const file = path.join(dir, 'c.json');
  fs.writeFileSync(file, JSON.stringify({ roles: { test: ['checks/**'] } }));
  const cfg = loadConfig(file);
  assert.deepEqual(cfg.roles.generated, defaults.roles.generated);
  assert.deepEqual(cfg.roles.test, ['checks/**']);
  assert.deepEqual(cfg.exclude, defaults.exclude);
  for (const [text, code] of [['{', 'cli/config-invalid'], ['[1]', 'cli/config-invalid']]) {
    fs.writeFileSync(file, text);
    assert.throws(() => loadConfig(file), (e) => e instanceof DiagnosticError && e.diagnostics[0].code === code, text);
  }
});

function run(dir, config) {
  const { facts } = extractFacts(dir, { language: 'py', config });
  const graph = buildGraph(facts, config);
  return { facts, findings: evaluateGraph(graph, config, facts) };
}
function compare(prev, next) {
  return reviewFindings(next.findings.diagnostics, { previous: prev.findings, analysis: next.findings.analysis, files: next.facts.files.map((f) => f.path) }).comparison;
}

test('comparison: the same analysis of edited code is comparable; a fixed cycle is no longer detected', (t) => {
  const dir = copySource();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = loadConfig(CONFIG);
  const before = run(dir, config);
  assert.deepEqual(schemaErrors('findings', before.findings), []);
  assert.ok(before.findings.analysis.configDigest);
  fs.writeFileSync(path.join(dir, 'app/b.py'), 'DEFAULT_LIMIT = 30\n\n\nclass Handler:\n    def __init__(self, config):\n        self.config = config\n');
  const c = compare(before, run(dir, config));
  assert.equal(c.comparable, true);
  assert.deepEqual(c.reasons, []);
  const gone = c.notDetected.find((f) => f.code === 'coupling/import-cycle');
  assert.ok(gone, 'the cycle is no longer detected');
  assert.equal(gone.likelyCause, undefined, 'nothing else explains its disappearance');
  assert.deepEqual(c.fixed, c.notDetected, '`fixed` stays as a compatible alias');
});

test('comparison: switching a rule off, changing thresholds or deleting a file is not a fix', (t) => {
  const dir = copySource();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = loadConfig(CONFIG);
  const before = run(dir, config);

  const ignored = compare(before, run(dir, { ...config, ignore: ['complexity/function'] }));
  assert.equal(ignored.comparable, false);
  assert.deepEqual(ignored.reasons.map((r) => r.code).sort(), ['config-changed', 'rules-removed']);
  assert.equal(ignored.notDetected.find((f) => f.code === 'complexity/function').likelyCause, 'rule-not-run');

  const raised = compare(before, run(dir, mergeConfig(config, { rules: { complexity: { function: { info: { complexity: 40 } } } } })));
  assert.equal(raised.comparable, false);
  assert.deepEqual(raised.reasons.map((r) => r.code), ['config-changed']);

  const excluded = compare(before, run(dir, { ...config, exclude: [...config.exclude, 'app/engine.py'] }));
  assert.equal(excluded.comparable, false);
  assert.equal(excluded.notDetected.find((f) => f.code === 'complexity/function').likelyCause, 'files-missing');

  fs.rmSync(path.join(dir, 'domain/order.py'));
  const deleted = compare(before, run(dir, config));
  assert.equal(deleted.comparable, true, 'same measurement; the code changed');
  assert.equal(deleted.notDetected.find((f) => f.code === 'architecture/boundary').likelyCause, 'files-missing');
});

test('comparison: renaming a function changes its id; the old one is not detected because its function is gone', (t) => {
  const dir = copySource();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = loadConfig(CONFIG);
  const before = run(dir, config);
  const file = path.join(dir, 'app/engine.py');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('def route(', 'def dispatch('));
  const c = compare(before, run(dir, config));
  const old = before.findings.diagnostics.find((d) => d.code === 'complexity/function');
  const gone = c.notDetected.find((f) => f.id === old.id);
  assert.equal(c.new.length, 1, 'the renamed function is reported under a new id');
  assert.equal(gone.likelyCause, 'possibly-renamed');
  assert.deepEqual(gone.candidates, c.new);
  assert.equal(c.comparable, true);
});

test('comparison: a previous run without analysis context has unknown comparability', (t) => {
  const dir = copySource();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { findings, facts } = analyzeFixture(dir);
  const { analysis: _gone, ...legacy } = findings;
  assert.deepEqual(schemaErrors('findings', legacy), [], 'findings without `analysis` stay valid');
  const c = reviewFindings(findings.diagnostics, { previous: legacy, analysis: findings.analysis, files: facts.files.map((f) => f.path) }).comparison;
  assert.equal(c.comparable, null);
  assert.equal(c.reasons[0].code, 'context-missing');
  assert.equal(comparability(findings.analysis, findings.analysis).comparable, true);
  const parse = comparability(findings.analysis, { ...findings.analysis, coverage: { ...findings.analysis.coverage, parseErrors: ['app/x.py'] } });
  assert.deepEqual(parse.reasons.map((r) => r.code), ['parse-errors']);
});
