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
  { name: 'ai-architecture-viewer', version: '0.3.0' },
  {
    instructions: [
      'Use this server as an external visual architecture handoff for coding agents.',
      'Call get_project_context before creating a run.',
      'Create a run before submitting evidence-backed artifacts.',
      'Evidence paths must be relative to the configured code workspace root.',
      'Only a published target is an executable architecture baseline; an accepted draft still awaits human publication.',
      'Agents may submit snapshots, proposals, and implementation reports, but cannot approve or publish architecture.',
    ].join(' '),
  },
);

const diagramViewSchema = z.object({
  diagramId: z.string().optional().describe('Optional architecture diagram ID.'),
  view: z.enum(['current', 'target']).optional().describe('Architecture view; defaults to current.'),
});

registerTool(server, 'get_project_context', {
  title: 'Get project architecture context',
  description: 'Read the viewer project, diagram catalog, selected published baseline, document index, and human-governance boundaries before inspecting or planning.',
  inputSchema: diagramViewSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, ({ diagramId, view }) => viewerRequest(`/api/agent/context${query({ diagram: diagramId, view })}`));

registerTool(server, 'get_current_architecture', {
  title: 'Get current published architecture',
  description: 'Read the current published architecture as a compact semantic graph with stable IDs, responsibilities, relationships, and boundaries.',
  inputSchema: z.object({ diagramId: z.string().optional() }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, async ({ diagramId }) => {
  const context = await viewerRequest(`/api/agent/context${query({ diagram: diagramId, view: 'current' })}`);
  return {
    protocolVersion: context.protocolVersion,
    project: context.project,
    diagram: {
      id: context.selected.diagramId,
      title: context.selected.title,
      description: context.selected.description,
    },
    published: context.selected.published,
    draftPresent: Boolean(context.selected.draft),
  };
});

registerTool(server, 'create_agent_run', {
  title: 'Create agent architecture run',
  description: 'Create a traceable run and lock its architecture baseline before submitting any architecture artifact.',
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
  description: 'Submit a code-fact-backed current architecture snapshot. Discussion and design intent cannot be used as proof of implementation. Omitted nodes are never removed automatically.',
  inputSchema: submissionSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
}, ({ runId, artifact, evidenceManifest }) => submit(runId, artifact, evidenceManifest));

registerTool(server, 'submit_change_proposal', {
  title: 'Submit architecture change proposal',
  description: 'Submit a target proposal backed by user confirmation, design documents, code facts, or labeled agent inference. Concept projects do not require a code repository. This does not approve, apply, or publish it.',
  inputSchema: submissionSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
}, ({ runId, artifact, evidenceManifest }) => submit(runId, artifact, evidenceManifest));

registerTool(server, 'submit_implementation_report', {
  title: 'Submit implementation reconciliation report',
  description: 'Submit a code-fact-backed report of changes, checks, acceptance results, and architecture drift for human inspection.',
  inputSchema: submissionSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
}, ({ runId, artifact, evidenceManifest }) => submit(runId, artifact, evidenceManifest));

registerTool(server, 'get_review_status', {
  title: 'Get review status',
  description: 'Read submitted artifacts and proposal review outcomes for a single agent run.',
  inputSchema: z.object({ runId: z.string().min(1) }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
}, ({ runId }) => viewerRequest(`/api/agent/runs/${encodeURIComponent(runId)}`));

registerTool(server, 'get_approved_target', {
  title: 'Get published formal target baseline',
  description: 'Read only the latest human-published formal target baseline as a compact semantic graph. Accepted but unpublished drafts are excluded and remain visible only as awaiting-publication review status.',
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
