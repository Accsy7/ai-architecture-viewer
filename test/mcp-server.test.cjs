'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('MCP stdio server exposes the governed external-agent tool surface', async () => {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js'),
  ]);
  const port = await availablePort();
  const client = new Client({ name: 'ai-architecture-viewer-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['mcp-server.mjs'],
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      VIEWER_BASE_URL: `http://127.0.0.1:${port}`,
    },
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), [
      'get_project_context',
      'get_current_architecture',
      'create_agent_run',
      'submit_architecture_snapshot',
      'submit_change_proposal',
      'submit_implementation_report',
      'get_review_status',
      'get_approved_target',
    ]);
    assert.equal(tools.tools.some((tool) => (
      tool.name.startsWith('approve_') || tool.name.startsWith('publish_')
    )), false);
    assert.equal(tools.tools.some((tool) => [
      'accept_implementation',
      'reject_implementation',
      'request_implementation_revision',
    ].includes(tool.name)), false);
    const approvedTargetTool = tools.tools.find((tool) => tool.name === 'get_approved_target');
    assert.match(approvedTargetTool.description, /only the latest human-published formal target baseline/i);
    assert.match(approvedTargetTool.description, /semantic hash/i);
    const reviewStatusTool = tools.tools.find((tool) => tool.name === 'get_review_status');
    assert.match(reviewStatusTool.description, /compact/i);
    assert.match(reviewStatusTool.description, /human-review/i);
    assert.ok(reviewStatusTool.inputSchema.properties.includeArchitectureGateDetails);

    const result = await client.callTool({
      name: 'get_current_architecture',
      arguments: { diagramId: 'system-overview' },
    });
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.diagram.id, 'system-overview');
    assert.ok(payload.published.graph.nodes.length > 0);
    assert.equal(payload.published.representation, 'semantic-graph-v1');
    assert.equal(JSON.stringify(payload.published).includes('position'), false);

    const targetContextResult = await client.callTool({
      name: 'get_project_context',
      arguments: { diagramId: 'system-overview', view: 'target' },
    });
    const targetContext = JSON.parse(targetContextResult.content[0].text);
    const formalTargetResult = await client.callTool({
      name: 'get_approved_target',
      arguments: { diagramId: 'system-overview' },
    });
    const formalTarget = JSON.parse(formalTargetResult.content[0].text);
    assert.equal(formalTarget.approvalStatus, 'published-target');
    assert.equal(formalTarget.baselineStatus, 'formal-baseline');
    assert.equal(formalTarget.architecture.revisionId, targetContext.selected.published.revisionId);
    assert.equal(formalTarget.formalBaseline.revisionId, targetContext.selected.published.revisionId);
    assert.match(formalTarget.formalBaseline.semanticHash, /^[a-f0-9]{64}$/);
  } finally {
    await client.close();
  }
});
