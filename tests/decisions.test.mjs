import test from 'node:test';
import assert from 'node:assert/strict';
import { groupLogs, sampleLogs } from '../server/decisions.mjs';
import { actionsFor } from '../server/browser.mjs';

test('log deduplication preserves evidence and does not collapse distinct request IDs', () => {
  const result = groupLogs('2026-09-28T10:00:00Z ERROR failed request=1\n2026-09-28T10:00:01Z ERROR failed request=1\n2026-09-28T10:00:02Z ERROR failed request=2\n');
  assert.equal(result.lines.length, 3); assert.equal(result.groups.length, 2);
  assert.deepEqual(result.groups[0].occurrences.map(o => o.line), [1, 2]);
  assert.equal(result.groups[1].occurrences[0].line, 3);
});
test('large log inputs are rejected rather than silently truncated', () => {
  assert.throws(() => groupLogs('entry\n'.repeat(2001)), /2,000/);
  assert.throws(() => groupLogs('x'.repeat(1501)), /1,500/);
  assert.equal(groupLogs(sampleLogs()).groups.length, 24);
});
test('browser candidates only target observed enabled controls and user-supplied text', () => {
  const observation = { text: 'A screen', elements: [
    { id: 'e1', tag: 'button', name: 'Add item', disabled: false },
    { id: 'e2', tag: 'button', name: 'Disabled', disabled: true },
    { id: 'e3', tag: 'input', name: 'Search', type: 'search', value: '' },
    { id: 'e4', tag: 'select', name: 'Category', value: 'all', options: [{ value: 'all', text: 'All' }, { value: 'audio', text: 'Audio' }] },
  ] };
  const actions = actionsFor(observation, 'Search for "headphones"', []);
  assert.equal(actions.length, 3); assert.ok(actions.every(a => a.element !== 'e2'));
  assert.equal(actions.find(a => a.type === 'fill').value, 'headphones');
  const withoutRepeat = actionsFor(observation, 'Search for "headphones"', [{ before: 'A screen', description: 'Click Add item' }]);
  assert.equal(withoutRepeat.length, 2);
});
