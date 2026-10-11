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

test('a blocked label can use a slot vacated by a later automatic label', () => {
  const scene = {
    labels: [
      { relation: {}, relationIndex: 0, label: 'Range',
        x: 300.85, y: 221, width: 46.3, height: 16, lx: 324, ly: 231 },
      { relation: {}, relationIndex: 1, label: 'Result',
        x: 337.5, y: 206, width: 61, height: 16, lx: 368, ly: 216 },
    ],
    routes: [
      { relationIndex: 0, points: [[324, 242], [324, 186]] },
      { relationIndex: 1, points: [[306, 186], [306, 227], [430, 227], [430, 560], [333, 560], [333, 584]] },
    ],
    components: [128, 242].map(y => ({ x: 259, y, width: 112, height: 58 })),
    titles: [], viewBox: [853, 740], maxOwnRouteDistance: 36,
  };
  const before = structuredClone(scene);
  const placed = placeAutomaticLabels(scene);
  for (const label of placed) {
    assert.equal(scene.components.some(rect => rectsOverlap(label, rect, 2)), false);
    assert.equal(placed.some(other => other !== label && rectsOverlap(label, other, 2)), false);
    for (const route of scene.routes.filter(route => route.relationIndex !== label.relationIndex)) {
      for (let i = 1; i < route.points.length; i++) {
        assert.ok(segmentRectClearanceWithin({ start: route.points[i - 1], end: route.points[i] }, label, 4) >= 4,
          'the full plate must clear unrelated routes after the later label moves');
      }
    }
  }
  assert.deepEqual(placed.map(label => label.label), ['Range', 'Result']);
  assert.deepEqual(scene, before);
  assert.deepEqual(placeAutomaticLabels({ ...scene, labels: placed }), placed,
    'resolved labels must not keep moving on another placement pass');
});

test('a complete label can move outside a close reciprocal pair without extra endpoint padding', () => {
  const scene = {
    labels: [{ relation: {}, relationIndex: 0, label: '同步支付请求',
      x: 246.2, y: 64, width: 67.6, height: 14, lx: 280, ly: 74 }],
    routes: [
      { relationIndex: 0, points: [[240, 84], [320, 84]] },
      { relationIndex: 1, points: [[320, 70], [240, 70]] },
    ],
    components: [{ x: 40, y: 40, width: 200, height: 74 }, { x: 320, y: 40, width: 190, height: 74 }],
    titles: [], viewBox: [550, 200], fallbackRing: false,
  };
  const before = structuredClone(scene);
  const [placed] = placeAutomaticLabels(scene);
  assert.equal(placed.label, scene.labels[0].label);
  assert.equal(placed.width, scene.labels[0].width, 'do not shorten or shrink the label');
  assert.equal(scene.components.some(rect => rectsOverlap(placed, rect, 2)), false);
  assert.ok(segmentRectClearanceWithin({ start: [320, 70], end: [240, 70] }, placed, 4) >= 4,
    'the label must clear the reciprocal arrow instead of forcing it to detour');
  assert.deepEqual(scene, before);

  const blocked = structuredClone(scene);
  blocked.titles.push({ x: 240, y: 94, width: 80, height: 70 });
  assert.deepEqual(placeAutomaticLabels(blocked)[0], blocked.labels[0], 'retain the unresolved conflict if the outer slot is occupied');
  const pinned = structuredClone(scene);
  pinned.labels[0].relation.labelAt = [280, 74];
  assert.deepEqual(placeAutomaticLabels(pinned)[0], pinned.labels[0], 'authored label placement stays authoritative');
});
