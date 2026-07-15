import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveLocalizedConfigText } from '../src/localized-config.mjs';

test('legacy header strings remain valid in both interface languages', () => {
  assert.equal(resolveLocalizedConfigText('Legacy viewer', 'zh'), 'Legacy viewer');
  assert.equal(resolveLocalizedConfigText('Legacy viewer', 'en'), 'Legacy viewer');
});

test('localized header values select only the requested configured variant', () => {
  const value = { zh: '中文标题', en: 'English title' };
  assert.equal(resolveLocalizedConfigText(value, 'zh'), '中文标题');
  assert.equal(resolveLocalizedConfigText(value, 'en'), 'English title');
  assert.deepEqual(value, { zh: '中文标题', en: 'English title' });
});

test('a missing localized variant falls back to the same configured field', () => {
  assert.equal(resolveLocalizedConfigText({ zh: '仅中文' }, 'en'), '仅中文');
  assert.equal(resolveLocalizedConfigText({ en: 'English only' }, 'zh'), 'English only');
  assert.equal(resolveLocalizedConfigText({}, 'en', 'Safe fallback'), 'Safe fallback');
});
