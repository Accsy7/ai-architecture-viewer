import assert from 'node:assert/strict';
import test from 'node:test';
import { partitionInspectorFields, understandingEvidence } from '../src/inspector-presentation.mjs';

test('inspector keeps the three owner-facing fields primary and moves governance detail behind disclosure', () => {
  const fields = [
    { key: 'group', label: '所属分组' },
    { key: 'purpose', label: '主要作用', multiline: true },
    { key: 'technical', label: '技术成熟度', tone: 'technical' },
    { key: 'product', label: '产品与视觉验收', tone: 'product' },
    { key: 'authorization', label: '授权边界', tone: 'authorization' },
    { key: 'aiCollaboration', label: 'AI 协作方式', optional: true },
    { key: 'buildStrategy', label: '建设方式' },
    { key: 'horizon', label: '目标周期' },
  ];
  const result = partitionInspectorFields(fields, {
    group: '业务运营',
    purpose: '承接业务事件。',
    technical: '本地原型',
    product: '待项目负责人评审',
    authorization: '不得自动执行',
    buildStrategy: '自建',
    horizon: '近期',
  });

  assert.equal(result.group.key, 'group');
  assert.equal(result.purpose.key, 'purpose');
  assert.equal(result.progress.key, 'technical');
  assert.equal(result.boundary.key, 'authorization');
  assert.deepEqual(result.secondary.map((field) => field.key), ['product', 'buildStrategy', 'horizon']);
});

test('source-unlinked confirmation is presented only as historical migration evidence', () => {
  const result = understandingEvidence({
    name: '事件中心',
    humanConfirmed: true,
    confirmationNote: '保留原有确认结论。',
    confirmedAt: '2026-07-15T01:02:03.000Z',
  });

  assert.deepEqual(result, [{
    sourceKind: 'historical-migration',
    retainedConclusion: '保留原有确认结论。',
    recordedAt: '2026-07-15T01:02:03.000Z',
    affectedModuleName: '事件中心',
  }]);
  assert.equal(understandingEvidence({ humanConfirmed: false }).length, 0);
});
