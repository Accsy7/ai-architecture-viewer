import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReviewRecords } from '../src/review-records.mjs';

test('review records focus on formal publication and implementation review while isolating legacy decisions', () => {
  const records = buildReviewRecords({
    revisions: [
      { revision: 1, revisionId: 'target-r1', origin: 'migration', publishedAt: '2026-01-01T00:00:00Z' },
      { revision: 2, revisionId: 'target-r2', origin: 'publish', message: 'Formal target', publishedAt: '2026-01-02T00:00:00Z', publishedBy: 'user' },
      { revision: 3, revisionId: 'target-r3', origin: 'restore', message: 'Restore known target', publishedAt: '2026-01-03T00:00:00Z', publishedBy: 'user' },
    ],
    runs: [
      { id: 'run-draft', agentName: 'Codex', humanReview: null },
      { id: 'run-implementation', agentName: 'Claude Code', humanReview: { decision: 'accepted', note: 'Verified locally', reviewedAt: '2026-01-04T00:00:00Z', reviewer: 'user' } },
    ],
    proposals: [
      { id: 'draft-write', status: 'draft-applied', reviewedAt: null },
      { id: 'legacy-accepted', status: 'accepted', title: 'Old proposal', reviewedAt: '2025-12-01T00:00:00Z' },
      { id: 'legacy-pending', status: 'pending', reviewedAt: null },
    ],
  });
  assert.deepEqual(records.map((record) => record.kind), ['implementation', 'publication', 'publication', 'legacy-proposal']);
  assert.deepEqual(records.filter((record) => record.kind === 'publication').map((record) => record.revisionId), ['target-r3', 'target-r2']);
  assert.equal(records.some((record) => record.id === 'draft-write'), false);
  assert.equal(records.some((record) => record.id === 'legacy-pending'), false);
});
