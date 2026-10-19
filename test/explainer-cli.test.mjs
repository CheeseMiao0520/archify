import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { prepareExplainer, writePreparedBundle } from '../archify/explainer/prepare.mjs';
import { scanHtml } from '../archify/explainer/check.mjs';
const cli = path.resolve('archify/bin/archify.mjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8XcAAAAASUVORK5CYII=', 'base64');
function run(args,env={}) { return spawnSync(process.execPath,[cli,...args],{encoding:'utf8',maxBuffer:64*1024*1024,env:{...process.env,ARCHIFY_UPDATE_CHECK_DISABLED:'1',...env}}); }
function fixture() {return {schema_version:1,diagram_type:'explainer',meta:{id:'cli-document',title:'How is a draft delivered?',locale:'en'},answer:{summary:'A checked candidate preserves the authored draft.'},panels:[{id:'delivery',title:'What is checked?',blocks:[{id:'delivery-text',type:'prose',text:'The draft is parsed and checked before publication.'}]}],sources:[]};}
function temporary(t) {const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-explainer-cli-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function write(dir,document=fixture()) {const input=path.join(dir,'author-draft.json');fs.writeFileSync(input,JSON.stringify(document,null,2)+'\n');return input;}
function bundle(file) {const scripts=scanHtml(fs.readFileSync(file,'utf8')).scripts;return JSON.parse(scripts.find(script=>script.attrs.id==='archify-explainer-prepared').text);}

test('explainer CLI binds original draft bytes through validate, deliver and strict check',t=>{
  const dir=temporary(t),input=write(dir),output=path.join(dir,'result.html');
  const validation=run(['validate','explainer',input,'--json']);assert.equal(validation.status,0,validation.stdout+validation.stderr);
  assert.equal(JSON.parse(validation.stdout).candidate.sha256,sha(fs.readFileSync(input)));
  const delivery=run(['deliver','explainer',input,output,'--json']);assert.equal(delivery.status,0,delivery.stdout+delivery.stderr);
  const receipt=JSON.parse(delivery.stdout);assert.equal(receipt.specification.sha256,sha(fs.readFileSync(input)));assert.equal(receipt.artifact.sha256,sha(fs.readFileSync(output)));
  const frozen=bundle(output);assert.equal(frozen.sourceText,fs.readFileSync(input,'utf8'));assert.equal(path.isAbsolute(frozen.sourcePath),false);assert.equal(fs.realpathSync(path.resolve(path.dirname(output),frozen.sourcePath)),fs.realpathSync(input));
  const check=run(['check',output,'--json','--require-provenance']);assert.equal(check.status,0,check.stdout+check.stderr);assert.equal(JSON.parse(check.stdout).deliveryReceiptId,receipt.receiptId);
});

test('explainer CLI parse and semantic failures preserve an existing artifact and actionable locations',t=>{
  const dir=temporary(t),input=write(dir),output=path.join(dir,'result.html');
  assert.equal(run(['deliver','explainer',input,output,'--json']).status,0);const previous=fs.readFileSync(output);
  const doc=fixture();doc.panels[0].blocks[0].type='unsupported-widget';fs.writeFileSync(input,JSON.stringify(doc,null,2));
  const failure=run(['deliver','explainer',input,output,'--json']);assert.equal(failure.status,1);assert.deepEqual(fs.readFileSync(output),previous);
  const diagnostic=JSON.parse(failure.stdout).diagnostics[0];assert.ok(diagnostic.code.startsWith('explainer/'));assert.ok(diagnostic.subject.line>0);assert.ok(diagnostic.subject.component);assert.ok(diagnostic.evidence.reason);assert.ok(diagnostic.evidence.example);
  fs.writeFileSync(input,'{\n  broken');const malformed=run(['finalize','explainer',input,output,'--json']);assert.equal(malformed.status,1);const final=JSON.parse(malformed.stdout);assert.deepEqual(Object.keys(final.gates),['validate','deliver','check','browser-check']);assert.deepEqual(fs.readFileSync(output),previous);
});

test('explainer prepared resource mutation fails before overwriting last good HTML',async t=>{
  const dir=temporary(t),doc=fixture();doc.panels[0].blocks.push({id:'contained-image',type:'image',path:'asset.png',alt:'A contained test image'});
  const input=write(dir,doc),output=path.join(dir,'result.html');fs.writeFileSync(path.join(dir,'asset.png'),png);
  const delivered=run(['deliver','explainer',input,output,'--json']);assert.equal(delivered.status,0,delivered.stdout+delivered.stderr);const previous=fs.readFileSync(output);
  const prepared=await prepareExplainer(fs.readFileSync(input,'utf8'),{inputPath:input});const preparedPath=writePreparedBundle(dir,prepared);
  fs.writeFileSync(path.join(dir,'asset.png'),Buffer.concat([png,Buffer.from('mutation')]));
  const result=run(['deliver','explainer',input,output,'--json'],{ARCHIFY_EXPLAINER_PREPARED:preparedPath});assert.equal(result.status,1);assert.ok(JSON.parse(result.stdout).diagnostics.some(d=>d.code==='explainer/dependency-changed'));assert.deepEqual(fs.readFileSync(output),previous);
});

test('explainer refuses a prepared bundle bound to different original source bytes',async t=>{
  const dir=temporary(t),input=write(dir),output=path.join(dir,'result.html');fs.writeFileSync(output,'last good artifact');
  const prepared=await prepareExplainer(fs.readFileSync(input,'utf8'),{inputPath:input});const preparedPath=writePreparedBundle(dir,prepared);fs.appendFileSync(input,'\n');
  const result=run(['deliver','explainer',input,output,'--json'],{ARCHIFY_EXPLAINER_PREPARED:preparedPath});assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).diagnostics[0].code,'explainer/prepared-mismatch');assert.equal(fs.readFileSync(output,'utf8'),'last good artifact');
});

