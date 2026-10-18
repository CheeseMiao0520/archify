import assert from 'node:assert/strict';
import test from 'node:test';
import { createRouter } from '../archify/renderers/architecture/routing.mjs';
import { reservedLabelRect } from '../archify/renderers/architecture/labels.mjs';
import { labelPoint, properSegmentIntersection, routeHonorsEndpointSides } from '../archify/renderers/shared/geometry.mjs';
import { textUnits } from '../archify/renderers/shared/utils.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function fixture() {
  const boxes = new Map([
    ['files', 420, 40, 240, 74], ['state', 40, 250, 280, 74],
    ['executor', 40, 480, 290, 74], ['log', 420, 480, 250, 74],
  ].map(([id, x, y, width, height]) => [id, { id, x, y, width, height, cx: x + width / 2, cy: y + height / 2 }]));
  const connections = [
    { id: 'state', from: 'executor', to: 'state', label: '取 Plan/Receipt · 更新状态' },
    { id: 'files', from: 'executor', to: 'files', label: '检查 / 修改 / 撤销', fromSide: 'right', toSide: 'bottom' },
    { id: 'write', from: 'executor', to: 'log', label: '先记日志 / 补偿' },
    { id: 'restore', from: 'log', to: 'executor', label: '读取恢复材料', variant: 'dashed' },
  ];
  return { boxes, connections };
}

function plan(boxes, connections, readabilityBottomMargin) {
  const router = createRouter(boxes, connections, {
    distinctAutomaticPorts: true, preferReadableRoutes: true, readabilityBottomMargin,
    labelRectFor(conn, points, { routes, labels }) {
      const [lx, ly] = labelPoint(conn, points);
      const width = Math.max(30, textUnits(conn.label) * 4.8 + 10);
      return reservedLabelRect({
        label: { relation: conn, label: conn.label, lx, ly, x: lx - width / 2, y: ly - 10, width, height: 14 },
        points, routes: routes.map((points, relationIndex) => ({ points, relationIndex })),
        labels, components: [...boxes.values()],
      });
    },
  });
  return { routes: connections.map(conn => router.pathFor(conn).points), metrics: router.routingMetrics() };
}

function crossings(routes) {
  let count = 0;
  for (let i = 0; i < routes.length; i += 1) for (let j = i + 1; j < routes.length; j += 1) {
    if (routes[i].slice(1).some((end, k) => routes[j].slice(1).some((other, l) =>
      properSegmentIntersection(routes[i][k], end, routes[j][l], other)))) count += 1;
  }
  return count;
}

test('an intrinsic-height architecture can use one lower corridor to separate a log return', () => {
  const { boxes, connections } = fixture();
  const original = JSON.stringify({ boxes: [...boxes], connections });
  const bounded = plan(boxes, connections, 0);
  const expanded = plan(boxes, connections, 24);
  assert.ok(crossings(bounded.routes) > 0, 'the complete four-node fixture exposes the return crossing');
  assert.equal(crossings(expanded.routes), 0, 'the return and all neighbouring routes remain distinct');
  assert.ok(routeHonorsEndpointSides(expanded.routes[1], 'right', 'bottom'), 'authored file-operation sides remain authoritative');
  const originalPoints = [...bounded.routes.flat(), ...[...boxes.values()].flatMap(b => [[b.x, b.y], [b.x + b.width, b.y + b.height]])];
  const xs = originalPoints.map(p => p[0]), ys = originalPoints.map(p => p[1]);
  for (const [x, y] of expanded.routes.flat()) {
    assert.ok(x >= Math.min(...xs) && x <= Math.max(...xs), 'do not widen the canvas');
    assert.ok(y >= Math.min(...ys) && y <= Math.max(...ys) + 24, 'the added corridor is bounded');
  }
  assert.ok(expanded.metrics.gridSearchCount <= bounded.metrics.gridSearchCount, 'the final sweep must not add grid searches');
  assert.equal(JSON.stringify({ boxes: [...boxes], connections }), original, 'preserve authored nodes, relations and pins');
});

test('extra lower room does not rewrite an explicitly routed return', () => {
  const { boxes, connections } = fixture();
  const originalRoute = plan(boxes, connections, 0).routes[3];
  Object.assign(connections[3], { fromSide: 'left', toSide: 'top', via: originalRoute.slice(1, -1) });
  assert.deepEqual(plan(boxes, connections, 24).routes[3], plan(boxes, connections, 0).routes[3]);
});

test('an already clear scene keeps its routes when lower room is available', () => {
  const { boxes, connections } = fixture();
  const clearConnections = connections.slice(0, 3);
  const bounded = plan(boxes, clearConnections, 0);
  assert.equal(crossings(bounded.routes), 0);
  assert.deepEqual(plan(boxes, clearConnections, 24).routes, bounded.routes);
});

test('the architecture renderer reserves extra room only for an automatic canvas', t => {
  const { boxes, connections } = fixture();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-return-room-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const diagram = {
    schema_version: 1, diagram_type: 'architecture',
    meta: { title: 'Change execution', output: 'diagram.html', quality_profile: 'showcase' },
    components: [...boxes.values()].map(b => ({ id: b.id, label: b.id, type: 'backend', pos: [b.x, b.y], size: [b.width, b.height] })),
    connections,
  };
  const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
  const reports = [];
  for (const fixed of [false, true]) {
    if (fixed) diagram.meta.viewBox = [720, 700];
    const input = path.join(cwd, `${fixed}.json`);
    const bytes = JSON.stringify(diagram);
    fs.writeFileSync(input, bytes);
    const result = spawnSync(process.execPath, [cli, 'validate', 'architecture', input, '--layout-json'], {
      encoding: 'utf8', env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.readFileSync(input, 'utf8'), bytes);
    reports.push(JSON.parse(result.stdout));
  }
  assert.equal(crossings(reports[0].connections.map(e => e.points)), 0);
  assert.ok(crossings(reports[1].connections.map(e => e.points)) > 0, 'a fixed canvas retains the bounded routing contract');
  assert.deepEqual(reports[1].viewBox, [720, 700]);
});
