import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { renderInline } from './inline.mjs';
import { parseExplainerDiff } from './diff.mjs';
import { computeExplainerRevision } from './revision.mjs';
import { layoutExplainerPanels } from './layout.mjs';

const css = fs.readFileSync(new URL('./reader.css', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('./reader.js', import.meta.url), 'utf8');
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const json = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
const hash = text => createHash('sha256').update(text).digest('hex');
const dictionaries = {
  en:{answer:'Answer',answerMark:'A',scope:'Applies to',sources:'Sources',print:'Print',auto:'System',light:'Light',dark:'Dark',typical:'Typical value',explore:'Explore diagram',close:'Close',loading:'Opening diagram…',graph:'Diagram structure',changes:'Structure changes',added:'Added',removed:'Removed',modified:'Modified',copy:'Copy',copied:'Copied'},
  zh:{answer:'结论',answerMark:'答',scope:'适用于',sources:'来源',print:'打印',auto:'系统',light:'浅色',dark:'深色',typical:'典型值',explore:'展开探索',close:'关闭',loading:'正在打开交互图…',graph:'图的结构',changes:'结构改动',added:'新增',removed:'删除',modified:'修改',copy:'复制',copied:'已复制'}
};

/** Render a validated canonical explainer with separately prepared, immutable resources. */
export function renderExplainer(document, options = {}) {
  const { preparedBundle, sourceText = JSON.stringify(document), sourceMap = {}, sourcePath, preparedSources = {}, preparedDiagrams = {}, diagnostics = [] } = options;
  const locale = document.meta.locale || 'zh-CN';
  const words = dictionaries[locale.startsWith('en') ? 'en' : 'zh'];
  const sources = preparedSources.sources || preparedSources;
  const assets = preparedSources.assets || {};
  const diagrams = preparedDiagrams.diagrams || preparedDiagrams;
  const sourceSha256 = hash(sourceText);
  const revision = computeExplainerRevision({document,sourceText,preparedSources,preparedDiagrams,dependencies:preparedBundle?.dependencies});
  const footnotes = [];
  const citations = new Map();
  const inline = (text, panelId, blockId) => renderInline(String(text ?? ''), {document,sources,diagrams,panelId,blockId,footnotes,citations});
  function unavailable(block, message) {
    const panelIndex = document.panels.findIndex(panel => panel.blocks.includes(block));
    const pointer = `/panels/${panelIndex}/blocks/${document.panels[panelIndex]?.blocks.indexOf(block)}`;
    const diagnostic = {code:'explainer/render-resource',severity:'error',message,subject:{component:block.type,path:pointer,input:sourcePath,...sourceMap[pointer]},evidence:{reason:message,example:'Prepare Git excerpts and native diagrams before rendering.'},supportedFixes:[]};
    throw Object.assign(new Error(message), {code:diagnostic.code,diagnostics:[diagnostic],archifyDiagnostics:[diagnostic]});
  }
  const nativeLink = (target, text) => {
    const nativeHash = target.node ? `focus=${encodeURIComponent(target.node)}` : target.route ? `route=${encodeURIComponent(target.route[0])}~${encodeURIComponent(target.route[1])}` : '';
    return `<a class="diagram-link" href="#${escape(target.diagram)}" data-diagram-link="${escape(target.diagram)}" data-diagram-hash="${escape(nativeHash)}"${target.edges ? ` data-diagram-edges="${escape(JSON.stringify(target.edges))}"` : ''}>${text}<span aria-hidden="true"> ↗</span></a>`;
  };
  function blockHtml(block, panelId) {
    const i = text => inline(text,panelId,block.id);
    let body;
    switch (block.type) {
      case 'prose': body = block.text.split(/\n\s*\n/).map(text => `<p>${i(text)}</p>`).join(''); break;
      case 'list': { const tag = block.ordered ? 'ol' : 'ul'; body = `<${tag} class="text-list">${block.items.map(text => `<li>${i(text)}</li>`).join('')}</${tag}>`; break; }
      case 'callout': body = `<aside class="callout ${escape(block.level)}">${block.title ? `<h3>${i(block.title)}</h3>` : ''}<p>${i(block.text)}</p></aside>`; break;
      case 'comparison': body = `<div class="table-scroll"><table><thead><tr><th scope="col">${block.labelColumn ? i(block.labelColumn) : ''}</th>${block.columns.map(text => `<th scope="col">${i(text)}</th>`).join('')}</tr></thead><tbody>${block.rows.map(row => `<tr id="${escape(row.id)}"><th scope="row">${i(row.label)}</th>${row.cells.map(cell => `<td>${cell.assessment ? `<span class="assessment ${escape(cell.assessment)}"><span class="assessment-meter" aria-hidden="true"><i></i><i></i><i></i></span><b>${i(cell.verdict || ({good:locale.startsWith('en')?'Favorable':'有利',caution:locale.startsWith('en')?'Tradeoff':'有代价',bad:locale.startsWith('en')?'Unfavorable':'不利'}[cell.assessment]))}</b></span>` : ''}<span class="cell-text">${i(cell.text)}</span></td>`).join('')}</tr>`).join('')}</tbody></table></div>`; break;
      case 'facts': body = `<dl class="facts">${block.entries.map(entry => `<div><dt>${i(entry.key)}</dt><dd>${i(entry.value)}</dd></div>`).join('')}</dl>`; break;
      case 'metric': {
        const over = block.value !== undefined && block.limit !== undefined && block.value > block.limit;
        const unit = escape(block.unit || '');
        body = `<div class="metric${over ? ' metric-over-limit' : ''}" data-metric-status="${over ? 'over-limit' : block.value === undefined ? 'limit-only' : 'within-limit'}"><span class="metric-label">${i(block.label)}</span><p class="metric-value">${block.value === undefined ? `${locale.startsWith('en')?'Limit':'上限'} ${escape(block.limit)}<span>${unit}</span>` : `${escape(block.value)}${block.unit ? `<span>${unit}</span>` : ''}${block.limit === undefined ? '' : `<small> / ${escape(block.limit)}${unit}</small>`}`}</p>${block.value !== undefined && block.limit > 0 ? `<meter min="0" max="${escape(block.limit)}" value="${escape(Math.max(0, Math.min(block.value,block.limit)))}" aria-label="${escape(block.label)}">${escape(block.value)} / ${escape(block.limit)}</meter>` : ''}${over ? `<p class="metric-overflow">${locale.startsWith('en')?'Over limit by':'超限'} ${escape(block.value - block.limit)}${block.unit ? ` ${unit}` : ''}</p>` : ''}${block.typical ? `<span class="typical">${words.typical}</span>` : ''}${block.note ? `<p class="fine">${i(block.note)}</p>` : ''}</div>`;
        break;
      }
      case 'steps': body = `<ol class="steps">${block.items.map(item => `<li id="${escape(item.id)}"><b>${item.target ? nativeLink(item.target,i(item.text)) : i(item.text)}</b>${item.detail ? `<p>${i(item.detail)}</p>` : ''}</li>`).join('')}</ol>`; break;
      case 'diagram': { const diagram = diagrams[block.id]; if (!diagram?.svg || !diagram?.html) unavailable(block,`Missing prepared native diagram: ${block.id}`); const title = diagram.spec?.meta?.title || block.id; const svg = staticSvg(diagram.svg, block.id); const previewClass = previewPrefix(block.id); const nativeStyle = scopeNativeCss(diagram.styles || '', '.' + previewClass, previewClass + '-'); body = `<figure class="diagram"><div class="diagram-preview ${previewClass}" role="img" aria-label="${escape(title)}"><style>${nativeStyle}</style>${svg}</div><figcaption><span>${escape(title)}</span><button class="text-button interactive" type="button" data-open-diagram="${escape(block.id)}">${words.explore} ↗</button></figcaption></figure><p class="diagram-fit-status fine" role="status" hidden></p><details class="diagram-semantics" open><summary>${words.graph}</summary><ul>${(diagram.semantic?.nodes || []).map(node => `<li>${escape(node.label || node.id)} <code>${escape(node.id)}</code></li>`).join('')}${(diagram.semantic?.edges || []).map(edge => `<li><code>${escape(edge.from)}</code> → <code>${escape(edge.to)}</code>${edge.label ? ` · ${escape(edge.label)}` : ''}</li>`).join('')}</ul></details>${block.changes?.length ? `<dl class="changes"><dt>${words.changes}</dt>${block.changes.map(change => `<dd><span class="chip ${escape(change.change)}">${words[change.change]}</span> <code>${escape(change.target)}</code></dd>`).join('')}</dl>` : ''}`; break; }
      case 'snippet': body = `<figure class="snippet"><figcaption><span class="snippet-label">${block.title ? i(block.title) : ''}${block.language ? `<code class="snippet-language">${escape(block.language)}</code>` : ''}</span><button class="text-button interactive" type="button" data-copy>${words.copy}</button></figcaption><pre><code${block.language ? ` class="language-${escape(block.language)}"` : ''}>${escape(block.text)}</code></pre></figure>`; break;
      case 'code': { const source = sources[block.source]; if (!source?.path || typeof source.text !== 'string') unavailable(block,`Code requires a Git excerpt: ${block.source}`); body = `<figure class="code"><figcaption>${i(`[](source:${block.source})`)}<span>${escape(source.path)}:${escape(source.lines?.join('–'))}</span></figcaption><pre><code${block.language ? ` class="language-${escape(block.language)}"` : ''}>${escape(source.text)}</code></pre></figure>`; break; }
      case 'diff': {
        const parsed = parseExplainerDiff(block.text,{component:'diff',input:sourcePath,panelId});
        if(parsed.diagnostics.some(diagnostic=>diagnostic.severity === 'error')) throw Object.assign(new Error(`Malformed diff: ${block.id}`),{diagnostics:parsed.diagnostics,archifyDiagnostics:parsed.diagnostics});
        body = `<figure class="diff" data-diff-format="${parsed.format}"><figcaption>${block.caption ? `<span>${i(block.caption)}</span>` : ''}<span class="diff-summary"><span class="added">+${parsed.counts.added} ${words.added}</span> · <span class="removed">−${parsed.counts.removed} ${words.removed}</span></span></figcaption><div class="diff-scroll"><table class="diff-code" aria-label="${escape(block.caption || (locale.startsWith('en')?'Code changes':'代码改动'))}"><thead><tr><th scope="col">${locale.startsWith('en')?'Old':'原行'}</th><th scope="col">${locale.startsWith('en')?'New':'新行'}</th><th scope="col">${locale.startsWith('en')?'Change':'改动'}</th></tr></thead><tbody>${parsed.rows.map(row=>`<tr class="diff-line ${escape(row.kind)}" data-diff-kind="${escape(row.kind)}"${row.oldLine === null ? '' : ` data-old-line="${row.oldLine}"`}${row.newLine === null ? '' : ` data-new-line="${row.newLine}"`}><td class="diff-number">${row.oldLine ?? ''}</td><td class="diff-number">${row.newLine ?? ''}</td><td><code>${escape(row.raw)}</code></td></tr>`).join('')}</tbody></table></div></figure>`;
        break;
      }
      case 'image': { const asset = assets[block.id]; if (!asset?.dataUrl || !/^data:image\/(png|jpeg|webp|gif);base64,/.test(asset.dataUrl)) unavailable(block,`Missing contained image: ${block.id}`); body = `<figure class="image"><img src="${escape(asset.dataUrl)}" alt="${escape(block.alt)}">${block.caption ? `<figcaption>${i(block.caption)}</figcaption>` : ''}</figure>`; break; }
      default: throw new Error(`Unsupported explainer block: ${block.type}`);
    }
    return `<div class="block block-${escape(block.type)}" id="${escape(block.id)}" data-block-type="${escape(block.type)}">${body}</div>`;
  }
  const scopeHtml = scope => { const parts = scopeParts(scope); return parts.length > 1 ? parts.map(part=>`<span class="scope-chip">${inline(part)}</span>`).join('') : `<span>${inline(scope)}</span>`; };
  // Render in reading order so the first citation receives number one.
  const answerHtml = `<header class="panel-head"><span class="panel-id answer-id" aria-hidden="true">${words.answerMark}</span><h2>${words.answer}</h2></header><div class="panel-body"><p class="verdict">${inline(document.answer.summary)}</p>${document.answer.reasons?.length ? `<ol class="reasons">${document.answer.reasons.map(reason=>`<li>${inline(reason)}</li>`).join('')}</ol>` : ''}</div>${document.answer.scope ? `<p class="answer-scope"><span class="scope-label">${words.scope}</span>${scopeHtml(document.answer.scope)}</p>` : ''}`;
  const rows=layoutExplainerPanels(document,diagrams);
  const panels=rows.flatMap((row,rowIndex)=>row.map(item=>{
    if(item.spacer)return `<div class="board-spacer span${item.span}" data-row="${rowIndex}" aria-hidden="true"></div>`;
    if(item.answer)return `<section id="answer" class="panel answer-panel span${item.span}" data-row="${rowIndex}" data-span-min="${item.min}">${answerHtml}</section>`;
    const panel=item.panel,index=document.panels.indexOf(panel);
    const measure=panel.blocks.every(block=>['prose','list','steps','callout','facts','metric'].includes(block.type)) ? ' data-measure="text"' : '';
    return `<section class="panel span${item.span}${panel.blocks.some(block=>block.type === 'diagram') ? ' diagram-panel' : ''}" id="${escape(panel.id)}" data-row="${rowIndex}" data-span-min="${item.min}"${item.explicit ? ` data-span-fixed="${item.span}"` : ''}${measure} data-title="${escape(panel.title)}"><header class="panel-head"><a class="panel-id" href="#${escape(panel.id)}" aria-label="${escape(panel.title)}">${index+1}</a><h2>${inline(panel.title,panel.id)}</h2></header><div class="panel-body">${panel.blocks.map(block=>blockHtml(block,panel.id)).join('')}</div></section>`;
  })).join('');
  for(const source of document.sources)if(!citations.has(source.id))citations.set(source.id,citations.size+1);
  const sourceList=[...citations].map(([id,number])=>{
    const source=sources[id] || document.sources.find(source=>source.id===id);
    const location=source?.path ? `<code>${escape(source.path)}${source.lines?':'+escape(source.lines.join('–')):''}${source.revision?' @ '+escape(source.revision):''}</code>` : '';
    const title=source?.url ? `<a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.title)}</a>` : escape(source?.title || id);
    return `<li id="source-${escape(id)}" value="${number}">${title}${location}</li>`;
  }).join('');
  for (const [id,diagram] of Object.entries(diagrams)) { if (diagram.sha256 && diagram.sha256 !== hash(diagram.html)) throw new Error(`Native child hash mismatch: ${id}`); if (diagram.bytes !== undefined && diagram.bytes !== Buffer.byteLength(diagram.html)) throw new Error(`Native child byte count mismatch: ${id}`); }
  const children = Object.fromEntries(Object.entries(diagrams).map(([id,diagram]) => [id,{diagramType:diagram.diagramType,html:diagram.html,sha256:diagram.sha256 || hash(diagram.html),bytes:diagram.bytes ?? Buffer.byteLength(diagram.html),semantic:diagram.semantic,checks:diagram.checks,composition:diagram.composition,specSha256:diagram.specSha256}]));
  const footnotesHtml = footnotes.length ? `<section class="typical-footnotes"><h2>${locale.startsWith('en')?'Typical value notes':'典型值说明'}</h2><ol>${footnotes.map(note=>`<li id="${escape(note.id)}">${escape(note.label)}: ${escape(note.text)}</li>`).join('')}</ol></section>` : '';
  const manifest = {version:1,artifactId:document.meta.id,revision,documentSha256:hash(JSON.stringify(document)),sourceSha256,dependencies:[...(preparedSources.dependencies || []),...(preparedDiagrams.dependencies || [])].map(({contentBase64,...entry})=>entry),children:Object.fromEntries(Object.entries(children).map(([id,child])=>[id,{sha256:child.sha256,bytes:child.bytes,diagramType:child.diagramType,checks:child.checks,composition:child.composition,specSha256:child.specSha256}])),sources:Object.fromEntries(Object.entries(sources).map(([id,source])=>[id,Object.fromEntries(Object.entries(source || {}).filter(([key])=>key !== 'text'))])),assets:Object.fromEntries(Object.entries(assets).map(([id,asset])=>[id,{sha256:asset.sha256,bytes:asset.bytes,mime:asset.mime}])),diagnostics};
  const bundle = preparedBundle || {schemaVersion:1,kind:'archify-explainer-prepared',sourceText,sourceMap,sourcePath,document,format:'json',diagnostics,preparedSources,preparedDiagrams,dependencies:[...(preparedSources.dependencies || []),...(preparedDiagrams.dependencies || [])],source:{sha256:sourceSha256,bytes:Buffer.byteLength(sourceText)}};
  manifest.dependencies = (bundle.dependencies || []).map(({contentBase64,...entry})=>entry);
  if (!preparedBundle) bundle.digest = hash(JSON.stringify(bundle));
  if (bundle.sourceText !== sourceText || JSON.stringify(bundle.document) !== JSON.stringify(document)) throw new Error('Prepared bundle differs from rendered source or canonical document.');
  return `<!doctype html>\n<html lang="${escape(locale)}" data-archify-artifact="explainer" data-artifact="${escape(document.meta.id)}" data-revision="${revision}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="description" content="${escape(document.answer.summary)}"><title>${escape(document.meta.title)} · Archify</title><style>${css}</style></head><body><a class="skip-link" href="#board">${locale.startsWith('en')?'Skip to content':'跳至正文'}</a><div class="shell"><header class="masthead"><h1>${escape(document.meta.title)}</h1><div class="tools interactive"><div class="theme-controls" role="group" aria-label="${locale.startsWith('en')?'Theme':'主题'}">${['auto','light','dark'].map(theme=>`<button type="button" data-theme-choice="${theme}" aria-pressed="${theme === 'auto'}">${words[theme]}</button>`).join('')}</div><button type="button" data-print>${words.print}</button></div></header><main id="board"><div class="board">${panels}</div></main><footer>${footnotesHtml}<section class="sources"><h2>${words.sources}</h2><ol>${sourceList}</ol></section><p class="colophon">Archify</p></footer></div><dialog class="viewer-dialog" id="diagram-dialog" aria-labelledby="diagram-dialog-title"><header><h2 id="diagram-dialog-title"></h2><button type="button" data-close-diagram>${words.close} ×</button></header><p class="dialog-loading" role="status">${words.loading}</p></dialog><div id="toast" role="status" aria-live="polite"></div><script type="application/json" id="archify-explainer-prepared">${json(bundle)}</script><script type="application/json" id="explainer-manifest">${json(manifest)}</script><script type="application/json" id="explainer-reader-words">${json(words)}</script><script>${js}</script></body></html>`;
}

// Prefix native SVG identifiers in the preview only. Original native HTML is frozen above.
function staticSvg(svg, id) {
  const prefix = previewPrefix(id) + '-';
  // Only element IDs are prefixed; data-node-id and data-edge-id stay semantic for step links.
  const ids = new Map([...svg.matchAll(/(?<![\w-])id="([^"]+)"/g)].map(match => [match[1],prefix + match[1]]));
  return svg.replace(/(?<![\w-])id="([^"]+)"/g,(_,value)=>`id="${escape(ids.get(value))}"`)
    .replace(/url\(#([^\)]+)\)/g,(_,value)=>`url(#${ids.get(value) || value})`)
    .replace(/\b(href|xlink:href)="#([^"]+)"/g,(_,attr,value)=>`${attr}="#${escape(ids.get(value) || value)}"`)
    .replace(/\b(aria-labelledby|aria-describedby)="([^"]+)"/g,(_,attr,value)=>`${attr}="${escape(value.split(/\s+/).map(id=>ids.get(id) || id).join(' '))}"`)
    .replace(/\s(?:tabindex="[^"]*"|role="button"|aria-pressed="[^"]*")/g,'');
}

// A scope written as "a · b · c" reads as separate conditions; anything else stays a sentence.
function scopeParts(scope) { return scope.split(/\s+·\s+/).map(part=>part.trim()).filter(Boolean); }

function previewPrefix(id) { return `preview-${id.replace(/[^A-Za-z0-9_-]/g,'-')}`; }

// Native CSS is scoped to its static preview. No native body/chrome layout enters the reader.
function scopeNativeCss(styles, scope, prefix) {
  const css = styles.replace(/<style[^>]*>/gi,'').replace(/<\/style>/gi,'').replace(/\/\*[\s\S]*?\*\//g,'');
  const defaults = []; const systemDark = []; const systemLight = [];
  function rules(input, collectThemes = true) {
    let result = ''; let cursor = 0;
    while (cursor < input.length) {
      const opening = input.indexOf('{',cursor); if(opening < 0) break;
      const selector = input.slice(cursor,opening).trim(); let depth = 1; let end = opening + 1; let quote = '';
      for(; end < input.length && depth; end++) { const c = input[end]; if(quote) {if(c === quote && input[end-1] !== '\\') quote = '';} else if(c === '\"' || c === "'") quote = c; else if(c === '{') depth++; else if(c === '}') depth--; }
      const body = input.slice(opening + 1,end-1).replace(/url\(#([^\)]+)\)/g,(_,id)=>`url(#${prefix}${id})`); cursor = end;
      if(selector.startsWith('@media') || selector.startsWith('@supports') || selector.startsWith('@layer')) { result += `${selector}{${rules(body,false)}}`; continue; }
      if(selector.startsWith('@font-face')) { result += `${selector}{${body}}`; continue; }
      if(selector.startsWith('@')) continue;
      const selectors = selector.split(',').filter(value=>!/(^|[\s>+~])body(?:\b|$)/.test(value)).map(value=>{
        let next = value.trim().replace(/#([A-Za-z][\w-]*)/g,(_,id)=>'#' + prefix + id);
        next = next.replace(/^:root|^html\b/,scope);
        if (next.startsWith('[data-theme=') || next.startsWith('[data-preset=')) next = scope + next;
        return next.startsWith(scope) ? next : `${scope} ${next}`;
      });
      const rootSelectors = selector.split(',').map(value=>value.trim());
      if (collectThemes && rootSelectors.includes(':root')) defaults.push(body);
      if (collectThemes && rootSelectors.some(value=>/^(?:\:root)?\[data-theme=[\"']?dark[\"']?\]$/.test(value))) systemDark.push(body);
      if (collectThemes && rootSelectors.some(value=>/^(?:\:root)?\[data-theme=[\"']?light[\"']?\]$/.test(value))) systemLight.push(body);
      if(selectors.length) result += `${selectors.join(',')}{${body}}`;
    }
    return result;
  }
  const scoped = rules(css);
  const light = systemLight.length ? systemLight : defaults;
  return scoped + (systemLight.length ? `${scope}:not([data-theme]){${systemLight.join(';')}}` : '') + (systemDark.length ? `@media(prefers-color-scheme:dark){${scope}:not([data-theme]){${systemDark.join(';')}}}` : '') + (light.length ? `@media print{${scope},${scope}[data-theme],${scope}:not([data-theme]){${light.join(';')}}}` : '');
}
