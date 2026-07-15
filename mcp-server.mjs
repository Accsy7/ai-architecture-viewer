#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v4';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = process.env.PORT || '8800';
const BASE_URL = (process.env.VIEWER_BASE_URL || `http://127.0.0.1:${DEFAULT_PORT}`).replace(/\/+$/, '');
let viewerProcess = null;

function textResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function errorResult(error) {
  const details = error?.details ? `\n${JSON.stringify(error.details, null, 2)}` : '';
  return {
    content: [{ type: 'text', text: `${error?.code || 'VIEWER_REQUEST_FAILED'}: ${error?.message || String(error)}${details}` }],
    isError: true,
  };
}

async function viewerRequest(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Viewer request failed with HTTP ${response.status}`);
    error.code = payload.code || 'VIEWER_REQUEST_FAILED';
    error.status = response.status;
    error.details = payload.details;
    throw error;
  }
  return payload;
}

async function viewerReady() {
  try {
    await viewerRequest('/api/agent/context?view=current');
    return true;
  } catch {
    return false;
  }
}

async function ensureViewer() {
  if (await viewerReady()) return;
  if (process.env.VIEWER_MCP_AUTOSTART === 'false') {
    throw new Error(`AI Architecture Viewer is not reachable at ${BASE_URL}`);
  }
  const url = new URL(BASE_URL);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error(`Refusing to auto-start a viewer for non-local URL ${BASE_URL}`);
  }
  viewerProcess = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: url.port || DEFAULT_PORT,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  viewerProcess.stderr?.pipe(process.stderr);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (await viewerReady()) return;
    if (viewerProcess.exitCode !== null) break;
  }
  throw new Error(`AI Architecture Viewer did not start at ${BASE_URL}`);
}

function query(values) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  });
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

function registerTool(server, name, config, handler) {
  server.registerTool(name, config, async (args) => {
    try {
      return textResult(await handler(args));
    } catch (error) {
      return errorResult(error);
    }
  });
}

const server = new McpServer(
  { name: 'ai-architecture-viewer', version: '0.6.0' },
  {
    instructions: [
      'Use this server as an external visual architecture handoff for coding agents.',
      'Call get_project_context before creating a run.',
      'Create a run before submitting evidence-backed artifacts.',
      'Use one architecture patch per discovery or change-plan run. For another patch, read the compact draft again and create a new run; this advances the lock without user intervention.',
      'Architecture-change runs lock both the published baseline and any active draft ID/revision; validated semantic patches apply directly to that locked draft and stale writes are rejected.',
      'Evidence paths must be relative to the configured code workspace root.',
      'Registered project documents are read only by documentId and optional Markdown section; they may support target design but never implementation facts.',
      'Only a locally human-published target is an executable architecture baseline; an agent-written draft always awaits publication.',
      'Implementation runs lock that published target, submit a code-fact snapshot first, and receive server-computed architecture and formal-contract gates.',
      'An implementation report status is only an agent claim; acceptance requires a complete claim, satisfied contract criteria, an eligible architecture gate, and local human review.',
      'Agents may write validated changes to drafts and submit implementation reports, but cannot publish architecture or review implementation results.',
    ].join(' '),
  },
);

const diagramViewSchema = z.object({
  diagramId: z.string().optional().describe('Optional architecture diagram ID.'),
  view: z.enum(['current', 'target']).optional().describe('Architecture view; defaults to current.'),
});

registerTool(server, 'get_project_context', {
  title: 'Get project architecture context',
  description: 'Read the viewer project, diagram catalog, selected published baseline and execution status, contract invalidation reason, document index, and human-governance boundaries before inspecting or planning.',
  inputSchema: diagramViewSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, ({ diagramId, view }) => viewerRequest(`/api/agent/context${query({ diagram: diagramId, view })}`));

registerTool(server, 'read_project_document', {
  title: 'Read registered project document',
  description: 'Read one registered Markdown document, optionally narrowed to an exact heading. The viewer enforces the project document root, size limits, section matching, and returns content hashes; this is target-design context, not code-fact proof.',
  inputSchema: z.object({
    documentId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
    section: z.string().min(1).max(200).optional(),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, ({ documentId, section }) => viewerRequest(
  `/api/documents/${encodeURIComponent(documentId)}/preview${query({ section })}`,
));

registerTool(server, 'get_current_architecture', {
  title: 'Get current architecture lane',
  description: 'Read a current or target architecture lane as compact published and active-draft semantic graphs. A target draft includes its compact unpublished development contract and stable acceptance-criterion IDs; it is never presented as an approved target.',
  inputSchema: z.object({
    diagramId: z.string().optional(),
    view: z.enum(['current', 'target']).optional().describe('Defaults to current.'),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async ({ diagramId, view = 'current' }) => {
  const context = await viewerRequest(`/api/agent/context${query({ diagram: diagramId, view })}`);
  return {
    protocolVersion: context.protocolVersion,
    project: context.project,
    diagram: {
      id: context.selected.diagramId,
      title: context.selected.title,
      description: context.selected.description,
    },
    view,
    published: context.selected.published,
    developmentContract: context.selected.developmentContract,
    draft: context.selected.draft,
    draftPresent: Boolean(context.selected.draft),
  };
});

registerTool(server, 'create_agent_run', {
  title: 'Create agent architecture run',
  description: 'Create a traceable run and lock its published baseline plus any active draft ID/revision. Use one architecture patch per discovery or change-plan run, then create a new run from the updated compact draft for the next patch. Implementation runs additionally lock the exact executable published target, contract, and document hashes.',
  inputSchema: z.object({
    agentName: z.string().min(1).max(120),
    agentClient: z.string().min(1).max(80).describe('Client identity such as codex or claude-code.'),
    taskType: z.enum(['architecture-discovery', 'architecture-change-plan', 'implementation-reconcile']),
    diagramId: z.string().optional(),
    view: z.enum(['current', 'target']).optional(),
    summary: z.string().min(1).max(1000).optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
}, (input) => viewerRequest('/api/agent/runs', { method: 'POST', body: JSON.stringify(input) }));

const artifactSchema = z.record(z.string(), z.unknown());
const submissionSchema = z.object({
  runId: z.string().min(1),
  artifact: artifactSchema,
  evidenceManifest: artifactSchema,
});

async function submit(runId, artifact, evidenceManifest) {
  return viewerRequest(`/api/agent/runs/${encodeURIComponent(runId)}/artifacts`, {
    method: 'POST',
    body: JSON.stringify({ artifact, evidenceManifest }),
  });
}

registerTool(server, 'submit_architecture_snapshot', {
  title: 'Submit architecture snapshot',
  description: 'Submit a code-fact-backed current architecture snapshot. In an architecture-discovery run, the server applies its additive stable-ID semantic diff directly to the exact locked current draft; stale writes are rejected, and this never publishes or records human approval. In an implementation-reconcile run, the snapshot remains reconciliation evidence only, must come before the report, and never writes the current draft. Discussion and design intent cannot prove implementation.',
  inputSchema: submissionSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
}, ({ runId, artifact, evidenceManifest }) => submit(runId, artifact, evidenceManifest));

registerTool(server, 'submit_change_proposal', {
  title: 'Apply architecture changes to a locked draft',
  description: 'Submit a stable-ID semantic patch backed by user confirmation, design documents, code facts, or labeled agent inference. The server applies it directly to the run-locked draft, records provenance, and rejects stale or no-effect writes. Protocol 1.4 node updates may explicitly clear supported optional fields with null; drill-down diagram/node references clear as a pair. It never publishes or marks the change human-approved.',
  inputSchema: submissionSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
}, ({ runId, artifact, evidenceManifest }) => submit(runId, artifact, evidenceManifest));

registerTool(server, 'submit_implementation_report', {
  title: 'Submit implementation reconciliation report',
  description: 'Submit a code-fact-backed agent claim that references the run-locked formal target and prior resulting snapshot. The server independently computes architecture and formal-contract gates; every result still requires local human review.',
  inputSchema: submissionSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
}, ({ runId, artifact, evidenceManifest }) => submit(runId, artifact, evidenceManifest));

registerTool(server, 'get_review_status', {
  title: 'Get review status',
  description: 'Read the agent claim, compact server-computed architecture and formal-contract gates, and traceable human-review status for one run. Request details only when individual drift or acceptance-criterion evidence is needed.',
  inputSchema: z.object({
    runId: z.string().min(1),
    includeArchitectureGateDetails: z.boolean().optional(),
    includeContractGateDetails: z.boolean().optional(),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, ({ runId, includeArchitectureGateDetails, includeContractGateDetails }) => {
  const details = includeArchitectureGateDetails && includeContractGateDetails
    ? 'review-gates'
    : includeArchitectureGateDetails
      ? 'architecture-gate'
      : includeContractGateDetails
        ? 'contract-gate'
        : undefined;
  return viewerRequest(`/api/agent/runs/${encodeURIComponent(runId)}${query({ details })}`);
});

registerTool(server, 'get_approved_target', {
  title: 'Get published formal target baseline',
  description: 'Read only the latest human-published target, its execution status, compact semantic graph, frozen acceptance contract, boundary references, and bound-document hashes. Every unpublished draft is excluded; legacy/unbound targets are explicitly non-executable.',
  inputSchema: z.object({ diagramId: z.string().optional() }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, ({ diagramId }) => viewerRequest(`/api/agent/approved-target${query({ diagram: diagramId })}`));

async function shutdown() {
  try { await server.close(); } catch { /* best-effort shutdown */ }
  if (viewerProcess && viewerProcess.exitCode === null) viewerProcess.kill();
}

process.once('SIGINT', async () => {
  await shutdown();
  process.exit(0);
});
process.once('SIGTERM', async () => {
  await shutdown();
  process.exit(0);
});
process.once('exit', () => {
  if (viewerProcess && viewerProcess.exitCode === null) viewerProcess.kill();
});

try {
  await ensureViewer();
  await server.connect(new StdioServerTransport());
} catch (error) {
  process.stderr.write(`${error?.message || String(error)}\n`);
  if (viewerProcess && viewerProcess.exitCode === null) viewerProcess.kill();
  process.exitCode = 1;
}
