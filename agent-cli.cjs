#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function parseArguments(values) {
  const parsed = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) {
      parsed._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = values[index + 1];
    if (next === undefined || next.startsWith('--')) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function usage() {
  return [
    'AI Architecture Viewer agent handoff CLI',
    '',
    'Commands:',
    '  context [--diagram <id>] [--view current|target]',
    '  create-run --agent <name> --client <client> --task <type> [--diagram <id>] [--view <view>] [--summary <text>]',
    '  submit --run <run-id> --artifact <artifact.json> [--evidence <evidence-manifest.json>]',
    '  status --run <run-id>',
    '  approved-target [--diagram <id>]',
    '',
    'Options:',
    '  --base-url <url>  Viewer URL (default: VIEWER_BASE_URL or http://127.0.0.1:8800)',
    '',
    'Task types: architecture-discovery, architecture-change-plan, implementation-reconcile',
  ].join('\n');
}

function required(options, key) {
  if (typeof options[key] !== 'string' || !options[key].trim()) {
    const error = new Error(`Missing required option --${key}`);
    error.code = 'CLI_ARGUMENT_REQUIRED';
    throw error;
  }
  return options[key].trim();
}

function readArtifact(file) {
  const resolved = path.resolve(process.cwd(), file);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function query(values) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (typeof value === 'string' && value) params.set(key, value);
  });
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const command = options._[0];
  if (!command || ['help', '-h', '--help'].includes(command)) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const baseUrl = String(options['base-url'] || process.env.VIEWER_BASE_URL || 'http://127.0.0.1:8800').replace(/\/+$/, '');
  const request = async (pathname, init = {}) => {
    const response = await fetch(`${baseUrl}${pathname}`, {
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
      ...init,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Viewer request failed with HTTP ${response.status}`);
      error.code = payload.code || 'VIEWER_REQUEST_FAILED';
      error.details = payload.details;
      throw error;
    }
    return payload;
  };

  let result;
  if (command === 'context') {
    result = await request(`/api/agent/context${query({ diagram: options.diagram, view: options.view })}`);
  } else if (command === 'create-run') {
    result = await request('/api/agent/runs', {
      method: 'POST',
      body: JSON.stringify({
        agentName: required(options, 'agent'),
        agentClient: required(options, 'client'),
        taskType: required(options, 'task'),
        ...(options.diagram ? { diagramId: options.diagram } : {}),
        ...(options.view ? { view: options.view } : {}),
        ...(options.summary ? { summary: options.summary } : {}),
      }),
    });
  } else if (command === 'submit') {
    const artifact = readArtifact(required(options, 'artifact'));
    const evidenceManifest = options.evidence ? readArtifact(options.evidence) : undefined;
    result = await request(`/api/agent/runs/${encodeURIComponent(required(options, 'run'))}/artifacts`, {
      method: 'POST',
      body: JSON.stringify({ artifact, ...(evidenceManifest ? { evidenceManifest } : {}) }),
    });
  } else if (command === 'status') {
    result = await request(`/api/agent/runs/${encodeURIComponent(required(options, 'run'))}`);
  } else if (command === 'approved-target') {
    result = await request(`/api/agent/approved-target${query({ diagram: options.diagram })}`);
  } else {
    const error = new Error(`Unknown command: ${command}\n\n${usage()}`);
    error.code = 'CLI_COMMAND_UNKNOWN';
    throw error;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.code || 'AGENT_CLI_FAILED'}: ${error.message}\n`);
  if (error.details) process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
  process.exitCode = 1;
});
