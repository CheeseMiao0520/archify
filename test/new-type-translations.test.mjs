import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../archify/', import.meta.url));
const examples = {
  tree: 'payment-platform.tree.json', class: 'payments.class.json',
  timeline: 'payment-incident.timeline.json', waterfall: 'checkout-request.waterfall.json',
};

for (const [type, example] of Object.entries(examples)) {
  test(`${type}: shared Viewer translation overrides work through the public CLI`, (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-translations-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const doc = JSON.parse(fs.readFileSync(path.join(root, 'examples', example), 'utf8'));
    doc.meta.locale = 'en';
    doc.meta.translations = { 'viewer.common.close': 'Close this panel' };
    const input = path.join(directory, 'input.json');
    const output = path.join(directory, 'diagram.html');
    const run = () => {
      fs.writeFileSync(input, JSON.stringify(doc));
      return spawnSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'render', type, input, output], { encoding: 'utf8' });
    };
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    const html = fs.readFileSync(output, 'utf8');
    const payload = html.match(/<script id="archify-i18n-data" type="application\/json">([\s\S]*?)<\/script>/);
    assert.ok(payload);
    const messages = JSON.parse(payload[1]).messages;
    assert.equal(messages['viewer.common.close'], 'Close this panel');
    assert.equal(messages['viewer.common.copyLink'], JSON.parse(fs.readFileSync(path.join(root, 'locales/en.json'), 'utf8'))['viewer.common.copyLink']);
    doc.meta.translations = {};
    result = run();
    assert.equal(result.status, 0, result.stderr);
    const empty = fs.readFileSync(output, 'utf8');
    delete doc.meta.translations;
    assert.equal(run().status, 0);
    assert.equal(fs.readFileSync(output, 'utf8'), empty);
    doc.meta.translations = { 'viewer.common.close': 42 };
    assert.equal(run().status, 1);
  });
}
