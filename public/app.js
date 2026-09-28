const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHTML = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = number => `${(number * 100).toFixed(1)}%`;
let currentView = 'classify';
let running = new Set();
const localPage = ['127.0.0.1', 'localhost'].includes(location.hostname);
let backend = localPage ? location.origin : '';
const apiURL = path => {
  if (!backend) { $('#connection-dialog').showModal(); throw new Error('Connect your local Laya server to run this demo.'); }
  return `${backend}${path}`;
};
$('#connection-button').onclick = () => $('#connection-dialog').showModal();
$('#close-connection').onclick = () => $('#connection-dialog').close();
$('#backend-url').value = backend || 'http://127.0.0.1:3000';
$('#connect-backend').onclick = async () => {
  const button = $('#connect-backend'); button.disabled = true;
  try {
    const url = new URL($('#backend-url').value.trim());
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Enter a local server origin, such as http://127.0.0.1:3000.');
    const response = await fetch(`${url.origin}/api/health`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Server returned ${response.status}.`);
    const data = await response.json();
    if (data.engine !== 'laya.Router') throw new Error('This server is not a Laya Router backend.');
    backend = url.origin;
    $('#connection-message').textContent = '';
    $('#connection-dialog').close(); await health();
  } catch (error) { $('#connection-message').textContent = `${error.message} Start npm run dev and allow local network access if your browser asks.`; }
  finally { button.disabled = false; }
};
const headings = {
  classify: ['Routing', '', 'Big decisions.', 'One prompt. The right model and tools.'],
  e2e: ['Browser', '', 'Real actions.', 'Give Laya a task. Watch the browser follow.'],
  logs: ['Logs', '', 'Less noise.', 'Ask a question. Get the logs that matter.'],
};
function setView(view) {
  if (!headings[view]) return;
  currentView = view;
  const [, , title, subtitle] = headings[view];
  $('#page-title').textContent = title; $('#page-subtitle').textContent = subtitle;
  $$('.view').forEach(el => { el.classList.toggle('active', el.id === `view-${view}`); el.hidden = el.id !== `view-${view}`; });
  $$('.nav-item').forEach(el => { el.classList.toggle('active', el.dataset.view === view); el.setAttribute('aria-current', el.dataset.view === view ? 'page' : 'false'); });
  history.replaceState(null, '', `#${view}`);
  window.scrollTo(0, 0);
}
$$('[data-view]').forEach(el => el.addEventListener('click', () => setView(el.dataset.view)));
if (location.hash) setView(location.hash.slice(1));
$('#how-button').onclick = () => $('#how-dialog').showModal();
$('#close-dialog').onclick = () => $('#how-dialog').close();
$('#how-dialog').addEventListener('click', event => { if (event.target === $('#how-dialog')) { const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close(); } });

async function health() {
  if (!backend) { $('#engine-label').textContent = 'Connect Laya'; $('#engine-dot').className = 'status-dot offline'; return; }
  try {
    const response = await fetch(apiURL('/api/health'), { signal: AbortSignal.timeout(8000) }); const data = await response.json();
    $('#engine-dot').className = `status-dot ${data.status === 'ready' ? '' : data.status === 'error' ? 'error' : 'loading'}`;
    $('#engine-label').textContent = data.status === 'ready' ? 'Connected locally' : data.status === 'error' ? 'Unavailable' : 'Loading Laya';
    $('#engine-detail').textContent = data.status === 'ready' ? `${data.device.toUpperCase()} · local inference` : 'Open How it works for setup';
    $('.engine-card').title = data.detail;
  } catch { $('#engine-label').textContent = 'Disconnected'; $('#engine-dot').className = 'status-dot error'; }
}
health(); setInterval(health, 10000);
const examples = {
  debug: 'My app crashes with a TypeError when a user logs in. Read the auth code, find the bug, and test the fix.',
  weather: 'What is the weather in Tokyo today?',
  architecture: 'Diagnose an intermittent race condition across our distributed payment services. Analyze the architecture, trace the failure through multiple systems, and propose a robust fix.',
};
function updatePromptCount() { $('#prompt-count').textContent = `${$('#prompt').value.length} / 1800`; }
$('#prompt').addEventListener('input', updatePromptCount); updatePromptCount();
$$('[data-example]').forEach(el => el.onclick = () => { $('#prompt').value = examples[el.dataset.example]; updatePromptCount(); $('#prompt').focus(); });
function showError(id, error) { const element = $(id); element.textContent = error; element.hidden = !error; }
async function post(url, payload, signal) {
  const response = await fetch(apiURL(url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal });
  if (!response.ok) { const data = await response.json(); throw new Error(data.error || `Request failed (${response.status})`); }
  return response;
}
async function classify() {
  if (running.has('classify')) return;
  const prompt = $('#prompt').value.trim();
  if (!prompt) return showError('#classify-error', 'Write a request for Laya to route.');
  running.add('classify'); $('#classify-button').disabled = true; $('#prompt').disabled = true; $$('[data-example]').forEach(el => el.disabled = true);
  $('#classify-button').children[1].textContent = 'Choosing…'; showError('#classify-error', '');
  $('#decision-canvas').hidden = false; $('#classification-details').hidden = true;
  $('#decision-canvas').classList.add('running'); $('#route-state').textContent = 'Finding your fit';
  $('#flow-model').textContent = 'Deciding…'; $('#flow-tools').textContent = '—';
  try {
    const result = await (await post('/api/classify', { prompt })).json();
    const model = result.answers.model;
    $('#flow-intent').textContent = result.answers.intent.choice;
    $('#flow-model').textContent = model.choice.charAt(0).toUpperCase() + model.choice.slice(1);
    $('#flow-tools').innerHTML = result.selectedTools.length ? result.selectedTools.map(tool => `<span class="tool-pill">${escapeHTML(tool)}</span>`).join('') : 'No tools needed';
    $('.model-symbol').textContent = { luna: '◔', sol: '☼', astra: '✧' }[model.choice] || '✳';
    $('#route-time').innerHTML = `${result.inference_ms.toLocaleString()} <small>ms</small>`;
    $('#route-confidence').innerHTML = `${(model.probabilities[model.choice] * 100).toFixed(1)} <small>%</small>`;
    $('#route-tool-count').innerHTML = `${result.selectedTools.length} <small>/ 6</small>`;
    $$('.model-card').forEach(card => { const name = card.dataset.model; card.classList.toggle('selected', name === model.choice); card.querySelector('.model-prob strong').textContent = pct(model.probabilities[name]); card.querySelector('.prob-track i').style.width = pct(model.probabilities[name]); });
    $('#model-result-label').textContent = `Evaluated by Laya’s ${result.routing.model} checkpoint.`;
    $('#tools-section').hidden = false;
    $('#tool-decisions').innerHTML = result.tools.map(tool => `<div class="tool-item ${tool.choice === 'use' ? 'selected' : ''}"><code>${escapeHTML(tool.name)}</code><span>${tool.choice === 'use' ? '✓ selected' : '— skipped'}</span><small>P(use) ${pct(tool.probabilities.use)}</small></div>`).join('');
    $('#classify-raw').textContent = JSON.stringify({ prompt, ...result }, null, 2);
    $('#decision-canvas').classList.add('has-result'); $('#route-state').textContent = 'Selected model'; $('#classification-details').hidden = false;
  } catch (error) { showError('#classify-error', error.message); $('#decision-canvas').hidden = true; }
  finally { running.delete('classify'); $('#classify-button').disabled = false; $('#prompt').disabled = false; $$('[data-example]').forEach(el => el.disabled = false); $('#classify-button').children[1].textContent = 'Route request'; $('#decision-canvas').classList.remove('running'); health(); }
}
$('#classify-button').onclick = classify;
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); if (currentView === 'classify') classify(); else if (currentView === 'e2e') $('#e2e-button').click(); else $('#logs-button').click(); } });

