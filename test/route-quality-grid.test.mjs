import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortestOrthogonalGridRoute } from '../archify/renderers/shared/route-quality.mjs';
import { routeHonorsEndpointSides, segmentIntersectsRect, frameBorderSegments, collectBorderRuns } from '../archify/renderers/shared/geometry.mjs';

test('a pinned endpoint on a frame retains a readable corridor on every side', () => {
  const sides = ['right', 'bottom', 'left', 'top'];
  for (let turn = 0; turn < sides.length; turn++) {
    const rotate = ([x, y]) => {
      for (let index = 0; index < turn; index++) [x, y] = [-y, x];
      return [x, y];
    };
    const rotateRect = (rect) => {
      const corners = [[rect.x, rect.y], [rect.x + rect.width, rect.y + rect.height]].map(rotate);
      return { x: Math.min(...corners.map(p => p[0])), y: Math.min(...corners.map(p => p[1])),
        width: Math.abs(corners[1][0] - corners[0][0]), height: Math.abs(corners[1][1] - corners[0][1]) };
    };
    const obstacles = [80, 280].map(y => rotateRect({ x: 100, y, width: 180, height: 72 }));
    const frame = rotateRect({ x: 76, y: 256, width: 228, height: 120 });
    const start = rotate([280, 116]);
    const end = rotate([280, 316]);
    const options = { start, end, points: [start, end], obstacles,
      fromSide: sides[turn], toSide: sides[turn], endpointStubPx: 24,
      borderSegments: frameBorderSegments(frame), routeSeparationPx: 8,
      minimumSegmentPx: 16, bendPenaltyPx: 48, clearance: 2, maximumGridNodes: 4096 };
    const metrics = {};
    const route = shortestOrthogonalGridRoute({ ...options, metrics });
    assert.ok(route, `the ${sides[turn]} corridor must be reachable without changing the port`);
    assert.deepEqual(route.points[0], start);
    assert.deepEqual(route.points.at(-1), end);
    assert.ok(routeHonorsEndpointSides(route.points, sides[turn], sides[turn]));
    assert.equal(collectBorderRuns({ routedRelations: [route], frames: [frame] }).length, 0);
    assert.ok(route.points.length <= 4, 'an empty outside corridor needs no staircase');
    for (const [index, point] of route.points.slice(1).entries()) {
      const previous = route.points[index];
      assert.ok(Math.abs(point[0] - previous[0]) + Math.abs(point[1] - previous[1]) >= 16);
    }
    assert.ok(metrics.candidateNodeCount <= options.maximumGridNodes);
    assert.ok(metrics.attemptCount <= 2);
    const limitedMetrics = {};
    shortestOrthogonalGridRoute({ ...options, maximumGridNodes: 32, metrics: limitedMetrics });
    assert.ok(limitedMetrics.usableNodeCount <= 32, 'recovery shares the existing node budget');
  }
});

test('dense candidate coordinates preserve an open routing corridor without short jogs', () => {
  const obstacles = [
    { x: 35, y: 20, width: 50, height: 50 },
    { x: 35, y: 110, width: 50, height: 20 },
  ];
  const options = {
    start: [0, 0], end: [100, 100], points: [[0, 0], [100, 100]],
    fromSide: 'right', toSide: 'left', endpointStubPx: 24,
    clearance: 2, maximumObstacleCount: 80, maximumGridNodes: 4096,
    minimumSegmentPx: 16, bendPenaltyPx: 48, allowAvoidedCrossings: true,
    obstacles,
    avoidedSegments: [{ start: [25, 100], end: [76, 100] }],
    // Remote frames contribute nearby coordinate candidates without blocking
    // the open horizontal corridor between the two local obstacles.
    borderSegments: Array.from({ length: 14 }, (_, index) => ({
      start: [200, 8 + index * 8], end: [300, 8 + index * 8],
    })),
  };
  const metrics = {};
  const routed = shortestOrthogonalGridRoute({ ...options, metrics });
  assert.ok(routed, 'coordinate thinning must retain the open corridor');
  assert.equal(metrics.status, 'routed');
  assert.ok(metrics.attemptCount <= 2, 'recovery must remain bounded');
  assert.ok(metrics.usableNodeCount <= options.maximumGridNodes);
  const limitedMetrics = {};
  shortestOrthogonalGridRoute({ ...options, maximumGridNodes: 64, metrics: limitedMetrics });
  assert.ok(limitedMetrics.usableNodeCount <= 64, 'both attempts share the original grid node budget');
  assert.ok(limitedMetrics.visitedNodeCount <= 64 * 4, 'each grid node has at most four arrival directions');
  assert.ok(routeHonorsEndpointSides(routed.points, 'right', 'left'));
  assert.deepEqual(routed.points[0], [0, 0]);
  assert.deepEqual(routed.points.at(-1), [100, 100]);
  for (const [index, end] of routed.points.slice(1).entries()) {
    const start = routed.points[index];
    assert.ok(Math.abs(end[0] - start[0]) + Math.abs(end[1] - start[1]) >= 16);
    assert.ok(obstacles.every(obstacle => !segmentIntersectsRect({ start, end }, obstacle, 2)));
    assert.ok(!(start[1] === 100 && end[1] === 100
      && Math.min(start[0], end[0]) < 76 && Math.max(start[0], end[0]) > 25));
  }
});

test('grid bounds pruning preserves the configured avoided-overlap threshold', () => {
  const options = {
    start: [0, 0], end: [100, 0], points: [[0, 0], [100, 0]],
    fromSide: 'right', toSide: 'left', endpointStubPx: 16,
    clearance: 2, maximumObstacleCount: 80, maximumGridNodes: 512,
    obstacles: [], allowAvoidedCrossings: true,
    avoidedSegments: [{ start: [0, 100], end: [100, 100] }],
  };
  assert.ok(shortestOrthogonalGridRoute({ ...options, minimumAvoidedOverlapPx: 8 }),
    'a remote segment cannot obstruct an ordinary positive overlap threshold');
  assert.equal(shortestOrthogonalGridRoute({ ...options, minimumAvoidedOverlapPx: 0 }), null,
    'zero overlap still meets a zero threshold, even for a remote segment');
});


test('caller rejection never returns an unusable route or expands the search budget', () => {
  const options = {
    start: [0, 0], end: [100, 100], points: [[0, 0], [100, 100]],
    fromSide: 'right', toSide: 'left', endpointStubPx: 24,
    clearance: 2, maximumObstacleCount: 80, maximumGridNodes: 64,
    obstacles: [], minimumSegmentPx: 16, bendPenaltyPx: 48,
  };
  const original = shortestOrthogonalGridRoute(options);
  assert.ok(original);
  assert.deepEqual(shortestOrthogonalGridRoute({ ...options, accept: () => true }), original,
    'an accepted route retains the established result');
  const metrics = {};
  let proposals = 0;
  assert.equal(shortestOrthogonalGridRoute({ ...options, metrics,
    accept: () => { proposals++; return false; } }), null,
  'a route rejected by the caller cannot be used as a successful repair');
  assert.ok(proposals > 0 && proposals <= 2);
  assert.ok(metrics.candidateNodeCount <= options.maximumGridNodes);
  assert.ok(metrics.visitedNodeCount <= options.maximumGridNodes * 4);
});
