import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileWorkflow } from '../archify/renderers/workflow/workflow-compiler.mjs';

function fixture() {
  return {
    schema_version: 2, diagram_type: 'workflow',
    meta: { title: 'Conditional return', output: 'conditional-return.html' },
    lanes: [{ id: 'caller', label: 'Caller' }, { id: 'query', label: 'Query' }],
    nodes: [
      { id: 'reply', lane: 'caller', col: 2, type: 'backend', label: 'Reply' },
      { id: 'error', lane: 'query', col: 1, yOffset: -120, type: 'security', label: 'Error' },
      { id: 'pending', lane: 'query', col: 0, yOffset: 40, type: 'backend', label: 'Pending' },
      { id: 'result', lane: 'query', col: 2, yOffset: 120, type: 'backend', label: 'Result' },
    ],
    edges: [
      { id: 'a-pending-result', from: 'pending', to: 'result', fromSide: 'right', toSide: 'left' },
      { id: 'b-error-result', from: 'error', to: 'result', label: 'Error result', fromSide: 'right', toSide: 'bottom' },
      { id: 'a0-return', from: 'result', to: 'reply', label: 'Return to caller', fromSide: 'top', toSide: 'bottom', route: 'straight' },
    ],
  };
}

function applyRepair(workflow, changes) {
  const repaired = structuredClone(workflow);
  for (const { op, path } of changes) {
    assert.equal(op, 'remove');
    const match = path.match(/^\/edges\/(\d+)\/(fromSide|toSide|route)$/);
    assert.ok(match, `repair must only relax a named optional route control: ${path}`);
    assert.notEqual(repaired.edges[match[1]][match[2]], undefined);
    delete repaired.edges[match[1]][match[2]];
  }
  return repaired;
}

test('a crossing reports an executable full-workflow repair without applying it to authored constraints', () => {
  const workflow = fixture();
  const original = structuredClone(workflow);
  const failure = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(failure.ok, false);
  assert.deepEqual(workflow, original);
  const diagnostic = failure.diagnostics.find(({ code }) => code === 'composition/proper-crossing');
  const repair = diagnostic.evidence.verifiedRepair;
  assert.equal(repair.scope, 'complete-workflow-compile');
  assert.match(diagnostic.supportedFixes[0], /if .* optional/);
  assert.match(diagnostic.supportedFixes[0], /browser verification still required/);
  const repaired = applyRepair(workflow, repair.changes);
  const success = compileWorkflow({ workflow: repaired, qualityProfile: 'showcase' });
  assert.equal(success.ok, true, JSON.stringify(success.diagnostics));
  assert.deepEqual(repaired.nodes, original.nodes);
  assert.deepEqual(repaired.lanes, original.lanes);
  assert.deepEqual(repaired.meta, original.meta);
  assert.deepEqual(repaired.edges.map(({ id, from, to, label }) => ({ id, from, to, label })),
    original.edges.map(({ id, from, to, label }) => ({ id, from, to, label })));
  assert.deepEqual(success.receipt.nodes, failure.receipt.nodes);
  assert.equal(success.receipt.edges.length, original.edges.length);
});

test('repair paths use authored edge indexes after source reordering', () => {
  const workflow = fixture();
  workflow.edges.reverse();
  const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  const repair = result.diagnostics.find(({ code }) => code === 'composition/proper-crossing').evidence.verifiedRepair;
  assert.equal(compileWorkflow({ workflow: applyRepair(workflow, repair.changes), qualityProfile: 'showcase' }).ok, true);
});

test('standard warning and absolute geometry retain their original acceptance without optional repair suggestions', () => {
  const standard = compileWorkflow({ workflow: fixture(), qualityProfile: 'standard' });
  assert.equal(standard.ok, true);
  assert.ok(standard.receipt.diagnostics.some(({ code }) => code === 'composition/proper-crossing'));
  assert.ok(standard.receipt.diagnostics.every(({ evidence }) => !evidence?.verifiedRepair));
  const workflow = fixture();
  workflow.meta.viewBox = [768, 816];
  const original = structuredClone(workflow);
  const pinned = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(pinned.ok, false);
  assert.ok(pinned.diagnostics.every(({ evidence }) => !evidence?.verifiedRepair));
  assert.deepEqual(workflow, original);
});

test('an unrelated error does not acquire a claim of a complete repair', () => {
  const workflow = fixture();
  workflow.nodes.push({ ...workflow.nodes[0], id: 'overlapping' });
  const failed = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(failed.ok, false);
  assert.ok(failed.diagnostics.every(({ evidence }) => !evidence?.verifiedRepair));
});
