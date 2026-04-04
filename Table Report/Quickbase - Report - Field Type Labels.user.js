// ==UserScript==
// @name         Quickbase — Report — Field Type Labels
// @namespace    https://quickbase.com/userscripts
// @version      1.3
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

  const FORMULA_TYPES = { FM: 1, FV: 1 };

  // ── Styles ───────────────────────────────────────────────────────────────
  GM_addStyle(`
    .${LABEL_CLASS} {
      display: block;
      font-style: italic;
      font-size: 10px;
      font-weight: 400;
      color: #8b95a3;
      line-height: 1.3;
      margin-top: 1px;
      white-space: nowrap;
      pointer-events: none;
    }
    .${LABEL_CLASS}.is-formula {
      color: #5b2f91;
      pointer-events: auto;
      cursor: help;
      text-decoration: underline dotted;
      text-underline-offset: 2px;
    }
    #${POPUP_ID} {
      position: fixed;
      z-index: 999999;
      background: #1e1e2e;
      color: #cdd6f4;
      border-radius: 8px;
      box-shadow: 0 6px 24px rgba(0,0,0,.3);
      font-family: "SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;
      font-size: 12px;
      line-height: 1.6;
      padding: 0;
      pointer-events: none;
      display: none;
      max-width: 420px;
      min-width: 180px;
      border: 1px solid #313244;
      overflow: hidden;
    }
    #${POPUP_ID} .fp-head {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 5px 10px; background: #181825; border-bottom: 1px solid #313244;
      font-family: system-ui, sans-serif; font-size: 10px; color: #a6adc8;
    }
    #${POPUP_ID} .fp-title { font-weight:600; color:#cba6f7; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #${POPUP_ID} .fp-badge { flex-shrink:0; font-size:9px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; background:#313244; color:#a6adc8; border-radius:3px; padding:1px 5px; }
    #${POPUP_ID} .fp-body  { padding:8px 10px; max-height:200px; overflow:auto; white-space:pre; scrollbar-width:thin; scrollbar-color:#45475a #1e1e2e; }
    #${POPUP_ID} .fp-empty { font-family:system-ui,sans-serif; font-style:italic; color:#585b70; font-size:11px; white-space:normal; }
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

  function showPopup(name, typeCode, formula, x, y) {
    var p = getPopup();
    var label = TYPE_LABELS[typeCode] || typeCode;
    p.innerHTML =
      '<div class="fp-head"><span class="fp-title">' + esc(name) + '</span>' +
      '<span class="fp-badge">' + esc(label) + '</span></div>' +
      '<div class="fp-body">' +
      (formula ? esc(formula) : '<span class="fp-empty">Formula text not available</span>') +
      '</div>';
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

      var span = document.createElement('span');
      span.className = LABEL_CLASS + (FORMULA_TYPES[typeCode] ? ' is-formula' : '');
      span.textContent = typeLabel;
      span.setAttribute('data-ft', typeCode);
      span.setAttribute('data-fn', colName);

      // Append inside the data-tip element so it appears under the field name
      cell.appendChild(span);
      cell.setAttribute(DONE_ATTR, '1');
      injected++;
    }

    return injected > 0;
  }

  // ── Formula hover (event delegation) ────────────────────────────────────
  document.addEventListener('mouseover', function(e) {
    var lbl = e.target.closest('.' + LABEL_CLASS + '.is-formula');
    if (!lbl) return;
    var name = lbl.getAttribute('data-fn') || '';
    var code = lbl.getAttribute('data-ft') || '';
    clearTimeout(popTimer);
    var cx = e.clientX, cy = e.clientY;
    popTimer = setTimeout(function() {
      var formula = '';
      var fi = getFinfo();
      if (fi && name) {
        var vals = Object.values(fi);
        for (var i = 0; i < vals.length; i++) {
          if (vals[i].name && vals[i].name.trim().toLowerCase() === name.toLowerCase()) {
            formula = vals[i].formula || vals[i].formulatext || vals[i].formulaText || '';
            break;
          }
        }
      }
      showPopup(name, code, formula, cx, cy);
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
