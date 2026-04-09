// ==UserScript==
// @name         Quickbase — Code Pages — CodeFlask Editor
// @namespace    https://quickbase.com/userscripts
// @version      1.8
// @description  Replaces the basic Quickbase code page textarea with a micro CodeFlask editor.
// @match        https://*.quickbase.com/*
// @grant        GM_addStyle
// @require      https://unpkg.com/codeflask/build/codeflask.min.js
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  function isCodeEditorPage() {
    const url = window.location.href;
    return url.includes('a=dbpage') || url.includes('/action/pageedit');
  }
  if (!isCodeEditorPage()) return;

  GM_addStyle(`
    #flask-editor-container {
      width: 100% !important;
      height: 85vh !important;
      position: relative;
      border: 1px solid #ddd;
      border-radius: 4px;
      margin: 10px 0;
      background: #1e1e1e;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      overflow: hidden;
    }
    
    /* CodeFlask internal tweaks */
    .codeflask {
       background: #1e1e1e !important;
       border-radius: 4px;
    }
    .codeflask__pre, .codeflask__textarea {
       font-family: 'Fira Code', 'Cascadia Code', 'Source Code Pro', monospace !important;
       font-size: 14px !important;
       line-height: 1.5 !important;
       padding: 10px !important; /* Fixed padding */
       margin: 0 !important;
       border: none !important;
       box-sizing: border-box !important;
       tab-size: 4 !important;
       -moz-tab-size: 4 !important;
    }

    /* Alignment Sync: Ensure layers are perfectly matched */
    .codeflask__pre {
       white-space: pre !important;
       overflow-wrap: normal !important;
    }
    .codeflask__textarea {
       caret-color: #a855f7 !important;
       outline: none !important;
       white-space: pre !important;
       overflow-wrap: normal !important;
       resize: none !important;
    }

    .flask-ready #pagetext, .flask-ready textarea[name="pagetext"] {
      display: none !important;
    }
    
    /* Aggressively expand all Quickbase parent containers to full width */
    .flask-ready #pageEditForm, 
    .flask-ready .container, 
    .flask-ready .container-fluid,
    .flask-ready .formContent,
    .flask-ready #bodyDiv,
    .flask-ready main,
    .flask-ready .qb-content-container {
       max-width: 100% !important;
       width: 100% !important;
       padding-left: 0 !important;
       padding-right: 0 !important;
       margin-left: 0 !important;
       margin-right: 0 !important;
    }

    /* Huey-specific full-width adjustments */
    .flask-ready .huey-content-area, 
    .flask-ready .huey-main-scroll-area {
       padding: 0 !important;
    }
  `);

  let isInitializing = false;
  let flask = null;

  function forceFullWidth(el) {
    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      parent.style.setProperty('width', '100%', 'important');
      parent.style.setProperty('max-width', 'none', 'important');
      parent.style.setProperty('padding-left', '0', 'important');
      parent.style.setProperty('padding-right', '0', 'important');
      parent.style.setProperty('margin-left', '0', 'important');
      parent.style.setProperty('margin-right', '0', 'important');
      
      // Handle flex/grid constraints
      const style = window.getComputedStyle(parent);
      if (style.display === 'flex' || style.display === 'inline-flex') {
        parent.style.setProperty('display', 'block', 'important');
      }
      
      parent = parent.parentElement;
    }
  }

  function init() {
    const ta = document.getElementById('pagetext') || document.querySelector('textarea[name="pagetext"]');
    if (!ta || ta.dataset.flaskBound || isInitializing) return;

    if (typeof CodeFlask === 'undefined') return;

    isInitializing = true;
    console.log('[QB CodeFlask] Initializing v2.0...');

    try {
      // Force all parents to expand before creating the editor
      forceFullWidth(ta);

      // Create container
      const container = document.createElement('div');
      container.id = 'flask-editor-container';
      ta.parentNode.insertBefore(container, ta);

      const pagename = document.getElementById('pagename')?.value || '';
      let lang = 'js';
      if (pagename.endsWith('.html')) lang = 'html';
      else if (pagename.endsWith('.css')) lang = 'css';

      flask = new CodeFlask('#flask-editor-container', {
        language: lang,
        lineNumbers: true
      });

      // Sync initial code
      flask.updateCode(ta.value);

      // Sync changes back to textarea
      flask.onUpdate((code) => {
        ta.value = code;
      });

      ta.dataset.flaskBound = 'true';
      document.body.classList.add('flask-ready');
      
      // Re-run expansion after initialization to catch any lazy-loaded styles
      forceFullWidth(container);
      
      console.log('[QB CodeFlask] SUCCESS');
    } catch (err) {
      console.error('[QB CodeFlask] ERROR:', err);
      isInitializing = false;
    }
  }

  // Monitor for the element appearing (Angular pages)
  const observer = new MutationObserver(() => { if (!isInitializing) init(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Fallback poll
  const poll = setInterval(() => {
    if (document.body && document.body.classList.contains('flask-ready')) {
        clearInterval(poll);
    } else {
        init();
    }
  }, 100);

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  }
})();
