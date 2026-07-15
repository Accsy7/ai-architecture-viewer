'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const rule = (css, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || '';
};

test('desktop workspace is exactly 880px while fullscreen remains viewport-bound', () => {
  const css = `${read('styles.css')}\n${read('src/phase3.css')}`;
  assert.match(rule(css, '.workspace'), /height:\s*880px/);
  assert.match(rule(css, '.workspace'), /min-height:\s*880px/);
  assert.match(rule(css, '.workspace.is-canvas-fullscreen'), /height:\s*auto/);
  assert.match(rule(css, '.workspace.is-canvas-fullscreen'), /min-height:\s*0/);
});

test('draft card markers preserve normal card backgrounds and selected borders', () => {
  const base = read('styles.css');
  const pending = read('src/pending-changes.css');
  assert.match(rule(base, '.architecture-node'), /background:\s*#fff/);
  assert.match(rule(base, '.architecture-node'), /border:\s*1px solid/);
  assert.match(base, /\.architecture-node:hover,\s*\.architecture-node\.is-selected/);

  for (const selector of ['.architecture-node.is-pending-addition', '.architecture-node.is-pending-change']) {
    assert.doesNotMatch(rule(pending, selector), /background\s*:/);
    assert.doesNotMatch(rule(pending, selector), /border(?:-color)?\s*:/);
  }
  assert.match(pending, /\.architecture-node\.is-pending-addition::before/);
  assert.match(pending, /\.architecture-node\.is-pending-change::before/);
  assert.match(rule(pending, '.architecture-node.is-pending-removal'), /opacity:/);
});

test('draft details use the shared inspector instead of an absolute canvas overlay', () => {
  const css = read('src/pending-changes.css');
  assert.match(css, /\.pending-changes-inspector/);
  assert.doesNotMatch(css, /\.pending-change-panel\s*\{[^}]*position:\s*absolute/s);
  assert.match(css, /\.pending-change-notice\s*\{[^}]*white-space:\s*nowrap/s);
});

test('language switch renders one alternate-language text button', () => {
  const source = read('src/i18n.jsx');
  const start = source.indexOf('export function LanguageSwitch()');
  const component = source.slice(start);
  assert.notEqual(start, -1);
  assert.equal((component.match(/<button\b/g) || []).length, 1);
  assert.doesNotMatch(component, /aria-pressed/);
  assert.doesNotMatch(component, /<span[^>]*>\/<\/span>/);
  assert.match(component, /language === 'zh' \? 'en' : 'zh'/);
});

test('compact draft notice excludes category chips and provenance explanations', () => {
  const source = read('src/components/PendingChangesLayer.jsx');
  const start = source.indexOf('export default function PendingChangesSummary');
  const end = source.indexOf('export function PendingChangesInspector');
  const summary = source.slice(start, end);
  assert.match(summary, /pending\.compactTarget/);
  assert.match(summary, /pending\.compactCurrent/);
  assert.doesNotMatch(summary, /pending\.noticeMixed|pending\.noticeAllAgent|pending-change-counts/);
});

test('relationship focus and registered flow remain deeper canvas interactions', () => {
  const app = read('src/ViewerApp.jsx');
  const details = read('src/components/ViewerDetailPanel.jsx');
  const flowPanel = read('src/components/BusinessFlowPanel.jsx');
  assert.match(app, /setRelationshipFocusNodeId\(node\.id\)/);
  assert.match(app, /onPaneClick=\{\(\) => \{\s*if \(activeFlow\) return;/s);
  assert.match(app, /setRelationshipFocusNodeId\(null\);\s*setFocusSelection\(false\);/s);
  assert.match(details, /relationshipFocused && availableFlows\.length > 0/);
  assert.doesNotMatch(app, /architectureViews.*registered-flow/s);
  assert.match(flowPanel, /onClick=\{onExit\}/);
  assert.match(flowPanel, /flow\.sidebarOnlyNote/);
});

test('lane and diagram loads clear transient focus while language copy stays reactive', () => {
  const app = read('src/ViewerApp.jsx');
  const flowPanel = read('src/components/BusinessFlowPanel.jsx');
  const details = read('src/components/ViewerDetailPanel.jsx');
  const displayStart = app.indexOf('const displayGraph = useCallback');
  const displayEnd = app.indexOf('const fetchViewBundle', displayStart);
  const displayGraph = app.slice(displayStart, displayEnd);
  assert.match(displayGraph, /setRelationshipFocusNodeId\(null\)/);
  assert.match(displayGraph, /setActiveFlowId\(null\)/);
  assert.match(displayGraph, /setSelectedFlowSourceNodeId\(null\)/);
  assert.match(flowPanel, /const \{ t \} = useI18n\(\)/);
  assert.match(details, /const \{ t, formatDateTime \} = useI18n\(\)/);
  const i18n = read('src/i18n.jsx');
  assert.equal((i18n.match(/'flow\.exit':/g) || []).length, 2);
  assert.equal((i18n.match(/'focus\.oneHopSummary':/g) || []).length, 2);
});

test('registered flow client contract is GET-only and contains no path-finding hook', () => {
  const api = read('src/api.js');
  const helper = read('src/registered-flows.mjs');
  const source = `${api}\n${helper}`;
  assert.match(api, /getRegisteredFlows = \(view, diagram\) => request\(lanePath\('\/api\/registered-flows'/);
  assert.doesNotMatch(source, /shortestPath|dijkstra|breadthFirst|modelProvider|fetch\([^)]*external/i);
});

test('relationship focus root keeps a controlled visual border after flow exit', () => {
  const app = read('src/ViewerApp.jsx');
  const node = read('src/components/ArchitectureNode.jsx');
  const css = read('styles.css');
  assert.match(app, /__relationshipFocusRoot: !activeFlow && node\.id === relationshipFocusNodeId/);
  assert.match(node, /data\.__relationshipFocusRoot \? 'is-relationship-focus-root'/);
  assert.match(css, /\.architecture-node\.is-relationship-focus-root/);
  assert.match(app, /setRelationshipFocusNodeId\(originId\);\s*setFocusSelection\(Boolean\(originId\)\);/s);
});
