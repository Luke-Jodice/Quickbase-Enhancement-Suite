// ==UserScript==
// @name         Quickbase — Side Nav — Hover Table Schema (Toggle)
// @namespace    https://quickbase.com/userscripts
// @version      1.0
// @description  Compact tooltip on hover; hold Shift to expand full schema details
// @match        https://*.quickbase.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  GM_addStyle(`
    #qb-schema-popup {
      position: fixed;
      z-index: 999999;
      background: #fff;
      color: #272b32;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.12);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 12px;
      pointer-events: none;
      display: none;
      max-width: 320px;
      line-height: 1.5;
      border: 1px solid #e1e3e6;
    }

    /* ── Compact view ───────────────────────── */
    #qb-schema-popup .qb-sp-compact {
      display: flex;
      align-items: baseline;
      gap: 8px;
    }
    #qb-schema-popup .qb-sp-compact-name {
      font-weight: 700;
      font-size: 13px;
      color: #5b2f91;
    }
    #qb-schema-popup .qb-sp-compact-meta {
      font-family: monospace;
      font-size: 10px;
      color: #636c7a;
      white-space: nowrap;
    }
    #qb-schema-popup .qb-sp-hint {
      margin-top: 4px;
      font-size: 9px;
      color: #aab2bd;
      letter-spacing: 0.2px;
    }
    #qb-schema-popup .qb-sp-hint kbd {
      background: #f0f2f4;
      border: 1px solid #ddd;
      border-radius: 3px;
      padding: 0 3px;
      font-size: 9px;
      font-family: inherit;
    }

    /* ── Expanded view ──────────────────────── */
    #qb-schema-popup .qb-sp-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      border-bottom: 1px solid #e1e3e6;
      margin-bottom: 8px;
      padding-bottom: 6px;
    }
    #qb-schema-popup .qb-sp-name {
      font-weight: 700;
      font-size: 14px;
      color: #5b2f91;
    }
    #qb-schema-popup .qb-sp-dbid {
      font-family: monospace;
      font-size: 10px;
      color: #636c7a;
    }
    #qb-schema-popup .qb-sp-badge {
      display: inline-block;
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      background: #5b2f91;
      color: #fff;
      border-radius: 3px;
      padding: 1px 5px;
      margin-left: 6px;
      vertical-align: middle;
    }
    #qb-schema-popup .qb-sp-stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      background: #f4f5f6;
      padding: 8px;
      border-radius: 6px;
      margin-bottom: 8px;
    }
    #qb-schema-popup .qb-sp-stat {
      display: flex;
      flex-direction: column;
    }
    #qb-schema-popup .qb-sp-label {
      color: #636c7a;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    #qb-schema-popup .qb-sp-value {
      font-size: 13px;
      color: #272b32;
      font-weight: 600;
    }
    #qb-schema-popup .qb-sp-types {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    #qb-schema-popup .qb-sp-tag {
      font-size: 10px;
      background: #eef0f3;
      color: #444;
      border-radius: 4px;
      padding: 2px 6px;
    }
    #qb-schema-popup .qb-sp-tag b {
      font-weight: 600;
      color: #272b32;
    }
    #qb-schema-popup .qb-sp-alias {
      font-size: 10px;
      color: #8b95a3;
      font-family: monospace;
      margin-top: 6px;
    }
  `);

  // QB type codes → short readable labels
  var TYPE_LABELS = {
    TX: 'Text', RT: 'Rich Text', NM: 'Numeric', CR: 'Currency',
    PC: 'Percent', DT: 'Date', TS: 'Timestamp', TM: 'Time of Day',
    DU: 'Duration', CB: 'Checkbox', LK: 'URL', EM: 'Email',
    PH: 'Phone', US: 'User', UL: 'User List', ML: 'Multi-select',
    FL: 'File', RI: 'Record ID', LU: 'Lookup', SM: 'Summary',
    FM: 'Formula', AB: 'Address', ST: 'State', ZP: 'Zip',
    CT: 'City', CO: 'Country', RN: 'Report Link', BC: 'Barcode',
    SL: 'dblink', MC: 'Multi-choice', FV: 'Formula', AD: 'Address',
    XD: 'Cross-DB', IB: 'iCalendar', VL: 'vCard',
  };

  var tooltip = null;
  var lastTarget = null;
  var hoverTimer = null;
  var pendingCoords = null;
  var currentSummary = null;
  var isExpanded = false;
  var shiftHeld = false;
  var OFFSET = 14;
  var HOVER_DELAY = 400;

  function esc(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getTableInfo(dbid) {
    if (typeof gTableInfo === 'undefined') return null;
    return gTableInfo[dbid] || null;
  }

  function buildSummary(dbid) {
    var t = getTableInfo(dbid);
    if (!t) return null;

    var finfo = t.finfo || {};
    var fids = Object.keys(finfo);
    var fieldCount = fids.length;

    var typeCounts = {};
    for (var i = 0; i < fids.length; i++) {
      var code = finfo[fids[i]].type;
      var label = TYPE_LABELS[code] || code;
      typeCounts[label] = (typeCounts[label] || 0) + 1;
    }

    var formulaCount = 0;
    var refCount = 0;
    for (var j = 0; j < fids.length; j++) {
      var f = finfo[fids[j]];
      if (f.type === 'FM' || f.type === 'FV' || f.formula) formulaCount++;
      if (f.type === 'SL' || f.type === 'XD' || f.reffid > 0) refCount++;
    }

    return {
      name: t.name || 'Unnamed',
      dbid: dbid,
      alias: t.alias || '',
      fieldCount: fieldCount,
      formulaCount: formulaCount,
      refCount: refCount,
      keyFid: t.kfid || 3,
      keyName: t.kfname || 'Record ID#',
      forms: (t.forminfo || []).length,
      typeCounts: typeCounts,
    };
  }

  // ── Compact: name · dbid · field count ────────────────────────
  function renderCompact(s) {
    return ''
      + '<div class="qb-sp-compact">'
      + '  <span class="qb-sp-compact-name">' + esc(s.name) + '</span>'
      + '  <span class="qb-sp-compact-meta">' + esc(s.dbid) + ' · ' + s.fieldCount + ' fields</span>'
      + '</div>'
      + '<div class="qb-sp-hint">Hold <kbd>Shift</kbd> for details</div>';
  }

  // ── Expanded: full stats grid + type tags ─────────────────────
  function renderExpanded(s) {
    var tags = Object.keys(s.typeCounts)
      .filter(function (k) { return k !== 'Record ID'; })
      .sort(function (a, b) { return s.typeCounts[b] - s.typeCounts[a]; })
      .slice(0, 8)
      .map(function (k) {
        return '<span class="qb-sp-tag"><b>' + s.typeCounts[k] + '</b> ' + esc(k) + '</span>';
      })
      .join('');

    return ''
      + '<div class="qb-sp-header">'
      + '  <span class="qb-sp-name">' + esc(s.name) + '<span class="qb-sp-badge">Expanded</span></span>'
      + '  <span class="qb-sp-dbid">' + esc(s.dbid) + '</span>'
      + '</div>'
      + '<div class="qb-sp-stats">'
      + '  <div class="qb-sp-stat"><span class="qb-sp-label">Fields</span><span class="qb-sp-value">' + s.fieldCount + '</span></div>'
      + '  <div class="qb-sp-stat"><span class="qb-sp-label">Key Field</span><span class="qb-sp-value">#' + s.keyFid + '</span></div>'
      + '  <div class="qb-sp-stat"><span class="qb-sp-label">Formulas</span><span class="qb-sp-value">' + s.formulaCount + '</span></div>'
      + '  <div class="qb-sp-stat"><span class="qb-sp-label">Relationships</span><span class="qb-sp-value">' + s.refCount + '</span></div>'
      + '</div>'
      + (tags ? '<div class="qb-sp-types">' + tags + '</div>' : '')
      + (s.alias ? '<div class="qb-sp-alias">' + esc(s.alias) + '</div>' : '');
  }

  function positionTooltip(x, y) {
    if (!tooltip) return;
    var left = x + OFFSET;
    var top = y + OFFSET;
    if (left + 330 > window.innerWidth) left = x - 330;
    if (top + tooltip.offsetHeight + 10 > window.innerHeight) top = y - tooltip.offsetHeight - OFFSET;
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }

  function showTooltip(html, x, y) {
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'qb-schema-popup';
      document.body.appendChild(tooltip);
    }
    tooltip.innerHTML = html;
    tooltip.style.display = 'block';
    positionTooltip(x, y);
  }

  function hideTooltip() {
    clearTimeout(hoverTimer);
    hoverTimer = null;
    pendingCoords = null;
    lastTarget = null;
    currentSummary = null;
    isExpanded = false;
    if (tooltip) tooltip.style.display = 'none';
  }

  function expandTooltip() {
    if (!tooltip || !currentSummary || isExpanded) return;
    isExpanded = true;
    tooltip.innerHTML = renderExpanded(currentSummary);
    if (pendingCoords) positionTooltip(pendingCoords.x, pendingCoords.y);
  }

  function collapseTooltip() {
    if (!tooltip || !currentSummary || !isExpanded) return;
    isExpanded = false;
    tooltip.innerHTML = renderCompact(currentSummary);
    if (pendingCoords) positionTooltip(pendingCoords.x, pendingCoords.y);
  }

  // ── Shift key tracking ────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Shift') {
      shiftHeld = true;
      if (tooltip && tooltip.style.display === 'block' && currentSummary) {
        expandTooltip();
      }
    }
  }, true);

  document.addEventListener('keyup', function (e) {
    if (e.key === 'Shift') {
      shiftHeld = false;
      if (isExpanded) collapseTooltip();
    }
  }, true);

  // ── Mouse events ──────────────────────────────────────────────
  var TABLE_LINK_SEL = 'a[href*="/table/"]';

  document.addEventListener('mouseover', function (e) {
    var target = e.target.closest(TABLE_LINK_SEL);
    if (!target || target === lastTarget) return;

    clearTimeout(hoverTimer);
    lastTarget = target;
    pendingCoords = { x: e.clientX, y: e.clientY };

    var match = target.href.match(/\/table\/([^/?#]+)/);
    if (!match) return;
    var dbid = match[1];

    hoverTimer = setTimeout(function () {
      if (lastTarget !== target) return;

      var summary = buildSummary(dbid);
      if (!summary) return;

      currentSummary = summary;
      isExpanded = false;

      var c = pendingCoords || { x: e.clientX, y: e.clientY };

      // If Shift is already held, go straight to expanded
      if (shiftHeld) {
        isExpanded = true;
        showTooltip(renderExpanded(summary), c.x, c.y);
      } else {
        showTooltip(renderCompact(summary), c.x, c.y);
      }
    }, HOVER_DELAY);
  }, true);

  document.addEventListener('mousemove', function (e) {
    if (hoverTimer && lastTarget) {
      pendingCoords = { x: e.clientX, y: e.clientY };
    }
    if (tooltip && tooltip.style.display === 'block') {
      pendingCoords = { x: e.clientX, y: e.clientY };
      positionTooltip(e.clientX, e.clientY);
    }
  }, { passive: true });

  document.addEventListener('mouseout', function (e) {
    if (e.target.closest(TABLE_LINK_SEL)) hideTooltip();
  }, true);
})();
