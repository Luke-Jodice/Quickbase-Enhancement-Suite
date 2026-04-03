// ==UserScript==
// @name         Quickbase Formula — Field Marker Tooltips
// @namespace    https://quickbase.com/userscripts
// @version      1.5
// @description  Hover tooltips on [FieldName] markers in the Quickbase formula editor showing field type, FID, and table
// @match        https://*.quickbase.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  GM_addStyle(`
    #qb-field-tooltip {
      position: absolute;
      z-index: 99999;
      background: #fff;
      color: #1a1d21;
      border: 1px solid #ddd;
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.06);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      padding: 8px 12px;
      pointer-events: none;
      display: none;
      max-width: 320px;
      line-height: 1.5;
    }
    #qb-field-tooltip .qb-tt-name {
      font-weight: 600;
      font-size: 13px;
      color: #1a1d21;
      margin-bottom: 4px;
    }
    #qb-field-tooltip .qb-tt-row {
      display: flex;
      gap: 4px;
      font-size: 11px;
      color: #444;
    }
    #qb-field-tooltip .qb-tt-label {
      color: #8b95a3;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      flex-shrink: 0;
    }
    #qb-field-tooltip .qb-tt-unknown {
      color: #8b95a3;
      font-style: italic;
      font-size: 11px;
    }
  `);

  // Quickbase internal type codes → human-readable names
  var TYPE_LABELS = {
    TX: 'Text', RT: 'Rich Text', NM: 'Numeric', CR: 'Currency',
    RT: 'Rating', PC: 'Percent', DT: 'Date', TS: 'Timestamp',
    TM: 'Time of Day', DU: 'Duration', CB: 'Checkbox',
    LK: 'URL', EM: 'Email', PH: 'Phone', US: 'User',
    UL: 'User List', ML: 'Multi-select Text', FL: 'File Attachment',
    RI: 'Record ID', LU: 'Lookup', SM: 'Summary', FM: 'Formula',
    AB: 'Address', ST: 'State', ZP: 'Zip', CT: 'City',
    CO: 'Country', RN: 'Report Link', BC: 'Barcode',
    IB: 'iCalendar', VL: 'vCard Lookup', PY: 'Predecessor',
    SL: 'dblink', MC: 'Multi-choice',
  };

  var tooltip = null;
  var hoverTimer = null;
  var fieldCache = null;
  var currentSpan = null;

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Get the current table ID from the page URL.
   */
  function getCurrentTableId() {
    var m = location.pathname.match(/table\/([^\/]+)/);
    return m ? m[1] : null;
  }

  /**
   * Build a name→{fid, type, table} cache from gTableInfo (page global)
   * and supplement with formulaHelper data-field-type when available.
   * The current table's fields take priority over other tables so that
   * fields with the same name across tables resolve correctly.
   */
  function buildFieldCache() {
    var cache = {};
    var currentTableId = getCurrentTableId();

    // Primary source: gTableInfo.finfo — gives us FID + type code
    // Process other tables first, then the current table last so it wins
    if (typeof gTableInfo !== 'undefined') {
      var tableIds = Object.keys(gTableInfo);
      // Sort so current table comes last (its entries overwrite others)
      tableIds.sort(function (a, b) {
        if (a === currentTableId) return 1;
        if (b === currentTableId) return -1;
        return 0;
      });
      for (var t = 0; t < tableIds.length; t++) {
        var tid = tableIds[t];
        var table = gTableInfo[tid];
        var finfo = table.finfo;
        if (!finfo) continue;
        for (var fid in finfo) {
          var f = finfo[fid];
          var key = f.name.toLowerCase();
          cache[key] = {
            name: f.name,
            fid: fid,
            typeCode: f.type,
            type: TYPE_LABELS[f.type] || f.type,
            table: table.name || '',
          };
        }
      }
    }

    // Supplement / override type with the friendlier data-field-type from formulaHelper
    var sel = document.getElementById('formulaHelper');
    if (sel) {
      for (var i = 0; i < sel.options.length; i++) {
        var opt = sel.options[i];
        if (opt.disabled) continue;
        var val = opt.value.trim();
        if (val.charAt(0) !== '[') continue;
        var name = opt.textContent.trim();
        var friendlyType = opt.getAttribute('data-field-type') || '';
        var key2 = name.toLowerCase();
        if (cache[key2] && friendlyType) {
          cache[key2].type = friendlyType;
        } else if (!cache[key2]) {
          cache[key2] = { name: name, fid: '', typeCode: '', type: friendlyType, table: '' };
        }
      }
    }

    return Object.keys(cache).length > 0 ? cache : null;
  }

  function lookupField(text) {
    if (!fieldCache) fieldCache = buildFieldCache();
    if (!fieldCache) return null;

    var inner = text.trim().replace(/^\[|\]$/g, '');
    return fieldCache[inner.toLowerCase()] || null;
  }

  function createTooltip() {
    var el = document.createElement('div');
    el.id = 'qb-field-tooltip';
    document.body.appendChild(el);
    return el;
  }

  function showTooltip(span) {
    var text = span.textContent || '';
    var field = lookupField(text);

    if (!tooltip) tooltip = createTooltip();

    if (!field) {
      var inner = text.replace(/^\[|\]$/g, '').trim();
      if (inner.startsWith('_DBID_') || inner.startsWith('_')) return;
      tooltip.innerHTML = '<div class="qb-tt-name">' + escapeHtml(inner || text) + '</div>'
        + '<div class="qb-tt-unknown">Unknown field</div>';
    } else {
      var html = '<div class="qb-tt-name">' + escapeHtml(field.name) + '</div>';
      if (field.fid) {
        html += '<div class="qb-tt-row"><span class="qb-tt-label">FID</span> ' + escapeHtml(field.fid) + '</div>';
      }
      if (field.type) {
        html += '<div class="qb-tt-row"><span class="qb-tt-label">Type</span> ' + escapeHtml(field.type) + '</div>';
      }
      if (field.table) {
        html += '<div class="qb-tt-row"><span class="qb-tt-label">Table</span> ' + escapeHtml(field.table) + '</div>';
      }
      tooltip.innerHTML = html;
    }

    var rect = span.getBoundingClientRect();
    var top = rect.bottom + window.scrollY + 6;
    var left = rect.left + window.scrollX;

    // Flip above if near viewport bottom
    tooltip.style.display = 'block';
    var ttHeight = tooltip.offsetHeight;
    if (rect.bottom + ttHeight + 10 > window.innerHeight) {
      top = rect.top + window.scrollY - ttHeight - 6;
    }

    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
  }

  function hideTooltip() {
    clearTimeout(hoverTimer);
    hoverTimer = null;
    currentSpan = null;
    if (tooltip) tooltip.style.display = 'none';
  }

  /**
   * Find the ace_field span under the given viewport coordinates.
   * All Ace layers have pointer-events:none so we hit-test bounding rects
   * of every .ace_field span against the mouse position.
   */
  function fieldSpanFromPoint(x, y, container) {
    var spans = container.querySelectorAll('.ace_field');
    for (var i = 0; i < spans.length; i++) {
      var rect = spans[i].getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return spans[i];
      }
    }
    return null;
  }

  function attach(container) {
    var scroller = container.querySelector('.ace_scroller') || container;

    scroller.addEventListener('mousemove', function (e) {
      var span = fieldSpanFromPoint(e.clientX, e.clientY, container);

      if (!span) {
        if (currentSpan) hideTooltip();
        return;
      }

      if (span === currentSpan) return;

      hideTooltip();
      currentSpan = span;
      hoverTimer = setTimeout(function () {
        if (!span.isConnected) { hideTooltip(); return; }
        // Don't show if QB's error helper or Ace's tooltip is visible
        var errMenu = document.getElementById('fexpr_OffendingTokenHelper');
        if (errMenu && errMenu.style.display !== 'none') { currentSpan = null; return; }
        var aceTooltip = document.querySelector('.ace_tooltip');
        if (aceTooltip && aceTooltip.offsetWidth > 0) { currentSpan = null; return; }
        fieldCache = null;
        showTooltip(span);
      }, 300);
    });

    scroller.addEventListener('mouseleave', function () {
      hideTooltip();
    });

    var editor = container.env && container.env.editor;
    if (editor) {
      editor.session.on('changeScrollTop', function () { hideTooltip(); });
      editor.on('change', function () { hideTooltip(); });
    }

    console.log('[QB Tooltip] Attached to Ace editor');
    return true;
  }

  function tryAttach() {
    var container = document.getElementById('fexpr_aceEditor');
    if (!container) return false;
    if (container.dataset.qbTooltipAttached) return true;

    container.dataset.qbTooltipAttached = '1';
    return attach(container);
  }

  if (tryAttach()) return;

  var attempts = 0;
  var poll = setInterval(function () {
    if (tryAttach() || ++attempts > 80) clearInterval(poll);
  }, 300);

  var observer = new MutationObserver(function () {
    if (!document.querySelector('[data-qb-tooltip-attached]') && document.getElementById('fexpr_aceEditor')) {
      tryAttach();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
