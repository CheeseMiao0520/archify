import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { cli, skillRoot, git, fixture } from './helpers/repository-evidence-fixture.mjs';

// Real promisor objects and a recording transport exercise Git's lazy fetch,
// while the helper prevents any network access even on the unfixed verifier.
for (const [fallback, ignoreNoLazyFetch] of [[false, false], [true, false], [false, true]]) {
  const scenario = ignoreNoLazyFetch ? 'Git ignoring NO_LAZY_FETCH' : `${fallback ? 'fallback' : 'batch'} reads`;
  test(`partial-clone evidence stays local through ${scenario}`, (t) => {
    const data = fixture();
    t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
    git(data.root, 'config', 'uploadpack.allowFilter', 'true');
    const partial = path.join(data.root, 'partial');
    git(data.root, 'clone', '--filter=blob:none', '--no-checkout', pathToFileURL(data.root).href, partial);
    const origin = 'https://github.com/example/evidence-repo';
    git(partial, 'remote', 'set-url', 'origin', origin);
    assert.equal(git(partial, 'config', 'remote.origin.promisor'), 'true');
    assert.doesNotMatch(git(partial, 'cat-file', '--batch-all-objects', '--batch-check'), / blob /);

    const helpers = path.join(data.root, 'helpers');
    fs.mkdirSync(helpers);
    fs.writeFileSync(path.join(helpers, 'git-remote-https'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$ARCHIFY_TRANSPORT_TRACE"\nexit 99\n', { mode: 0o755 });
    const trace = path.join(data.root, 'transport.log');
    const env = {
      ...process.env,
      GIT_EXEC_PATH: helpers,
      GIT_NO_LAZY_FETCH: '0', // The verifier must override the caller's setting.
      ARCHIFY_TRANSPORT_TRACE: trace.replaceAll('\\', '/'),
    };
    const wrapper = path.join(data.root, 'force-fallback.mjs');
    if (fallback || ignoreNoLazyFetch) fs.writeFileSync(wrapper, `
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';
const original = childProcess.spawnSync;
childProcess.spawnSync = (executable, args, options) => {
  if (${fallback} && executable === 'git' && args.includes('--batch-check')) {
    fs.appendFileSync(${JSON.stringify(path.join(data.root, 'fallback.log'))}, 'forced batch failure;');
    return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  }
  if (${ignoreNoLazyFetch} && executable === 'git') {
    // Emulate an older Git ignoring NO_LAZY_FETCH, retaining real transports.
    options = { ...options, env: { ...options.env, GIT_NO_LAZY_FETCH: '0' } };
    fs.appendFileSync(${JSON.stringify(path.join(data.root, 'compatibility.log'))}, 'ignored NO_LAZY_FETCH;');
  }
  return original(executable, args, options);
};
syncBuiltinESMExports();
`);
    // Propagate the injection into the renderer process which owns Git reads.
    if (fallback || ignoreNoLazyFetch) env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --import=${pathToFileURL(wrapper).href}`;
    const invoke = (args, repo = partial) => spawnSync(process.execPath, [
      cli, ...args, '--repo-root', repo, '--json',
    ], { cwd: skillRoot, encoding: 'utf8', env });
    const config = fs.readFileSync(path.join(partial, '.git/config'));
    const packs = fs.readdirSync(path.join(partial, '.git/objects/pack')).sort();
    const output = path.join(data.root, 'delivered.html');
    const previous = '<!doctype html><title>previous artifact</title>';
    fs.writeFileSync(output, previous);

    for (const line of [undefined, 1]) {
      data.diagram.meta.repository.link_mode = 'local-only';
      data.diagram.components[0].sources = [{ path: 'src/router.js', ...(line ? { line } : {}) }];
      fs.writeFileSync(data.input, JSON.stringify(data.diagram));
      for (const command of ['validate', 'deliver']) {
        const result = invoke([command, 'architecture', data.input, ...(command === 'deliver' ? [output] : [])]);
        assert.equal(result.status, 1, result.stdout + result.stderr);
        const receipt = JSON.parse(result.stdout);
        assert.equal(receipt.ok, false);
        assert.equal(fs.existsSync(trace), false, 'verification must not start a remote transport');
        assert.equal(receipt.diagnostics[0].code, 'repository-evidence/object-unavailable');
        assert.ok(receipt.diagnostics[0].supportedFixes.some((fix) => /fetch|download/i.test(fix)));
        assert.equal(fs.readFileSync(output, 'utf8'), previous);
      }
    }
    assert.deepEqual(fs.readFileSync(path.join(partial, '.git/config')), config);
    assert.deepEqual(fs.readdirSync(path.join(partial, '.git/objects/pack')).sort(), packs);
    if (fallback) assert.ok(fs.existsSync(path.join(data.root, 'fallback.log')), 'the renderer must exercise the forced fallback');
    if (ignoreNoLazyFetch) assert.ok(fs.existsSync(path.join(data.root, 'compatibility.log')), 'the renderer must exercise the compatibility case');

    // The user explicitly prepares the missing objects. Verification then
    // succeeds without remote transport, just as it does in a complete clone.
    git(partial, 'remote', 'set-url', 'origin', pathToFileURL(data.root).href);
    git(partial, 'show', `${data.revision}:src/router.js`);
    git(partial, 'remote', 'set-url', 'origin', origin);
    for (const repo of [partial, data.root]) {
      const result = invoke(['validate', 'architecture', data.input], repo);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(JSON.parse(result.stdout).ok, true);
    }
    assert.equal(fs.existsSync(trace), false);
  });
}
