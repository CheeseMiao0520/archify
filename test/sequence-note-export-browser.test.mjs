import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

// Sequence notes explain the messages at the normal reading zoom. Map may
// hide them, but exports must still carry every line (#676).
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;
const LONG_NOTE = 'this note explains the whole retry and backoff policy in a lot of detail so it is very long';

test('SVG and PNG exports keep every line of a wrapped sequence note', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser export checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-note-export-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const input = path.join(scratch, 'note.json');
  const file = path.join(scratch, 'note.html');
  const spec = {
    schema_version: 1,
    diagram_type: 'sequence',
    meta: { title: 'Note export', output: 'note.html', quality_profile: 'showcase', column_fit: 'spread' },
    participants: [
      { id: 'client', type: 'external', label: 'Client' },
      { id: 'api', type: 'backend', label: 'API' },
      { id: 'db', type: 'database', label: 'DB' },
    ],
    messages: [
      { id: 'request', from: 'client', to: 'api', y: 200, label: 'request', note: LONG_NOTE },
      { id: 'reply', from: 'api', to: 'client', y: 300, label: 'reply', variant: 'return' },
    ],
  };
  fs.writeFileSync(input, JSON.stringify(spec));
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/sequence/render-sequence.mjs'), input, file]);
  const lines = [...fs.readFileSync(file, 'utf8').matchAll(/<tspan x="[\d.]+" dy="[\d.]+">([^<]*)<\/tspan>/g)].map((match) => match[1]);
  assert.ok(lines.length > 1, 'the fixture note wraps');

  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  // Capture downloads at the anchor boundary; serialization, drawing and
  // encoding remain production code.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.noteDownloads=[];
    const create=URL.createObjectURL.bind(URL),blobs=new Map();
    URL.createObjectURL=blob=>{const url=create(blob);blobs.set(url,blob);return url;};
    const click=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){if(this.download){noteDownloads.push(blobs.get(this.href));return;}return click.call(this);};
    window.noteExport=async format=>{const count=noteDownloads.length;await Archify.exportMenu.run(format);
      const start=performance.now();while(noteDownloads.length===count){if(performance.now()-start>15000)throw new Error('export timed out');await new Promise(r=>setTimeout(r,20));}
      return noteDownloads[noteDownloads.length-1];};
    window.notePixels=async blob=>{const bitmap=await createImageBitmap(blob);const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
      const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);return context.getImageData(0,0,bitmap.width,bitmap.height);};
  ` });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(file).href });
  await loaded;
  await run('document.fonts.ready');
  await run('Archify.readerLayout.whenStable()');

  // Conditions and failure details remain visible at the initial reading
  // zoom. Changing depth never reflows the authored note or message geometry.
  const noteState = () => run(`(() => {
    const note = document.querySelector('g[data-edge-from="client"][data-edge-to="api"] > text');
    const svg = note.ownerSVGElement;
    return { opacity: getComputedStyle(note).opacity,
      detail: document.querySelector('.diagram-container').dataset.detailLevel,
      viewBox: svg.getAttribute('viewBox'), x: note.getAttribute('x'), y: note.getAttribute('y'),
      font: note.getAttribute('font-size'), text: note.textContent,
      path: svg.querySelector('g[data-edge-from="client"][data-edge-to="api"] path').getAttribute('d') };
  })()`);
  const initial = await noteState();
  assert.equal(initial.detail, 'read');
  assert.equal(initial.opacity, '1', 'initial reading exposes the complete note');
  const geometry = ({ opacity, detail, ...rest }) => rest;
  for (const [action, detail, opacity] of [['zoomOut', 'map', '0'], ['reset', 'read', '1']]) {
    await run(`Archify.view.${action}();new Promise((resolve,reject)=>{
      const deadline=performance.now()+2000;
      function settled(){
        const note=document.querySelector('g[data-edge-from="client"][data-edge-to="api"] > text');
        if(getComputedStyle(note).opacity===${JSON.stringify(opacity)})return resolve();
        if(performance.now()>deadline)return reject(new Error('Note depth did not settle'));
        requestAnimationFrame(settled);
      }settled();
    })`);
    const current = await noteState();
    assert.equal(current.detail, detail);
    assert.equal(current.opacity, opacity);
    assert.deepEqual(geometry(current), geometry(initial));
  }
  // Export from Map as well: hidden-on-screen never means dropped content.
  await run('Archify.view.zoomOut()');
  const svg = await run(`noteExport('svg').then(blob=>blob.text())`);
  for (const line of lines) assert.ok(svg.includes(`>${line}</tspan>`), `SVG export keeps "${line}"`);
  assert.doesNotMatch(svg, /data-detail=/, 'SVG export removes the zoom-only marker');

  // Compare PNG exports with and without the note text: the difference is the
  // note itself, and it must be as tall as its wrapped lines.
  const diff = await run(`(async()=>{
    const withNote=await notePixels(await noteExport('png'));
    const note=document.querySelector('g[data-edge-from="client"][data-edge-to="api"] > text');const saved=note.innerHTML;note.innerHTML='';
    const withoutNote=await notePixels(await noteExport('png'));note.innerHTML=saved;
    if(withNote.width!==withoutNote.width||withNote.height!==withoutNote.height)return {sameSize:false};
    let top=Infinity,bottom=-1,left=Infinity,right=-1;
    for(let y=0;y<withNote.height;y+=1)for(let x=0;x<withNote.width;x+=1){const i=(y*withNote.width+x)*4;
      if(Math.abs(withNote.data[i]-withoutNote.data[i])+Math.abs(withNote.data[i+1]-withoutNote.data[i+1])+Math.abs(withNote.data[i+2]-withoutNote.data[i+2])>24){
        top=Math.min(top,y);bottom=Math.max(bottom,y);left=Math.min(left,x);right=Math.max(right,x);}}
    return {sameSize:true,width:withNote.width,top,bottom,left,right};
  })()`);
  assert.equal(diff.sameSize, true);
  assert.ok(diff.bottom >= 0, 'the PNG export draws the note');
  const exportedWidth = Number(svg.match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) [\d.]+"/)[1]);
  const scale = diff.width / exportedWidth;
  assert.ok(diff.bottom - diff.top >= (lines.length - 1) * 11 * scale * 0.8, `the PNG note spans its ${lines.length} lines (${diff.bottom - diff.top}px at scale ${scale.toFixed(2)})`);

  if (process.env.ARCHIFY_NOTE_EXPORT_EVIDENCE) {
    const png = await run(`noteExport('png').then(blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);}))`);
    fs.writeFileSync(process.env.ARCHIFY_NOTE_EXPORT_EVIDENCE, Buffer.from(png, 'base64'));
  }

  // This fixture has no segment overlays: the note sits on the panel over
  // the body background. Measure computed colors in Full detail, not a class
  // name, and retain the default Read/export checks above.
  await run(`Archify.view.reset();for(let i=0;i<3;i++) Archify.view.zoomIn();
    new Promise((resolve,reject)=>{
      const deadline=performance.now()+2000;
      function settled(){
        if(getComputedStyle(document.querySelector('g[data-edge-from="client"][data-edge-to="api"] > text')).opacity==='1') return resolve();
        if(performance.now()>deadline) return reject(new Error('Full-detail note did not become visible'));
        requestAnimationFrame(settled);
      }
      settled();
    })`);
  const full = await noteState();
  assert.equal(full.detail, 'full');
  assert.deepEqual(geometry(full), geometry(initial), 'Full retains note content and authored geometry');
  for (const theme of ['dark', 'light']) {
    await t.test(`${theme} Full-detail note has at least 4.5:1 contrast`, async () => {
      await run(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});
        new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      const colors = await run(`(() => {
        const note = document.querySelector('g[data-edge-from="client"][data-edge-to="api"] > text');
        const panel = document.querySelector('.diagram-container');
        const style = getComputedStyle(note);
        const rgba = value => {
          const parts = value.match(/[\\d.]+/g).map(Number);
          return [...parts.slice(0, 3), parts[3] ?? 1];
        };
        const over = (front, back) => front.slice(0, 3).map((c, i) => c * front[3] + back[i] * (1 - front[3]));
        const body = rgba(getComputedStyle(document.body).backgroundColor);
        const background = over(rgba(getComputedStyle(panel).backgroundColor), body);
        const fill = rgba(style.fill);
        fill[3] *= Number(style.fillOpacity);
        const foreground = over(fill, background);
        const luminance = rgb => rgb.map(c => {
          c /= 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
        const a = luminance(foreground), b = luminance(background);
        return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          foreground, background, bodyAlpha: body[3], opacity: style.opacity,
          visibility: style.visibility, display: style.display,
          detail: panel.getAttribute('data-detail-level'),
          svgBackgroundAlpha: rgba(getComputedStyle(note.ownerSVGElement).backgroundColor)[3],
          segments: document.querySelectorAll('[data-composition-frame-kind="segment"]').length };
      })()`);
      assert.equal(colors.detail, 'full');
      assert.equal(colors.opacity, '1', 'contrast is measured on a visible note');
      assert.notEqual(colors.visibility, 'hidden');
      assert.notEqual(colors.display, 'none');
      assert.equal(colors.bodyAlpha, 1, 'body provides the opaque background');
      assert.equal(colors.svgBackgroundAlpha, 0, 'SVG leaves the panel background visible');
      assert.equal(colors.segments, 0, 'no segment overlay changes the note background');
      t.diagnostic(`${theme} note contrast ${colors.ratio.toFixed(3)}:1; foreground ${colors.foreground}; background ${colors.background}`);
      assert.ok(colors.ratio >= 4.5, `${theme} note contrast ${colors.ratio.toFixed(3)}:1 must be at least 4.5:1`);
    });
  }

  await t.test('phase borders remain outside note text in Read, focused Map and exports', async () => {
    spec.segments = [
      { from: 150, to: 230, label: 'Request' },
      { from: 241, to: 350, label: 'Reply' },
    ];
    fs.writeFileSync(input, JSON.stringify(spec));
    execFileSync(process.execPath, [path.join(skillRoot, 'renderers/sequence/render-sequence.mjs'), input, file]);
    const reloaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.reload', { ignoreCache: true });
    await reloaded;
    await run('document.fonts.ready');
    await run('Archify.view.reset(); Archify.readerLayout.whenStable()');
    const before = await noteState();
    assert.equal(before.text.replace(/\s/g, ''), LONG_NOTE.replace(/\s/g, ''));
    for (const theme of ['light', 'dark']) {
      await run(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});
        new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      // Compare real PNG pixels with the frame strokes toggled off. In the
      // note's bounding box, a border must not change any pixel. Beside the
      // note it must remain visible. This catches strokes through whitespace
      // as well as glyphs without prescribing how the renderer clears them.
      const pixels = await run(`(async()=>{
        const note=document.querySelector('g[data-edge-id="request"] > text');
        const frames=[...document.querySelectorAll('[data-composition-frame-kind="segment"]')];
        const bounds=frames.map(e=>[e.getAttribute('y'),e.getAttribute('height')]);
        const withStroke=await notePixels(await noteExport('png'));
        const text=note.innerHTML;note.innerHTML='';
        const withoutText=await notePixels(await noteExport('png'));note.innerHTML=text;
        // PNG adds a title and card padding. Locate the actual exported glyphs
        // instead of assuming SVG coordinates equal image coordinates.
        const box={left:Infinity,right:-1,top:Infinity,bottom:-1};
        for(let y=0;y<withStroke.height;y++)for(let x=0;x<withStroke.width;x++){
          const i=(y*withStroke.width+x)*4;
          if(Math.abs(withStroke.data[i]-withoutText.data[i])+Math.abs(withStroke.data[i+1]-withoutText.data[i+1])+Math.abs(withStroke.data[i+2]-withoutText.data[i+2])>12){
            box.left=Math.min(box.left,x);box.right=Math.max(box.right,x);box.top=Math.min(box.top,y);box.bottom=Math.max(box.bottom,y);
          }
        }
        const saved=frames.map(e=>e.getAttribute('style'));
        frames.forEach(e=>e.style.setProperty('stroke','none','important'));
        const withoutStroke=await notePixels(await noteExport('png'));
        frames.forEach((e,i)=>saved[i]===null?e.removeAttribute('style'):e.setAttribute('style',saved[i]));
        function difference(x1,x2){let count=0;
          for(let y=box.top;y<=box.bottom;y++)
            for(let x=x1;x<=x2;x++){
              const i=(y*withStroke.width+x)*4;
              if(Math.abs(withStroke.data[i]-withoutStroke.data[i])+Math.abs(withStroke.data[i+1]-withoutStroke.data[i+1])+Math.abs(withStroke.data[i+2]-withoutStroke.data[i+2])>12)count++;
            }return count;}
        return {inside:difference(box.left,box.right),outside:difference(box.right+20,box.right+60),bounds,box};
      })()`);
      assert.ok(pixels.box.bottom >= 0, 'the exported note remains visible');
      assert.equal(pixels.inside, 0, `${theme}: frame stroke crosses ${pixels.inside} pixels in the note`);
      assert.ok(pixels.outside > 0, `${theme}: the phase border remains visible beside the note`);
      assert.deepEqual(pixels.bounds, [['150', '80'], ['241', '109']], 'authored frame extents stay fixed');
    }
    for (const [action, opacity] of [
      ['Archify.view.zoomOut()', '0'],
      ["Archify.focus.set('client', { toggle: false, updateUrl: false })", '1'],
    ]) {
      await run(`${action};new Promise((resolve,reject)=>{
        const deadline=performance.now()+2000;
        function settled(){
          const note=document.querySelector('g[data-edge-id="request"] > text');
          if(getComputedStyle(note).opacity===${JSON.stringify(opacity)})return resolve();
          if(performance.now()>deadline)return reject(new Error('Note focus did not settle'));
          requestAnimationFrame(settled);
        }settled();
      })`);
    }
    const focused = await noteState();
    assert.equal(focused.detail, 'map');
    assert.equal(focused.opacity, '1', 'focused Map reveals the complete note');
    assert.deepEqual(geometry(focused), geometry(before), 'reading depth and focus preserve text and coordinates');
    const focusedSvg = await run(`noteExport('svg').then(blob=>blob.text())`);
    for (const line of lines) assert.ok(focusedSvg.includes(`>${line}</tspan>`));
    assert.doesNotMatch(focusedSvg, /data-detail=/);
  });

});