async function loadLogs() {
  try { const response = await fetch('./sample-logs.json'); if (!response.ok) throw new Error('Could not load sample logs.'); const data = await response.json(); $('#log-source').value = data.logs; updateLogCount(); }
  catch (error) { showError('#logs-error', error.message); }
}
function updateLogCount() { $('#log-line-count').textContent = $('#log-source').value.split(/\r?\n/).filter(l => l.trim()).length.toLocaleString(); }
$('#log-source').addEventListener('input', () => { updateLogCount(); $('.log-editor-label').lastElementChild.textContent = 'YOUR LOG DATA'; });
$('#load-sample').onclick = () => { loadLogs(); $('.log-editor-label').lastElementChild.textContent = 'SAMPLE DATA'; };
loadLogs();

async function streamPost(url, payload, signal, onEvent) {
  const response = await post(url, payload, signal);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let complete = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) if (line.trim()) { const event = JSON.parse(line); if (event.type === 'error') throw new Error(event.error); if (event.type === 'complete') complete = true; onEvent(event); }
      if (done) break;
    }
    if (!complete && !signal.aborted) throw new Error('The connection closed before a result was returned. Please try again.');
  } finally { reader.releaseLock(); }
}

const scenarios = {
  cart: ['Add Studio Headphones to the cart.', 'The cart contains Studio Headphones and the cart count is 1.'],
  filter: ['Filter the collection to show only Lighting products.', 'The product catalog shows 1 product: Arc Desk Lamp.'],
  search: ['Search the product collection for "Mechanical Keyboard".', 'The product catalog shows 1 product: Mechanical Keyboard.'],
  impossible: ['Add a Flying Bicycle to the cart.', 'The cart contains a Flying Bicycle.'],
};
$('#e2e-scenario').onchange = event => { const [task, expectation] = scenarios[event.target.value]; $('#e2e-task').value = task; $('#e2e-expect').value = expectation; };
let browserController;
function trace(icon, title, detail, meta = '', type = '') {
  if ($('#e2e-trace .empty-state')) $('#e2e-trace').innerHTML = '';
  const row = document.createElement('div'); row.className = `trace-row ${type}`;
  row.innerHTML = `<span class="trace-icon">${escapeHTML(icon)}</span><div><strong>${escapeHTML(title)}</strong><p>${escapeHTML(detail)}</p></div><span class="trace-meta">${escapeHTML(meta)}</span>`;
  $('#e2e-trace').appendChild(row);
}
$('#e2e-button').onclick = async () => {
  if (running.has('e2e')) return;
  const task = $('#e2e-task').value.trim(); const expectation = $('#e2e-expect').value.trim();
  if (!task || !expectation) return showError('#e2e-error', 'Describe both the task and the expected result.');
  running.add('e2e'); browserController = new AbortController();
  $('#e2e-button').disabled = true; $('#e2e-stop').hidden = false; $('#e2e-task').disabled = true; $('#e2e-expect').disabled = true; $('#e2e-scenario').disabled = true;
  $('#e2e-trace').innerHTML = ''; $('#trace-count').textContent = '0 ACTIONS'; $('#e2e-verdict').hidden = true;
  $('#browser-state').textContent = 'STARTING'; showError('#e2e-error', '');
  trace('↗', 'Opening a fresh browser', 'Creating an isolated Chromium session for your journey.');
  const events = [];
  try {
    await streamPost('/api/e2e/run', { task, expectation }, browserController.signal, event => {
      const { screenshot, ...record } = event; events.push(record); $('#e2e-raw').textContent = JSON.stringify(events, null, 2);
      if (event.type === 'observation') {
        $('#sandbox-preview').hidden = true; $('#browser-screenshot').hidden = false; $('#browser-live-label').hidden = false;
        $('#browser-screenshot').src = `data:image/jpeg;base64,${screenshot}`;
        $('#browser-observation-count').textContent = `${event.observation.visibleElementCount} visible elements · ${event.observation.elements.length} controls observed`;
        $('#browser-state').textContent = 'OBSERVING';
        trace('◎', `Observe screen ${event.step + 1}`, `${event.observation.elements.length} controls passed to Laya with the current screen text.`);
      }
      if (event.type === 'assertion') {
        trace('◇', event.outcome.choice === 'pending' ? 'Expectation not yet satisfied' : `Laya verdict: ${event.outcome.choice}`, expectation,
          `${pct(event.outcome.probabilities[event.outcome.choice])} · ${event.inference_ms.toLocaleString()} ms`, 'assertion');
        $('#browser-state').textContent = 'DECIDING';
      }
      if (event.type === 'focus') trace('⌖', `Inspect ${event.region}`, 'Laya selected this page region as evidence for the expectation.', `${event.inference_ms.toLocaleString()} ms`);
      if (event.type === 'action') {
        trace(String(event.step).padStart(2, '0'), event.action.description, `Selected by Laya from ${event.candidates.length} available actions. Executed by Playwright.`, `${pct(event.confidence)} · ${event.inference_ms.toLocaleString()} ms`);
        $('#trace-count').textContent = `${event.step} ACTION${event.step === 1 ? '' : 'S'}`; $('#browser-state').textContent = 'ACTING';
      }
      if (event.type === 'complete') {
        $('#browser-state').textContent = event.status.toUpperCase();
        const verdict = $('#e2e-verdict'); verdict.hidden = false; verdict.className = `verdict-panel ${event.status}`;
        verdict.innerHTML = `<span>${event.status === 'passed' ? '✓' : '◇'}</span><div><h3>${event.status === 'passed' ? 'Expectation met, according to Laya.' : event.status === 'failed' ? 'Expectation not met.' : 'Result inconclusive.'}</h3><p>${escapeHTML(event.detail || expectation)}</p></div><div class="verdict-meta">${event.steps} action${event.steps === 1 ? '' : 's'}</div>`;
      }
    });
  } catch (error) {
    if (error.name === 'AbortError') { $('#browser-state').textContent = 'STOPPED'; trace('■', 'Run stopped', 'No further browser actions will be executed.'); }
    else { $('#browser-state').textContent = 'ERROR'; showError('#e2e-error', error.message); trace('!', 'Run could not complete', error.message); }
  } finally { running.delete('e2e'); $('#e2e-button').disabled = false; $('#e2e-stop').hidden = true; $('#e2e-task').disabled = false; $('#e2e-expect').disabled = false; $('#e2e-scenario').disabled = false; health(); }
};
$('#e2e-stop').onclick = () => browserController?.abort();

