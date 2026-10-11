import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectAmbiguousCorridors, properSegmentIntersection } from '../archify/renderers/shared/geometry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..', 'archify');
const renderer = path.join(skillRoot, 'renderers', 'dataflow', 'render-dataflow.mjs');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const fixture = path.join(__dirname, 'fixtures', 'dataflow-first-draft', 'ml-features.dataflow.json');

function render(diagram) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-dataflow-first-draft-'));
  const input = path.join(directory, 'candidate.json');
  const output = path.join(directory, 'candidate.html');
  fs.writeFileSync(input, JSON.stringify(diagram));
  const result = spawnSync(process.execPath, [renderer, input, output], { cwd: directory, encoding: 'utf8' });
  return { ...result, input, output, html: result.status === 0 ? fs.readFileSync(output, 'utf8') : '' };
}

const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));

function routes(html) {
  return [...html.matchAll(/<path\b[^>]*data-composition-points="[^"]*"[^>]*>/g)].map((match) => attrs(match[0]))
    .filter((route) => route['data-edge-from'])
    .map((route) => ({
      from: route['data-edge-from'],
      to: route['data-edge-to'],
      points: route['data-composition-points'].split(';').map((pair) => pair.split(',').map(Number)),
    }));
}

function properCrossings(html) {
  const all = routes(html);
  const crossings = [];
  for (const [index, left] of all.entries()) {
    for (const right of all.slice(index + 1)) {
      if ([left.from, left.to].some((id) => id === right.from || id === right.to)) continue;
      if (left.points.slice(1).some((end, i) => right.points.slice(1).some((otherEnd, j) => (
        properSegmentIntersection(left.points[i], end, right.points[j], otherEnd))))) crossings.push([`${left.from}->${left.to}`, `${right.from}->${right.to}`]);
    }
  }
  return crossings;
}

test('an automatic dataflow keeps a stage-skipping flow short with a verifiable crossover', () => {
  const diagram = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const result = render(diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(routes(result.html).length >= diagram.flows.length);
  const lookup = routes(result.html).find(route => route.from === 'store' && route.to === 'serve');
  const length = lookup.points.slice(1).reduce((total, point, index) => total
    + Math.abs(point[0] - lookup.points[index][0]) + Math.abs(point[1] - lookup.points[index][1]), 0);
  const direct = Math.abs(lookup.points.at(-1)[0] - lookup.points[0][0])
    + Math.abs(lookup.points.at(-1)[1] - lookup.points[0][1]);
  assert.ok(length <= direct * 1.35, `lookup detour is ${length / direct} times its direct distance`);
  assert.ok(lookup.points.length <= 4, 'lookup should not take a four-bend perimeter detour');
  const checked = spawnSync(process.execPath, [cli, 'check', result.output, '--json'], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  const metrics = JSON.parse(checked.stdout).composition.metrics;
  assert.equal(metrics.properCrossings, 0);
  assert.ok(metrics.resolvedCrossovers > 0, 'the crossing needs actual matching halo geometry');
  assert.equal(properCrossings(result.html).length, metrics.resolvedCrossovers);
  const validation = spawnSync(process.execPath, [cli, 'validate', 'dataflow', result.input, '--quality', 'showcase', '--json'], { encoding: 'utf8' });
  assert.equal(validation.status, 0, validation.stdout + validation.stderr);
});

test('automatic crossing optimization does not replace a readable port bridge with a micro jog', t => {
  const diagram = {
    schema_version: 1, diagram_type: 'dataflow',
    meta: { title: 'Shared automatic ports', output: 'diagram.html', quality_profile: 'showcase' },
    stages: ['Input', 'Plan', 'Process', 'Assemble', 'Output'].map(label => ({ label })),
    nodes: [
      ['request', 'Request', 0, 2], ['plan', 'Plan', 1, 2],
      ['a', 'Processor A', 2, 0], ['b', 'Processor B', 2, 2],
      ['c', 'Processor C', 2, 4], ['assembly', 'Assembly', 3, 4],
      ['result', 'Result', 4, 3], ['archive', 'Archive', 4, 2],
    ].map(([id, label, stage, row]) => ({ id, label, stage, row, type: id === 'request' ? 'frontend' : 'backend' })),
    flows: [
      ['request', 'plan', 'configuration'], ['plan', 'a', 'input'],
      ['plan', 'b', 'conditional'], ['plan', 'c', 'render'],
      ['request', 'assembly', 'options'], ['plan', 'result', 'result'],
      ['request', 'archive', 'original input'],
    ].map(([from, to, label], index) => ({ id: `f${index}`, from, to, label, variant: index === 1 ? 'emphasis' : 'default' })),
  };
  for (const freeLabelSlot of [false, true]) {
    if (freeLabelSlot) {
      const labels = ['config', 'task', 'ready', 'data', 'flags', 'result', 'source'];
      diagram.flows.forEach((flow, index) => { flow.label = labels[index]; });
    }
    const result = render(diagram);
    t.after(() => fs.rmSync(path.dirname(result.input), { recursive: true, force: true }));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.readFileSync(result.input, 'utf8'), JSON.stringify(diagram));
    const rendered = routes(result.html);
    assert.deepEqual(rendered.map(({ from, to }) => [from, to]),
      diagram.flows.map(({ from, to }) => [from, to]));
    for (const node of diagram.nodes) assert.ok(result.html.includes(`id="node-${node.id}"`));
    for (const flow of diagram.flows) assert.ok(result.html.includes(flow.label));
    if (freeLabelSlot) {
      const target = rendered.find(route => route.from === 'plan' && route.to === 'b');
      assert.ok(target.points.every(([, y]) => Math.abs(y - target.points[0][1]) < 0.0001),
        'a free endpoint should align when its straight route and label both fit');
    }
  }
});

test('a pinned dataflow route keeps its geometry and its crossing diagnostic', () => {
  const diagram = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  for (const flow of diagram.flows) flow.route = 'auto';
  diagram.flows.find((flow) => flow.from === 'store' && flow.to === 'serve').route = 'straight';
  diagram.flows.find((flow) => flow.from === 'train' && flow.to === 'registry').route = 'straight';
  const result = render(diagram);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /proper-crossing/);
});

test('retaining an automatic crossing does not merge two independent branches', () => {
  const diagram = {
    schema_version: 1, diagram_type: 'dataflow',
    meta: { title: 'Independent branches', quality_profile: 'showcase', output: 'branches.html' },
    stages: ['Inputs', 'Branches', 'Output'].map(label => ({ label })),
    nodes: [
      ['a', 0, 0], ['b', 1, 3], ['c', 0, 1],
      ['d', 1, 4], ['e', 0, 2], ['f', 2, 2],
    ].map(([id, stage, row]) => ({ id, type: 'backend', label: id.toUpperCase(), stage, row })),
    flows: [
      { from: 'a', to: 'b', label: '1' },
      { from: 'c', to: 'd', label: '2' },
      { from: 'e', to: 'f', label: '3' },
    ],
  };
  const result = render(diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const rendered = routes(result.html);
  assert.deepEqual(rendered.map(({ from, to }) => [from, to]), diagram.flows.map(({ from, to }) => [from, to]));
  assert.deepEqual(collectAmbiguousCorridors({
    routedRelations: rendered.map(route => ({ relation: route, points: route.points })),
  }), [], 'independent branches must retain separate corridors');
});

test('a cheaper crossover cannot retain a route through intervening nodes', () => {
  const diagram = {
    schema_version: 1, diagram_type: 'dataflow',
    meta: { title: 'Independent routes and nodes', quality_profile: 'showcase', output: 'obstacles.html' },
    stages: ['Source', 'Prepare', 'Compute', 'Store'].map(label => ({ label })),
    nodes: [
      ['a', 0, 4], ['b', 3, 2], ['c', 1, 4],
      ['d', 2, 2], ['e', 0, 3], ['f', 3, 3],
    ].map(([id, stage, row]) => ({ id, type: 'backend', label: id.toUpperCase(), stage, row })),
    flows: [
      { from: 'a', to: 'b', label: 'one' },
      { from: 'e', to: 'f', label: 'two' },
    ],
  };
  const result = render(diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(routes(result.html).map(({ from, to }) => [from, to]),
    diagram.flows.map(({ from, to }) => [from, to]));
  const checked = spawnSync(process.execPath, [cli, 'check', result.output, '--json'], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
});

test('automatic independent branches keep separate corridors even without a proper crossing', () => {
  const diagram = {
    schema_version: 1, diagram_type: 'dataflow',
    meta: { title: 'Parallel branches', quality_profile: 'showcase', output: 'parallel.html' },
    stages: ['Source', 'Destination'].map(label => ({ label })),
    nodes: [['a', 0, 0], ['b', 1, 3], ['c', 0, 1], ['d', 1, 4]]
      .map(([id, stage, row]) => ({ id, type: 'backend', label: id.toUpperCase(), stage, row })),
    flows: [{ from: 'a', to: 'b', label: 'one' }, { from: 'c', to: 'd', label: 'two' }],
  };
  const result = render(diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(collectAmbiguousCorridors({
    routedRelations: routes(result.html).map(route => ({ relation: route, points: route.points })),
  }), []);
});

for (const vertical of [false, true]) {
  test(`automatic ${vertical ? 'vertical' : 'horizontal'} routes avoid an intervening node without a perimeter excursion`, () => {
    const diagram = {
      schema_version: 1, diagram_type: 'dataflow',
      meta: { title: 'Skip a stage or row', quality_profile: 'showcase', output: 'skip.html' },
      stages: ['Source', 'Middle', 'Destination'].map(label => ({ label })),
      nodes: ['source', 'middle', 'destination'].map((id, index) => ({
        id, type: 'backend', label: id, stage: vertical ? 0 : index, row: vertical ? index : 0,
      })),
      flows: [{ from: 'source', to: 'destination', label: 'skip' }],
    };
    const result = render(diagram);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const [route] = routes(result.html);
    const distance = route.points.slice(1).reduce((sum, point, index) => sum
      + Math.abs(point[0] - route.points[index][0]) + Math.abs(point[1] - route.points[index][1]), 0);
    const direct = Math.abs(route.points.at(-1)[0] - route.points[0][0])
      + Math.abs(route.points.at(-1)[1] - route.points[0][1]);
    assert.ok(distance < direct * 2.1, 'a local obstacle should only need a local detour');
    assert.ok(route.points.length <= 6, 'a single obstacle needs at most four bends');
    const checked = spawnSync(process.execPath, [cli, 'check', result.output, '--json'], { encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);

    diagram.flows[0].route = 'straight';
    const pinned = render(diagram);
    assert.notEqual(pinned.status, 0, 'explicit straight route must not be silently changed');
    assert.match(pinned.stdout + pinned.stderr, /edge-through-node/);
  });
}

test('two automatic arrivals on one side of a tall node keep at least 16px between their ports', () => {
  const diagram = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const result = render(diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const arrivals = routes(result.html).filter((route) => route.to === 'fe').map((route) => route.points.at(-1));
  assert.ok(arrivals.length >= 2, `expected at least two arrivals into fe, got ${arrivals.length}`);
  const ys = arrivals.map((point) => point[1]).sort((a, b) => a - b);
  for (let index = 1; index < ys.length; index += 1) {
    assert.ok(ys[index] - ys[index - 1] >= 16, `ports ${ys[index - 1]} and ${ys[index]} are only ${ys[index] - ys[index - 1]}px apart`);
  }
});

test('overlapping obstructed presets can be repaired without blocking each other', () => {
  const diagram = {
    schema_version: 1, diagram_type: 'dataflow',
    meta: { title: 'Interleaved skips', quality_profile: 'showcase', output: 'skips.html' },
    stages: ['Prepare', 'Output'].map(label => ({ label })),
    nodes: ['a', 'b', 'c', 'd'].map((id, row) => ({
      id, type: 'backend', label: id.toUpperCase(), stage: 0, row,
    })),
    flows: [{ from: 'a', to: 'c', label: 'one' }, { from: 'b', to: 'd', label: 'two' }],
  };
  for (const flows of [diagram.flows, [...diagram.flows].reverse()]) {
    const result = render({ ...diagram, flows });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(routes(result.html).map(({ from, to }) => [from, to]),
      flows.map(({ from, to }) => [from, to]));
    const checked = spawnSync(process.execPath, [cli, 'check', result.output, '--json'], { encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  }
  diagram.flows[0].route = 'straight';
  const pinned = render(diagram);
  assert.notEqual(pinned.status, 0, 'an obstructed authored route must remain authoritative');
  assert.match(pinned.stdout + pinned.stderr, /edge-through-node/);
});

test('automatic detours cross stage frames without following their borders', () => {
  const diagram = {
    schema_version: 1, diagram_type: 'dataflow',
    meta: { title: 'Stage corridors', quality_profile: 'showcase', output: 'borders.html' },
    stages: ['Input', 'Prepare', 'Compute', 'Store'].map(label => ({ label })),
    nodes: [
      ['a', 1, 0], ['b', 1, 3], ['c', 2, 0], ['d', 2, 1],
      ['e', 2, 3], ['f', 3, 0], ['g', 3, 3],
    ].map(([id, stage, row]) => ({ id, type: 'backend', label: id.toUpperCase(), stage, row,
      ...(id === 'd' ? { sublabel: 'a'.repeat(27) } : {}),
    })),
    flows: [{ from: 'a', to: 'f', label: 'one' }, { from: 'b', to: 'g', label: 'two' }],
  };
  const result = render(diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(routes(result.html).map(({ from, to }) => [from, to]),
    diagram.flows.map(({ from, to }) => [from, to]));
  const checked = spawnSync(process.execPath, [cli, 'check', result.output, '--json'], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
});
