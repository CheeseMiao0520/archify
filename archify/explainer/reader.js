(() => {
  'use strict';
  const root = document.documentElement;
  const read = id => JSON.parse(document.getElementById(id).textContent);
  const prepared = read('archify-explainer-prepared');
  const diagrams = prepared.preparedDiagrams.diagrams || prepared.preparedDiagrams;
  const words = read('explainer-reader-words');
  const english = root.lang.startsWith('en');
  const say = (en,zh) => english ? en : zh;
  const byId = id => document.getElementById(id);
  const all = (selector, within = document) => [...within.querySelectorAll(selector)];
  let toastTimer;
  function notify(text) { const toast=byId('toast');toast.textContent=text;toast.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('visible'),3000); }
  // The legend and grid are hidden in the preview, so fit the viewBox to the drawing itself.
  function cropDiagramPreviews() {
    all('.diagram-preview>svg').forEach(svg=>{
      if (svg.dataset.cropped) return;
      let box; try { box = svg.getBBox(); } catch { return; }
      if (!box.width || !box.height) return;
      const pad = 6;
      svg.setAttribute('viewBox',[box.x - pad,box.y - pad,box.width + pad * 2,box.height + pad * 2].map(n=>Math.round(n)).join(' '));
      svg.dataset.cropped = 'true';
    });
  }
  function ensureDiagramReadability() {
    const bodySize = parseFloat(getComputedStyle(document.querySelector('.block-prose>p') || document.body).fontSize);
    const minimumText = window.innerWidth >= 1440 ? Math.max(10,bodySize * .75) : 10;
    all('.diagram-preview>svg').forEach(svg=>{
      // Measure the current available width, rather than retaining a wider viewport's floor.
      svg.style.minWidth = '0px';
      const sizes = all('text',svg).filter(text=>text.textContent.trim() && text.getBoundingClientRect().width > 0).map(text=>{const matrix = text.getScreenCTM();return matrix ? parseFloat(getComputedStyle(text).fontSize) * (()=>{const trace=matrix.a**2+matrix.b**2+matrix.c**2+matrix.d**2;const determinant=matrix.a*matrix.d-matrix.b*matrix.c;return Math.sqrt(Math.max(0,(trace-Math.sqrt(Math.max(0,trace**2-4*determinant**2)))/2));})() : Infinity;});
      const smallest = Math.min(...sizes);
      const preview = svg.parentElement;
      const insufficient = smallest > 0 && smallest < minimumText;
      if (insufficient) {
        preview.dataset.diagramRequiredWidth = String(Math.ceil(svg.getBoundingClientRect().width * minimumText / smallest));
      } else delete preview.dataset.diagramRequiredWidth;
      preview.dataset.diagramFit = insufficient ? 'insufficient' : 'fit';
      preview.dataset.diagramMinimumText = String(minimumText);
      const status = svg.closest('.block-diagram').querySelector('.diagram-fit-status');
      status.hidden = !insufficient;
      status.textContent = insufficient ? say('This diagram cannot fit this page width with readable text. Open the full diagram to inspect it.','此图无法在当前页宽内同时完整展示并保持文字清晰。请展开交互图查看。') : '';
    });
  }
  const preference = matchMedia('(prefers-color-scheme: dark)');
  let theme = 'auto';
  function applyTheme() {
    const effective = theme === 'auto' ? preference.matches ? 'dark' : 'light' : theme;
    root.dataset.theme = effective;
    all('[data-theme-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.themeChoice === theme)));
    all('.diagram-preview').forEach(preview=>preview.dataset.theme = effective);
    if (viewer?.ready) sendViewer();
  }
  all('[data-theme-choice]').forEach(button=>button.addEventListener('click',()=>{theme = button.dataset.themeChoice; applyTheme();}));
  preference.addEventListener?.('change',applyTheme);
  document.querySelector('[data-print]').addEventListener('click',()=>window.print());
  // Only the isolated srcdoc copy receives this bridge. The payload remains byte-for-byte native.
  const viewerDialog = byId('diagram-dialog');
  let viewer = null;
  let viewerOpener;
  function validHash(diagram,hash) {
    if(!hash) return true;
    const nodes = new Set((diagram.semantic?.nodes || []).map(node=>node.id));
    try {
      if(hash.startsWith('focus=')) return nodes.has(decodeURIComponent(hash.slice(6)));
      if(hash.startsWith('route=')) { const parts = hash.slice(6).split('~').map(decodeURIComponent); return parts.length === 2 && parts.every(id=>nodes.has(id)); }
    } catch {}
    return false;
  }
  function sendViewer() { if(!viewer?.ready) return; viewer.frame.contentWindow.postMessage({kind:'archify-explainer-host',token:viewer.token,theme:root.dataset.theme,hash:viewer.hash,nodes:viewer.nodes,edges:viewer.edges},'*'); }
  function openViewer(id,hash,opener) {
    const diagram = diagrams[id];
    if(!diagram || !validHash(diagram,hash)) { notify(say('Diagram target unavailable.','图中目标不可用。')); return; }
    let requestedEdges = []; try { requestedEdges = JSON.parse(opener.dataset.diagramEdges || '[]'); } catch {}
    requestedEdges = requestedEdges.filter(id=>(diagram.semantic?.edges || []).some(edge=>edge.id === id));
    const selectedEdges = (diagram.semantic?.edges || []).filter(edge=>requestedEdges.includes(edge.id));
    const requestedNodes = [...new Set(hash.startsWith('focus=') ? [decodeURIComponent(hash.slice(6))] : hash.startsWith('route=') ? hash.slice(6).split('~').map(decodeURIComponent) : selectedEdges.flatMap(edge=>[edge.from,edge.to]))];
    viewerOpener = opener;
    byId('diagram-dialog-title').textContent = byId(id).querySelector('figcaption span').textContent;
    viewerDialog.showModal(); document.body.classList.add('dialog-open');
    if(viewer?.id === id) { viewer.hash = hash; viewer.nodes = requestedNodes; viewer.edges = requestedEdges; sendViewer(); return; }
    viewer?.frame.remove();
    const token = Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
    viewerDialog.dataset.nativeReady = 'false'; delete viewerDialog.dataset.nativeFocus;
    const frame = document.createElement('iframe'); frame.addEventListener('load',()=>{viewerDialog.dataset.nativeLoaded = id;}); frame.title = byId('diagram-dialog-title').textContent;
    frame.setAttribute('sandbox','allow-scripts allow-downloads allow-modals');
    const script = `<script>(()=>{
      const token=${JSON.stringify(token)};
      let pending=null;
      const settle=data=>requestAnimationFrame(()=>{
        if(pending!==data)return;
        if(Array.isArray(data.edges)&&data.edges.length&&Array.isArray(data.nodes)){
          if(window.Archify?.focus?.setMany)window.Archify.focus.setMany(data.nodes,{toggle:false,mode:'selection',updateUrl:false});
          document.querySelectorAll('[data-edge-id]').forEach(edge=>{if(data.edges.includes(edge.dataset.edgeId))edge.setAttribute('data-focus-match','');else edge.removeAttribute('data-focus-match');});
        }
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
          if(pending!==data)return;
          pending=null;
          const active=document.querySelector('svg[data-focus-active]');
          const selected=Array.from(document.querySelectorAll('[data-focus-selected]')).map(node=>node.dataset.nodeId);
          const matched=Array.from(document.querySelectorAll('[data-edge-id][data-focus-match]')).map(edge=>edge.dataset.edgeId);
          parent.postMessage({kind:'archify-explainer-focus-result',token,nodes:[...new Set(selected)],edges:[...new Set(matched)],active:active?.dataset.focusActive||''},'*');
        }));
      });
      // The native hash listeners restore focus before the explicit host selection.
      addEventListener('hashchange',()=>{if(pending&&location.hash.slice(1)===pending.hash)settle(pending);});
      addEventListener('message',event=>{
        const data=event.data;
        if(event.source!==parent||data?.kind!=='archify-explainer-host'||data.token!==token)return;
        if(['light','dark'].includes(data.theme))document.documentElement.dataset.theme=data.theme;
        if(typeof data.hash!=='string'||!/^(?:|focus=[^&]+|route=[^&]+~[^&]+)$/.test(data.hash))return;
        pending=data;
        if(location.hash.slice(1)===data.hash)dispatchEvent(new HashChangeEvent('hashchange'));
        else location.hash=data.hash;
      });
      addEventListener('keydown',event=>{if(event.key==='Escape')parent.postMessage({kind:'archify-explainer-escape',token},'*');},true);
      const ready=()=>requestAnimationFrame(()=>requestAnimationFrame(()=>parent.postMessage({kind:'archify-explainer-ready',token},'*')));
      if(document.readyState==='complete')ready();else addEventListener('load',ready,{once:true});
    })();<\/script>`;
    const end = diagram.html.toLowerCase().lastIndexOf('</body>');
    frame.srcdoc = end < 0 ? diagram.html + script : diagram.html.slice(0,end) + script + diagram.html.slice(end);
    viewer = {id,frame,token,hash,nodes:requestedNodes,edges:requestedEdges,ready:false};
    viewerDialog.querySelector('.dialog-loading').hidden = false;
    viewerDialog.append(frame);
  }
  function closeViewer() { if(viewerDialog.open) viewerDialog.close(); }
  document.querySelector('[data-close-diagram]').addEventListener('click',closeViewer);
  viewerDialog.addEventListener('close',()=>{ document.body.classList.remove('dialog-open'); viewerOpener?.focus({preventScroll:true}); });
  window.addEventListener('message',event=>{ if(!viewer || event.source !== viewer.frame.contentWindow || event.data?.token !== viewer.token) return; if(event.data.kind === 'archify-explainer-ready') {viewer.ready = true; viewerDialog.dataset.nativeReady = 'true'; viewerDialog.querySelector('.dialog-loading').hidden = true; sendViewer();} else if(event.data.kind === 'archify-explainer-focus-result') {viewerDialog.dataset.nativeFocus = JSON.stringify({nodes:event.data.nodes,edges:event.data.edges,active:event.data.active});} else if(event.data.kind === 'archify-explainer-escape') closeViewer(); });
  all('[data-open-diagram]').forEach(button=>button.addEventListener('click',()=>openViewer(button.dataset.openDiagram,'',button)));
  all('[data-diagram-link]').forEach(link=>{
    link.addEventListener('click',event=>{ event.preventDefault(); openViewer(link.dataset.diagramLink,link.dataset.diagramHash || '',link); });
    const highlight = active => {
      const preview = byId(link.dataset.diagramLink)?.querySelector('.diagram-preview'); if(!preview) return;
      const target = link.dataset.diagramHash || '';
      const nodes = target.startsWith('focus=') ? [decodeURIComponent(target.slice(6))] : target.startsWith('route=') ? target.slice(6).split('~').map(decodeURIComponent) : [];
      let edges = []; try { edges = JSON.parse(link.dataset.diagramEdges || '[]'); } catch {}
      let matched = false;
      all('[data-node-id],[data-edge-id]',preview).forEach(element=>{const hit = active && (nodes.includes(element.dataset.nodeId) || edges.includes(element.dataset.edgeId)); matched ||= hit; element.classList.toggle('reader-highlight',hit);});
      preview.classList.toggle('focusing',matched);
    };
    link.addEventListener('mouseenter',()=>highlight(true)); link.addEventListener('mouseleave',()=>highlight(false)); link.addEventListener('focus',()=>highlight(true)); link.addEventListener('blur',()=>highlight(false));
  });
  // Native dialogs supply Escape, focus trapping and the accessible modal semantics.
  const printDetails = new Map();
  all('.diagram-semantics').forEach(details=>details.open = false);
  window.addEventListener('beforeprint',()=>all('.diagram-semantics').forEach(details=>{printDetails.set(details,details.open);details.open = true;}));
  window.addEventListener('afterprint',()=>{printDetails.forEach((open,details)=>details.open = open);printDetails.clear();});
  root.classList.add('js');
  applyTheme();
  cropDiagramPreviews();
  Promise.resolve(document.fonts?.ready).then(()=>requestAnimationFrame(()=>requestAnimationFrame(ensureDiagramReadability)));
  window.addEventListener('resize',ensureDiagramReadability);
})();