$$('[data-log-query]').forEach(el => el.onclick = () => { $('#log-query').value = el.dataset.logQuery; $('#log-query').focus(); });
$('#log-upload').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  if (file.size > 700000) return showError('#logs-error', 'Choose a text file smaller than 700 KB.');
  $('#log-source').value = await file.text(); updateLogCount(); $('.log-editor-label').lastElementChild.textContent = file.name; showError('#logs-error', '');
  event.target.value = '';
};
let logsController;
$('#logs-button').onclick = async () => {
  if (running.has('logs')) return;
  const query = $('#log-query').value.trim(); const logs = $('#log-source').value.trim();
  if (!query || !logs) return showError('#logs-error', 'Add your logs and a question to investigate.');
  running.add('logs'); logsController = new AbortController(); $('#logs-button').disabled = true; $('#logs-stop').hidden = false;
  $('#signal-panel').hidden = false; $('#logs-details').hidden = true;
  $$('#log-source, #log-query, #load-sample, #log-upload, [data-log-query]').forEach(el => el.disabled = true);
  $('#log-progress').hidden = false; $('#log-progress i').style.width = '0'; $('#log-progress span').textContent = 'Sending the log stream to Laya…';
  $('#log-summary').hidden = true; $('#log-results').innerHTML = ''; showError('#logs-error', '');
  $('#log-state').textContent = 'READING'; $('#log-state').className = 'state-badge running';
  try {
    await streamPost('/api/logs/rank', { query, logs }, logsController.signal, event => {
      if (event.type === 'started') $('#log-progress span').textContent = `${event.total} lines · ${event.unique} unique messages to evaluate`;
      if (event.type === 'progress') { $('#log-progress i').style.width = `${event.processed / event.total * 100}%`; $('#log-progress span').textContent = `${event.processed} / ${event.total} lines evaluated · ${event.uniqueProcessed} / ${event.unique} unique messages`; }
      if (event.type === 'complete') {
        $('#log-progress').hidden = true; $('#log-state').textContent = 'RANKED'; $('#log-state').className = 'state-badge complete';
        $('#log-summary').hidden = false; $('#log-summary').textContent = `${event.total} lines reviewed · ${event.unique} unique messages · ${(event.inference_ms / 1000).toFixed(1)} seconds`;
        const entries = event.ranked.map(group => `<article class="log-entry"><div class="log-entry-head"><span class="log-category ${escapeHTML(group.category)}">${{ critical: 'High relevance', relevant: 'Related', noise: 'Low relevance' }[group.category]}</span><span>${group.occurrences.length} occurrence${group.occurrences.length === 1 ? '' : 's'}</span></div><p>${escapeHTML(group.message)}</p><details><summary>Evidence & score</summary><pre>${escapeHTML(`Relevance: ${(group.score * 100).toFixed(1)} / 100\nP(critical): ${pct(group.probabilities.critical)}\n\n` + group.occurrences.map(o => `L${o.line}  ${o.text}`).join('\n'))}</pre></details></article>`);
        $('#log-results').innerHTML = entries.slice(0, 5).join('') + (entries.length > 5 ? `<details class="remaining-logs"><summary>Show ${entries.length - 5} more messages</summary>${entries.slice(5).join('')}</details>` : '');
        $('#logs-details').hidden = false;
        $('#logs-raw').textContent = JSON.stringify({ query, formula: 'P(critical) + 0.5 × P(relevant)', ...event }, null, 2);
      }
    });
  } catch (error) { $('#log-state').textContent = error.name === 'AbortError' ? 'STOPPED' : 'ERROR'; $('#log-state').className = 'state-badge'; $('#log-progress').hidden = true; if (error.name !== 'AbortError') showError('#logs-error', error.message); }
  finally { running.delete('logs'); $('#logs-button').disabled = false; $('#logs-stop').hidden = true; $$('#log-source, #log-query, #load-sample, #log-upload, [data-log-query]').forEach(el => el.disabled = false); health(); }
};
$('#logs-stop').onclick = () => logsController?.abort();