test('explainer direct render resolves contained resources against author directory',t=>{
  const dir=temporary(t),doc=fixture();doc.panels[0].blocks.push({id:'contained-image',type:'image',path:'asset.png',alt:'A contained test image'});
  const input=write(dir,doc),output=path.join(dir,'result.html');fs.writeFileSync(path.join(dir,'asset.png'),png);
  const rendered=run(['render','explainer',input,output]);assert.equal(rendered.status,0,rendered.stderr);assert.ok(fs.readFileSync(output,'utf8').includes('data:image/png;base64,'));
});

test('explainer finalize opts into the browser gate and reports unavailability',t=>{
  const dir=temporary(t),input=write(dir),output=path.join(dir,'final.html');
  const result=run(['finalize','explainer',input,output,'--browser-check','--json'],{ARCHIFY_CHROME:''});assert.equal(result.status,2,result.stdout+result.stderr);
  const receipt=JSON.parse(result.stdout);assert.deepEqual(receipt.gates,{validate:'pass',deliver:'pass',check:'pass','browser-check':'skipped'});assert.deepEqual(receipt.browserCheck,{requested:true,ran:false});assert.equal(receipt.quality,'showcase');assert.equal(receipt.specification.sha256,sha(fs.readFileSync(input)));assert.equal(receipt.ok,false);
});

test('explainer prepared bundle cannot follow same-byte draft into a different author directory',async t=>{
  const dir=temporary(t),input=write(dir),subdir=path.join(dir,'moved');fs.mkdirSync(subdir);const moved=path.join(subdir,'author-draft.json');fs.copyFileSync(input,moved);
  const prepared=await prepareExplainer(fs.readFileSync(input,'utf8'),{inputPath:input});const preparedPath=writePreparedBundle(dir,prepared),output=path.join(dir,'result.html');fs.writeFileSync(output,'last good');
  const result=run(['deliver','explainer',moved,output,'--json'],{ARCHIFY_EXPLAINER_PREPARED:preparedPath});assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).diagnostics[0].evidence.reason,'draft-path-mismatch');assert.equal(fs.readFileSync(output,'utf8'),'last good');
});

