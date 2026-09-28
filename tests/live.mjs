import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.TEST_BASE || 'http://127.0.0.1:3000';
const artifacts = [];
async function post(path, payload) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return response;
}
async function streamed(path, payload) {
  const response = await post(path, payload); const events = [];
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line); const { screenshot, ...record } = event;
      events.push(record);
      console.log(path, event.type, event.action?.description || event.outcome?.choice || event.status || event.error || event.processed || '');
      if (screenshot) { await mkdir('artifacts', { recursive: true }); await writeFile('artifacts/e2e-latest.jpg', Buffer.from(screenshot, 'base64')); }
      assert.notEqual(event.type, 'error', event.error);
    }
  }
  assert.equal(events.at(-1)?.type, 'complete', 'Stream must terminate explicitly');
  return events;
}
const cases = [
  { prompt: 'What is the weather in Tokyo today?', model: 'luna', tool: 'search' },
  { prompt: 'My app crashes with a TypeError when a user logs in. Read the auth code, find the bug, and test the fix.', model: 'sol', tool: 'debugging' },
  { prompt: 'Diagnose an intermittent race condition across our distributed payment services. Analyze the architecture, trace the failure through multiple systems, and propose a robust fix.', models: ['sol', 'astra'] },
];
for (const item of process.env.TEST_SUITE === 'e2e' ? [] : cases) {
  const result = await (await post('/api/classify', { prompt: item.prompt })).json();
  console.log('classification', result.answers.model.choice, result.selectedTools, result.inference_ms);
  artifacts.push({ type: 'classification', prompt: item.prompt, result });
  assert.ok(result.inference_ms > 0); assert.ok(result.routing.model);
  if (item.model) assert.equal(result.answers.model.choice, item.model);
  else assert.ok(item.models.includes(result.answers.model.choice));
  if (item.tool) assert.ok(result.selectedTools.includes(item.tool));
}
const sample = await (await fetch(`${base}/api/logs/sample`)).json();
for (const query of process.env.TEST_SUITE === 'e2e' ? [] : ['Why are checkout requests failing and timing out?', 'Why are users unable to sign in?']) {
  const events = await streamed('/api/logs/rank', { query, logs: sample.logs });
  const result = events.at(-1); artifacts.push({ type: 'logs', query, result });
  assert.equal(result.total, 240); assert.equal(result.unique, 24);
  console.log('Top logs:', result.ranked.slice(0, 3).map(g => [g.message, g.score]));
  assert.ok(result.ranked[0].message.toLowerCase().includes(query.includes('checkout') ? 'checkout' : 'auth'));
}
for (const scenario of [
  { task: 'Add Studio Headphones to the cart.', expectation: 'The cart contains Studio Headphones and the cart count is 1.' },
  { task: 'Filter the collection to show only Lighting products.', expectation: 'The product catalog shows 1 product: Arc Desk Lamp.' },
  { task: 'Search the product collection for "Mechanical Keyboard".', expectation: 'The product catalog shows 1 product: Mechanical Keyboard.' },
  { task: 'Add a Flying Bicycle to the cart.', expectation: 'The cart contains a Flying Bicycle.', negative: true },
]) {
  const events = await streamed('/api/e2e/run', scenario); const result = events.at(-1);
  artifacts.push({ type: 'e2e', ...scenario, events });
  if (scenario.negative) assert.notEqual(result.status, 'passed');
  else {
    assert.equal(result.status, 'passed'); assert.ok(result.steps > 0, 'Must execute at least one real action');
    // Independent integration checks validate actual UI evidence, not the model's verdict alone.
    const screen = events.filter(e => e.type === 'observation').at(-1).observation;
    const catalog = screen.regions.find(r => r.region === 'Product catalog').text;
    if (scenario.task.startsWith('Add Studio')) assert.match(screen.regions.find(r => r.region === 'Shopping cart').text, /Studio Headphones/);
    if (scenario.task.startsWith('Filter')) { assert.equal(screen.elements.find(e => e.name === 'Product category').value, 'lighting'); assert.match(catalog, /Showing 1 products/); assert.ok(!catalog.includes('Studio Headphones')); }
    if (scenario.task.startsWith('Search')) { assert.equal(screen.elements.find(e => e.name === 'Search products').value, 'Mechanical Keyboard'); assert.match(catalog, /Showing 1 products/); assert.ok(!catalog.includes('Arc Desk Lamp')); }
  }
}
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/live-results.json', JSON.stringify(artifacts, null, 2));
console.log(`PASS: ${process.env.TEST_SUITE === 'e2e' ? 'browser' : 'all'} live Laya integration checks. Evidence saved in artifacts/live-results.json`);
