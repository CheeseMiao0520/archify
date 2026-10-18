import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileWorkflow } from '../archify/renderers/workflow/workflow-compiler.mjs';

const fixture = new URL('./fixtures/workflow-return-arrival.json', import.meta.url);

test('an automatic reverse rail leaves a feasible arrival for the waiting branch', () => {
  // The earlier close→release rail used the inside of the expiry column,
  // forcing pending→deadline around the outside despite a clear two-bend
  // arrival. Keep the full scene: removing its label/geometry context made
  // the old compiler pass a four-node reduction already.
  const workflow = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const original = structuredClone(workflow);
  const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(workflow, original);
  assert.deepEqual(result.receipt.nodes.map(({ id, lane, col }) => [id, lane, col]).sort(),
    workflow.nodes.map(({ id, lane, col }) => [id, lane, col]).sort());
  assert.deepEqual(result.receipt.edges.map(({ id, from, to }) => [id, from, to]).sort(),
    workflow.edges.map(({ id, from, to }) => [id, from, to]).sort());
  assert.deepEqual(result.receipt.labels.map(({ label }) => label).sort(),
    workflow.edges.filter(({ label }) => label).map(({ label }) => label).sort());
  const waiting = result.receipt.edges.find(({ id }) => id === 'pending-deadline');
  assert.ok(waiting.points.length <= 4, 'the waiting branch should not need a third bend');

  workflow.edges.reverse();
  const reversed = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(reversed.ok, true, JSON.stringify(reversed.diagnostics));
  assert.deepEqual(reversed.receipt.edges, result.receipt.edges);
  assert.deepEqual(reversed.receipt.nodes, result.receipt.nodes);
});
