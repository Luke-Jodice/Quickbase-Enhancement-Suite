// ==UserScript==
// @name         Quickbase — Code Pages — CodeMirror Editor
// @namespace    https://quickbase.com/userscripts
// @version      1.7
// @description  Replaces the basic Quickbase code page textarea with a full CodeMirror editor.
// @match        https://*.quickbase.com/*
// @grant        GM_addStyle
// @require      https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/javascript/javascript.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/xml/xml.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/css/css.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/htmlmixed/htmlmixed.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/edit/matchbrackets.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/edit/closebrackets.min.js
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // URL Validation
  function isCodeEditorPage() {
    const url = window.location.href;
    return url.includes('a=dbpage') || url.includes('/action/pageedit');
  }
  if (!isCodeEditorPage()) return;

  const CM_VERSION = '5.65.16';
  
  // Faster CSS injection
  const cssLinks = [
    `https://cdnjs.cloudflare.com/ajax/libs/codemirror/${CM_VERSION}/codemirror.min.css`,
    `https://cdnjs.cloudflare.com/ajax/libs/codemirror/${CM_VERSION}/theme/dracula.min.css`
  ];
  cssLinks.forEach(url => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    document.head.appendChild(link);
  });

  GM_addStyle(`
    .CodeMirror {
      height: 85vh !important;
      width: 100% !important;
      border: 1px solid #ddd;
      font-family: 'Fira Code', 'Cascadia Code', 'Source Code Pro', monospace;
      font-size: 14px;
      line-height: 1.5;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      z-index: 1;
    }
    
    /* Full width wrapper adjustment for Quickbase's container */
    .cm-ready .CodeMirror {
       margin: 10px 0;
    }

    /* Fix for line numbers and layout shifts */
    .CodeMirror * { box-sizing: content-box !important; }
    .CodeMirror-scroll { box-sizing: content-box !important; }
    .CodeMirror-gutter { min-width: 40px; }
    
    .cm-ready #pagetext, .cm-ready textarea[name="pagetext"] {
      display: none !important;
    }
  `);

  let isInitializing = false;

  function init() {
    const ta = document.getElementById('pagetext') || document.querySelector('textarea[name="pagetext"]');
    if (!ta || ta.dataset.cmBound || isInitializing) return;

    if (typeof CodeMirror === 'undefined') return;

    isInitializing = true;

    try {
      const pagename = document.getElementById('pagename')?.value || '';
      const mode = pagename.endsWith('.html') ? 'htmlmixed' : (pagename.endsWith('.css') ? 'css' : 'javascript');

      const editor = CodeMirror.fromTextArea(ta, {
        lineNumbers: true,
        mode: mode,
        theme: 'dracula',
        tabSize: 4,
        indentUnit: 4,
        lineWrapping: true,
        matchBrackets: true,
        autoCloseBrackets: true,
        viewportMargin: Infinity
      });

      // Rapid refresh to ensure layout is correct
      editor.refresh();
      setTimeout(() => editor.refresh(), 50);

      editor.on('change', () => {
        ta.value = editor.getValue();
      });

      ta.dataset.cmBound = 'true';
      document.body.classList.add('cm-ready');
      console.log('[QB CodeMirror] v1.7 SUCCESS');
    } catch (err) {
      console.error('[QB CodeMirror] ERROR:', err);
      isInitializing = false;
    }
  }

  // Use a faster check strategy
  const observer = new MutationObserver(() => { if (!isInitializing) init(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Fallback poll (faster interval for snappier loading)
  const poll = setInterval(() => {
    if (document.body && document.body.classList.contains('cm-ready')) {
        clearInterval(poll);
    } else {
        init();
    }
  }, 100);

  // Immediate attempt
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  }
})();
