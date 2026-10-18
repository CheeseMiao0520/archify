import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..', 'archify');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-semantic-zoom-'));

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

function render(mode, example) {
  const output = path.join(tmp, `${mode}.html`);
  execFileSync(process.execPath, [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
    path.join(skillRoot, 'examples', example),
    output,
  ]);
  return fs.readFileSync(output, 'utf8');
}

test('typed renderers keep primary labels and classify optional reading detail', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    assert.match(html, /data-detail="context"/, mode);
    // Sequence notes are reading context; their Read/Map/Full visibility
    // and complete exports are protected by sequence-note-export-browser.
    if (mode !== 'sequence') assert.match(html, /data-detail="fine"/, mode);
    assert.match(html, /data-detail-anchor/, mode);
    assert.doesNotMatch(html, /<text[^>]*data-detail="(?:context|fine)"[^>]*class="t-primary"/, mode);
    assert.match(html, /class="diagram-container" data-detail-level="read"/, mode);
  }
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
