'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { migrateLegacyState, validateState } = require('./state-contract.cjs');

function writeAtomic(filePath, value) {
  const temp = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temp, filePath);
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
  }
}

function migrateFile(inputPath, outputPath = inputPath) {
  const input = path.resolve(inputPath);
  const output = path.resolve(outputPath);
  const legacy = JSON.parse(fs.readFileSync(input, 'utf8'));
  const canonical = migrateLegacyState(legacy);
  validateState(canonical);
  writeAtomic(output, canonical);
  return canonical;
}

if (require.main === module) {
  const input = process.argv[2];
  const output = process.argv[3] || input;
  if (!input) {
    console.error('用法: node schema/migrate-state.cjs <input.json> [output.json]');
    process.exitCode = 2;
  } else {
    const migrated = migrateFile(input, output);
    console.log(JSON.stringify({
      schemaVersion: migrated.schemaVersion,
      output: path.resolve(output),
      current: {
        revision: migrated.current.published.revision,
        revisionId: migrated.current.published.revisionId,
        publishedNodes: migrated.current.published.graph.nodes.length,
        publishedEdges: migrated.current.published.graph.edges.length,
        draftId: migrated.current.draft?.draftId || null,
        draftRevision: migrated.current.draft?.draftRevision || 0,
        draftNodes: migrated.current.draft === null ? null : migrated.current.draft.graph.nodes.length,
      },
      target: {
        revision: migrated.target.published.revision,
        revisionId: migrated.target.published.revisionId,
        publishedNodes: migrated.target.published.graph.nodes.length,
        publishedEdges: migrated.target.published.graph.edges.length,
        draftId: migrated.target.draft?.draftId || null,
        draftRevision: migrated.target.draft?.draftRevision || 0,
        draftNodes: migrated.target.draft === null ? null : migrated.target.draft.graph.nodes.length,
        draftEdges: migrated.target.draft === null ? null : migrated.target.draft.graph.edges.length,
      },
    }, null, 2));
  }
}

module.exports = { migrateFile, writeAtomic };
