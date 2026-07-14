#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { validateExchangeArtifact } = require('../schema/ai-coding-exchange-contract.cjs');

const input = process.argv[2];
if (!input) {
  process.stderr.write('Usage: node protocol/validate-artifact.cjs <artifact.json>\n');
  process.exitCode = 2;
} else {
  try {
    const file = path.resolve(process.cwd(), input);
    const artifact = JSON.parse(fs.readFileSync(file, 'utf8'));
    validateExchangeArtifact(artifact);
    process.stdout.write(`Valid ${artifact.artifactType} artifact: ${input}\n`);
  } catch (error) {
    process.stderr.write(`${error.code || 'AI_CODING_ARTIFACT_INVALID'}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
