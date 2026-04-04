// ==UserScript==
// @name         Quickbase — Report — Field Type Labels
// @namespace    https://quickbase.com/userscripts
// @version      1.10
// @description  Shows field type in italics under each column header in table reports; hovering a formula field shows a scrollable formula preview
// @match        https://*.quickbase.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const LABEL_CLASS  = 'qb-ftype-label';
  const POPUP_ID     = 'qb-ftype-popup';
  const DONE_ATTR    = 'data-qb-ft';   // stamped on each processed header

  // Type code → readable label
  const TYPE_LABELS = {
    TX:'Text',        RT:'Rich Text',   NM:'Numeric',     CR:'Currency',
    PC:'Percent',     DT:'Date',        TS:'Timestamp',   TM:'Time of Day',
    DU:'Duration',    CB:'Checkbox',    LK:'URL',         EM:'Email',
    PH:'Phone',       US:'User',        UL:'User List',   ML:'Multi-select',
    FL:'File',        RI:'Record ID',   LU:'Lookup',      SM:'Summary',
    FM:'Formula',     FV:'Formula',     AB:'Address',     ST:'State',
    ZP:'Zip',         CT:'City',        CO:'Country',     RN:'Report Link',
    BC:'Barcode',     SL:'Table Link',  MC:'Multi-choice',XD:'Cross-DB',
    IB:'iCalendar',   VL:'vCard',
  };

  // Field categories — drives colour + prefix
  // 'scalar'  : user-entered data fields
  // 'formula' : computed by a formula expression
  // 'lookup'  : value pulled from a related table
  // 'summary' : aggregate over related records
  // 'system'  : built-in QB system fields
  const FIELD_CATEGORY = {
    // scalar
    TX:'scalar', RT:'scalar', NM:'scalar', CR:'scalar', PC:'scalar',
    DT:'scalar', TS:'scalar', TM:'scalar', DU:'scalar', CB:'scalar',
    LK:'scalar', EM:'scalar', PH:'scalar', US:'scalar', UL:'scalar',
    ML:'scalar', FL:'scalar', AB:'scalar', ST:'scalar', ZP:'scalar',
    CT:'scalar', CO:'scalar', MC:'scalar', BC:'scalar', IB:'scalar', VL:'scalar',
    // formula
    FM:'formula', FV:'formula',
    // lookup / cross-table
    LU:'lookup', XD:'lookup', SL:'lookup', RN:'lookup',
    // summary / aggregate
    SM:'summary',
    // system
    RI:'system', AD:'system',
  };

  // Prefix shown before the type label for non-scalar categories
  // 'ƒ' (U+0192) is the conventional math function symbol
  const CATEGORY_PREFIX = {
    formula: 'ƒ ',
    lookup:  '⇠ ',   // arrow indicating value comes from elsewhere
    summary: 'Σ ',   // sigma for aggregate
    system:  '',
    scalar:  '',
  };

  // ── Styles ───────────────────────────────────────────────────────────────
  GM_addStyle(`
    /* Base label */
    .${LABEL_CLASS} {
      display: block;
      font-style: italic;
      font-size: 10px;
      font-weight: 400;
      line-height: 1.3;
      margin-top: 1px;
      white-space: nowrap;
      pointer-events: none;
      /* default = scalar: neutral grey */
      color: #8b95a3;
    }

    /* Formula — purple, hoverable to show formula text */
    .${LABEL_CLASS}.is-formula {
      color: #5b2f91;
      pointer-events: auto;
      text-decoration: underline dotted;
    }

    /* Lookup — teal/cyan: value originates from another table */
    .${LABEL_CLASS}.is-lookup {
      color: #1a7f6e;
    }

    /* Summary — amber: aggregate over child records */
    .${LABEL_CLASS}.is-summary {
      color: #9a6200;
    }

    /* System fields — light grey, de-emphasised */
    .${LABEL_CLASS}.is-system {
      color: #b0b8c4;
      font-style: normal;
    }
    #${POPUP_ID} {
      position: fixed;
      z-index: 999999;
      background: #ffffff;
      color: #334155;
      border-radius: 8px;
      box-shadow: 0 6px 24px rgba(0,0,0,.15);
      font-family: "SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;
      font-size: 12px;
      line-height: 1.6;
      padding: 0;
      pointer-events: none;
      display: none;
      max-width: 420px;
      min-width: 180px;
      border: 1px solid #e2e8f0;
      overflow: hidden;
    }
    #${POPUP_ID} .fp-head {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 5px 10px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;
      font-family: system-ui, sans-serif; font-size: 10px; color: #64748b;
    }
    #${POPUP_ID} .fp-title { font-weight:600; color:#5b2f91; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #${POPUP_ID} .fp-badge { flex-shrink:0; font-size:9px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; background:#e2e8f0; color:#475569; border-radius:3px; padding:1px 5px; }
    #${POPUP_ID} .fp-body  { padding:8px 10px; max-height:200px; overflow:auto; white-space:pre; scrollbar-width:thin; scrollbar-color:#cbd5e1 #ffffff; }
    #${POPUP_ID} .fp-empty { font-family:system-ui,sans-serif; font-style:italic; color:#94a3b8; font-size:11px; white-space:normal; }
    #${POPUP_ID} .fp-trunc { font-family:system-ui,sans-serif; font-style:italic; color:#64748b; font-size:10px; white-space:normal; display:block; margin-top:8px; border-top:1px dashed #e2e8f0; padding-top:6px; }
    #${POPUP_ID} .fp-comment { font-style:italic; color:#94a3b8; }
  `);

  // ── Helpers ──────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function getFinfo() {
    try {
      if (typeof gTableInfo === 'undefined') return null;
      var m = location.pathname.match(/\/table\/([^/?#]+)/);
      if (!m) return null;
      var t = gTableInfo[m[1]];
      return (t && t.finfo) ? t.finfo : null;
    } catch(e) { return null; }
  }

  // Build lowercased-name → field lookup once per injection pass
  function makeNameMap(finfo) {
    var map = Object.create(null);
    var vals = Object.values(finfo);
    for (var i = 0; i < vals.length; i++) {
      var f = vals[i];
      if (f.name) map[f.name.trim().toLowerCase()] = f;
    }
    return map;
  }

  // ── Popup ────────────────────────────────────────────────────────────────
  var popup = null;
  var popTimer = null;

  function getPopup() {
    if (!popup || !popup.isConnected) {
      popup = document.createElement('div');
      popup.id = POPUP_ID;
      document.body.appendChild(popup);
    }
    return popup;
  }

  function placePopup(x, y) {
    var p = popup; if (!p) return;
    var pw = p.offsetWidth || 300, ph = p.offsetHeight || 140, off = 14;
    var left = x + off, top = y + off;
    if (left + pw > window.innerWidth  - 8) left = x - pw - off;
    if (top  + ph > window.innerHeight - 8) top  = y - ph - off;
    p.style.left = Math.max(8, left) + 'px';
    p.style.top  = Math.max(8, top)  + 'px';
  }

  function formatLine(line) {
    var inQuote = false;
    for (var i = 0; i < line.length; i++) {
      if (line[i] === '"') inQuote = !inQuote;
      // Find Quickbase comment initiator outside of string literals
      if (!inQuote && line[i] === '/' && line[i+1] === '/') {
         var codePart = esc(line.substring(0, i));
         var commentPart = esc(line.substring(i + 2)); // remove '//'
         return codePart + '<span class="fp-comment">' + commentPart + '</span>';
      }
    }
    return esc(line);
  }

  function showPopup(name, typeCode, formula, x, y) {
    var p = getPopup();
    var label = TYPE_LABELS[typeCode] || typeCode;
    
    var bodyHtml = '<span class="fp-empty">Formula text not available</span>';
    if (formula) {
      if (formula === 'Fetching formula...') {
        bodyHtml = '<span class="fp-empty">Fetching formula...</span>';
      } else {
        // Strip out lines that are entirely whitespace
        var lines = formula.split(/\r?\n/).filter(function(line) {
          return line.trim() !== '';
        });

        // Format up to 5 lines
        var limit = Math.min(lines.length, 5);
        var formatted = [];
        for (var l = 0; l < limit; l++) {
           formatted.push(formatLine(lines[l]));
        }

        if (lines.length > 5) {
          bodyHtml = formatted.join('\n') + 
                     '\n<span class="fp-trunc">... (Formula exceeds 5 lines. View field settings to read more.)</span>';
        } else {
          bodyHtml = formatted.join('\n');
        }
      }
    }

    p.innerHTML =
      '<div class="fp-head"><span class="fp-title">' + esc(name) + '</span>' +
      '<span class="fp-badge">' + esc(label) + '</span></div>' +
      '<div class="fp-body">' + bodyHtml + '</div>';
    
    p.style.display = 'block';
    placePopup(x, y);
  }

  function hidePopup() {
    clearTimeout(popTimer);
    if (popup) popup.style.display = 'none';
  }

  // ── Core injection ───────────────────────────────────────────────────────
  // Target: the wrapper divs Quickbase already annotates with data-tip="<FieldName>"
  // Selector is stable — data-for="AppShellTooltip" is present on every column label cell.
  var HEADER_SEL = '[data-for="AppShellTooltip"][data-tip]';

  function inject() {
    // Only run on table report pages
    if (!/\/table\/[^/?#]+/.test(location.pathname)) return false;

    var finfo = getFinfo();
    if (!finfo) return false;               // gTableInfo not ready yet

    var cells = document.querySelectorAll(HEADER_SEL);
    if (!cells.length) return false;        // Grid not rendered yet

    var nameMap = makeNameMap(finfo);
    var injected = 0;

    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      if (cell.getAttribute(DONE_ATTR)) continue;   // already processed

      // data-tip is the exact field name Quickbase uses
      var colName = (cell.getAttribute('data-tip') || '').trim();
      if (!colName) {
        cell.setAttribute(DONE_ATTR, '1');
        continue;
      }

      var field = nameMap[colName.toLowerCase()];
      if (!field) {
        // Not a user field (e.g. checkbox/action column) — skip
        cell.setAttribute(DONE_ATTR, '1');
        continue;
      }

      var typeCode  = field.type || '';
      var typeLabel = TYPE_LABELS[typeCode] || typeCode;
      if (!typeLabel) {
        cell.setAttribute(DONE_ATTR, '1');
        continue;
      }

      // A field is a formula if it has a formula expression OR its type is FM/FV.
      // Additionally, Quickbase hides the formula text on some views, but marks
      // the field with a 'virtual' flag (bit 4, e.g. flags = 34956 instead of 34952).
      // We check this flag to upgrade 'scalar' output types (like TX, NM) to formulas.
      var hasFormulaStr = !!(field.formula || field.formulatext || field.formulaText);
      var isVirtualFlag = !!(field.flags && (field.flags & 4));
      
      var category = FIELD_CATEGORY[typeCode] || 'scalar';
      if (hasFormulaStr || FIELD_CATEGORY[typeCode] === 'formula' || (isVirtualFlag && category === 'scalar')) {
        category = 'formula';
      }
      
      var prefix = CATEGORY_PREFIX[category] || '';

      var span = document.createElement('span');
      span.className = LABEL_CLASS + ' is-' + category;
      // For formula fields, show the output type name (e.g. "ƒ Text") not just "ƒ Formula"
      // so the column's data type is still visible alongside the formula indicator.
      var displayLabel = (category === 'formula' && FIELD_CATEGORY[typeCode] !== 'formula')
                           ? typeLabel          // e.g. "Text", "Numeric" — the output type
                           : typeLabel;         // "Formula" for FM/FV types
      span.textContent = prefix + displayLabel;
      span.setAttribute('data-ft', typeCode);
      span.setAttribute('data-fn', colName);
      span.setAttribute('data-cat', category);

      // Append inside the data-tip element so it appears under the field name
      cell.appendChild(span);
      cell.setAttribute(DONE_ATTR, '1');
      
      // Prevent Quickbase's native redundant tooltip from showing
      cell.removeAttribute('data-tip');
      
      injected++;
    }

    return injected > 0;
  }

  // ── Dynamic Schema API ───────────────────────────────────────────────────
  var formulaCache = {}; // dbid -> { fid: formula }
  var fetchPromises = {};

  function fetchFormulasForTable(dbid) {
    if (formulaCache[dbid]) return Promise.resolve(formulaCache[dbid]);
    if (fetchPromises[dbid]) return fetchPromises[dbid];

    var p = fetch('/db/' + dbid + '?a=API_GetSchema')
      .then(function(r) { return r.text(); })
      .then(function(xmlText) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(xmlText, "text/xml");
        var fields = doc.querySelectorAll('field');
        var cache = {};
        for (var i = 0; i < fields.length; i++) {
          var fid = fields[i].getAttribute('id');
          var formEl = fields[i].querySelector('formula');
          if (fid && formEl && formEl.textContent) {
            cache[fid] = formEl.textContent.trim();
          }
        }
        formulaCache[dbid] = cache;
        return cache;
      })
      .catch(function() { return {}; });

    fetchPromises[dbid] = p;
    return p;
  }

  // ── Formula hover (event delegation) — only for formula-category labels ──
  document.addEventListener('mouseover', function(e) {
    var lbl = e.target.closest('.' + LABEL_CLASS + '.is-formula');
    if (!lbl) return;
    var name = lbl.getAttribute('data-fn') || '';
    var code = lbl.getAttribute('data-ft') || '';
    clearTimeout(popTimer);
    var cx = e.clientX, cy = e.clientY;
    
    popTimer = setTimeout(function() {
      var formula = '';
      var fid = null;
      var fi = getFinfo();
      
      var tMatch = location.pathname.match(/\/table\/([^/?#]+)/);
      var dbid = tMatch ? tMatch[1] : null;

      if (fi && name) {
        var keys = Object.keys(fi);
        for (var i = 0; i < keys.length; i++) {
          var f = fi[keys[i]];
          if (f.name && f.name.trim().toLowerCase() === name.toLowerCase()) {
            formula = f.formula || f.formulatext || f.formulaText || '';
            fid = keys[i];
            break;
          }
        }
      }

      // If we immediately found the formula text in gTableInfo, show it natively.
      if (formula) {
        showPopup(name, code, formula, cx, cy);
      } 
      // If we found the field ID but lack the formula string, dynamically fetch it.
      else if (fid && dbid) {
        showPopup(name, code, "Fetching formula...", cx, cy);
        
        fetchFormulasForTable(dbid).then(function(cache) {
          // Verify we are still hovering it
          if (popup && popup.style.display === 'block') {
            showPopup(name, code, cache[fid] || '', cx, cy);
          }
        });
      }
      else {
        showPopup(name, code, "", cx, cy);
      }

    }, 120);
  }, true);

  document.addEventListener('mouseout', function(e) {
    if (e.target.closest('.' + LABEL_CLASS + '.is-formula')) hidePopup();
  }, true);

  document.addEventListener('mousemove', function(e) {
    if (popup && popup.style.display === 'block') placePopup(e.clientX, e.clientY);
  }, { passive: true });

  // ── Bootstrap ────────────────────────────────────────────────────────────
  if (!inject()) {
    // Poll until grid & gTableInfo are ready
    var attempts = 0;
    var poll = setInterval(function() {
      if (inject() || ++attempts > 80) clearInterval(poll);
    }, 400);

    // Also re-run on DOM changes (SPA nav, column reorder, report switch)
    var obs = new MutationObserver(function() {
      var unprocessed = document.querySelector(HEADER_SEL + ':not([' + DONE_ATTR + '])');
      if (unprocessed) inject();
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

})();
