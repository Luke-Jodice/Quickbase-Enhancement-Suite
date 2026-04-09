// ==UserScript==
// @name         Quickbase — Code Pages Plus
// @namespace    https://quickbase.com/userscripts
// @version      3.6
// @description  Pro-grade Quickbase codepages editor with a clean white IDE theme.
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

  function isCodeEditorPage() {
    const url = window.location.href;
    return url.includes('a=dbpage') || url.includes('/action/pageedit');
  }
  if (!isCodeEditorPage()) return;

  const CM_VERSION = '5.65.16';
  const css = [
    `https://cdnjs.cloudflare.com/ajax/libs/codemirror/${CM_VERSION}/codemirror.min.css`,
    `https://cdnjs.cloudflare.com/ajax/libs/codemirror/${CM_VERSION}/theme/neo.min.css` // Modern white theme
  ];
  css.forEach(url => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    document.head.appendChild(link);
  });

  GM_addStyle(`
    #cm-editor-wrapper {
      position: relative;
      width: 100% !important;
      height: 85vh !important;
      margin: 10px 0;
      background: #ffffff;
      border: 1px solid #cfd4d9;
      border-radius: 4px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .CodeMirror {
      position: absolute !important;
      top: 0; left: 0; right: 0; bottom: 0;
      height: 100% !important;
      width: 100% !important;
      font-family: 'Fira Code', 'Cascadia Code', 'Source Code Pro', monospace;
      font-size: 14px;
      line-height: 1.6;
    }
    
    /* Neo Theme Tweaks for Quickbase */
    .cm-s-neo.CodeMirror {
       background-color: #ffffff;
       color: #2e3440;
    }
    .cm-s-neo .CodeMirror-gutters {
       background-color: #f1f3f5; /* Slightly darker gutter */
       border-right: 1px solid #d1d8e0;
    }
    .cm-s-neo .CodeMirror-linenumber {
       color: #4a4a4a !important; /* Darker line numbers */
       font-weight: 500;
    }
    
    .CodeMirror * { box-sizing: content-box !important; }
    .CodeMirror-scroll { box-sizing: content-box !important; }
    .CodeMirror-gutter { min-width: 40px; }
    
    .cm-ready #pagetext, .cm-ready textarea[name="pagetext"] {
      display: none !important;
    }
  `);

  let isInitializing = false;

  function forceFullWidth(el) {
    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      parent.style.setProperty('width', '100%', 'important');
      parent.style.setProperty('max-width', 'none', 'important');
      parent.style.setProperty('padding', '0', 'important');
      parent.style.setProperty('margin', '0', 'important');
      if (window.getComputedStyle(parent).display.includes('flex')) {
          parent.style.setProperty('display', 'block', 'important');
      }
      parent = parent.parentElement;
    }
  }

  function init() {
    const ta = document.getElementById('pagetext') || document.querySelector('textarea[name="pagetext"]');
    if (!ta || ta.dataset.cmBound || isInitializing) return;
    if (typeof CodeMirror === 'undefined') return;

    isInitializing = true;
    console.log('[QB CodeMirror] Initializing v3.5...');

    try {
      forceFullWidth(ta);

      const wrapper = document.createElement('div');
      wrapper.id = 'cm-editor-wrapper';
      ta.parentNode.insertBefore(wrapper, ta);

      const pagename = document.getElementById('pagename')?.value || '';
      const mode = pagename.endsWith('.html') ? 'htmlmixed' : (pagename.endsWith('.css') ? 'css' : 'javascript');

      const editor = CodeMirror(wrapper, {
        value: ta.value,
        lineNumbers: true,
        mode: mode,
        theme: 'neo',
        tabSize: 4,
        indentUnit: 4,
        lineWrapping: true,
        matchBrackets: true,
        autoCloseBrackets: true,
        viewportMargin: Infinity
      });

      editor.refresh();
      editor.focus();

      const visibilityObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            editor.refresh();
            forceFullWidth(wrapper);
          }
        });
      }, { threshold: 0.1 });
      visibilityObserver.observe(wrapper);

      let count = 0;
      const aggRefresh = setInterval(() => {
        editor.refresh();
        forceFullWidth(wrapper);
        if (++count > 10) clearInterval(aggRefresh);
      }, 100);

      editor.on('change', () => { ta.value = editor.getValue(); });

      ta.dataset.cmBound = 'true';
      document.body.classList.add('cm-ready');
      console.log('[QB CodeMirror] v3.5 SUCCESS');
    } catch (err) {
      console.error('[QB CodeMirror] ERROR:', err);
      isInitializing = false;
    }
  }

  const fastPoll = setInterval(() => {
    if (document.getElementById('pagetext') || document.querySelector('textarea[name="pagetext"]')) {
      init();
      if (document.body.classList.contains('cm-ready')) clearInterval(fastPoll);
    }
  }, 50);

  const observer = new MutationObserver(() => init());
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
