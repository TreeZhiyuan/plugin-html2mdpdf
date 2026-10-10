(function () {
  'use strict';

  const state = {
    mode: 'NORMAL',
    hiddenStack: [],
    selectedExportRoots: [],
    printStyle: null
  };

  const hoverMask = document.createElement('div');
  hoverMask.id = 'ext-hover-mask';
  hoverMask.setAttribute('aria-hidden', 'true');

  function ensureMask() {
    if (!hoverMask.isConnected && document.body) document.body.appendChild(hoverMask);
  }

  function isPageElement(target) {
    return target instanceof Element && target !== hoverMask && target !== document.body && target !== document.documentElement;
  }

  function updateMaskPosition(target) {
    ensureMask();
    if (!isPageElement(target) || state.mode === 'NORMAL') {
      hoverMask.style.display = 'none';
      return;
    }
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      hoverMask.style.display = 'none';
      return;
    }
    hoverMask.className = state.mode === 'HIDE' ? 'ext-mask-hide' : 'ext-mask-pick';
    hoverMask.style.display = 'block';
    hoverMask.style.left = `${rect.left + window.scrollX}px`;
    hoverMask.style.top = `${rect.top + window.scrollY}px`;
    hoverMask.style.width = `${rect.width}px`;
    hoverMask.style.height = `${rect.height}px`;
  }

  function stopInteraction(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
  }

  function handlePageClick(event) {
    if (state.mode === 'NORMAL' || !isPageElement(event.target)) return;
    stopInteraction(event);

    const target = event.target;
    if (state.mode === 'HIDE') {
      if (target.dataset.extHidden !== 'true') {
        target.dataset.extOldDisplay = target.style.display || '';
        target.style.setProperty('display', 'none', 'important');
        target.dataset.extHidden = 'true';
        state.hiddenStack.push(target);
      }
      hoverMask.style.display = 'none';
      return;
    }

    if (state.mode === 'PICK_ROOT') {
      const selectedIndex = state.selectedExportRoots.findIndex(root => root === target || root.contains(target));
      if (selectedIndex >= 0) {
        const selectedRoot = state.selectedExportRoots.splice(selectedIndex, 1)[0];
        delete selectedRoot.dataset.extExportRoot;
      } else {
        state.selectedExportRoots.push(target);
        target.dataset.extExportRoot = 'true';
      }
      hoverMask.style.display = 'none';
    }
  }

  function undoHide() {
    while (state.hiddenStack.length) {
      const element = state.hiddenStack.pop();
      if (!element || !element.isConnected) continue;
      element.style.display = element.dataset.extOldDisplay || '';
      delete element.dataset.extOldDisplay;
      delete element.dataset.extHidden;
      return state.hiddenStack.length;
    }
    return 0;
  }

  function removeExtensionMarkers(root) {
    if (root.matches?.('[data-ext-hidden="true"]') || root.id === 'ext-hover-mask') return null;
    root.querySelectorAll('[data-ext-hidden="true"], #ext-hover-mask, [data-ext-export-root]').forEach(node => {
      if (node.matches('[data-ext-hidden="true"], #ext-hover-mask')) node.remove();
      else node.removeAttribute('data-ext-export-root');
    });
    return root;
  }

  function getExportRoots() {
    const connectedRoots = state.selectedExportRoots.filter(root => root?.isConnected);
    return connectedRoots
      .filter(root => !connectedRoots.some(other => other !== root && other.contains(root)))
      .sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  }

  function triggerDownload(content, filename, contentType) {
    const blob = new Blob([content], { type: `${contentType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportMarkdown() {
    if (typeof TurndownService === 'undefined') return { ok: false, message: 'Markdown 转换库未加载' };

    const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
    const roots = getExportRoots();
    const sources = roots.length ? roots : [document.body];
    const markdown = sources.map(source => {
      const clone = source.cloneNode(true);
      const cleanRoot = removeExtensionMarkers(clone);
      return cleanRoot ? turndown.turndown(cleanRoot.outerHTML || cleanRoot.innerHTML) : '';
    }).filter(Boolean).join('\n\n');
    if (!markdown.trim()) return { ok: false, message: '当前区域没有可导出的内容' };
    triggerDownload(`${markdown.trim()}\n`, `web-clip-${new Date().toISOString().slice(0, 10)}.md`, 'text/markdown');
    return { ok: true, selectedCount: roots.length };
  }

  function clearPrintOverrides() {
    if (!state.printOverrides) return;
    state.printOverrides.forEach(({ element, style }) => {
      if (style === null) element.removeAttribute('style');
      else element.setAttribute('style', style);
    });
    state.printOverrides = [];
  }

  function applyPrintVisibility(roots) {
    state.printOverrides = [];
    if (!roots.length) return;
    document.body.querySelectorAll('*').forEach(element => {
      if (element === hoverMask) return;
      const keep = roots.some(root => root === element || root.contains(element) || element.contains(root));
      if (!keep) {
        state.printOverrides.push({ element, style: element.getAttribute('style') });
        element.style.setProperty('display', 'none', 'important');
      }
    });
  }

  function exportPDF() {
    if (state.printStyle) state.printStyle.remove();
    clearPrintOverrides();
    const style = document.createElement('style');
    style.id = 'ext-print-override';
    let css = '@media print { * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } [data-ext-hidden="true"], #ext-hover-mask { display: none !important; }';
    const roots = getExportRoots();
    if (roots.length) {
      applyPrintVisibility(roots);
      css += ' [data-ext-export-root] { width: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 !important; }';
    }
    style.textContent = `${css} }`;
    document.head.appendChild(style);
    state.printStyle = style;
    window.setTimeout(() => window.print(), 0);
    window.setTimeout(() => {
      if (state.printStyle === style) { style.remove(); state.printStyle = null; clearPrintOverrides(); }
    }, 1000);
    return { ok: true, selectedCount: roots.length };
  }

  document.addEventListener('mouseover', event => updateMaskPosition(event.target), true);
  document.addEventListener('click', handlePageClick, true);
  window.addEventListener('scroll', () => {
    if (hoverMask.style.display === 'block') hoverMask.style.display = 'none';
  }, { passive: true });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    ensureMask();
    switch (request.action) {
      case 'TOGGLE_HIDE_MODE':
        state.mode = state.mode === 'HIDE' ? 'NORMAL' : 'HIDE';
        sendResponse({ isHideMode: state.mode === 'HIDE' });
        break;
      case 'TOGGLE_PICK_MODE':
        state.mode = state.mode === 'PICK_ROOT' ? 'NORMAL' : 'PICK_ROOT';
        sendResponse({ isPickMode: state.mode === 'PICK_ROOT', selectedCount: getExportRoots().length });
        break;
      case 'UNDO_HIDE': {
        const before = state.hiddenStack.length;
        const stackCount = undoHide();
        sendResponse({ restored: before !== stackCount, stackCount });
        break;
      }
      case 'EXPORT_MARKDOWN': sendResponse(exportMarkdown()); break;
      case 'EXPORT_PDF': sendResponse(exportPDF()); break;
      default: sendResponse({ ok: false, message: '未知操作' });
    }
    return true;
  });

  ensureMask();
})();
