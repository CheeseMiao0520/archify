import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyTemplate } from '../archify/renderers/shared/utils.mjs';
import { findChrome } from '../archify/bin/visual-check.mjs';
import { desktopBrowser, desktopPointerCheck } from './helpers/desktop-browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('native copy links preserve a host page and opaque reader state without changing standalone links', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME for the native address regression.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-reading-address-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const template = fs.readFileSync(path.join(root, 'archify/assets/template.html'), 'utf8');
  const html = applyTemplate(template, {
    title: 'Reading address', subtitle: 'Native state stays opaque to the host.', cards: '',
    svg: `<svg viewBox="0 0 600 360" role="img" aria-label="Directed graph">
      <g data-node-id="source" data-node-label="Source" data-node-kind="component" role="button" tabindex="0" aria-pressed="false"><rect x="80" y="60" width="180" height="64" class="c-backend"/><text x="100" y="90" class="t-primary">Source</text></g>
      <g data-node-id="target" data-node-label="Target" data-node-kind="component" role="button" tabindex="0" aria-pressed="false"><rect x="340" y="60" width="180" height="64" class="c-backend"/><text x="360" y="90" class="t-primary">Target</text></g>
      <path d="M260 92 H340" class="a-default" data-edge-id="calls" data-edge-key="calls" data-edge-label="Calls" data-edge-from="source" data-edge-to="target"/>
    </svg>`,
  });
  const file = path.join(scratch, 'reader.html');
  fs.writeFileSync(file, html);
  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const pointer = await desktopPointerCheck(browser, session);
  await browser.inspect({ artifactPath: file, width: 1600, height: 1100,
    theme: 'light', writeScreenshot: false });
  await pointer();
  const run = async (expression, contextId) => {
    const result = await browser.cdp.send('Runtime.evaluate', {
      expression, contextId, returnByValue: true, awaitPromise: true,
    }, session);
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.text);
    return result.result.value;
  };
  const copy = async (action, contextId, mode = 'reject', fallback = true) => run(`(async () => {
    const original = document.execCommand;
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    let text = null, clipboardCalls = 0;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value:
      ${JSON.stringify(mode)} === 'missing' ? undefined : {
        writeText: value => { clipboardCalls++;
          if (${JSON.stringify(mode)} === 'throw') throw new Error('denied');
          if (${JSON.stringify(mode)} !== 'success') return Promise.reject(new Error('denied'));
          text = value; return Promise.resolve();
        }
      }
    });
    document.execCommand = command => {
      if (command !== 'copy') return false;
      text = document.querySelector('textarea[readonly]')?.value ?? null;
      return ${JSON.stringify(fallback)};
    };
    try {
      const copied = await (${action});
      // Observe transient feedback before another CDP round trip can outlive it.
      const button = document.getElementById(${JSON.stringify(action.startsWith('Archify.focus.') ? 'btn-focus-copy' : action.startsWith('Archify.routeProbe.') ? 'route-probe-copy' : 'semantic-lens-copy')});
      return { copied, text, clipboardCalls,
        residual: document.querySelectorAll('textarea[readonly]').length,
        feedback: { text: button.textContent, accessible: button.getAttribute('aria-label') } };
    }
    finally { document.execCommand = original;
      if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor);
      else delete navigator.clipboard; }
  })()`, contextId);
  const states = [
    ['Archify.focus.set("source", {toggle:false,updateUrl:false})', 'Archify.focus.copyLink()', 'focus=source'],
    ['Archify.focus.reach("downstream", {reveal:false,updateUrl:false})', 'Archify.focus.copyLink()', 'focus=source&reach=downstream'],
    ['Archify.focus.inspectRelationshipById("calls", {updateUrl:false})', 'Archify.focus.copyLink()', 'relation=calls'],
    ['Archify.routeProbe.begin({source:"source",focusNode:false}); Archify.routeProbe.choose("target", {updateUrl:false})', 'Archify.routeProbe.copyLink()', 'route=source~target'],
    ['Archify.semanticLens.select("component", {updateUrl:false})', 'Archify.semanticLens.copyLink()', 'lens=component'],
  ];
  const check = async (contextId, address) => {
    for (const [setup, action, state] of states) {
      assert.equal(await run(setup, contextId), true);
      const result = await copy(action, contextId);
      assert.equal(result.copied, true);
      assert.equal(result.residual, 0);
      assert.equal(result.text, address.includes('&reader=')
        ? address.replace('{state}', encodeURIComponent(state))
        : address.replace('{state}', state));
    }
  };
  await check(undefined, pathToFileURL(file).href + '?theme=light#{state}');
  await run('Archify.focus.set("source", {toggle:false,updateUrl:false})');
  for (const [mode, fallback, expected, attempts] of [
    ['success', false, true, 1], ['reject', true, true, 1],
    ['throw', true, true, 1], ['throw', false, false, 1],
    ['missing', true, true, 0], ['reject', false, false, 1],
  ]) {
    const result = await copy('Archify.focus.copyLink()', undefined, mode, fallback);
    assert.equal(result.copied, expected);
    assert.equal(result.clipboardCalls, attempts);
    assert.equal(result.residual, 0);
    assert.equal(result.text, pathToFileURL(file).href + '?theme=light#focus=source');
  }
  for (const address of [
    'https://example.test/publication?lang=en#page=mechanism&reader={state}',
    'file:///standalone/architecture.html#page=second&reader={state}',
  ]) {
    await run(`document.documentElement.setAttribute('data-reading-link-template', ${JSON.stringify(address)})`);
    await check(undefined, address);
  }
  for (const invalid of ['javascript:{state}', 'https://example.test/no-state',
    'https://example.test/#{state}/{state}', 'https://user:password@example.test/#{state}']) {
    await run(`document.documentElement.setAttribute('data-reading-link-template', ${JSON.stringify(invalid)})`);
    for (const [setup, action] of states) {
      assert.equal(await run(setup), true);
      const result = await copy(action);
      assert.equal(result.copied, false);
      assert.equal(result.text, null);
      assert.equal(result.clipboardCalls, 0);
      assert.equal(result.residual, 0);
      const feedback = result.feedback;
      assert.match(feedback.text, /copy failed/i, `${action} must explain rejected addresses`);
      assert.match(feedback.accessible, /(?:could not copy|copy failed)/i,
        `${action} must announce rejected addresses`);
    }
  }
  const host = 'https://example.test/publication#page=opaque&reader={state}';
  const script = `<script>(async () => {
    if (document.readyState !== 'complete') await new Promise(resolve => addEventListener('load', resolve, {once:true}));
    const original = document.execCommand;
    let text = null, clipboardCalls = 0;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: () => { clipboardCalls++; return Promise.reject(new Error('denied')); }
    }});
    document.execCommand = () => { text = document.querySelector('textarea[readonly]')?.value; return true; };
    const results = [];
    try {
      for (const [setup, action, state] of ${JSON.stringify(states)}) {
        const selected = eval(setup), copied = await eval(action);
        results.push({ selected, copied, text, state, clipboardCalls,
          residual: document.querySelectorAll('textarea[readonly]').length });
      }
      const policy = document.permissionsPolicy || document.featurePolicy;
      parent.postMessage({type:'native-reading-address', location:location.href,
        denied: policy?.allowsFeature('clipboard-write') === false, results}, '*');
    } catch (error) { parent.postMessage({type:'native-reading-address', error:error.message}, '*'); }
    finally { document.execCommand = original; }
  })();</script>`;
  const embedded = html.replace('<html ', `<html data-reading-link-template="${host.replaceAll('&', '&amp;')}" `)
    .replace('</body>', script + '</body>');
  const opaque = await run(`new Promise((resolve,reject) => {
    const frame=document.createElement('iframe'); frame.width='1600'; frame.height='1100';
    frame.setAttribute('sandbox','allow-scripts');
    const timeout=setTimeout(() => { removeEventListener('message', receive); frame.remove(); reject(new Error('Native address frame did not report')); },10000);
    const receive=event => { if(event.source!==frame.contentWindow || event.data?.type!=='native-reading-address') return;
      clearTimeout(timeout); removeEventListener('message',receive); frame.remove(); resolve(event.data); };
    addEventListener('message',receive); frame.srcdoc=${JSON.stringify(embedded)};
    document.body.appendChild(frame);
  })`);
  assert.equal(opaque.error, undefined);
  assert.equal(opaque.location, 'about:srcdoc');
  assert.equal(opaque.denied, true);
  assert.equal(opaque.results.length, states.length);
  for (const result of opaque.results) {
    assert.equal(result.selected, true);
    assert.equal(result.copied, true);
    assert.equal(result.clipboardCalls, 0);
    assert.equal(result.residual, 0);
    assert.equal(result.text, host.replace('{state}', encodeURIComponent(result.state)));
  }
  const restoredScript = `<script>addEventListener('load', () => {
    parent.postMessage({type:'native-reading-restored', hash:location.hash,
      focus:Archify.focus.active(), relationship:Archify.focus.relationship(),
      reach:Archify.focus.reachability(), route:Archify.routeProbe.result(),
      lens:Archify.semanticLens.active()}, '*');
  }, {once:true});</script>`;
  const reopenedReader = html.replace('<head>',
    '<head><script>location.replace(location.href.replace(/#.*$/, "") + "#" + __STATE__);</script>')
    .replace('</body>', restoredScript + '</body>');
  const hostFile = path.join(scratch, 'host.html');
  fs.writeFileSync(hostFile, `<!doctype html><html><body><script>
    const address=new URLSearchParams(location.hash.slice(1));
    const frame=document.createElement('iframe'); frame.setAttribute('sandbox','allow-scripts');
    addEventListener('message', event => {
      if(event.source===frame.contentWindow && event.data?.type==='native-reading-restored')
        window.reopened={page:address.get('page'), ...event.data};
    });
    frame.srcdoc=${JSON.stringify(reopenedReader).replaceAll('<', '\\u003c')}
      .replace('__STATE__', JSON.stringify(address.get('reader') || ''));
    document.body.appendChild(frame);
  </script></body></html>`);
  for (const result of opaque.results) {
    const address = pathToFileURL(hostFile);
    address.hash = new URL(result.text).hash;
    const blank = browser.cdp.waitFor('Page.loadEventFired', session);
    await browser.cdp.send('Page.navigate', { url: 'about:blank' }, session);
    await blank;
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await browser.cdp.send('Page.navigate', { url: address.href }, session);
    await loaded;
    const restored = await run(`new Promise((resolve,reject) => {
      const started=performance.now();
      function check() {
        if(window.reopened) return resolve(window.reopened);
        if(performance.now()-started>10000) return reject(new Error('Reopened reader did not report'));
        requestAnimationFrame(check);
      }
      check();
    })`);
    assert.equal(restored.page, 'opaque');
    assert.equal(restored.hash, '#' + result.state, 'host passes native state through without parsing it');
    if (result.state.startsWith('focus=')) {
      assert.equal(restored.focus, 'source');
      assert.equal(restored.reach?.direction ?? null, result.state.includes('&reach=') ? 'downstream' : null);
    } else if (result.state.startsWith('relation=')) {
      assert.equal(restored.relationship?.id, 'calls');
    } else if (result.state.startsWith('route=')) {
      assert.equal(restored.route?.source, 'source');
      assert.equal(restored.route?.target, 'target');
      assert.deepEqual(restored.route?.nodes, ['source', 'target']);
    } else {
      assert.deepEqual(restored.lens, ['component']);
    }
  }
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const links = new Set(Array.from(readme.matchAll(/\]\((examples\/[^)\s]+\.html)\)/g), match => match[1]));
  const examples = fs.readdirSync(path.join(root, 'examples'))
    .filter(name => name.endsWith('.architecture.json'))
    .map(name => JSON.parse(fs.readFileSync(path.join(root, 'examples', name), 'utf8')).meta.output)
    .filter(output => links.has(output));
  assert.ok(examples.length, 'README links architecture examples with authoritative inputs');
  for (const example of examples) {
    const artifact = path.join(root, example);
    await browser.inspect({ artifactPath: artifact, width: 1600, height: 1100,
      theme: 'light', writeScreenshot: false });
    const id = await run(`document.querySelector('svg [data-node-id]')?.getAttribute('data-node-id')`);
    assert.ok(id, `${example} provides an authored node`);
    assert.equal(await run(`Archify.focus.set(${JSON.stringify(id)}, {toggle:false,updateUrl:false})`), true);
    const state = 'focus=' + encodeURIComponent(id);
    const before = await copy('Archify.focus.copyLink()');
    assert.equal(before.copied, true);
    assert.equal(before.text, pathToFileURL(artifact).href + '?theme=light#' + state);
    await run(`document.documentElement.setAttribute('data-reading-link-template', ${JSON.stringify(host)})`);
    const configured = await copy('Archify.focus.copyLink()');
    assert.equal(configured.copied, true);
    assert.equal(configured.text, host.replace('{state}', encodeURIComponent(state)),
      `${example} uses the declared host address`);
    assert.equal(configured.residual, 0);
    await run(`document.documentElement.setAttribute('data-reading-link-template', 'javascript:{state}')`);
    const invalid = await copy('Archify.focus.copyLink()');
    assert.equal(invalid.copied, false);
    assert.equal(invalid.clipboardCalls, 0);
    assert.equal(invalid.text, null);
    assert.equal(invalid.residual, 0);
  }
});
