import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import {
  acceptAnalysisProposal,
  getAnalysis,
  getDiagramCatalog,
  getDocuments,
  getLane,
  getRevision,
  getRevisionDiff,
  getRevisions,
  getSkills,
  getViewerConfig,
  getViewerLayout,
  previewDocument,
  publishDraft,
  putDraft,
  putViewerLayout,
  rejectAnalysisProposal,
} from './api.js';
import {
  canonicalGraphToFlow,
  diffSummary,
  styleFlowEdge,
  visibleGraph,
} from './graph.js';
import { resolveEdgePorts } from './routing.mjs';
import { enrichNodesWithDocuments } from './document-model.js';
import ArchitectureNode, { CanvasEditContext } from './components/ArchitectureNode.jsx';
import AnalysisWorkbench from './components/AnalysisWorkbench.jsx';
import GroupRegionNode from './components/GroupRegionNode.jsx';
import DocumentLibrary from './components/DocumentLibrary.jsx';
import {
  ArchitectureCorrectionDialog,
  DocumentPreviewDialog,
  PublishDraftDialog,
} from './components/Phase3Dialogs.jsx';
import RevisionPanel from './components/RevisionPanel.jsx';
import ProposalReviewDialog from './components/ProposalReviewDialog.jsx';
import SmartArchitectureEdge from './components/SmartArchitectureEdge.jsx';
import ViewerDetailPanel from './components/ViewerDetailPanel.jsx';

const nodeTypes = { architectureNode: ArchitectureNode, groupRegion: GroupRegionNode };
const edgeTypes = { architectureEdge: SmartArchitectureEdge };
const INSPECTOR_WIDTH_KEY = 'architecture.viewer.inspectorWidth';
const INSPECTOR_COLLAPSED_KEY = 'architecture.viewer.inspectorCollapsed';
const clampInspectorWidth = (value) => Math.max(280, Math.min(640, Number(value) || 350));

const DEFAULT_CONFIG = {
  projectId: 'project',
  projectName: 'Project',
  viewerName: 'AI 架构查看器',
  eyebrow: 'PROJECT ARCHITECTURE',
  scopeNote: '用于理解、核对与讨论项目架构。',
  defaultFocusNodeId: null,
  views: {
    current: { label: '当前架构', description: '查看当前结构与待确认修订' },
    target: { label: '目标架构', description: '查看规划中的目标结构' },
    compare: { label: '差异对比', description: '对比当前架构与目标方案' },
  },
  nodeFields: [
    { key: 'group', label: '所属分组' },
    { key: 'purpose', label: '主要作用', multiline: true },
    { key: 'technical', label: '技术成熟度', tone: 'technical' },
    { key: 'product', label: '产品与视觉验收', tone: 'product' },
    { key: 'authorization', label: '授权边界', tone: 'authorization' },
    { key: 'aiCollaboration', label: '智能体协作方式', tone: 'ai', optional: true },
    { key: 'buildStrategy', label: '建设方式' },
    { key: 'horizon', label: '目标周期' },
  ],
};

const EMPTY_REGISTRY = {
  schemaVersion: '1.0.0',
  baseRevision: 0,
  lastUpdated: null,
  documents: [],
  bindingDiagnostics: [],
};

const EMPTY_ANALYSIS = {
  schemaVersion: '2.2.0',
  baseRevision: 0,
  lastUpdated: null,
  sources: [],
  evidence: [],
  proposals: [],
  runs: [],
  artifacts: [],
  integration: {
    mode: 'external-agent',
    modelProviderRequired: false,
    agentCanApprove: false,
    agentCanPublish: false,
    mcpCommand: 'npm run mcp',
    cliCommand: 'npm run agent --',
  },
};

const EMPTY_SKILL_CATALOG = {
  schemaVersion: '1.0.0',
  protocolVersion: '1.2.0',
  skills: [],
};

const EMPTY_LAYOUT = {
  schemaVersion: '1.1.0',
  baseRevision: 0,
  lastUpdated: null,
  positions: {},
  containers: {},
};

const EMPTY_DIAGRAM_CATALOG = {
  schemaVersion: '1.0.0',
  defaultDiagramId: null,
  diagrams: [],
};

const REGION_NODE_PREFIX = 'group-region-';
const REGION_MIN_WIDTH = 300;
const REGION_MIN_HEIGHT = 210;
const REGION_CARD_PADDING = 28;
const REGION_HEADER_CLEARANCE = 92;

const finiteNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const nodeWidth = (node) => finiteNumber(node?.measured?.width, finiteNumber(node?.width, finiteNumber(node?.style?.width, 260)));
const nodeHeight = (node) => finiteNumber(node?.measured?.height, finiteNumber(node?.height, finiteNumber(node?.style?.height, 150)));
const regionNodeId = (groupId) => `${REGION_NODE_PREFIX}${groupId}`;

function groupGeometry(group, layout, preview = {}) {
  const stored = preview[group.id] || layout?.containers?.[group.id] || {};
  return {
    x: finiteNumber(stored.x, finiteNumber(group.position?.x, 0)),
    y: finiteNumber(stored.y, finiteNumber(group.position?.y, 0)),
    width: Math.max(REGION_MIN_WIDTH, finiteNumber(stored.width, finiteNumber(group.width, 340))),
    height: Math.max(REGION_MIN_HEIGHT, finiteNumber(stored.height, finiteNumber(group.height, 520))),
  };
}

function expandGeometryToContainNode(geometry, node) {
  const left = finiteNumber(node.position?.x);
  const top = finiteNumber(node.position?.y);
  const right = left + nodeWidth(node);
  const bottom = top + nodeHeight(node);
  const nextLeft = Math.min(geometry.x, left - REGION_CARD_PADDING);
  const nextTop = Math.min(geometry.y, top - REGION_HEADER_CLEARANCE);
  const nextRight = Math.max(geometry.x + geometry.width, right + REGION_CARD_PADDING);
  const nextBottom = Math.max(geometry.y + geometry.height, bottom + REGION_CARD_PADDING);
  return {
    x: nextLeft,
    y: nextTop,
    width: Math.max(REGION_MIN_WIDTH, nextRight - nextLeft),
    height: Math.max(REGION_MIN_HEIGHT, nextBottom - nextTop),
  };
}

function sameGeometry(left, right) {
  return ['x', 'y', 'width', 'height'].every((key) => Math.abs(finiteNumber(left?.[key]) - finiteNumber(right?.[key])) < 0.01);
}

const laneSignature = (lane) => [
  lane?.meta?.lastUpdated,
  lane?.published?.revision,
  lane?.published?.revisionId,
  lane?.draft?.draftId,
  lane?.draft?.draftRevision,
  lane?.draft?.savedAt,
  lane?.historyCount,
].join('|');

const layoutSignature = (layout) => [layout?.baseRevision, layout?.lastUpdated].join('|');

const documentSignature = (registry) => JSON.stringify({
  baseRevision: registry?.baseRevision,
  lastUpdated: registry?.lastUpdated,
  documents: (registry?.documents || []).map((document) => ({
    id: document.id,
    status: document.status,
    diagnostics: (document.diagnostics || []).map((item) => [item.code, item.severity, item.message]),
    activeCount: document.referenceSummary?.activeCount || 0,
    historicalCount: document.referenceSummary?.historicalCount || 0,
  })),
  bindingDiagnostics: (registry?.bindingDiagnostics || []).map((item) => [
    item.diagramId,
    item.view,
    item.scope,
    item.nodeId,
    item.documentId,
    item.code,
    item.severity,
    item.message,
  ]),
});

function applyPositions(graph, positions = {}) {
  return {
    nodes: (graph?.nodes || []).map((node) => positions[node.id]
      ? { ...node, position: { ...positions[node.id] } }
      : node),
    edges: graph?.edges || [],
  };
}

