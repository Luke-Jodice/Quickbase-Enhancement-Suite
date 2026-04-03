// ==UserScript==
// @name         Quickbase Formula — Field Autocomplete
// @namespace    https://quickbase.com/userscripts
// @version      4.0
// @description  Autocomplete [FieldName] markers in the Quickbase formula editor (Ctrl+[ to trigger)
// @match        https://*.quickbase.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  GM_addStyle(`
    #qb-ac-dropdown {
      position: absolute;
      z-index: 99999;
      background: #fff;
      border: 1px solid #ddd;
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.06);
      max-height: 260px;
      overflow-y: auto;
      min-width: 220px;
      max-width: 400px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      padding: 4px 0;
      display: none;
      scrollbar-width: thin;
    }
    #qb-ac-dropdown::-webkit-scrollbar { width: 5px; }
    #qb-ac-dropdown::-webkit-scrollbar-thumb {
      background: #ccc; border-radius: 3px;
    }
    .qb-ac-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 12px;
      cursor: pointer;
      gap: 12px;
      transition: background 100ms ease;
    }
    .qb-ac-item:hover,
    .qb-ac-item.qb-ac-active {
      background: #f0f4f8;
    }
    .qb-ac-item-name {
      color: #1a1d21;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .qb-ac-item-name mark {
      background: #fff3b0;
      color: inherit;
      border-radius: 2px;
      padding: 0 1px;
    }
    .qb-ac-item-type {
      font-size: 10px;
      color: #8b95a3;
      white-space: nowrap;
      flex-shrink: 0;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .qb-ac-empty {
      padding: 10px 14px;
      color: #8b95a3;
      font-style: italic;
      text-align: center;
    }
    .qb-ac-hint {
      padding: 4px 12px 6px;
      font-size: 10px;
      color: #aab2bd;
      border-top: 1px solid #f0f0f0;
      margin-top: 2px;
      display: flex;
      gap: 10px;
      justify-content: center;
    }
    .qb-ac-hint kbd {
      background: #f0f2f4;
      border: 1px solid #ddd;
      border-radius: 3px;
      padding: 0 4px;
      font-size: 10px;
      font-family: inherit;
    }
  `);

  var dropdown = null;
  var fields = [];
  var filtered = [];
  var activeIndex = 0;
  var bracketStart = null;
  var bracketEnd = null;
  var isOpen = false;
  var aceEditor = null;
  var inserting = false;

  function collectFields() {
    var sel = document.getElementById('formulaHelper');
    if (!sel) return [];
    var result = [];
    for (var i = 0; i < sel.options.length; i++) {
      var opt = sel.options[i];
      if (opt.disabled || opt.value === 'Select a function...') continue;
      var val = opt.value.trim();
      if (val.charAt(0) !== '[') continue;
      result.push({
        name: opt.textContent.trim(),
        value: val,
        type: opt.getAttribute('data-field-type') || '',
      });
    }
    return result;
  }

  function createDropdown() {
    var el = document.createElement('div');
    el.id = 'qb-ac-dropdown';
    document.body.appendChild(el);
    return el;
  }

  function highlightMatch(text, query) {
    if (!query) return text;
    var idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    var before = text.slice(0, idx);
    var match = text.slice(idx, idx + query.length);
    var after = text.slice(idx + query.length);
    return before + '<mark>' + match + '</mark>' + after;
  }

  function render(query) {
    var q = (query || '').toLowerCase();
    filtered = fields.filter(function (f) { return f.name.toLowerCase().includes(q); });
    activeIndex = 0;

    if (filtered.length === 0) {
      dropdown.innerHTML = '<div class="qb-ac-empty">No matching fields</div>';
    } else {
      dropdown.innerHTML = filtered.map(function (f, i) {
        return '<div class="qb-ac-item' + (i === 0 ? ' qb-ac-active' : '') + '" data-index="' + i + '">'
          + '<span class="qb-ac-item-name">' + highlightMatch(f.name, query) + '</span>'
          + '<span class="qb-ac-item-type">' + f.type + '</span>'
          + '</div>';
      }).join('')
        + '<div class="qb-ac-hint">'
        + '<span><kbd>↑↓</kbd> navigate</span>'
        + '<span><kbd>Tab</kbd>/<kbd>Enter</kbd> insert</span>'
        + '<span><kbd>Esc</kbd> close</span>'
        + '</div>';
    }

    dropdown.querySelectorAll('.qb-ac-item').forEach(function (el) {
      el.addEventListener('mousedown', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var idx = parseInt(el.dataset.index, 10);
        insertField(filtered[idx]);
      });
    });
  }

  function positionDropdown() {
    if (!aceEditor || !bracketStart) return;

    var renderer = aceEditor.renderer;
    var pos = renderer.textToScreenCoordinates(bracketStart.row, bracketStart.column);
    var lineHeight = renderer.lineHeight || 17;
    var top = pos.pageY + lineHeight + 2;
    var left = pos.pageX;

    var vh = window.innerHeight;
    var ddHeight = Math.min(dropdown.scrollHeight || 280, 280);
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
    bracketStart = null;
    bracketEnd = null;
    filtered = [];
    activeIndex = 0;
  }

  function findBrackets() {
    if (!aceEditor) return null;

    var cursor = aceEditor.getCursorPosition();
    var line = aceEditor.session.getLine(cursor.row);

    var openIdx = -1;
    for (var i = cursor.column - 1; i >= 0; i--) {
      if (line.charAt(i) === '[') { openIdx = i; break; }
      if (line.charAt(i) === ']') break;
    }
    if (openIdx === -1) return null;

    var closeIdx = -1;
    for (var j = cursor.column; j < line.length; j++) {
      if (line.charAt(j) === ']') { closeIdx = j; break; }
      if (line.charAt(j) === '[') break;
    }
    if (closeIdx === -1) return null;

    var query = line.slice(openIdx + 1, cursor.column);

    return {
      open: { row: cursor.row, column: openIdx },
      close: { row: cursor.row, column: closeIdx },
      query: query
    };
  }

  function insertField(field) {
    if (!aceEditor || !bracketStart || !bracketEnd || !field) {
      console.warn('[QB AC] insertField guard failed:', {
        editor: !!aceEditor,
        start: bracketStart,
        end: bracketEnd,
        field: field
      });
      return;
    }

    inserting = true;
    isOpen = false;

    try {
      aceEditor.selection.setRange({
        start: { row: bracketStart.row, column: bracketStart.column },
        end: { row: bracketEnd.row, column: bracketEnd.column + 1 }
      });
      aceEditor.insert(field.value);
    } catch (err) {
      console.error('[QB AC] Insert error:', err);
    }

    close();
    inserting = false;
    aceEditor.focus();
  }

  function setActiveIndex(idx) {
    var items = dropdown.querySelectorAll('.qb-ac-item');
    items.forEach(function (el) { el.classList.remove('qb-ac-active'); });
    activeIndex = Math.max(0, Math.min(idx, filtered.length - 1));
    var active = items[activeIndex];
    if (active) {
      active.classList.add('qb-ac-active');
      active.scrollIntoView({ block: 'nearest' });
    }
  }

  function getQueryText() {
    if (!aceEditor || !bracketStart) return null;
    var cursor = aceEditor.getCursorPosition();
    if (cursor.row !== bracketStart.row) return null;
    if (cursor.column <= bracketStart.column) return null;

    var line = aceEditor.session.getLine(cursor.row);
    return line.slice(bracketStart.column + 1, cursor.column);
  }

  function triggerAutocomplete() {
    if (!aceEditor) return;

    fields = collectFields();
    if (fields.length === 0) return;

    var brackets = findBrackets();

    if (brackets) {
      bracketStart = brackets.open;
      bracketEnd = brackets.close;
      open(brackets.query);
    } else {
      var cursor = aceEditor.getCursorPosition();
      aceEditor.insert('[]');
      aceEditor.moveCursorToPosition({ row: cursor.row, column: cursor.column + 1 });
      aceEditor.clearSelection();

      bracketStart = { row: cursor.row, column: cursor.column };
      bracketEnd = { row: cursor.row, column: cursor.column + 1 };
      open('');
    }
  }

  function attach(editor) {
    aceEditor = editor;

    var textInput = editor.textInput.getElement();

    textInput.addEventListener('keydown', function (e) {
      if (e.key === '[' && (e.ctrlKey || e.metaKey)) {
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
          insertField(filtered[activeIndex]);
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

      var q = getQueryText();
      if (q === null) {
        close();
        return;
      }

      var line = aceEditor.session.getLine(bracketStart.row);
      var closeIdx = -1;
      for (var j = aceEditor.getCursorPosition().column; j < line.length; j++) {
        if (line.charAt(j) === ']') { closeIdx = j; break; }
        if (line.charAt(j) === '[') break;
      }

      if (closeIdx === -1) {
        close();
        return;
      }

      bracketEnd = { row: bracketStart.row, column: closeIdx };
      render(q);
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

    console.log('[QB AC] Attached to Ace Editor');
  }

  function tryAttach() {
    var container = document.getElementById('fexpr_aceEditor');
    if (!container) return false;

    var editor = container.env && container.env.editor;
    if (!editor) return false;

    if (container.dataset.qbAcAttached) return true;
    container.dataset.qbAcAttached = '1';

    attach(editor);
    return true;
  }

  if (tryAttach()) return;

  var attempts = 0;
  var poll = setInterval(function () {
    if (tryAttach() || ++attempts > 80) clearInterval(poll);
  }, 300);

  var observer = new MutationObserver(function () {
    if (!document.querySelector('[data-qb-ac-attached]') && document.getElementById('fexpr_aceEditor')) {
      tryAttach();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();