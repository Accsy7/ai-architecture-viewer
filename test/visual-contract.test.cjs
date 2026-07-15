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

test('owner inspector keeps primary language visible and secondary evidence collapsed', () => {
  const details = read('src/components/ViewerDetailPanel.jsx');
  const i18n = read('src/i18n.jsx');

  assert.match(details, /details\.whatItDoes/);
  assert.match(details, /details\.currentProgress/);
  assert.match(details, /details\.cannotDo/);
  assert.match(details, /<details className="inspector-disclosure relationship-disclosure">/);
  assert.match(details, /<details className="inspector-disclosure inspector-more">/);
  assert.match(details, /<details className="inspector-disclosure understanding-evidence">/);
  assert.match(details, /details\.historicalMigrationRecord/);
  assert.match(details, /details\.sourceNotRecorded/);
  assert.doesNotMatch(details, /human-confirmation-card/);

  for (const key of [
    'details.whatItDoes',
    'details.currentProgress',
    'details.cannotDo',
    'details.directRelationships',
    'details.moreInformation',
    'details.understandingEvidence',
    'details.historicalMigrationRecord',
  ]) {
    const escaped = key.replace('.', '\\.');
    assert.equal((i18n.match(new RegExp(`'${escaped}':`, 'g')) || []).length, 2, `${key} must be bilingual`);
  }
});

test('viewer tools use one neutral treatment and neutral count badges', () => {
  const phase3 = read('src/phase3.css');
  const analysis = read('src/analysis.css');
  const genericTool = rule(phase3, '.graph-heading-actions button');
  const documentTool = rule(phase3, '.graph-heading-actions .persistent-document-entry');
  const agentTool = rule(analysis, '.graph-heading-actions .analysis-entry');

  assert.match(genericTool, /background:\s*#fbfcfa/);
  assert.match(genericTool, /border-color:\s*#d3d9d5/);
  assert.match(documentTool, /background:\s*#fbfcfa/);
  assert.doesNotMatch(documentTool, /var\(--green\)|green-soft/);
  assert.match(agentTool, /background:\s*#fbfcfa/);
  assert.doesNotMatch(agentTool, /analysis-purple/);
  assert.match(rule(phase3, '.graph-heading-actions button span'), /background:\s*#eef1ed/);
});

test('all three architecture selector triggers stay transparent through mouse and open states', () => {
  const css = read('src/phase3.css');
  assert.match(rule(css, '.architecture-selector-trigger'), /background:\s*transparent/);
  assert.match(rule(css, '.architecture-selector-trigger'), /border:\s*0/);
  assert.match(rule(css, '.architecture-selector-trigger'), /box-shadow:\s*none/);
  assert.match(rule(css, '.architecture-selector-trigger'), /font-family:\s*Georgia/);
  assert.match(rule(css, '.architecture-selector-trigger'), /font-size:\s*22px/);
  assert.match(rule(css, '.diagram-selector-trigger'), /background:\s*transparent/);
  assert.match(rule(css, '.diagram-selector-trigger'), /border:\s*0/);
  assert.match(rule(css, '.diagram-selector-trigger'), /box-shadow:\s*none/);
  assert.match(rule(css, '.diagram-selector-trigger'), /font-size:\s*13px/);
  assert.match(css, /\.architecture-selector-trigger:hover:not\(:disabled\),[\s\S]*?\.navigation-level-selector \.diagram-level-trigger\[aria-expanded='true'\]\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
  assert.match(css, /\.architecture-selector-trigger:focus-visible,[\s\S]*?\.navigation-level-selector \.diagram-level-trigger:focus-visible\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?outline:\s*2px solid rgba\(70, 109, 153, 0\.42\)/);
  assert.doesNotMatch(rule(css, '.navigation-level-selector .diagram-level-trigger'), /background\s*:/);
});

test('relationship focus and business-flow navigation use blue rather than success green', () => {
  const css = read('styles.css');
  assert.match(css, /\.architecture-node\.is-relationship-focus-root,[\s\S]*?border-color:\s*var\(--blue\)/);
  assert.match(rule(css, '.relationship-focus-summary'), /border-left:\s*3px solid var\(--blue\)/);
  assert.match(rule(css, '.business-flow-node-badge'), /color:\s*var\(--blue\)/);
  assert.match(rule(css, '.business-flow-step.is-active'), /border-color:\s*var\(--blue\)/);
  assert.match(rule(css, '.business-flow-step-number'), /background:\s*var\(--blue\)/);
  for (const selector of ['.business-flow-node-badge', '.business-flow-step.is-active', '.business-flow-step-number']) {
    assert.doesNotMatch(rule(css, selector), /var\(--green\)|green-soft/);
  }
});
