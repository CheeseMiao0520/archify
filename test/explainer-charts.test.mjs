import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = path.resolve('archify/bin/archify.mjs');
const draft = chart => `# Why did P99 jump? {#p99}\n\nOnly the slowest requests got slower.\n\n@meta locale=en\n\n## How did the numbers move? {#shift}\n\n\`\`\`mermaid title="Before and after"\n${chart}\n\`\`\`\n`;
function finalize(t, chart) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-explainer-chart-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'draft.md'), output = path.join(dir, 'page.html');
  fs.writeFileSync(input, draft(chart));
  const run = spawnSync(process.execPath, [cli, 'finalize', 'explainer', input, output, '--json'], { encoding: 'utf8', env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' } });
  return { status: run.status, receipt: JSON.parse(run.stdout), html: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : null };
}

test('explainer chart fences render static themed SVG without shipping the chart library', t => {
  const { status, html } = finalize(t, 'xychart-beta\n  x-axis ["Before", "After"]\n  bar [80, 600]');
  assert.equal(status, 0);
  const figure = html.match(/<figure class="chart"[\s\S]*?<\/figure>/)[0];
  assert.match(figure, /<svg\b[^>]*class="pele pele-xychart"/);
  assert.match(figure, /<figcaption>Before and after<\/figcaption>/);
  assert.doesNotMatch(html, /registerDiagram|PeleError/);
});

test('explainer chart fences send native diagram types to shorthand and locate syntax errors', t => {
  const flow = finalize(t, 'flowchart LR\n  A --> B');
  assert.notEqual(flow.status, 0);
  assert.ok(flow.receipt.diagnostics.some(d => d.code === 'explainer/chart' && /native workflow/.test(d.message) && d.subject.line === 10));
  const broken = finalize(t, 'pie title Share\n  "A" : abc');
  assert.ok(broken.receipt.diagnostics.some(d => d.code === 'explainer/chart' && d.subject.line === 11));
  assert.equal(broken.html, null);
});

test('explainer chart CJK axis titles stand upright and task lists become checklists', t => {
  const { status, html } = finalize(t, 'xychart-beta\n  x-axis ["前", "后"]\n  y-axis "延迟（毫秒）" 0 --> 700\n  bar [80, 600]\n```\n\n- [ ] 核对押金条款\n- [x] 拍下水电读数\n\n```text\nx');
  assert.equal(status, 0);
  assert.match(html, /<text[^>]*writing-mode="vertical-rl"[^>]*>延迟（毫秒）<\/text>/);
  assert.match(html, /<ul class="checklist"><li><label><input type="checkbox"><span>核对押金条款<\/span><\/label><\/li><li><label><input type="checkbox"><span>拍下水电读数<\/span>/);
  const mixed = finalize(t, 'pie\n  "A" : 1\n```\n\n- [ ] Task\n- Plain\n\n```text\nx');
  assert.ok(mixed.receipt.diagnostics.some(d => d.code === 'explainer/parse-list' && /checklist/.test(d.message)));
});

test('explainer charts label bar values and give pie slices their value and share', t => {
  const bars = finalize(t, 'xychart-beta\n  x-axis ["Before", "After"]\n  bar [80, 600]');
  assert.match(bars.html, /<text[^>]*>600<\/text>/, 'bars carry their value');
  const pie = finalize(t, 'pie showData\n  "Viewer" : 0.8\n  "字体" : 0.2');
  assert.match(pie.html, /Viewer · 0\.8 \(80%\)/);
  assert.match(pie.html, /字体 · 0\.2（20%）/);
  assert.doesNotMatch(pie.html, /\[0\.8\]/);
});

test('a data chart reads its CSV next to the draft, freezes it, and names a missing column', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-explainer-data-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'latency.csv'), 'day,p50,p99\nMon,78,82\nTue,79,600\n');
  const run = draft => { const input = path.join(dir, 'draft.md'), output = path.join(dir, 'page.html'); fs.writeFileSync(input, draft); const r = spawnSync(process.execPath, [cli, 'finalize', 'explainer', input, output, '--json'], { encoding: 'utf8', env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' } }); return { status: r.status, receipt: JSON.parse(r.stdout), html: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '' }; };
  const page = draft => `# Why did P99 jump?\n\nOnly the slowest requests got slower.\n\n@meta locale=en\n\n## How did it move? {#week}\n\n${draft}\n`;
  const ok = run(page('@chart type=bar data=latency.csv x=day y=p50,p99 unit=ms title="Week"'));
  assert.equal(ok.status, 0, JSON.stringify(ok.receipt.diagnostics));
  assert.match(ok.html, /<svg\b[^>]*class="pele pele-xychart"/);
  assert.match(ok.html, /<text[^>]*>600<\/text>/);
  assert.ok(ok.receipt.diagnostics.length === 0);
  const missing = run(page('@chart type=bar data=latency.csv x=day y=p95'));
  assert.notEqual(missing.status, 0);
  assert.ok(missing.receipt.diagnostics.some(d => /no column "p95"/.test(d.message)));
});

test('a blank data cell is missing data, never drawn as zero', async () => {
  const { chartFromData } = await import('../archify/explainer/charts.mjs');
  for (const [file, bytes] of [['a.csv', 'day,p99\nMon,80\nTue,\n'], ['a.json', '[{"day":"Mon","p99":80},{"day":"Tue","p99":null}]'], ['b.json', '[{"day":"Mon","p99":80},{"day":"Tue"}]']]) {
    const result = chartFromData(Buffer.from(bytes), file, { kind: 'bar', x: 'day', y: ['p99'] });
    assert.equal(result.text, undefined, file);
    assert.match(result.error, /empty in data row 2/, file);
  }
  assert.match(chartFromData(Buffer.from('k,v\nA,60\nB,40\n'), 'a.csv', { kind: 'pie', x: 'k', y: ['v'] }).text, /"A" : 60\n {2}"B" : 40/);
});
