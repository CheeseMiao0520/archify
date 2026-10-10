import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeAutomaticLabels } from '../archify/renderers/shared/automatic-labels.mjs';
import { rectsOverlap, segmentRectClearanceWithin } from '../archify/renderers/shared/geometry.mjs';

function narrowSlot(vertical = false) {
  const rotatePoint = ([x, y]) => vertical ? [y, x] : [x, y];
  const rotateRect = rect => vertical
    ? { x: rect.y, y: rect.x, width: rect.height, height: rect.width } : rect;
  const plate = rotateRect({ x: 174.5, y: 241, width: 66, height: 16 });
  const label = { ...plate, lx: plate.x + plate.width / 2, ly: plate.y + 10,
    relation: {}, relationIndex: 0, label: 'Payload' };
  return {
    labels: [label],
    routes: [
      { relationIndex: 0, points: [[156, 262], [259, 262]].map(rotatePoint) },
      { relationIndex: 1, points: [[236, 186], [236, 346]].map(rotatePoint) },
    ],
    components: [44, 259].map(x => rotateRect({ x, y: 186, width: 112, height: 160 })),
    titles: [], viewBox: [500, 500], maxOwnRouteDistance: 36,
  };
}

for (const vertical of [false, true]) {
  test(`an automatic label finds a narrow ${vertical ? 'vertical' : 'horizontal'} slot between fixed sample points`, () => {
    const scene = narrowSlot(vertical);
    const before = structuredClone(scene);
    const [placed] = placeAutomaticLabels(scene);
    assert.equal(scene.components.some(rect => rectsOverlap(placed, rect, 2)), false);
    const [start, end] = scene.routes[1].points;
    assert.ok(segmentRectClearanceWithin({ start, end }, placed, 4) >= 4,
      'the complete label plate must clear the other relationship');
    const [ownStart, ownEnd] = scene.routes[0].points;
    assert.ok(segmentRectClearanceWithin({ start: ownStart, end: ownEnd }, placed, 36) <= 36);
    assert.equal(placed.label, scene.labels[0].label);
    assert.deepEqual(scene, before, 'placement cannot mutate routes, components or authored labels');
  });
}

test('a pinned label keeps its position even when a nearby free slot exists', () => {
  for (const pin of [{ labelAt: [207.5, 251] }, { labelDx: 0 }, { labelDy: 0 }, { labelSegment: 0 }]) {
    const scene = narrowSlot();
    scene.labels[0].relation = pin;
    assert.equal(placeAutomaticLabels(scene)[0], scene.labels[0]);
  }
});