test('explainer public writing modes warn, reject strict drafts, and permit explicit off',t=>{
  const dir=temporary(t),document=fixture();document.panels[0].blocks[0].text='We will perform an analysis of each and every request.';const input=write(dir,document),output=path.join(dir,'result.html');
  const warning=run(['deliver','explainer',input,output,'--writing','warn','--json']);assert.equal(warning.status,0,warning.stdout+warning.stderr);assert.ok(JSON.parse(warning.stdout).diagnostics.some(d=>d.code.startsWith('explainer/writing-')&&d.severity==='warning'));assert.equal(bundle(output).writingMode,'warn');const previous=fs.readFileSync(output);
  for(const command of ['validate','deliver','finalize']) {
    const result=run([command,'explainer',input,...(command==='validate'?[]:[output]),'--writing','strict','--json']);assert.equal(result.status,1,result.stdout+result.stderr);assert.ok(JSON.parse(result.stdout).diagnostics.some(d=>d.code.startsWith('explainer/writing-')&&d.severity==='error'));assert.deepEqual(fs.readFileSync(output),previous);
  }
  const disabled=run(['deliver','explainer',input,output,'--writing=off','--json']);assert.equal(disabled.status,0,disabled.stdout+disabled.stderr);assert.equal(bundle(output).writingMode,'off');assert.ok(!(JSON.parse(disabled.stdout).diagnostics||[]).some(d=>d.code.startsWith('explainer/writing-')));
  const native=run(['validate','workflow',input,'--writing','strict','--json']);assert.equal(native.status,2,native.stdout+native.stderr);assert.equal(JSON.parse(native.stdout).diagnostics[0].code,'cli/unsupported-option');
});

test('explainer prepared writing mode cannot silently change across stages',async t=>{
  const dir=temporary(t),input=write(dir),output=path.join(dir,'result.html');fs.writeFileSync(output,'last good');const prepared=await prepareExplainer(fs.readFileSync(input,'utf8'),{inputPath:input,writingMode:'off'});const preparedPath=writePreparedBundle(dir,prepared);
  const result=run(['deliver','explainer',input,output,'--writing','strict','--json'],{ARCHIFY_EXPLAINER_PREPARED:preparedPath});assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).diagnostics[0].evidence.reason,'writing-mode-mismatch');assert.equal(fs.readFileSync(output,'utf8'),'last good');
});

test('default explainer finalize succeeds without discovering or launching a browser',t=>{
 const dir=temporary(t),input=write(dir),output=path.join(dir,'fast.html');
 const result=run(['finalize','explainer',input,output,'--json'],{ARCHIFY_CHROME:path.join(dir,'does-not-exist')});assert.equal(result.status,0,result.stdout+result.stderr);
 const summary=JSON.parse(result.stdout);assert.deepEqual(summary.gates,{validate:'pass',deliver:'pass',check:'pass','browser-check':'not-run'});assert.deepEqual(summary.browserCheck,{requested:false,ran:false});assert.equal(summary.ok,true);
 const full=JSON.parse(fs.readFileSync(summary.evidence.receipt,'utf8'));assert.deepEqual(full.browserCheck,summary.browserCheck);assert.equal(full.stages['browser-check'].execution,'not-requested');
});

test('explainer live preview explains the supported delivery path before reading input', t => {
  const dir = temporary(t), output = path.join(dir, 'result.html');
  fs.writeFileSync(output, 'last good artifact');
  const result = run(['preview', 'explainer', path.join(dir, 'missing.md'), output, '--no-open']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Live preview supports the ten diagram types only/);
  assert.match(result.stderr, /finalize explainer/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'last good artifact');
});
