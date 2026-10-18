import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flowLabelSize, wrapBlockedFlowLabels } from '../archify/renderers/dataflow/label-capacity.mjs';
import { rectsOverlap, segmentRectClearanceWithin } from '../archify/renderers/shared/geometry.mjs';

function fixture(text = '保存 / 复制结果') {
  const relation = { id: 'output', label: text };
  const size = flowLabelSize(relation);
  return {
    labels: [{ relation, relationIndex: 0, label: text, ...size, lx: 251, ly: 203,
      x: 251 - size.width / 2, y: 192 }],
    routes: [
      { relationIndex: 0, points: [[201, 213], [301, 213]] },
      { relationIndex: 1, points: [[280, 257], [280, 50]] },
      { relationIndex: 2, points: [[42, 161], [279.5, 161]] },
    ],
    components: [{ x: 89, y: 184, width: 112, height: 58 }, { x: 301, y: 184, width: 118, height: 58 }],
    titles: [], viewBox: [468, 355], placementBottom: 281,
  };
}

for (const text of ['保存 / 复制结果', 'save / copy result', '👩‍💻 / e\u0301 result']) {
  test(`a blocked label stays beside its own arrow with complete two-line text: ${text}`, () => {
    const scene = fixture(text), before = structuredClone(scene);
    const [label] = wrapBlockedFlowLabels(scene);
    assert.equal(label.lines?.length, 2);
    assert.equal(label.lines.join(''), text, 'every character must survive wrapping');
    assert.ok(label.width < scene.labels[0].width);
    assert.ok(label.x >= 209 && label.x + label.width <= 293, 'plate stays within the arrow span');
    const [start, end] = scene.routes[0].points;
    assert.ok(segmentRectClearanceWithin({ start, end }, label, 6) <= 6, 'label stays next to its own line');
    for (const route of scene.routes) for (let i = 1; i < route.points.length; i++) {
      assert.ok(segmentRectClearanceWithin({ start: route.points[i - 1], end: route.points[i] }, label, 4) >= 4 - 0.0001);
    }
    assert.ok(scene.components.every(node => !rectsOverlap(label, node, 2)));
    assert.deepEqual(scene, before, 'input and routes remain unchanged');
    assert.deepEqual(wrapBlockedFlowLabels(scene), [label], 'placement is deterministic');
    const boundaries = new Set([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(x => x.index));
    assert.ok(boundaries.has(label.lines[0].length), 'never split an emoji or combining sequence');
  });
}

test('valid plates and authored label controls retain their exact geometry', () => {
  const valid = fixture('save');
  assert.deepEqual(wrapBlockedFlowLabels(valid), valid.labels);
  for (const key of ['labelAt', 'labelDx', 'labelDy', 'labelSegment']) {
    const scene = fixture(); scene.labels[0].relation[key] = key === 'labelAt' ? [251, 203] : 0;
    assert.deepEqual(wrapBlockedFlowLabels(scene), scene.labels);
  }
});

test('classification retains its own full row and an unavailable slot remains a failure', () => {
  const classified = fixture(); classified.labels[0].relation.classification = 'private';
  Object.assign(classified.labels[0], flowLabelSize(classified.labels[0].relation));
  const [result] = wrapBlockedFlowLabels(classified);
  assert.equal(result.height, 38);
  assert.equal(result.relation.classification, 'private');
  assert.equal(result.lines.join(''), classified.labels[0].label);
  const blocked = fixture(); blocked.components.push({ x: 205, y: 0, width: 92, height: 300 });
  assert.deepEqual(wrapBlockedFlowLabels(blocked), blocked.labels, 'do not silently clip or drop text when capacity is exhausted');
});