function buildGenericCompareGraph(currentGraph, targetGraph) {
  const currentNodes = new Map((currentGraph?.nodes || []).map((node) => [node.id, node]));
  const targetNodes = new Map((targetGraph?.nodes || []).map((node) => [node.id, node]));
  const nodes = (targetGraph?.nodes || []).map((node) => {
    const current = currentNodes.get(node.id);
    const exists = Boolean(current);
    const changed = exists && JSON.stringify(current.data || {}) !== JSON.stringify(node.data || {});
    return {
      ...node,
      data: {
        ...node.data,
        compareStatus: !exists ? '目标新增' : changed ? '当前已有，目标职责或状态将调整' : '当前已有，目标延续',
        compareClass: !exists ? 'compare-new' : changed ? 'compare-changed' : 'compare-current',
      },
    };
  });
  for (const node of currentGraph?.nodes || []) {
    if (targetNodes.has(node.id)) continue;
    nodes.push({
      ...node,
      data: { ...node.data, compareStatus: '仅当前架构', compareClass: 'compare-only' },
    });
  }
  return { nodes, edges: targetGraph?.edges || [] };
}

function buildNavigationSections(diagrams = []) {
  const sections = new Map();
  diagrams.forEach((diagram) => {
    const navigation = diagram.navigation;
    if (!navigation) return;
    if (!sections.has(navigation.sectionId)) {
      sections.set(navigation.sectionId, {
        id: navigation.sectionId,
        label: navigation.sectionLabel,
        order: navigation.sectionOrder,
        root: null,
        diagrams: [],
      });
    }
    const section = sections.get(navigation.sectionId);
    if (navigation.sectionRoot) section.root = diagram;
    if (navigation.menuVisible) section.diagrams.push(diagram);
  });
  return [...sections.values()]
    .map((section) => ({
      ...section,
      diagrams: section.diagrams.sort((left, right) => (
        left.navigation.order - right.navigation.order || left.title.localeCompare(right.title, 'zh-CN')
      )),
    }))
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, 'zh-CN'));
}

function resolveNavigationLocation(diagrams = [], selectedDiagram = null) {
  if (!selectedDiagram) return { anchor: null, trail: [] };
  const byId = new Map(diagrams.map((diagram) => [diagram.id, diagram]));
  const selectedSectionId = selectedDiagram.navigation?.sectionId;
  let anchor = selectedDiagram;
  while (
    anchor
    && (!anchor.navigation?.menuVisible || anchor.navigation?.sectionId !== selectedSectionId)
    && anchor.parentDiagramId
  ) {
    anchor = byId.get(anchor.parentDiagramId) || null;
  }
  if (!anchor?.navigation?.menuVisible || anchor.navigation?.sectionId !== selectedSectionId) {
    return { anchor: selectedDiagram, trail: [] };
  }
  const trail = [];
  let cursor = selectedDiagram;
  while (cursor && cursor.id !== anchor.id) {
    trail.unshift(cursor);
    cursor = cursor.parentDiagramId ? byId.get(cursor.parentDiagramId) || null : null;
  }
  return { anchor, trail };
}

