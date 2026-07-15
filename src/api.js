export const SCHEMA_VERSION = '3.1.0';
export const DOCUMENT_SCHEMA_VERSION = '1.0.0';
export const LAYOUT_SCHEMA_VERSION = '1.1.0';
export const ANALYSIS_SCHEMA_VERSION = '2.3.0';

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || '本地架构操作失败');
    error.code = payload.code;
    error.status = response.status;
    error.details = payload.details;
    throw error;
  }
  return payload;
}

const lanePath = (path, view, diagram) => {
  const query = new URLSearchParams({ view });
  if (diagram) query.set('diagram', diagram);
  return `${path}?${query.toString()}`;
};

const withQuery = (path, values) => {
  const separator = path.includes('?') ? '&' : '?';
  const query = new URLSearchParams(values);
  return `${path}${separator}${query.toString()}`;
};

export function laneLocks(lane) {
  return {
    schemaVersion: lane.schemaVersion,
    expectedHeadRevision: lane.published.revision,
    expectedHeadRevisionId: lane.published.revisionId,
    expectedDraftId: lane.draft?.draftId ?? null,
    expectedDraftRevision: lane.draft?.draftRevision ?? 0,
  };
}

export const getLane = (view, diagram) => request(lanePath('/api/state', view, diagram));

export const getViewerConfig = () => request('/api/config');

export const getSkills = () => request('/api/skills');

export const getDiagramCatalog = () => request('/api/diagrams');

export const getViewerLayout = (view, diagram) => request(lanePath('/api/layout', view, diagram));

export const putViewerLayout = (view, layout, positions, diagram, containers) =>
  request(lanePath('/api/layout', view, diagram), {
    method: 'PUT',
    body: JSON.stringify({
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      expectedRevision: layout.baseRevision,
      positions,
      ...(containers ? { containers } : {}),
    }),
  });

export const putDraft = (view, lane, graph, diagram, { userConfirmedSemanticOverride = false } = {}) =>
  request(lanePath('/api/draft', view, diagram), {
    method: 'PUT',
    body: JSON.stringify({
      ...laneLocks(lane),
      graph,
      ...(userConfirmedSemanticOverride ? { userConfirmedSemanticOverride: true } : {}),
    }),
  });

export const deleteDraft = (view, lane, diagram) =>
  request(lanePath('/api/draft', view, diagram), {
    method: 'DELETE',
    body: JSON.stringify(laneLocks(lane)),
  });

export const publishDraft = (view, lane, message, diagram) =>
  request(lanePath('/api/publish', view, diagram), {
    method: 'POST',
    body: JSON.stringify({
      ...laneLocks(lane),
      message,
      userConfirmed: true,
    }),
  });

export const getRevisions = (view, diagram) => request(lanePath('/api/revisions', view, diagram));

export const getRevision = (view, revisionId, diagram) =>
  request(withQuery(lanePath('/api/revision', view, diagram), { id: revisionId }));

export const getRevisionDiff = (view, from, to, diagram) =>
  request(withQuery(lanePath('/api/diff', view, diagram), { from, to }));

export const restoreRevision = (view, lane, sourceRevisionId, message, diagram) =>
  request(lanePath('/api/restore', view, diagram), {
    method: 'POST',
    body: JSON.stringify({
      ...laneLocks(lane),
      sourceRevisionId,
      message,
      userConfirmed: true,
    }),
  });

export const getDocuments = () => request('/api/documents');

export const getDocument = (documentId) =>
  request(`/api/documents/${encodeURIComponent(documentId)}`);

export const createDocument = (baseRevision, document) =>
  request('/api/documents', {
    method: 'POST',
    body: JSON.stringify({
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      baseRevision,
      document,
    }),
  });

export const updateDocument = (documentId, baseRevision, document) =>
  request(`/api/documents/${encodeURIComponent(documentId)}`, {
    method: 'PUT',
    body: JSON.stringify({
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      baseRevision,
      document,
    }),
  });

export const deleteDocument = (documentId, baseRevision) =>
  request(`/api/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
    body: JSON.stringify({
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      baseRevision,
    }),
  });

export const previewDocument = (documentId, section = '') => {
  const query = section ? `?section=${encodeURIComponent(section)}` : '';
  return request(`/api/documents/${encodeURIComponent(documentId)}/preview${query}`);
};

export const getAnalysis = () => request('/api/analysis');

export const acceptAnalysisProposal = (proposalId, baseRevision) =>
  request(`/api/analysis/proposals/${encodeURIComponent(proposalId)}/accept`, {
    method: 'POST',
    body: JSON.stringify({ schemaVersion: ANALYSIS_SCHEMA_VERSION, baseRevision, userConfirmed: true }),
  });

export const rejectAnalysisProposal = (proposalId, baseRevision) =>
  request(`/api/analysis/proposals/${encodeURIComponent(proposalId)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ schemaVersion: ANALYSIS_SCHEMA_VERSION, baseRevision, userConfirmed: true }),
  });

export const reviewImplementationRun = (runId, baseRevision, decision, note) =>
  request(`/api/analysis/runs/${encodeURIComponent(runId)}/review`, {
    method: 'POST',
    body: JSON.stringify({
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      baseRevision,
      userConfirmed: true,
      decision,
      note,
    }),
  });
