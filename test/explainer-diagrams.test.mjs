import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { SaxesParser } from 'saxes';
import { compileExplainerDiagram, prepareExplainerDiagrams, validateExplainerDiagramTarget } from '../archify/explainer/diagrams.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const documentOf = blocks => ({ panels: [{ id: 'mechanism', blocks }] });
const blockOf = (type, spec, extra = {}) => ({ id: type, type: 'diagram', diagramType: type, spec, ...extra });
const rows = {
  sequence: ['actor client | Client | frontend', 'actor api | API | backend', 'actor redis | Redis | database',
    'client | api | Request', 'api | redis | Read', 'redis | api | Miss | return'],
  architecture: ['client | Client | external', 'api | API | backend', 'redis | Redis | database', 'client > api | Request', 'api > redis | Read'],
  workflow: ['client | Client | external', 'api | API | backend', 'done | Done | backend', 'client > api | Request', 'api > done | Done'],
  tree: ['root | 平台', 'api | API | root', 'redis | Redis | root'],
  timeline: ['lane release | 发布', 'deploy | 2026-10-01T10:00:00+08:00 | 发布 | release | change', 'alert | 2026-10-01T10:05:00+08:00 | 告警 | release | alert'],
  erd: ['entity user | 用户', 'entity order | 订单', 'user.id | bigint | pk', 'order.id | bigint | pk', 'order.user_id | bigint | fk | user.id', 'order > user | many:one | 下单者'],
};

test('explainer diagrams: compact shapes produce real native showcase HTML and semantic routes', async () => {
  const specs = Object.fromEntries(Object.entries(rows).map(([type, lines]) => [type, compileExplainerDiagram(type, lines, { id: type })]));
  const document = documentOf(Object.entries(specs).map(([type, spec]) => blockOf(type, spec)));
  const frozen = JSON.stringify(document);
  const { diagrams, dependencies } = await prepareExplainerDiagrams(document);
  assert.equal(JSON.stringify(document), frozen, 'native render must not mutate author input');
  assert.equal(dependencies.length, 6);
  for (const [type, entry] of Object.entries(diagrams)) {
    assert.equal(entry.checks.check.ok, true, `${type} native artifact checker`);
    assert.equal(entry.checks.validate.ok, true);
    assert.equal(entry.checks.render.ok, true);
    assert.equal(entry.sha256, hash(entry.html));
    assert.equal(entry.bytes, Buffer.byteLength(entry.html));
    assert.equal(entry.checks.check.artifact.sha256, entry.sha256, 'native receipt binds original canonical bytes');
    assert.equal(fs.existsSync(path.dirname(entry.checks.check.file)), false, 'renderer-owned temporary directory is cleaned');
    assert.ok(entry.semantic.nodes.length >= 2);
    assert.match(entry.styles, /--frontend-fill/);
    assert.match(entry.styles, /data-theme="light"/);
    assert.match(entry.svg, /data-quality-profile="showcase"/);
    assert.match(entry.html, /Archify/);
    assert.equal(entry.canonicalSvg, entry.svg);
    assert.equal(Buffer.from(entry.specification.contentBase64, 'base64').toString(), JSON.stringify(specs[type]));
  }
  assert.deepEqual(diagrams.sequence.semantic.edges.map(edge => [edge.from, edge.to]), [['client', 'api'], ['api', 'redis'], ['redis', 'api']]);
  assert.equal(validateExplainerDiagramTarget(diagrams, { diagram: 'architecture', route: ['client', 'redis'] }), true);
  assert.equal(validateExplainerDiagramTarget(diagrams, { diagram: 'sequence', edges: ['api-to-redis-1'] }), true);
  for (const target of [{ diagram: 'missing' }, { diagram: 'architecture', node: 'imaginary' },
    { diagram: 'architecture', route: ['redis', 'client'] }, { diagram: 'sequence', edges: ['invented'] }]) {
    assert.throws(() => validateExplainerDiagramTarget(diagrams, target, { line: 42 }), error => {
      assert.equal(error.archifyDiagnostics[0].subject.line, 42); return true;
    });
  }
  assert.deepEqual(diagrams.erd.semantic.edges.map(edge => [edge.from, edge.to]), [['order', 'user']], 'FK declarations never invent relations');
});