function Viewer() {
  const { fitView } = useReactFlow();
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [diagramCatalog, setDiagramCatalog] = useState(EMPTY_DIAGRAM_CATALOG);
  const [diagramId, setDiagramId] = useState(null);
  const [catalogReady, setCatalogReady] = useState(false);
  const [view, setView] = useState('current');
  const [lane, setLane] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [layouts, setLayouts] = useState({ current: EMPTY_LAYOUT, target: EMPTY_LAYOUT });
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [selectedRegionId, setSelectedRegionId] = useState(null);
  const [focusSelection, setFocusSelection] = useState(false);
  const [regionPreview, setRegionPreview] = useState({});
  const [loading, setLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState('');
  const [registry, setRegistry] = useState(EMPTY_REGISTRY);
  const [analysis, setAnalysis] = useState(EMPTY_ANALYSIS);
  const [skillCatalog, setSkillCatalog] = useState(EMPTY_SKILL_CATALOG);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisWorkbenchOpen, setAnalysisWorkbenchOpen] = useState(false);
  const [analysisTab, setAnalysisTab] = useState('runs');
  const [reviewProposalId, setReviewProposalId] = useState(null);
  const [analysisActionBusy, setAnalysisActionBusy] = useState(false);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentLibraryOpen, setDocumentLibraryOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [architectureSelectorOpen, setArchitectureSelectorOpen] = useState(false);
  const [levelSelectorOpen, setLevelSelectorOpen] = useState(false);
  const [diagramSelectorOpen, setDiagramSelectorOpen] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    try { return clampInspectorWidth(window.localStorage.getItem(INSPECTOR_WIDTH_KEY)); } catch { return 350; }
  });
  const [inspectorCollapsed, setInspectorCollapsed] = useState(() => {
    try { return window.localStorage.getItem(INSPECTOR_COLLAPSED_KEY) === 'true'; } catch { return false; }
  });
  const [canvasFullscreen, setCanvasFullscreen] = useState(false);
  const [revisionPanelOpen, setRevisionPanelOpen] = useState(false);
  const [revisionLoading, setRevisionLoading] = useState(false);
  const [revisionCatalog, setRevisionCatalog] = useState({ headRevisionId: null, revisions: [] });
  const [historicalRevision, setHistoricalRevision] = useState(null);
  const [revisionDiff, setRevisionDiff] = useState(null);
  const [correctionNodeId, setCorrectionNodeId] = useState(null);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);

  const configRef = useRef(DEFAULT_CONFIG);
  const diagramCatalogRef = useRef(EMPTY_DIAGRAM_CATALOG);
  const diagramRef = useRef(null);
  const laneRef = useRef(null);
  const viewRef = useRef('current');
  const nodesRef = useRef([]);
  const edgesRef = useRef([]);
  const layoutsRef = useRef({ current: EMPTY_LAYOUT, target: EMPTY_LAYOUT });
  const regionPreviewRef = useRef({});
  const regionInteractionRef = useRef(null);
  const registryRef = useRef(EMPTY_REGISTRY);
  const analysisRef = useRef(EMPTY_ANALYSIS);
  const historicalRef = useRef(null);
  const bundleSignatureRef = useRef('');
  const fitAfterLoadRef = useRef(false);
  const navigationFocusRef = useRef(null);
  const draggingRef = useRef(false);
  const toastTimerRef = useRef(null);
  const architectureSelectorRef = useRef(null);
  const levelSelectorRef = useRef(null);
  const diagramSelectorRef = useRef(null);
  const workspaceRef = useRef(null);

  const showToast = useCallback((message) => {
    setToastMessage(message);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMessage(''), 3000);
  }, []);

  const replaceNodes = useCallback((next) => {
    nodesRef.current = next;
    setNodes(next);
  }, []);

  const replaceEdges = useCallback((next) => {
    edgesRef.current = next;
    setEdges(next);
  }, []);

  const replaceRegionPreview = useCallback((nextOrUpdater) => {
    setRegionPreview((current) => {
      const next = typeof nextOrUpdater === 'function' ? nextOrUpdater(current) : nextOrUpdater;
      regionPreviewRef.current = next;
      return next;
    });
  }, []);

  const updateLayouts = useCallback((viewName, nextLayout) => {
    const next = { ...layoutsRef.current, [viewName]: { ...EMPTY_LAYOUT, ...nextLayout } };
    layoutsRef.current = next;
    setLayouts(next);
  }, []);

  const displayGraph = useCallback((graph, shouldFit = true) => {
    const flow = canonicalGraphToFlow(graph);
    const decoratedNodes = enrichNodesWithDocuments(flow.nodes, registryRef.current.documents || []);
    replaceNodes(decoratedNodes);
    replaceEdges(flow.edges);
    const activeDiagram = diagramCatalogRef.current.diagrams.find((entry) => entry.id === diagramRef.current);
    const requestedId = navigationFocusRef.current;
    navigationFocusRef.current = null;
    const preferredId = requestedId || activeDiagram?.defaultFocusNodeId || configRef.current.defaultFocusNodeId;
    const preferred = decoratedNodes.find((node) => node.id === preferredId)?.id || decoratedNodes[0]?.id || null;
    setSelectedNodeId((current) => decoratedNodes.some((node) => node.id === current) ? current : preferred);
    setSelectedEdgeId(null);
    setSelectedRegionId(null);
    setFocusSelection(false);
    if (shouldFit) fitAfterLoadRef.current = true;
  }, [replaceEdges, replaceNodes]);

  const fetchViewBundle = useCallback(async (nextView, nextDiagramId = diagramRef.current) => {
    if (!nextDiagramId) throw new Error('尚未选择架构图');
    if (nextView === 'compare') {
      const [current, target, currentLayout, targetLayout] = await Promise.all([
        getLane('current', nextDiagramId),
        getLane('target', nextDiagramId),
        getViewerLayout('current', nextDiagramId),
        getViewerLayout('target', nextDiagramId),
      ]);
      const currentGraph = applyPositions(current.published.graph, currentLayout.positions);
      const targetGraph = applyPositions(visibleGraph(target), targetLayout.positions);
      const compareLane = {
        schemaVersion: current.schemaVersion,
        meta: current.meta,
        view: 'compare',
        published: {
          revision: `C${current.published.revision} / T${target.draft ? '草案' : target.published.revision}`,
          revisionId: `compare:${current.published.revisionId}:${target.draft?.draftId || target.published.revisionId}`,
          graph: buildGenericCompareGraph(currentGraph, targetGraph),
        },
        draft: null,
        historyCount: 0,
      };
      return {
        diagramId: nextDiagramId,
        lane: compareLane,
        graph: compareLane.published.graph,
        layouts: { current: currentLayout, target: targetLayout },
        signature: [nextDiagramId, laneSignature(current), laneSignature(target), layoutSignature(currentLayout), layoutSignature(targetLayout)].join('::'),
      };
    }
    const [nextLane, nextLayout] = await Promise.all([
      getLane(nextView, nextDiagramId),
      getViewerLayout(nextView, nextDiagramId),
    ]);
    return {
      diagramId: nextDiagramId,
      lane: nextLane,
      graph: applyPositions(visibleGraph(nextLane), nextLayout.positions),
      layouts: { [nextView]: nextLayout },
      signature: [nextDiagramId, laneSignature(nextLane), layoutSignature(nextLayout)].join('::'),
    };
  }, []);

  const syncBundle = useCallback((bundle, nextView, shouldFit = true) => {
    historicalRef.current = null;
    setHistoricalRevision(null);
    setRevisionDiff(null);
    replaceRegionPreview({});
    regionInteractionRef.current = null;
    diagramRef.current = bundle.diagramId;
    setDiagramId(bundle.diagramId);
    laneRef.current = bundle.lane;
    setLane(bundle.lane);
    Object.entries(bundle.layouts || {}).forEach(([viewName, nextLayout]) => updateLayouts(viewName, nextLayout));
    bundleSignatureRef.current = bundle.signature;
    displayGraph(bundle.graph, shouldFit);
    viewRef.current = nextView;
    setView(nextView);
  }, [displayGraph, replaceRegionPreview, updateLayouts]);

  const loadView = useCallback(async (nextView, quiet = false, nextDiagramId = diagramRef.current) => {
    if (!quiet) setLoading(true);
    try {
      const bundle = await fetchViewBundle(nextView, nextDiagramId);
      setRevisionPanelOpen(false);
      syncBundle(bundle, nextView, !quiet);
    } catch (error) {
      showToast(error.message);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [fetchViewBundle, showToast, syncBundle]);

  const refreshDocuments = useCallback(async (quiet = false) => {
    if (!quiet) setDocumentLoading(true);
    try {
      const next = await getDocuments();
      const normalized = { ...EMPTY_REGISTRY, ...next, documents: next.documents || [] };
      registryRef.current = normalized;
      setRegistry(normalized);
      replaceNodes(enrichNodesWithDocuments(nodesRef.current, normalized.documents));
      return normalized;
    } catch (error) {
      if (!quiet) showToast(error.message);
      return registryRef.current;
    } finally {
      if (!quiet) setDocumentLoading(false);
    }
  }, [replaceNodes, showToast]);

  const replaceAnalysis = useCallback((next) => {
    const normalized = {
      ...EMPTY_ANALYSIS,
      ...next,
      sources: next?.sources || [],
      evidence: next?.evidence || [],
      proposals: next?.proposals || [],
      runs: next?.runs || [],
      artifacts: next?.artifacts || [],
      integration: { ...EMPTY_ANALYSIS.integration, ...(next?.integration || {}) },
    };
    analysisRef.current = normalized;
    setAnalysis(normalized);
    return normalized;
  }, []);

  const refreshAnalysis = useCallback(async (quiet = false) => {
    if (!quiet) setAnalysisLoading(true);
    try {
      return replaceAnalysis(await getAnalysis());
    } catch (error) {
      if (!quiet) showToast(error.message);
      return analysisRef.current;
    } finally {
      if (!quiet) setAnalysisLoading(false);
    }
  }, [replaceAnalysis, showToast]);

  const refreshSkills = useCallback(async (quiet = false) => {
    try {
      const next = await getSkills();
      const normalized = { ...EMPTY_SKILL_CATALOG, ...next, skills: next?.skills || [] };
      setSkillCatalog(normalized);
      return normalized;
    } catch (error) {
      if (!quiet) showToast(error.message);
      return EMPTY_SKILL_CATALOG;
    }
  }, [showToast]);

  useEffect(() => {
    Promise.all([getViewerConfig(), getDiagramCatalog()]).then(([nextConfig, nextCatalog]) => {
      const normalizedConfig = {
        ...DEFAULT_CONFIG,
        ...nextConfig,
        views: { ...DEFAULT_CONFIG.views, ...nextConfig.views },
      };
      const normalizedCatalog = {
        ...EMPTY_DIAGRAM_CATALOG,
        ...nextCatalog,
        diagrams: nextCatalog.diagrams || [],
      };
      if (!normalizedCatalog.defaultDiagramId || !normalizedCatalog.diagrams.length) {
        throw new Error('项目尚未配置可查看的架构图');
      }
      configRef.current = normalizedConfig;
      diagramCatalogRef.current = normalizedCatalog;
      diagramRef.current = normalizedCatalog.defaultDiagramId;
      setConfig(normalizedConfig);
      setDiagramCatalog(normalizedCatalog);
      setDiagramId(normalizedCatalog.defaultDiagramId);
      setCatalogReady(true);
    }).catch((error) => {
      setLoading(false);
      showToast(error.message);
    });
  }, [showToast]);

  useEffect(() => {
    if (catalogReady) loadView('current', false, diagramRef.current);
  }, [catalogReady, loadView]);
  useEffect(() => { refreshDocuments(); }, [refreshDocuments]);
  useEffect(() => { refreshAnalysis(); }, [refreshAnalysis]);
  useEffect(() => { refreshSkills(true); }, [refreshSkills]);

  useEffect(() => {
    if (!fitAfterLoadRef.current || !nodes.length) return;
    fitAfterLoadRef.current = false;
    const timer = window.setTimeout(() => fitView({ padding: 0.18, duration: 320 }), 40);
    return () => window.clearTimeout(timer);
  }, [fitView, nodes.length, view, historicalRevision?.revisionId]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (historicalRef.current || draggingRef.current) return;
      try {
        const bundle = await fetchViewBundle(viewRef.current);
        if (bundle.signature !== bundleSignatureRef.current) {
          syncBundle(bundle, viewRef.current, false);
          showToast('本地架构与排版已同步');
        }
      } catch {
        // 保持上一次可读状态，下一轮继续尝试本地同步。
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [fetchViewBundle, showToast, syncBundle]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const next = await getDocuments();
        if (documentSignature(next) !== documentSignature(registryRef.current)) {
          const normalized = { ...EMPTY_REGISTRY, ...next, documents: next.documents || [] };
          registryRef.current = normalized;
          setRegistry(normalized);
          replaceNodes(enrichNodesWithDocuments(nodesRef.current, normalized.documents));
        }
      } catch {
        // 文档登记册保持上一次可读状态。
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [replaceNodes]);

  useEffect(() => {
    const closeOnOutside = (event) => {
      if (!architectureSelectorRef.current?.contains(event.target)) setArchitectureSelectorOpen(false);
      if (!levelSelectorRef.current?.contains(event.target)) setLevelSelectorOpen(false);
      if (!diagramSelectorRef.current?.contains(event.target)) setDiagramSelectorOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      setArchitectureSelectorOpen(false);
      setLevelSelectorOpen(false);
      setDiagramSelectorOpen(false);
      setAnalysisWorkbenchOpen(false);
      setReviewProposalId(null);
      setCanvasFullscreen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('cockpit-focus-open', canvasFullscreen);
    const timer = window.setTimeout(() => fitView({ padding: 0.18, duration: 220 }), 40);
    return () => {
      window.clearTimeout(timer);
      document.body.classList.remove('cockpit-focus-open');
    };
  }, [canvasFullscreen, fitView]);

  useEffect(() => {
    try { window.localStorage.setItem(INSPECTOR_COLLAPSED_KEY, String(inspectorCollapsed)); } catch { /* 保持当前会话。 */ }
    const timer = window.setTimeout(() => fitView({ padding: 0.18, duration: 180 }), 40);
    return () => window.clearTimeout(timer);
  }, [fitView, inspectorCollapsed]);

  useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);

  const beginInspectorResize = useCallback((event) => {
    if (inspectorCollapsed) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = inspectorWidth;
    document.body.classList.add('is-resizing-inspector');
    const handleMove = (moveEvent) => {
      const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width || window.innerWidth;
      const maxWidth = Math.max(280, Math.min(640, workspaceWidth - 480));
      setInspectorWidth(Math.max(280, Math.min(maxWidth, startWidth + startX - moveEvent.clientX)));
    };
    const handleUp = () => {
      document.body.classList.remove('is-resizing-inspector');
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
      setInspectorWidth((width) => {
        const normalized = clampInspectorWidth(width);
        try { window.localStorage.setItem(INSPECTOR_WIDTH_KEY, String(normalized)); } catch { /* 保持当前会话。 */ }
        return normalized;
      });
      window.setTimeout(() => fitView({ padding: 0.18, duration: 160 }), 30);
    };
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp, { once: true });
  }, [fitView, inspectorCollapsed, inspectorWidth]);

  const handleNodesChange = useCallback((changes) => {
    const regionSelection = changes.find((change) => change.type === 'select' && change.id.startsWith(REGION_NODE_PREFIX));
    if (regionSelection) setSelectedRegionId(regionSelection.selected ? regionSelection.id : null);
    const allowed = changes.filter((change) => (
      !change.id.startsWith(REGION_NODE_PREFIX)
      && ['position', 'dimensions', 'select'].includes(change.type)
    ));
    if (!allowed.length) return;
    replaceNodes(applyNodeChanges(allowed, nodesRef.current));
  }, [replaceNodes]);

  const saveLayoutChanges = useCallback(async ({ positions = {}, containers, message = '排版已保存；架构内容没有改变' }) => {
    const activeView = viewRef.current;
    const activeDiagram = diagramRef.current;
    if (!['current', 'target'].includes(activeView) || historicalRef.current) return;
    let currentLayout = layoutsRef.current[activeView] || EMPTY_LAYOUT;
    try {
      let saved;
      try {
        saved = await putViewerLayout(activeView, currentLayout, positions, activeDiagram, containers);
      } catch (error) {
        if (error.code !== 'STALE_LAYOUT') throw error;
        currentLayout = await getViewerLayout(activeView, activeDiagram);
        saved = await putViewerLayout(activeView, currentLayout, positions, activeDiagram, containers);
      }
      updateLayouts(activeView, saved);
      if (containers) {
        replaceRegionPreview((current) => {
          const next = { ...current };
          Object.keys(containers).forEach((containerId) => { delete next[containerId]; });
          return next;
        });
      }
      bundleSignatureRef.current = [activeDiagram, laneSignature(laneRef.current), layoutSignature(saved)].join('::');
      showToast(message);
      return saved;
    } catch (error) {
      showToast(error.message);
      await loadView(activeView, true, activeDiagram);
      return null;
    }
  }, [loadView, replaceRegionPreview, showToast, updateLayouts]);

  const saveNodePosition = useCallback(async (node) => {
    const activeView = viewRef.current;
    const activeLayout = layoutsRef.current[activeView] || EMPTY_LAYOUT;
    const groupDefinition = (laneRef.current?.meta?.groups || []).find((entry) => entry.group === node.data?.group);
    let containers;
    if (groupDefinition) {
      const currentGeometry = groupGeometry(groupDefinition, activeLayout, regionPreviewRef.current);
      const expandedGeometry = expandGeometryToContainNode(currentGeometry, node);
      if (!sameGeometry(currentGeometry, expandedGeometry)) {
        containers = { [groupDefinition.id]: expandedGeometry };
        replaceRegionPreview((current) => ({ ...current, [groupDefinition.id]: expandedGeometry }));
      }
    }
    await saveLayoutChanges({
      positions: { [node.id]: { x: node.position.x, y: node.position.y } },
      containers,
    });
  }, [replaceRegionPreview, saveLayoutChanges]);

  const previewRegionResize = useCallback((groupId, geometry) => {
    draggingRef.current = true;
    replaceRegionPreview((current) => ({
      ...current,
      [groupId]: {
        x: finiteNumber(geometry.x),
        y: finiteNumber(geometry.y),
        width: Math.max(REGION_MIN_WIDTH, finiteNumber(geometry.width, REGION_MIN_WIDTH)),
        height: Math.max(REGION_MIN_HEIGHT, finiteNumber(geometry.height, REGION_MIN_HEIGHT)),
      },
    }));
  }, [replaceRegionPreview]);

  const saveRegionResize = useCallback(async (groupId, geometry) => {
    const normalized = {
      x: finiteNumber(geometry.x),
      y: finiteNumber(geometry.y),
      width: Math.max(REGION_MIN_WIDTH, finiteNumber(geometry.width, REGION_MIN_WIDTH)),
      height: Math.max(REGION_MIN_HEIGHT, finiteNumber(geometry.height, REGION_MIN_HEIGHT)),
    };
    previewRegionResize(groupId, normalized);
    try {
      await saveLayoutChanges({
        containers: { [groupId]: normalized },
        message: '分组区域大小已保存；卡片归属没有改变',
      });
    } finally {
      draggingRef.current = false;
    }
  }, [previewRegionResize, saveLayoutChanges]);

  const openRevisionPanel = useCallback(async () => {
    if (viewRef.current === 'compare') {
      showToast('请先选择当前架构或目标架构，再查看对应版本历史');
      return;
    }
    setRevisionPanelOpen(true);
    setRevisionLoading(true);
    try {
      const catalog = await getRevisions(viewRef.current, diagramRef.current);
      setRevisionCatalog({ headRevisionId: catalog.headRevisionId, revisions: catalog.revisions || [] });
    } catch (error) {
      showToast(error.message);
    } finally {
      setRevisionLoading(false);
    }
  }, [showToast]);

  const inspectRevision = useCallback(async (summary) => {
    setRevisionLoading(true);
    try {
      const payload = await getRevision(viewRef.current, summary.revisionId, diagramRef.current);
      const revision = payload.revision || payload;
      historicalRef.current = revision;
      setHistoricalRevision(revision);
      displayGraph(revision.graph, true);
      setRevisionPanelOpen(false);
      try {
        setRevisionDiff(await getRevisionDiff(viewRef.current, revision.revisionId, 'head', diagramRef.current));
      } catch {
        setRevisionDiff({ summary: diffSummary(revision.graph, laneRef.current.published.graph) });
      }
      showToast(`正在查看 R${revision.revision}；正式架构没有改变`);
    } catch (error) {
      showToast(error.message);
    } finally {
      setRevisionLoading(false);
    }
  }, [displayGraph, showToast]);

  const returnFromHistorical = useCallback(() => loadView(viewRef.current), [loadView]);

  const openDocumentLibrary = useCallback(async () => {
    setDocumentLibraryOpen(true);
    await refreshDocuments();
  }, [refreshDocuments]);

  const openDocumentPreview = useCallback(async (document) => {
    setPreview({ title: document.title, path: document.path, content: '' });
    setPreviewLoading(true);
    try {
      const payload = await previewDocument(document.id);
      setPreview({ ...payload, title: document.title, path: payload.path || document.path });
    } catch (error) {
      setPreview(null);
      showToast(error.message);
    } finally {
      setPreviewLoading(false);
    }
  }, [showToast]);

  const openAnalysisWorkbench = useCallback(async () => {
    if (historicalRef.current || viewRef.current === 'compare') {
      showToast('请先回到当前架构或目标架构，再打开智能体工作台');
      return;
    }
    setAnalysisWorkbenchOpen(true);
    await Promise.all([refreshAnalysis(), refreshSkills(true)]);
  }, [refreshAnalysis, refreshSkills, showToast]);

  const copySkillPrompt = useCallback(async (skill) => {
    if (!skill?.defaultPrompt) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(skill.defaultPrompt);
      showToast(`已复制“${skill.displayName}”调用提示`);
    } catch {
      showToast(`无法自动复制；请让编码智能体读取 ${skill.skillPath}`);
    }
  }, [showToast]);

  const copyAgentConnection = useCallback(async () => {
    const instructions = [
      '请连接本项目的 AI Architecture Viewer MCP 服务。',
      `启动命令：${analysisRef.current.integration?.mcpCommand || 'npm run mcp'}`,
      '先调用 get_project_context，再调用 create_agent_run。',
      '概念项目可从用户确认的讨论结论或 Markdown 设计材料提交目标提案，无需代码仓库。',
      '文件依据路径必须相对于查看器配置的工作区根目录。',
      '每条依据标明 user-confirmed、design-document、code-fact 或 agent-inference；当前架构只能引用 code-fact。',
      '根据任务提交 architecture snapshot、change proposal 或 implementation report，并附带 evidence manifest。',
      '不要接受提案或发布架构；这两步必须由用户在查看器中完成。',
    ].join('\n');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(instructions);
      showToast('已复制智能体接入说明');
    } catch {
      showToast('无法自动复制；请运行 npm run mcp 查看接入入口');
    }
  }, [showToast]);

  const openProposalReview = useCallback((proposal) => {
    if (!proposal?.id) return;
    setReviewProposalId(proposal.id);
  }, []);

  const acceptProposal = useCallback(async (proposal) => {
    if (!proposal?.id) return;
    setAnalysisActionBusy(true);
    try {
      const result = await acceptAnalysisProposal(proposal.id, analysisRef.current.baseRevision);
      replaceAnalysis(result.analysis);
      setReviewProposalId(null);
      if (proposal.view === viewRef.current && proposal.diagramId === diagramRef.current && !historicalRef.current) {
        await loadView(viewRef.current, false, diagramRef.current);
      }
      showToast('提案已写入草案；正式架构尚未改变');
    } catch (error) {
      showToast(error.message);
      throw error;
    } finally {
      setAnalysisActionBusy(false);
    }
  }, [loadView, replaceAnalysis, showToast]);

  const rejectProposal = useCallback(async (proposal) => {
    if (!proposal?.id) return;
    setAnalysisActionBusy(true);
    try {
      const next = await rejectAnalysisProposal(proposal.id, analysisRef.current.baseRevision);
      replaceAnalysis(next);
      setReviewProposalId(null);
      showToast('提案已拒绝，正式架构没有改变');
    } catch (error) {
      showToast(error.message);
      throw error;
    } finally {
      setAnalysisActionBusy(false);
    }
  }, [replaceAnalysis, showToast]);

  const openEvidenceExcerpt = useCallback((evidence) => {
    if (!evidence) return;
    const isDiscussion = evidence.sourceKind === 'discussion';
    const range = evidence.lineEnd && evidence.lineEnd !== evidence.lineStart
      ? `${evidence.lineStart}–${evidence.lineEnd}`
      : evidence.lineStart;
    setPreview({
      title: isDiscussion ? '用户讨论依据摘录' : '资料依据摘录',
      path: isDiscussion ? (evidence.sourceLabel || '用户与智能体讨论') : `${evidence.path}:${range}`,
      content: evidence.excerpt || '',
    });
    setPreviewLoading(false);
  }, []);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId) || null;
  const readOnlyHistorical = Boolean(historicalRevision);
  const draggable = !readOnlyHistorical && view !== 'compare';

  const displayEdges = useMemo(() => {
    const routedEdges = edges.map((edge) => {
      const autoEdge = { ...edge, data: { ...edge.data, routingMode: 'auto' } };
      const styled = styleFlowEdge(autoEdge);
      const ports = resolveEdgePorts(nodes, autoEdge);
      return { edge, styled, ports };
    });
    const sourceBundles = new Map();
    const targetBundles = new Map();
    routedEdges.forEach(({ edge, ports }) => {
      const sourceKey = `${edge.source}:${ports.sourcePort}`;
      const targetKey = `${edge.target}:${ports.targetPort}`;
      sourceBundles.set(sourceKey, (sourceBundles.get(sourceKey) || 0) + 1);
      targetBundles.set(targetKey, (targetBundles.get(targetKey) || 0) + 1);
    });
    return routedEdges.map(({ edge, styled, ports }, edgeIndex) => {
      const related = edge.id === selectedEdgeId
        || (selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId));
      const emphasized = focusSelection && related;
      const sourceBundleCount = sourceBundles.get(`${edge.source}:${ports.sourcePort}`) || 1;
      const targetBundleCount = targetBundles.get(`${edge.target}:${ports.targetPort}`) || 1;
      const className = [styled.className, emphasized ? 'is-emphasized' : '']
        .filter(Boolean)
        .join(' ');
      return {
        ...styled,
        sourceHandle: ports.sourcePort,
        targetHandle: ports.targetPort,
        selected: edge.id === selectedEdgeId || edge.selected,
        label: styled.label,
        className,
        style: {
          ...styled.style,
          strokeWidth: Number(styled.style?.strokeWidth || 1.7) + (emphasized ? 0.9 : 0),
          ...(emphasized ? { filter: 'drop-shadow(0 1px 2px rgba(31, 115, 85, 0.24))' } : {}),
        },
        data: {
          ...styled.data,
          routingMode: 'auto',
          __nodes: nodes,
          __sourcePort: ports.sourcePort,
          __targetPort: ports.targetPort,
          __laneIndex: edgeIndex,
          __sourceBundleCount: sourceBundleCount,
          __targetBundleCount: targetBundleCount,
          __editable: false,
        },
      };
    });
  }, [edges, focusSelection, nodes, selectedEdgeId, selectedNodeId]);

  const architectureViews = useMemo(() => ['current', 'target', 'compare'].map((key) => [
    key,
    config.views[key]?.label || DEFAULT_CONFIG.views[key].label,
    config.views[key]?.description || DEFAULT_CONFIG.views[key].description,
  ]), [config.views]);
  const selectedArchitectureView = architectureViews.find(([key]) => key === view) || architectureViews[0];
  const selectedDiagram = diagramCatalog.diagrams.find((entry) => entry.id === diagramId)
    || diagramCatalog.diagrams[0]
    || null;
  const navigationSections = useMemo(
    () => buildNavigationSections(diagramCatalog.diagrams),
    [diagramCatalog.diagrams],
  );
  const selectedNavigationSection = selectedDiagram?.navigation
    ? navigationSections.find((section) => section.id === selectedDiagram.navigation.sectionId) || null
    : null;
  const navigationLocation = useMemo(
    () => resolveNavigationLocation(diagramCatalog.diagrams, selectedDiagram),
    [diagramCatalog.diagrams, selectedDiagram],
  );
  const selectedNavigationAnchor = navigationLocation.anchor;
  const navigationTrail = navigationLocation.trail;

  const selectDiagram = useCallback(async (nextDiagramId, focusNodeId = null) => {
    setLevelSelectorOpen(false);
    setDiagramSelectorOpen(false);
    if (!nextDiagramId) return;
    if (nextDiagramId === diagramRef.current) {
      if (focusNodeId && nodesRef.current.some((node) => node.id === focusNodeId)) {
        setSelectedRegionId(null);
        setSelectedEdgeId(null);
        setSelectedNodeId(focusNodeId);
        setFocusSelection(true);
      }
      return;
    }
    navigationFocusRef.current = focusNodeId;
    setCorrectionNodeId(null);
    setPublishDialogOpen(false);
    setReviewProposalId(null);
    const emptyLayouts = { current: EMPTY_LAYOUT, target: EMPTY_LAYOUT };
    layoutsRef.current = emptyLayouts;
    setLayouts(emptyLayouts);
    await loadView(viewRef.current, false, nextDiagramId);
  }, [loadView]);

  const selectedChildDiagram = selectedNode
    ? diagramCatalog.diagrams.find((entry) => (
      entry.parentDiagramId === diagramId && entry.ownerNodeId === selectedNode.id
    )) || null
    : null;
  const selectedRelatedDiagram = selectedNode?.data?.relatedDiagramId
    ? diagramCatalog.diagrams.find((entry) => entry.id === selectedNode.data.relatedDiagramId) || null
    : null;
  const groups = Array.isArray(lane?.meta?.groups) ? lane.meta.groups : [];
  const groupLabels = groups.map((group) => group.group || `${group.level || 'L1'}｜${group.label}`);
  const draftDiff = lane?.draft ? diffSummary(lane.published.graph, lane.draft.graph) : null;
  const correctionNode = nodes.find((node) => node.id === correctionNodeId) || null;
  const activeAnalysisProposals = analysis.proposals.filter((proposal) => (
    proposal.diagramId === diagramId && proposal.view === view
  ));
  const activeAgentRuns = analysis.runs.filter((run) => (
    run.diagramId === diagramId && run.view === view
  ));
  const pendingAnalysisCount = activeAnalysisProposals.filter((proposal) => proposal.status === 'pending').length;
  const reviewProposal = activeAnalysisProposals.find((proposal) => proposal.id === reviewProposalId) || null;
  const analysisReviews = activeAnalysisProposals
    .filter((proposal) => proposal.status !== 'pending')
    .map((proposal) => ({
      id: proposal.id,
      title: proposal.title,
      summary: proposal.summary,
      status: proposal.status,
      reviewedAt: proposal.reviewedAt,
      acceptedCount: proposal.status === 'accepted' ? proposal.changes.length : 0,
      rejectedCount: proposal.status === 'rejected' ? proposal.changes.length : 0,
      proposal,
    }));

  const displayNodes = useMemo(() => {
    const relatedNodeIds = new Set();
    if (selectedNodeId) {
      relatedNodeIds.add(selectedNodeId);
      edges.forEach((edge) => {
        if (edge.source === selectedNodeId) relatedNodeIds.add(edge.target);
        if (edge.target === selectedNodeId) relatedNodeIds.add(edge.source);
      });
    }
    if (selectedEdgeId) {
      const edge = edges.find((item) => item.id === selectedEdgeId);
      if (edge) {
        relatedNodeIds.add(edge.source);
        relatedNodeIds.add(edge.target);
      }
    }
    const childOwnerIds = new Set(diagramCatalog.diagrams
      .filter((entry) => entry.parentDiagramId === diagramId && entry.ownerNodeId)
      .map((entry) => entry.ownerNodeId));
    const semanticNodes = nodes.map((node) => ({
      ...node,
      zIndex: 2,
      data: {
        ...node.data,
        __hasChildDiagram: childOwnerIds.has(node.id),
        __mutedByFocus: false,
        __relatedByFocus: focusSelection && relatedNodeIds.has(node.id),
      },
    }));
    const layoutView = view === 'compare' ? 'target' : view;
    const activeLayout = layouts[layoutView] || EMPTY_LAYOUT;
    const regionNodes = groups.flatMap((group, index) => {
      const childNodes = semanticNodes.filter((node) => node.data?.group === group.group);
      if (!childNodes.length) return [];
      const geometry = groupGeometry(group, activeLayout, regionPreview);
      const minimumRight = Math.max(...childNodes.map((node) => node.position.x + nodeWidth(node) + REGION_CARD_PADDING));
      const minimumBottom = Math.max(...childNodes.map((node) => node.position.y + nodeHeight(node) + REGION_CARD_PADDING));
      const minWidth = Math.max(REGION_MIN_WIDTH, minimumRight - geometry.x);
      const minHeight = Math.max(REGION_MIN_HEIGHT, minimumBottom - geometry.y);
      const id = regionNodeId(group.id || String(index));
      return [{
        id,
        type: 'groupRegion',
        position: { x: geometry.x, y: geometry.y },
        width: geometry.width,
        height: geometry.height,
        style: { width: geometry.width, height: geometry.height },
        selected: selectedRegionId === id,
        dragHandle: '.group-region__drag-handle',
        data: {
          label: group.label || group.group || `分组 ${index + 1}`,
          description: group.description || '',
          color: group.color,
          accent: group.accent,
          level: group.level || 'L1',
          __groupId: group.id,
          __group: group.group,
          __resizable: draggable,
          __minWidth: minWidth,
          __minHeight: minHeight,
          __onResize: previewRegionResize,
          __onResizeEnd: saveRegionResize,
        },
        draggable,
        selectable: true,
        connectable: false,
        deletable: false,
        focusable: true,
        zIndex: -1,
      }];
    });
    return [...regionNodes, ...semanticNodes];
  }, [
    groups,
    diagramCatalog.diagrams,
    diagramId,
    draggable,
    edges,
    focusSelection,
    layouts,
    nodes,
    previewRegionResize,
    regionPreview,
    saveRegionResize,
    selectedEdgeId,
    selectedNodeId,
    selectedRegionId,
    view,
  ]);

  const beginCanvasNodeDrag = useCallback((_, node) => {
    draggingRef.current = true;
    if (node.type !== 'groupRegion') return;
    const groupId = node.data?.__groupId;
    const group = node.data?.__group;
    const activeView = viewRef.current;
    const activeLayout = layoutsRef.current[activeView] || EMPTY_LAYOUT;
    const groupDefinition = (laneRef.current?.meta?.groups || []).find((entry) => entry.id === groupId);
    if (!groupDefinition || !group) return;
    const geometry = groupGeometry(groupDefinition, activeLayout, regionPreviewRef.current);
    const childPositions = {};
    nodesRef.current.forEach((entry) => {
      if (entry.data?.group === group) childPositions[entry.id] = { ...entry.position };
    });
    regionInteractionRef.current = {
      groupId,
      group,
      startPosition: { ...node.position },
      geometry,
      childPositions,
    };
    setSelectedRegionId(node.id);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setFocusSelection(false);
  }, []);

  const moveCanvasNode = useCallback((_, node) => {
    if (node.type !== 'groupRegion') return;
    const interaction = regionInteractionRef.current;
    if (!interaction || interaction.groupId !== node.data?.__groupId) return;
    const delta = {
      x: finiteNumber(node.position?.x) - finiteNumber(interaction.startPosition?.x),
      y: finiteNumber(node.position?.y) - finiteNumber(interaction.startPosition?.y),
    };
    replaceNodes(nodesRef.current.map((entry) => {
      const original = interaction.childPositions[entry.id];
      if (!original) return entry;
      return { ...entry, position: { x: original.x + delta.x, y: original.y + delta.y } };
    }));
    replaceRegionPreview((current) => ({
      ...current,
      [interaction.groupId]: {
        ...interaction.geometry,
        x: interaction.geometry.x + delta.x,
        y: interaction.geometry.y + delta.y,
      },
    }));
  }, [replaceNodes, replaceRegionPreview]);

  const stopCanvasNodeDrag = useCallback(async (event, node) => {
    if (node.type !== 'groupRegion') {
      try { await saveNodePosition(node); } finally { draggingRef.current = false; }
      return;
    }
    const interaction = regionInteractionRef.current;
    if (!interaction || interaction.groupId !== node.data?.__groupId) {
      draggingRef.current = false;
      return;
    }
    moveCanvasNode(event, node);
    const delta = {
      x: finiteNumber(node.position?.x) - finiteNumber(interaction.startPosition?.x),
      y: finiteNumber(node.position?.y) - finiteNumber(interaction.startPosition?.y),
    };
    const positions = Object.fromEntries(Object.entries(interaction.childPositions).map(([nodeId, position]) => [
      nodeId,
      { x: position.x + delta.x, y: position.y + delta.y },
    ]));
    const geometry = {
      ...interaction.geometry,
      x: interaction.geometry.x + delta.x,
      y: interaction.geometry.y + delta.y,
    };
    regionInteractionRef.current = null;
    try {
      await saveLayoutChanges({
        positions,
        containers: { [interaction.groupId]: geometry },
        message: '分组区域与内部卡片已整体移动；卡片归属没有改变',
      });
    } finally {
      draggingRef.current = false;
    }
  }, [moveCanvasNode, saveLayoutChanges, saveNodePosition]);

  const saveArchitectureCorrection = useCallback(async (correction) => {
    const activeLane = laneRef.current;
    const activeView = viewRef.current;
    const activeDiagram = diagramRef.current;
    if (!activeLane || !['current', 'target'].includes(activeView) || historicalRef.current) return;
    const baseGraph = visibleGraph(activeLane);
    const nextGraph = JSON.parse(JSON.stringify(baseGraph));
    const node = nextGraph.nodes.find((entry) => entry.id === correctionNodeId);
    if (!node) {
      showToast('所选模块已经变化，请刷新后重试');
      return;
    }
    node.data = { ...node.data, ...correction };
    try {
      await putDraft(activeView, activeLane, nextGraph, activeDiagram, { userConfirmedSemanticOverride: true });
      setCorrectionNodeId(null);
      await loadView(activeView, false, activeDiagram);
      showToast('你的纠正已写入草案，并已标记为人工确认');
    } catch (error) {
      showToast(error.message);
      throw error;
    }
  }, [correctionNodeId, loadView, showToast]);

  const publishCurrentDraft = useCallback(async (message) => {
    const activeLane = laneRef.current;
    const activeView = viewRef.current;
    const activeDiagram = diagramRef.current;
    if (!activeLane?.draft || !['current', 'target'].includes(activeView) || historicalRef.current) return;
    try {
      await publishDraft(activeView, activeLane, message, activeDiagram);
      setPublishDialogOpen(false);
      await loadView(activeView, false, activeDiagram);
      showToast('修订已发布为新的正式架构版本');
    } catch (error) {
      showToast(error.message);
      throw error;
    }
  }, [loadView, showToast]);

  const modeText = loading || !lane
    ? '正在加载'
    : readOnlyHistorical
      ? `历史 R${historicalRevision.revision} · 只读`
      : view === 'compare'
        ? '只读差异对比'
        : lane.draft
          ? `AI 待确认${view === 'target' ? '目标' : '当前'}方案 · 正式版 R${lane.published.revision} 未改变`
          : `${view === 'target' ? '正式目标' : '正式当前'}架构 · R${lane.published.revision}`;

  const editContext = useMemo(() => ({ editable: false, onResizeEnd: () => {} }), []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">{config.eyebrow}</span>
          <h1>{config.viewerName}</h1>
          <p>{config.scopeNote}</p>
        </div>
        <div className="top-actions">
          <span className={`mode-badge ${lane?.draft ? 'is-draft' : ''}`}>{modeText}</span>
          {readOnlyHistorical && <button type="button" onClick={returnFromHistorical}>返回当前工作视图</button>}
        </div>
      </header>

      <main>
        <section
          ref={workspaceRef}
          className={`workspace ${inspectorCollapsed ? 'inspector-collapsed' : ''} ${canvasFullscreen ? 'is-canvas-fullscreen' : ''}`}
          style={{ '--inspector-width': `${inspectorWidth}px` }}
        >
          <div className="graph-area">
            <div className="graph-heading">
              <div className="architecture-navigation">
                <div className="architecture-selector" ref={architectureSelectorRef}>
                  <button
                    className="architecture-selector-trigger"
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={architectureSelectorOpen}
                    onClick={() => {
                      setLevelSelectorOpen(false);
                      setDiagramSelectorOpen(false);
                      setArchitectureSelectorOpen((open) => !open);
                    }}
                  >
                    <span className="architecture-brand">{config.projectName}</span>
                    <span className="architecture-view-name">{selectedArchitectureView[1]}</span>
                    <span className={`architecture-chevron ${architectureSelectorOpen ? 'open' : ''}`} aria-hidden="true">⌄</span>
                  </button>
                  {readOnlyHistorical && <span className="historical-title-badge">历史 R{historicalRevision.revision} · 只读</span>}
                  {architectureSelectorOpen && (
                    <div className="architecture-selector-menu" role="menu" aria-label="切换架构状态">
                      {architectureViews.map(([key, label, description]) => (
                        <button
                          key={key}
                          type="button"
                          role="menuitemradio"
                          aria-checked={view === key && !readOnlyHistorical}
                          className={view === key && !readOnlyHistorical ? 'selected' : ''}
                          onClick={() => {
                            setArchitectureSelectorOpen(false);
                            loadView(key);
                          }}
                        >
                          <span className="selector-check" aria-hidden="true">{view === key && !readOnlyHistorical ? '✓' : ''}</span>
                          <span><strong>{label}</strong><small>{description}</small></span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <span className="architecture-navigation-divider" aria-hidden="true">/</span>

                <div className="diagram-selector navigation-level-selector" ref={levelSelectorRef}>
                  <button
                    className="diagram-selector-trigger diagram-level-trigger"
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={levelSelectorOpen}
                    disabled={readOnlyHistorical || navigationSections.length < 2}
                    onClick={() => {
                      setArchitectureSelectorOpen(false);
                      setDiagramSelectorOpen(false);
                      setLevelSelectorOpen((open) => !open);
                    }}
                  >
                    <span>{selectedNavigationSection?.label || '观察视角'}</span>
                    {navigationSections.length > 1 && (
                      <span className={`architecture-chevron ${levelSelectorOpen ? 'open' : ''}`} aria-hidden="true">⌄</span>
                    )}
                  </button>
                  {levelSelectorOpen && (
                    <div className="architecture-selector-menu diagram-level-menu" role="menu" aria-label="选择架构层级">
                      {navigationSections.map((section) => (
                        <button
                          key={section.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={section.id === selectedNavigationSection?.id}
                          className={section.id === selectedNavigationSection?.id ? 'selected' : ''}
                          onClick={() => selectDiagram(section.root?.id)}
                        >
                          <span className="selector-check" aria-hidden="true">{section.id === selectedNavigationSection?.id ? '✓' : ''}</span>
                          <span><strong>{section.label}</strong><small>{section.root?.description}</small></span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <span className="architecture-navigation-divider" aria-hidden="true">/</span>

                <div className="diagram-selector" ref={diagramSelectorRef}>
                  <button
                    className="diagram-selector-trigger diagram-detail-trigger"
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={diagramSelectorOpen}
                    disabled={readOnlyHistorical || !selectedNavigationSection || selectedNavigationSection.diagrams.length < 2}
                    onClick={() => {
                      setArchitectureSelectorOpen(false);
                      setLevelSelectorOpen(false);
                      setDiagramSelectorOpen((open) => !open);
                    }}
                  >
                    <span>{selectedNavigationAnchor?.navigation?.label || selectedDiagram?.title || '架构图'}</span>
                    {selectedNavigationSection?.diagrams.length > 1 && (
                      <span className={`architecture-chevron ${diagramSelectorOpen ? 'open' : ''}`} aria-hidden="true">⌄</span>
                    )}
                  </button>
                  {diagramSelectorOpen && (
                    <div className="architecture-selector-menu diagram-selector-menu" role="menu" aria-label="选择当前架构图">
                      {selectedNavigationSection.diagrams.map((diagram) => (
                        <button
                          key={diagram.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={diagram.id === selectedNavigationAnchor?.id}
                          className={diagram.id === selectedNavigationAnchor?.id ? 'selected' : ''}
                          onClick={() => selectDiagram(diagram.id)}
                        >
                          <span className="selector-check" aria-hidden="true">{diagram.id === selectedNavigationAnchor?.id ? '✓' : ''}</span>
                          <span><strong>{diagram.navigation.label}</strong><small>{diagram.description}</small></span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {navigationTrail.map((diagram) => (
                  <span key={diagram.id} className="deep-navigation-segment">
                    <span className="architecture-navigation-divider" aria-hidden="true">/</span>
                    <span className="deep-diagram-label">{diagram.navigation?.label || diagram.title}</span>
                  </span>
                ))}
              </div>
              <div className="graph-heading-actions" aria-label="架构查看工具">
                <button
                  className="analysis-entry"
                  type="button"
                  disabled={readOnlyHistorical || view === 'compare'}
                  onClick={openAnalysisWorkbench}
                >
                  智能体协作 <span>{pendingAnalysisCount}</span>
                </button>
                {!readOnlyHistorical && view !== 'compare' && lane?.draft && (
                  <button className="publish-draft-entry" type="button" onClick={() => setPublishDialogOpen(true)}>
                    审阅并发布
                  </button>
                )}
                <button type="button" disabled={view === 'compare'} onClick={openRevisionPanel}>
                  版本历史 <span>{view === 'compare' ? 0 : lane ? (lane.historyCount || 0) + 1 : revisionCatalog.revisions.length}</span>
                </button>
                <button className="persistent-document-entry" type="button" onClick={openDocumentLibrary}>
                  项目文档 <span>{registry.documents.length}</span>
                </button>
                <button type="button" onClick={() => setInspectorCollapsed((collapsed) => !collapsed)}>
                  {inspectorCollapsed ? '展开侧栏' : '收起侧栏'}
                </button>
                <button type="button" onClick={() => setCanvasFullscreen((fullscreen) => !fullscreen)}>
                  {canvasFullscreen ? '退出全屏' : '全屏画布'}
                </button>
              </div>
            </div>

            {readOnlyHistorical && (
              <div className="notice historical-notice">
                <span>正在查看 {historicalRevision.revisionId}。历史画布只用于查看和比较。</span>
                <div>
                  <button type="button" onClick={openRevisionPanel}>打开版本历史</button>
                  <button className="primary" type="button" onClick={returnFromHistorical}>返回当前工作视图</button>
                </div>
              </div>
            )}
            {readOnlyHistorical && revisionDiff && (
              <div className="historical-diff-bar" aria-label="历史版本与当前正式版差异">
                <strong>与当前正式版比较</strong>
                {[
                  ['结构', (revisionDiff.summary || revisionDiff.categories || {}).structural],
                  ['说明', (revisionDiff.summary || revisionDiff.categories || {}).semantic],
                  ['布局', (revisionDiff.summary || revisionDiff.categories || {}).layout],
                  ['文档绑定', (revisionDiff.summary || revisionDiff.categories || {}).document],
                  ['关系', (revisionDiff.summary || revisionDiff.categories || {}).relationship],
                ].map(([label, value]) => <span key={label}>{label} {typeof value === 'number' ? value : 0}</span>)}
              </div>
            )}

            <div className="canvas-shell">
              <CanvasEditContext.Provider value={editContext}>
                <ReactFlow
                  nodes={displayNodes}
                  edges={displayEdges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  onNodesChange={handleNodesChange}
                  onNodeClick={(_, node) => {
                    if (node.type === 'groupRegion') {
                      setSelectedRegionId(node.id);
                      setSelectedNodeId(null);
                      setSelectedEdgeId(null);
                      setFocusSelection(false);
                      return;
                    }
                    setSelectedRegionId(null);
                    setSelectedEdgeId(null);
                    setSelectedNodeId(node.id);
                    setFocusSelection(true);
                  }}
                  onNodeDoubleClick={(_, node) => {
                    if (node.type === 'groupRegion') return;
                    const child = diagramCatalog.diagrams.find((entry) => (
                      entry.parentDiagramId === diagramId && entry.ownerNodeId === node.id
                    ));
                    if (child) selectDiagram(child.id);
                  }}
                  onEdgeClick={(_, edge) => {
                    setSelectedRegionId(null);
                    setSelectedNodeId(null);
                    setSelectedEdgeId(edge.id);
                    setFocusSelection(true);
                  }}
                  onPaneClick={() => {
                    setSelectedRegionId(null);
                    setSelectedNodeId(null);
                    setSelectedEdgeId(null);
                    setFocusSelection(false);
                  }}
                  onNodeDragStart={beginCanvasNodeDrag}
                  onNodeDrag={moveCanvasNode}
                  onNodeDragStop={stopCanvasNodeDrag}
                  nodesDraggable={draggable}
                  nodesConnectable={false}
                  edgesReconnectable={false}
                  connectionMode={ConnectionMode.Loose}
                  connectOnClick={false}
                  elementsSelectable
                  selectionOnDrag={false}
                  panOnDrag
                  deleteKeyCode={null}
                  minZoom={0.2}
                  maxZoom={2}
                  zoomOnDoubleClick={false}
                  fitView
                  fitViewOptions={{ padding: 0.18 }}
                  proOptions={{ hideAttribution: true }}
                  aria-label={`${config.projectName} ${selectedDiagram?.title || '架构'}查看画布`}
                >
                  <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="#cbd2cb" />
                  <Controls showInteractive={false} />
                  <MiniMap
                    pannable
                    zoomable
                    nodeStrokeWidth={2}
                    nodeColor={(node) => node.type === 'groupRegion'
                      ? node.data?.accent || '#cbd7cf'
                      : node.data?.compareClass === 'compare-only'
                      ? '#f3d5cf'
                      : node.data?.compareClass === 'compare-new'
                        ? '#d9e7f7'
                        : node.data?.compareClass === 'compare-changed' ? '#f3e5bf' : '#dcebe3'}
                    maskColor="rgba(244, 243, 237, 0.72)"
                  />
                </ReactFlow>
              </CanvasEditContext.Provider>
            </div>
          </div>

          {!inspectorCollapsed && (
            <div
              className="workspace-resizer"
              role="separator"
              aria-label="调整右侧面板宽度"
              aria-orientation="vertical"
              aria-valuemin="280"
              aria-valuemax="640"
              aria-valuenow={Math.round(inspectorWidth)}
              onPointerDown={beginInspectorResize}
            ><span /></div>
          )}

          {!inspectorCollapsed && (
            <ViewerDetailPanel
              selectedNode={selectedNode}
              selectedEdge={selectedEdge}
              nodes={nodes}
              edges={edges}
              documents={registry.documents}
              nodeFields={config.nodeFields}
              onSelectEdge={(id) => { setSelectedNodeId(null); setSelectedEdgeId(id); setFocusSelection(true); }}
              onPreviewDocument={openDocumentPreview}
              childDiagram={selectedChildDiagram}
              relatedDiagram={selectedRelatedDiagram}
              onOpenChild={selectDiagram}
              onOpenRelated={selectDiagram}
              canCorrect={!readOnlyHistorical && view !== 'compare'}
              onCorrectNode={() => setCorrectionNodeId(selectedNode.id)}
            />
          )}
        </section>
      </main>

      <RevisionPanel
        open={revisionPanelOpen}
        loading={revisionLoading}
        revisions={revisionCatalog.revisions}
        headRevisionId={revisionCatalog.headRevisionId || lane?.published?.revisionId}
        selectedRevisionId={historicalRevision?.revisionId}
        activeDraft={lane?.draft}
        diff={revisionDiff}
        readOnly
        onClose={() => setRevisionPanelOpen(false)}
        onInspect={inspectRevision}
      />
      <DocumentLibrary
        open={documentLibraryOpen}
        loading={documentLoading}
        documents={registry.documents}
        bindingDiagnostics={registry.bindingDiagnostics}
        readOnly
        onClose={() => setDocumentLibraryOpen(false)}
        onPreview={openDocumentPreview}
      />
      <AnalysisWorkbench
        open={analysisWorkbenchOpen}
        runs={activeAgentRuns}
        proposals={activeAnalysisProposals}
        reviews={analysisReviews}
        skills={skillCatalog.skills}
        integration={analysis.integration}
        activeTab={analysisTab}
        busy={analysisLoading || analysisActionBusy}
        onClose={() => setAnalysisWorkbenchOpen(false)}
        onTabChange={setAnalysisTab}
        onRefresh={() => refreshAnalysis()}
        onCopyConnection={copyAgentConnection}
        onOpenProposal={openProposalReview}
        onCopySkillPrompt={copySkillPrompt}
      />
      <ProposalReviewDialog
        open={Boolean(reviewProposal)}
        proposal={reviewProposal}
        busy={analysisActionBusy}
        onClose={() => setReviewProposalId(null)}
        onAcceptProposal={acceptProposal}
        onRejectProposal={rejectProposal}
        onLocateEvidence={openEvidenceExcerpt}
      />
      <DocumentPreviewDialog preview={preview} loading={previewLoading} onClose={() => { setPreview(null); setPreviewLoading(false); }} />
      <ArchitectureCorrectionDialog
        node={correctionNode}
        groupOptions={groupLabels}
        relatedEdgeCount={correctionNode ? edges.filter((edge) => edge.source === correctionNode.id || edge.target === correctionNode.id).length : 0}
        onCancel={() => setCorrectionNodeId(null)}
        onConfirm={saveArchitectureCorrection}
      />
      {publishDialogOpen && lane?.draft && (
        <PublishDraftDialog
          diagramTitle={selectedDiagram?.title || '当前架构图'}
          viewLabel={selectedArchitectureView[1]}
          diff={draftDiff}
          onCancel={() => setPublishDialogOpen(false)}
          onConfirm={publishCurrentDraft}
        />
      )}
      <div className={`toast ${toastMessage ? 'show' : ''}`} role="status">{toastMessage}</div>
    </div>
  );
}

export default function ViewerApp() {
  return <ReactFlowProvider><Viewer /></ReactFlowProvider>;
}
