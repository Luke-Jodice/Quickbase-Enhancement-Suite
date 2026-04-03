// ==UserScript==
// @name         Quickbase Formula — Function Autocomplete
// @namespace    https://quickbase.com/userscripts
// @version      1.0
// @description  Autocomplete formula functions in the Quickbase formula editor (Ctrl+Space to trigger)
// @match        https://*.quickbase.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  GM_addStyle(`
    #qb-fn-dropdown {
      position: absolute;
      z-index: 99999;
      background: #fff;
      border: 1px solid #ddd;
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.06);
      max-height: 300px;
      overflow-y: auto;
      min-width: 280px;
      max-width: 500px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      padding: 4px 0;
      display: none;
      scrollbar-width: thin;
    }
    #qb-fn-dropdown::-webkit-scrollbar { width: 5px; }
    #qb-fn-dropdown::-webkit-scrollbar-thumb {
      background: #ccc; border-radius: 3px;
    }
    .qb-fn-item {
      display: flex;
      align-items: baseline;
      padding: 5px 12px;
      cursor: pointer;
      gap: 6px;
      transition: background 100ms ease;
    }
    .qb-fn-item:hover,
    .qb-fn-item.qb-fn-active {
      background: #f0f4f8;
    }
    .qb-fn-item-name {
      color: #1a1d21;
      font-weight: 600;
      white-space: nowrap;
    }
    .qb-fn-item-name mark {
      background: #fff3b0;
      color: inherit;
      border-radius: 2px;
      padding: 0 1px;
      font-weight: 600;
    }
    .qb-fn-item-params {
      color: #8b95a3;
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
    }
    .qb-fn-item-badge {
      font-size: 10px;
      color: #fff;
      background: #aab2bd;
      border-radius: 8px;
      padding: 1px 6px;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .qb-fn-empty {
      padding: 10px 14px;
      color: #8b95a3;
      font-style: italic;
      text-align: center;
    }
    .qb-fn-hint {
      padding: 4px 12px 6px;
      font-size: 10px;
      color: #aab2bd;
      border-top: 1px solid #f0f0f0;
      margin-top: 2px;
      display: flex;
      gap: 10px;
      justify-content: center;
    }
    .qb-fn-hint kbd {
      background: #f0f2f4;
      border: 1px solid #ddd;
      border-radius: 3px;
      padding: 0 4px;
      font-size: 10px;
      font-family: inherit;
    }
  `);

  var dropdown = null;
  var functions = null;
  var filtered = [];
  var activeIndex = 0;
  var wordStart = null;
  var isOpen = false;
  var aceEditor = null;
  var inserting = false;

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function parseFuncInfo(html) {
    var text = html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();

    var firstLine = text.split(/\n/)[0] || '';
    var paramMatch = firstLine.match(/\(([^)]*)\)/);
    var params = paramMatch ? paramMatch[1].trim() : '';

    var descMatch = text.match(/Description:\s*([^\n]+)/);
    var description = descMatch ? descMatch[1].trim() : '';

    return { params: params, description: description };
  }

  function collectFunctions() {
    var sel = document.getElementById('Select1');
    if (!sel || sel.options.length === 0) return null;

    var funcInfo = document.getElementById('FuncInfo');
    var originalIndex = sel.selectedIndex;

    // Ensure "All" category is selected so every function is visible
    var catSel = document.getElementById('Select2');
    var origCatIndex = catSel ? catSel.selectedIndex : -1;
    if (catSel && catSel.value !== 'All') {
      catSel.value = 'All';
      try {
        if (typeof unsafeWindow !== 'undefined' && unsafeWindow.RefreshFormulaInfoByCategory) {
          unsafeWindow.RefreshFormulaInfoByCategory(catSel);
        } else {
          catSel.dispatchEvent(new Event('change'));
        }
      } catch (e) { /* ignore */ }
    }

    var funcMap = {};

    for (var i = 0; i < sel.options.length; i++) {
      var opt = sel.options[i];
      var name = opt.textContent.trim();
      if (!name) continue;

      var info = { params: '', description: '' };
      if (funcInfo) {
        sel.selectedIndex = i;
        try {
          if (typeof unsafeWindow !== 'undefined' && unsafeWindow.RefreshFormulaInfo) {
            unsafeWindow.RefreshFormulaInfo(sel);
          } else {
            sel.dispatchEvent(new Event('change'));
          }
          info = parseFuncInfo(funcInfo.innerHTML);
        } catch (e) { /* fall back to name-only */ }
      }

      if (!funcMap[name]) {
        funcMap[name] = { name: name, overloads: [] };
      }
      funcMap[name].overloads.push(info);
    }

    // Restore original state
    if (sel.options.length > 0) {
      sel.selectedIndex = originalIndex;
      if (funcInfo) {
        try {
          if (typeof unsafeWindow !== 'undefined' && unsafeWindow.RefreshFormulaInfo) {
            unsafeWindow.RefreshFormulaInfo(sel);
          } else {
            sel.dispatchEvent(new Event('change'));
          }
        } catch (e) { /* ignore */ }
      }
    }
    if (catSel && origCatIndex >= 0) {
      catSel.selectedIndex = origCatIndex;
    }

    var result = Object.values(funcMap);
    console.log('[QB FN AC] Collected ' + result.length + ' unique functions');
    return result;
  }

  function createDropdown() {
    var el = document.createElement('div');
    el.id = 'qb-fn-dropdown';
    document.body.appendChild(el);
    return el;
  }

  function highlightMatch(text, query) {
    if (!query) return escapeHtml(text);
    var lower = text.toLowerCase();
    var idx = lower.indexOf(query.toLowerCase());
    if (idx === -1) return escapeHtml(text);
    var before = text.slice(0, idx);
    var match = text.slice(idx, idx + query.length);
    var after = text.slice(idx + query.length);
    return escapeHtml(before) + '<mark>' + escapeHtml(match) + '</mark>' + escapeHtml(after);
  }

  function render(query) {
    var q = (query || '').toLowerCase();
    filtered = functions.filter(function (f) {
      return f.name.toLowerCase().includes(q);
    });
    activeIndex = 0;

    if (filtered.length === 0) {
      dropdown.innerHTML = '<div class="qb-fn-empty">No matching functions</div>';
    } else {
      dropdown.innerHTML = filtered.map(function (f, i) {
        var first = f.overloads[0] || {};
        var paramsText = first.params ? '(' + escapeHtml(first.params) + ')' : '()';
        var badge = f.overloads.length > 1
          ? '<span class="qb-fn-item-badge">+' + (f.overloads.length - 1) + '</span>'
          : '';
        var title = first.description ? escapeHtml(first.description) : '';
        return '<div class="qb-fn-item' + (i === 0 ? ' qb-fn-active' : '') + '" data-index="' + i + '" title="' + title + '">'
          + '<span class="qb-fn-item-name">' + highlightMatch(f.name, query) + '</span>'
          + '<span class="qb-fn-item-params">' + paramsText + '</span>'
          + badge
          + '</div>';
      }).join('')
        + '<div class="qb-fn-hint">'
        + '<span><kbd>↑↓</kbd> navigate</span>'
        + '<span><kbd>Tab</kbd>/<kbd>Enter</kbd> insert</span>'
        + '<span><kbd>Esc</kbd> close</span>'
        + '</div>';
    }

    dropdown.querySelectorAll('.qb-fn-item').forEach(function (el) {
      el.addEventListener('mousedown', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var idx = parseInt(el.dataset.index, 10);
        insertFunction(filtered[idx]);
      });
    });
  }

  function positionDropdown() {
    if (!aceEditor || !wordStart) return;

    var renderer = aceEditor.renderer;
    var pos = renderer.textToScreenCoordinates(wordStart.row, wordStart.column);
    var lineHeight = renderer.lineHeight || 17;
    var top = pos.pageY + lineHeight + 2;
    var left = pos.pageX;

    var vh = window.innerHeight;
    var ddHeight = Math.min(dropdown.scrollHeight || 320, 320);
    if (top + ddHeight > vh) {
      top = pos.pageY - ddHeight - 2;
    }

    dropdown.style.top = top + 'px';
    dropdown.style.left = left + 'px';
  }

  function open(query) {
    if (!dropdown) dropdown = createDropdown();
    render(query || '');
    dropdown.style.display = 'block';
    positionDropdown();
    isOpen = true;
  }

  function close() {
    if (dropdown) dropdown.style.display = 'none';
    isOpen = false;
    wordStart = null;
    filtered = [];
    activeIndex = 0;
  }

  function getWordBeforeCursor() {
    if (!aceEditor) return { word: '', start: 0, row: 0 };
    var cursor = aceEditor.getCursorPosition();
    var line = aceEditor.session.getLine(cursor.row);
    var col = cursor.column;
    var start = col;
    while (start > 0 && /[A-Za-z0-9_]/.test(line.charAt(start - 1))) start--;
    return { word: line.slice(start, col), start: start, row: cursor.row };
  }

  function insertFunction(func) {
    if (!aceEditor || !wordStart || !func) return;

    inserting = true;
    isOpen = false;

    try {
      var cursor = aceEditor.getCursorPosition();
      var line = aceEditor.session.getLine(cursor.row);
      // Extend selection to end of current word (handles mid-word trigger)
      var end = cursor.column;
      while (end < line.length && /\w/.test(line.charAt(end))) end++;

      aceEditor.selection.setRange({
        start: { row: wordStart.row, column: wordStart.column },
        end: { row: wordStart.row, column: end }
      });
      aceEditor.insert(func.name + '(');
    } catch (err) {
      console.error('[QB FN AC] Insert error:', err);
    }

    close();
    inserting = false;
    aceEditor.focus();
  }

  function setActiveIndex(idx) {
    var items = dropdown.querySelectorAll('.qb-fn-item');
    items.forEach(function (el) { el.classList.remove('qb-fn-active'); });
    activeIndex = Math.max(0, Math.min(idx, filtered.length - 1));
    var active = items[activeIndex];
    if (active) {
      active.classList.add('qb-fn-active');
      active.scrollIntoView({ block: 'nearest' });
    }
  }

  function triggerAutocomplete() {
    if (!aceEditor) return;

    if (!functions) {
      functions = collectFunctions();
      if (!functions || functions.length === 0) {
        functions = null;
        console.warn('[QB FN AC] No functions found — is the formula functions dialog in the DOM?');
        return;
      }
    }

    var info = getWordBeforeCursor();
    wordStart = { row: info.row, column: info.start };
    open(info.word);
  }

  function attach(editor) {
    aceEditor = editor;

    var textInput = editor.textInput.getElement();

    textInput.addEventListener('keydown', function (e) {
      // Ctrl+Space to trigger
      if (e.key === ' ' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        triggerAutocomplete();
        return;
      }

      if (!isOpen) return;

      if (e.key === 'Enter' || e.key === 'Tab') {
        if (filtered.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          insertFunction(filtered[activeIndex]);
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        close();
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setActiveIndex(activeIndex - 1);
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setActiveIndex(activeIndex + 1);
        return;
      }
    }, true);

    editor.on('change', function () {
      if (!isOpen || inserting) return;

      var cursor = aceEditor.getCursorPosition();
      if (cursor.row !== wordStart.row || cursor.column < wordStart.column) {
        close();
        return;
      }

      var line = aceEditor.session.getLine(cursor.row);
      var query = line.slice(wordStart.column, cursor.column);

      // Close if query contains non-word characters
      if (query && !/^\w*$/.test(query)) {
        close();
        return;
      }

      render(query);
      positionDropdown();
    });

    editor.on('blur', function () {
      setTimeout(function () {
        if (isOpen && !inserting) close();
      }, 250);
    });

    editor.session.on('changeScrollTop', function () {
      if (isOpen) close();
    });

    console.log('[QB FN AC] Attached to Ace Editor');
  }

  function tryAttach() {
    var container = document.getElementById('fexpr_aceEditor');
    if (!container) return false;

    var editor = container.env && container.env.editor;
    if (!editor) return false;

    if (container.dataset.qbFnAcAttached) return true;
    container.dataset.qbFnAcAttached = '1';

    attach(editor);
    return true;
  }

  if (tryAttach()) return;

  var attempts = 0;
  var poll = setInterval(function () {
    if (tryAttach() || ++attempts > 80) clearInterval(poll);
  }, 300);

  var observer = new MutationObserver(function () {
    if (!document.querySelector('[data-qb-fn-ac-attached]') && document.getElementById('fexpr_aceEditor')) {
      tryAttach();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
