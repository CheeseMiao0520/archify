import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileWorkflow } from '../archify/renderers/workflow/workflow-compiler.mjs';

const fixture = new URL('./fixtures/workflow-first-draft/automatic-port-slot.workflow.json', import.meta.url);

test('automatic branches use a clear port slot without reversing over an incoming line', () => {
  // The unconnected nodes and spare lane reserve the same columns and gutters
  // as surrounding work. Both branches must fit beside an incoming arrow;
  // shifting only their corners used to leave a reverse shared segment.
  const workflow = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const original = structuredClone(workflow);
  const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(workflow, original);
  assert.deepEqual(result.receipt.diagnostics, []);
  assert.equal(result.receipt.nodes.length, workflow.nodes.length);
  assert.equal(result.receipt.edges.length, workflow.edges.length);
  for (const node of workflow.nodes) {
    assert.equal(result.receipt.nodes.find(item => item.id === node.id).width, node.width);
    assert.ok(result.svg.includes(node.label));
  }
  const incoming = result.receipt.edges.find(edge => edge.id === 'prepare-spawn');
  const branches = result.receipt.edges.filter(edge => edge.from === 'spawn');
  // Where ports share a node side, keep the arrow's 3.5-stroke half-width
  // clear of each outgoing stroke. Do not prescribe the selected side or slot.
  for (const branch of branches) {
    const tip = incoming.points.at(-1), start = branch.points[0];
    if (Math.abs(tip[0] - start[0]) < 0.0001) {
      assert.ok(Math.abs(tip[1] - start[1]) >= 4 * 1.4 - 0.0001);
    }
  }
  const reordered = structuredClone(workflow);
  reordered.nodes.reverse();
  reordered.edges.reverse();
  assert.deepEqual(compileWorkflow({ workflow: reordered, qualityProfile: 'showcase' }), result);
});