test('explainer diagrams: all other native modes preserve their JSON source bytes', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-diagram-fixtures-'));
  try {
    const fixtures = { dataflow: 'product-analytics.dataflow.json', lifecycle: 'deployment-release.lifecycle.json',
      class: 'payments.class.json', waterfall: 'checkout-request.waterfall.json' };
    const blocks = [];
    for (const [type, file] of Object.entries(fixtures)) {
      fs.copyFileSync(path.join(root, 'archify/examples', file), path.join(directory, file));
      blocks.push({ id: type, type: 'diagram', diagramType: type, source: file });
    }
    const { diagrams, dependencies } = await prepareExplainerDiagrams(documentOf(blocks), { baseDir: directory });
    for (const [type, entry] of Object.entries(diagrams)) {
      const bytes = fs.readFileSync(path.join(directory, fixtures[type]));
      const dependency = dependencies.find(item => item.id === type);
      assert.equal(entry.checks.check.ok, true, type);
      assert.equal(dependency.kind, 'diagram-spec');
      assert.equal(dependency.path, path.join(directory, fixtures[type]));
      assert.equal(dependency.sha256, hash(bytes));
      assert.deepEqual(Buffer.from(dependency.contentBase64, 'base64'), bytes);
      assert.deepEqual(entry.spec, JSON.parse(bytes));
      fs.writeFileSync(path.join(directory, fixtures[type]), '{}');
      assert.equal(entry.spec.diagram_type, type, 'prepared result owns frozen data');
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('explainer diagrams: inline native locale inherits its parent while explicit and source locales stay authoritative', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-diagram-locales-'));
  try {
    const shorthand = compileExplainerDiagram('sequence', rows.sequence, { id: 'request' });
    const english = { ...shorthand, meta: { ...shorthand.meta, locale: 'en' } };
    const sourceBytes = Buffer.from(JSON.stringify(shorthand));
    fs.writeFileSync(path.join(directory, 'standalone.sequence.json'), sourceBytes);
    const document = { ...documentOf([
      blockOf('sequence', shorthand, { id: 'inherited' }),
      blockOf('sequence', english, { id: 'english' }),
      { id: 'standalone', type: 'diagram', diagramType: 'sequence', source: 'standalone.sequence.json' },
    ]), meta: { locale: 'zh-CN' } };
    const originalDocument = JSON.stringify(document);
    const { diagrams, dependencies } = await prepareExplainerDiagrams(document, { baseDir: directory });
    assert.match(diagrams.inherited.canonicalSvg, /lang="zh-CN"/);
    assert.match(diagrams.inherited.canonicalSvg, />图例<\/text>/);
    for (const id of ['english', 'standalone']) {
      assert.match(diagrams[id].canonicalSvg, /lang="en"/);
      assert.match(diagrams[id].canonicalSvg, />Legend<\/text>/);
    }
    assert.equal(JSON.stringify(document), originalDocument, 'locale inheritance never rewrites authored specs');
    assert.equal(diagrams.inherited.spec.meta.locale, undefined);
    assert.deepEqual(Buffer.from(diagrams.inherited.specification.contentBase64, 'base64'), sourceBytes);
    assert.deepEqual(Buffer.from(dependencies.find(dependency => dependency.id === 'standalone').contentBase64, 'base64'), sourceBytes);
    const baseline = await prepareExplainerDiagrams(documentOf([blockOf('sequence', english, { id: 'english' })]));
    assert.equal(diagrams.english.html, baseline.diagrams.english.html, 'parent locale cannot alter explicit child rendered bytes');
    for (const entry of Object.values(diagrams)) {
      assert.equal(entry.checks.check.ok, true);
      assert.equal(entry.sha256, hash(entry.html));
      assert.equal(entry.checks.check.artifact.sha256, entry.sha256);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('explainer diagrams: structural changes decorate only explicit preview targets and keep canonical hash intact', async () => {
  const spec = compileExplainerDiagram('sequence', rows.sequence, { id: 'request' });
  const { diagrams } = await prepareExplainerDiagrams(documentOf([blockOf('sequence', spec,
    { changes: [{ target: 'api', change: 'modified' }, { target: 'api-to-redis-1', change: 'added' }] })]));
  const entry = diagrams.sequence;
  assert.match(entry.svg, /data-node-id="api"[^>]*data-explainer-change="modified"/);
  assert.match(entry.svg, /data-edge-id="api-to-redis-1"[^>]*data-explainer-change="added"/);
  const xml = new SaxesParser();
  xml.on('error', error => { throw error; });
  assert.doesNotThrow(() => xml.write(entry.svg).close(), 'preview annotations preserve valid native SVG markup');
  assert.doesNotMatch(entry.html, /data-explainer-change/);
  assert.doesNotMatch(entry.canonicalSvg, /data-explainer-change/);
  assert.equal(hash(entry.html), entry.sha256);
  await assert.rejects(prepareExplainerDiagrams(documentOf([blockOf('sequence', spec,
    { changes: [{ target: 'nonexistent', change: 'removed' }] })])), error => error.archifyDiagnostics[0].code === 'explainer/diagram-change-target');
});

test('explainer diagrams: rejected native causes retain author line, component and repair example', async () => {
  assert.throws(() => compileExplainerDiagram('sequence', [
    { text: 'Client | API | Request', line: 18 }, { text: 'API | Client | Reply | strange', line: 23 },
  ], { id: 'request', line: 17 }), error => {
    const diagnostic = error.archifyDiagnostics[0];
    assert.equal(diagnostic.subject.line, 23);
    assert.equal(diagnostic.subject.component, 'diagram');
    assert.equal(diagnostic.evidence.native.code, 'schema/enum');
    assert.ok(diagnostic.evidence.example); return true;
  });
  const spec = compileExplainerDiagram('architecture', ['api | API | backend', 'api > missing | Request']);
  await assert.rejects(prepareExplainerDiagrams(documentOf([blockOf('architecture', spec)]), {
    sourceMap: { '/panels/0/blocks/0': { line: 31 } }, sourcePath: '/draft.md',
  }), error => {
    const diagnostic = error.archifyDiagnostics[0];
    assert.equal(diagnostic.subject.line, 31);
    assert.equal(diagnostic.subject.component, 'diagram');
    assert.equal(diagnostic.subject.input, '/draft.md');
    assert.ok(diagnostic.evidence.native); assert.ok(diagnostic.evidence.reason); assert.ok(diagnostic.evidence.example); return true;
  });
  assert.throws(() => compileExplainerDiagram('class', ['a | A']), error => error.archifyDiagnostics[0].code === 'explainer/diagram-shorthand-unsupported');
  const table = compileExplainerDiagram('sequence', [['Client', 'API', 'Request']]);
  assert.equal(table.messages[0].label, 'Request');
  const literal = compileExplainerDiagram('sequence', [{ cells: ['Client', 'API', 'Request | Trace'], line: 81 }]);
  assert.equal(literal.messages[0].label, 'Request | Trace', 'already parsed escaped pipes remain literal label data');
  assert.throws(() => compileExplainerDiagram('erd', ['entity users | Users', 'users.id | bigint | pk', 'users > users | ambiguous']),
    error => error.archifyDiagnostics[0].code === 'explainer/diagram-cardinality');
});

test('explainer diagrams: source containment rejects traversal, symlinks, mismatch, and malformed JSON', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-diagram-boundary-'));
  try {
    const outside = path.join(directory, 'outside.json'), baseDir = path.join(directory, 'input'); fs.mkdirSync(baseDir);
    fs.writeFileSync(outside, JSON.stringify(compileExplainerDiagram('tree', ['root | Root'])));
    fs.symlinkSync(outside, path.join(baseDir, 'linked.json'));
    fs.mkdirSync(path.join(baseDir, 'sub')); fs.symlinkSync(baseDir, path.join(baseDir, 'sub', 'loop'));
    const read = source => prepareExplainerDiagrams(documentOf([{ id: 'tree', type: 'diagram', diagramType: 'tree', source }]), { baseDir });
    for (const source of ['../outside.json', outside, 'linked.json', 'sub/loop/linked.json', 'outside.txt']) {
      await assert.rejects(read(source), error => {
        assert.match(error.archifyDiagnostics[0].code, /^explainer\/diagram-source-/); return true;
      });
    }
    fs.writeFileSync(path.join(baseDir, 'invalid.json'), '{ "secret":');
    await assert.rejects(read('invalid.json'), error => {
      assert.equal(error.archifyDiagnostics[0].code, 'explainer/diagram-json');
      assert.doesNotMatch(JSON.stringify(error.archifyDiagnostics), /secret/); return true;
    });
    fs.writeFileSync(path.join(baseDir, 'mismatch.json'), JSON.stringify({ diagram_type: 'sequence' }));
    await assert.rejects(read('mismatch.json'), error => error.archifyDiagnostics[0].code === 'explainer/diagram-type-mismatch');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
