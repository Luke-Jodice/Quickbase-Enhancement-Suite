// ==UserScript==
// @name         QB LSP Lite — Code Pages Schema & Snippets
// @namespace    https://quickbase.com/userscripts
// @version      5.0
// @description  Zero-dependency native Autocomplete for Schema (Tables/Fields) and JS Snippets, powered by REST API.
// @match        https://*.quickbase.com/*
// @grant        GM_addStyle
// ==/UserScript==

(function () {
  'use strict';

  GM_addStyle(`
    #qb-ac-dropdown {
      position: absolute; z-index: 99999;
      background: #fff; border: 1px solid #ddd; border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.06);
      max-height: 260px; overflow-y: auto; min-width: 280px; max-width: 450px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px; padding: 4px 0; display: none; scrollbar-width: thin;
    }
    #qb-ac-dropdown::-webkit-scrollbar { width: 5px; }
    #qb-ac-dropdown::-webkit-scrollbar-thumb { background: #ccc; border-radius: 3px; }
    
    .qb-ac-item { display: flex; align-items: center; justify-content: space-between; padding: 6px 14px; cursor: pointer; gap: 12px; }
    .qb-ac-item:hover, .qb-ac-item.qb-ac-active { background: #f0f4f8; }
    .qb-ac-item-name { color: #1a1d21; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-grow: 1; }
    .qb-ac-item-name mark { background: #fff3b0; color: inherit; border-radius: 2px; padding: 0 1px; }
    .qb-ac-item-type { font-size: 10px; color: #8b95a3; white-space: nowrap; flex-shrink: 0; text-transform: uppercase; font-family: monospace; }
    
    .qb-type-table { color: #2d7a2d; }
    .qb-type-field { color: #a05a00; }
    .qb-type-snippet { color: #6b35a8; font-weight: bold; }
    
    .qb-ac-hint { padding: 6px 12px; font-size: 10px; color: #aab2bd; border-top: 1px solid #f0f0f0; margin-top: 4px; display: flex; gap: 10px; justify-content: center; }
    .qb-ac-hint kbd { background: #f0f2f4; border: 1px solid #ddd; border-radius: 3px; padding: 0 4px; font-size: 10px; }
  `);

  function escapeHtml(str) { return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // ── State & Context ────────────────────────────────────────────────────────
  let state = {
    appId: null,
    tableId: null,
    tables: [],
    fields: {},
    fetchedTables: false,
    schemaItems: [] // merged array for dropdown
  };

  var dropdown = null;
  var isOpen = false;
  var filtered = [];
  var activeIndex = 0;
  var currentQuery = '';

  const JS_SNIPPETS = [
    { name: 'qbQueryRecords', value: `fetch('https://\${location.hostname}/api/v1/records/query', {\\n  method: 'POST',\\n  headers: { 'QB-Realm-Hostname': location.hostname, 'Content-Type': 'application/json' },\\n  credentials: 'include',\\n  body: JSON.stringify({ from: 'TABLE_ID', where: '{3.EX.\\\\'value\\\\'}', select: [3, 6] })\\n}).then(r => r.json()).then(data => console.log(data));`, type: 'Snippet' },
    { name: 'qbUpsertRecords', value: `fetch('https://\${location.hostname}/api/v1/records', {\\n  method: 'POST',\\n  headers: { 'QB-Realm-Hostname': location.hostname, 'Content-Type': 'application/json' },\\n  credentials: 'include',\\n  body: JSON.stringify({ to: 'TABLE_ID', data: [{ '6': { value: 'VALUE' } }] })\\n}).then(r => r.json());`, type: 'Snippet' },
    { name: 'qbDeleteRecords', value: `fetch('https://\${location.hostname}/api/v1/records', {\\n  method: 'DELETE',\\n  headers: { 'QB-Realm-Hostname': location.hostname, 'Content-Type': 'application/json' },\\n  credentials: 'include',\\n  body: JSON.stringify({ from: 'TABLE_ID', where: '{3.EX.\\\\'value\\\\'}' })\\n}).then(r => r.json());`, type: 'Snippet' },
    { name: 'qbGetCurrentDbid', value: `new URLSearchParams(window.location.search).get('dbid')`, type: 'Snippet' },
    { name: 'qbGetCurrentAppId', value: `window?.QB?.config?.appId || new URLSearchParams(window.location.search).get('appid')`, type: 'Snippet' },
    { name: 'qbLoadScript', value: `(function(){\\n  var s = document.createElement('script');\\n  s.src = '/db/TABLE_ID?a=dbpage&pageID=PAGE_ID';\\n  document.head.appendChild(s);\\n})();`, type: 'Snippet' }
  ];

  const HTML_SNIPPETS = [
    { name: 'qbScriptTag', value: `<script src="/db/TABLE_ID?a=dbpage&pageID=1"></script>`, type: 'Snippet' },
    { name: 'qbWidgetDiv', value: `<div id="qb-widget" data-dbid="TABLE_ID" data-appid="APP_ID" class="qb-widget"></div>`, type: 'Snippet' },
    { name: 'qbStylesheet', value: `<link rel="stylesheet" href="/db/TABLE_ID?a=dbpage&pageID=PAGE_ID">`, type: 'Snippet' }
  ];

  // ── Data Fetching ───────────────────────────────────────────────────────
  function extractQBContext() {
    state.appId = window?.QB?.config?.appId;
    state.tableId = window?.QB?.config?.tableId || window?.DBID;

    // Safe regex extraction for both legacy /db/ DBIDs and modern Huey /nav/app/ DBIDs
    var urlAppRegex = location.pathname.match(/\/(?:db|app)\/([^/?]+)/);
    if (urlAppRegex && urlAppRegex[1] !== 'main') {
      if (!state.appId) state.appId = urlAppRegex[1];
    }

    var urlTableRegex = location.search.match(/[?&](?:tableid|dbid)=([^&]+)/i);
    if (urlTableRegex) {
      if (!state.tableId) state.tableId = urlTableRegex[1];
    }
  }

  function rebuildSchemaItems() {
    let items = [];
    
    state.tables.forEach(t => {
      items.push({ name: t.name, value: t.id, type: 'Table ID', css: 'qb-type-table' });
    });

    if (state.tableId && state.fields[state.tableId]) {
      state.fields[state.tableId].forEach(f => {
        items.push({ name: f.label, value: String(f.id), type: 'Field ID', css: 'qb-type-field' });
      });
    }

    var pagename = document.getElementById('pagename');
    var isHtml = pagename && pagename.value.endsWith('.html');
    var snips = isHtml ? HTML_SNIPPETS : JS_SNIPPETS;
    snips.forEach(s => {
       items.push({ name: s.name, value: s.value, type: 'Snippet', css: 'qb-type-snippet' });
    });

    state.schemaItems = items;
  }

  async function loadQBMeta() {
    extractQBContext();
    if (!state.appId || state.fetchedTables) return;
    
    // Quickbase REST API strictly enforces Token validation on metadata endpoints and blocks cookies. 
    // We gracefully fall back to the native XML API which properly honors your active session cookie.
    try {
      const res = await fetch('/db/' + state.appId + '?a=API_GetSchema');
      const xml = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, "text/xml");

      // Extract Tables
      const tableNodes = doc.querySelectorAll('chdbids chdbid');
      const tables = [];
      tableNodes.forEach(node => {
         const tName = node.getAttribute('name');
         if (tName) tables.push({ id: node.textContent, name: tName });
      });
      state.tables = tables;
      state.fetchedTables = true;

      // Extract Fields for the active table (if we are in a table context)
      if (state.tableId) {
         state.fields[state.tableId] = [];
         
         // API_GetSchema returns all fields for the app. We can extract just the table's fields if needed, 
         // but wait - API_GetSchema on the APP DBID only returns app-level info and children DBIDs.
         // To get Fields for a SPECIFIC table, we must hit the Table DBID natively!
      }
    } catch (e) {
       console.error('[QB LSP Lite] Error fetching schema via XML', e);
    }

    // Secondary fetch for actual fields of the active table context natively
    if (state.tableId && !state.fields[state.tableId]) {
       try {
         const fRes = await fetch('/db/' + state.tableId + '?a=API_GetSchema');
         const fXml = await fRes.text();
         const fDoc = new DOMParser().parseFromString(fXml, "text/xml");
         
         const fields = [];
         fDoc.querySelectorAll('fields field').forEach(node => {
            const fid = node.getAttribute('id');
            const ftype = node.getAttribute('field_type');
            const labelNode = node.querySelector('label');
            if (fid && labelNode) fields.push({ id: fid, label: labelNode.textContent, type: ftype });
         });
         state.fields[state.tableId] = fields;
       } catch (e) {
          console.error('[QB LSP Lite] Error fetching table fields via XML', e);
       }
    }

    rebuildSchemaItems();
  }

  // ── Coordinates Engine ───────────────────────────────────────────────────
  function getCaretCoordinates(ta, position) {
    var div = document.createElement('div');
    var style = div.style;
    var computed = window.getComputedStyle(ta);

    style.whiteSpace = 'pre-wrap'; style.wordWrap = 'break-word';
    style.position = 'absolute'; style.visibility = 'hidden';

    var props = ['direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontSizeAdjust', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing', 'tabSize', 'MozTabSize'];
    props.forEach(function(p) { style[p] = computed[p]; });

    div.textContent = ta.value.substring(0, position);
    var span = document.createElement('span');
    span.textContent = ta.value.substring(position) || '.'; 
    div.appendChild(span);
    document.body.appendChild(div);

    var taRect = ta.getBoundingClientRect();
    var coords = {
      top: span.offsetTop + parseInt(computed['borderTopWidth']),
      left: span.offsetLeft + parseInt(computed['borderLeftWidth']),
      height: parseInt(computed['lineHeight'] || 16)
    };
    document.body.removeChild(div);
    
    return {
      top: taRect.top + window.scrollY - ta.scrollTop + coords.top,
      left: taRect.left + window.scrollX - ta.scrollLeft + coords.left,
      height: coords.height
    };
  }

  // ── Dropdown Engine ──────────────────────────────────────────────────────
  function highlightMatch(text, query) {
    if (!query) return escapeHtml(text);
    var idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escapeHtml(text);
    return escapeHtml(text.slice(0, idx)) + '<mark>' + escapeHtml(text.slice(idx, idx + query.length)) + '</mark>' + escapeHtml(text.slice(idx + query.length));
  }

  function renderDropdown(query) {
    if (!dropdown) {
      dropdown = document.createElement('div'); dropdown.id = 'qb-ac-dropdown'; document.body.appendChild(dropdown);
    }

    var q = (query || '').toLowerCase();
    filtered = state.schemaItems.filter(function(s) { 
      return s.name.toLowerCase().includes(q) || s.value.toLowerCase().includes(q); 
    });
    
    activeIndex = Math.max(0, Math.min(activeIndex, filtered.length - 1));

    if (filtered.length === 0) {
      dropdown.innerHTML = '<div style="padding:10px; text-align:center; color:#888; font-style:italic;">No matching schema items</div>';
    } else {
      dropdown.innerHTML = filtered.map(function(s, i) {
        var activeClass = (i === activeIndex) ? ' qb-ac-active' : '';
        return '<div class="qb-ac-item' + activeClass + '" data-index="' + i + '">'
             + '<span class="qb-ac-item-name">' + highlightMatch(s.name, query) + '</span>'
             + '<span class="qb-ac-item-type ' + s.css + '">' + escapeHtml(s.type) + '</span>'
             + '</div>';
      }).join('')
      + '<div class="qb-ac-hint"><span><kbd>↑↓</kbd> navigate</span><span><kbd>Tab</kbd>/<kbd>Enter</kbd> insert</span><span><kbd>Esc</kbd> close</span></div>';
    }

    dropdown.querySelectorAll('.qb-ac-item').forEach(function(el) {
      el.addEventListener('mousedown', function(e) {
        e.preventDefault(); e.stopPropagation();
        insertSelection(filtered[Math.max(0, parseInt(el.dataset.index, 10))]);
      });
    });
  }

  function positionDropdown(ta) {
    var coords = getCaretCoordinates(ta, ta.selectionEnd);
    var vTop = coords.top + coords.height + 4;
    var vLeft = coords.left;

    dropdown.style.display = 'block';
    if (vTop + 260 > window.scrollY + window.innerHeight) { vTop = coords.top - 264; }
    dropdown.style.top = vTop + 'px'; dropdown.style.left = vLeft + 'px';
  }

  function openDropdown(query) {
    isOpen = true;
    currentQuery = query || '';
    renderDropdown(currentQuery);
    var ta = document.getElementById('pagetext');
    if (ta) positionDropdown(ta);
  }

  function closeDropdown() {
    isOpen = false; currentQuery = ''; activeIndex = 0;
    if (dropdown) dropdown.style.display = 'none';
  }

  var activeEngine = 'textarea';
  var codeMirrorInstance = null;

  function insertSelection(item) {
    if (!item) return;

    var insertString = item.type === 'Table ID' ? ('"' + item.value + '"') : item.value; 

    if (activeEngine === 'codemirror' && codeMirrorInstance) {
       var cursor = codeMirrorInstance.getCursor();
       var realStart = cursor.ch - currentQuery.length;
       codeMirrorInstance.replaceRange(insertString, {line: cursor.line, ch: realStart}, {line: cursor.line, ch: cursor.ch});
       codeMirrorInstance.focus();
    } else {
       var ta = document.getElementById('pagetext');
       if (!ta) return;
       var realStart = ta.selectionStart - currentQuery.length;
       var end = ta.selectionEnd;
       ta.value = ta.value.substring(0, realStart) + insertString + ta.value.substring(end);
       ta.selectionStart = ta.selectionEnd = realStart + insertString.length;
       ta.focus();
    }
    
    closeDropdown();
  }

  // ── Hooking & Events ─────────────────────────────────────────────────────
  function attachToEditor() {
    var cmNode = document.querySelector('.CodeMirror');
    if (cmNode && cmNode.CodeMirror) {
       if (cmNode.dataset.qbAcBound) return;
       cmNode.dataset.qbAcBound = '1';
       activeEngine = 'codemirror';
       codeMirrorInstance = cmNode.CodeMirror;

       codeMirrorInstance.on('keydown', function(cm, e) {
          if ((e.code === 'Space' || e.keyCode === 32 || e.key === ' ') && (e.ctrlKey || e.metaKey)) {
             e.preventDefault(); openDropdown(''); return;
          }
          if (!isOpen) return;
          if (e.key === 'Escape') { e.preventDefault(); closeDropdown(); return; }
          if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, filtered.length - 1); renderDropdown(currentQuery); return; }
          if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); renderDropdown(currentQuery); return; }
          if (e.key === 'Enter' || e.key === 'Tab') {
             if (filtered.length > 0) { e.preventDefault(); insertSelection(filtered[activeIndex]); }
             return;
          }
       });

       codeMirrorInstance.on('keyup', function(cm, e) {
          if (!isOpen) { 
             var cursor = cm.getCursor();
             var line = cm.getLine(cursor.line);
             var preVal = line.substring(0, cursor.ch);
             if (/(?:dbid|appdbid|tableid|appid)\s*[:=]\s*["']?$/i.test(preVal) || /fid\s*[:=]\s*["']?$/i.test(preVal) || /(?:qb)$/i.test(preVal)) {
                openDropdown('');
             }
             return;
          }
          var ignoreKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab', 'Escape', 'Control', 'Shift', 'Alt', 'Meta'];
          if (ignoreKeys.includes(e.key)) return;

          var cursor = cm.getCursor();
          var line = cm.getLine(cursor.line);
          var preVal = line.substring(0, cursor.ch);
          var match = preVal.match(/([\w\d]+)$/);
          currentQuery = match ? match[1] : '';
          
          activeIndex = 0; 
          renderDropdown(currentQuery);
          
          var rawCoords = codeMirrorInstance.cursorCoords(true, 'window');
          var vTop = window.scrollY + rawCoords.bottom + 4;
          dropdown.style.display = 'block';
          if (vTop + 260 > window.scrollY + window.innerHeight) { vTop = window.scrollY + rawCoords.top - 264; }
          dropdown.style.top = vTop + 'px';
          dropdown.style.left = rawCoords.left + 'px';
       });

       codeMirrorInstance.on('blur', function() { setTimeout(closeDropdown, 300); });
       console.log('[QB LSP Lite] Attached natively to Quickbase CodeMirror overlay.');
       return;
    }

    var ta = document.getElementById('pagetext');
    if (!ta || ta.dataset.qbAcBound) return;
    
    if (window.getComputedStyle(ta).display === 'none') return;
    
    ta.dataset.qbAcBound = '1';
    activeEngine = 'textarea';

    ta.addEventListener('keydown', function(e) {
      if ((e.code === 'Space' || e.keyCode === 32 || e.key === ' ') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault(); e.stopImmediatePropagation(); openDropdown(''); return;
      }
      if (!isOpen) return;

      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeDropdown(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); activeIndex = Math.min(activeIndex + 1, filtered.length - 1); renderDropdown(currentQuery); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); activeIndex = Math.max(activeIndex - 1, 0); renderDropdown(currentQuery); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (filtered.length > 0) { e.preventDefault(); e.stopImmediatePropagation(); insertSelection(filtered[activeIndex]); }
        return;
      }
    }, true);

    ta.addEventListener('keyup', function(e) {
      if (!isOpen) { 
         var preVal = ta.value.substring(0, ta.selectionEnd);
         // Regex pattern checks for typing 'dbid:', 'fid=', or 'qb' 
         if (/(?:dbid|appdbid|tableid|appid)\s*[:=]\s*["']?$/i.test(preVal) || /fid\s*[:=]\s*["']?$/i.test(preVal) || /(?:qb)$/i.test(preVal)) {
            openDropdown('');
         }
         return;
      }
      var ignoreKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab', 'Escape', 'Control', 'Shift', 'Alt', 'Meta'];
      if (ignoreKeys.includes(e.key)) return;

      var start = ta.selectionEnd;
      var textBefore = ta.value.substring(0, start);
      var match = textBefore.match(/([\w\d]+)$/);
      currentQuery = match ? match[1] : '';
      
      activeIndex = 0; 
      renderDropdown(currentQuery);
      positionDropdown(ta);
    }, true);

    ta.addEventListener('blur', function() { setTimeout(closeDropdown, 300); });
    console.log('[QB LSP Lite] Attached floating Snippet & Schema autocomplete natively.');
  }

  // ── Init Pipeline ────────────────────────────────────────────────────────
  function isCodePageEditor() {
    return document.getElementById('pagetext') !== null;
  }

  function init() {
    if (isCodePageEditor()) {
      loadQBMeta();
      attachToEditor();
    }
  }

  var observer = new MutationObserver(function() { init(); });
  observer.observe(document.body, { childList: true, subtree: true });
  
  // Clean boot check removing Angular requirements
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
     init();
  } else {
     document.addEventListener('DOMContentLoaded', init);
  }

})();