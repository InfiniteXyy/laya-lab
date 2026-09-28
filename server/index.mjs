import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { LayaBridge } from './bridge.mjs';
import { classificationQuestions, classificationResult, groupLogs, sampleLogs } from './decisions.mjs';
import { runBrowser } from './browser.mjs';

const port = Number(process.env.PORT || 3000);
const host = '127.0.0.1';
const base = `http://${host}:${port}`;
const allowedOrigins = new Set([base, `http://localhost:${port}`, 'https://infinitexyy.github.io']);
const bridge = new LayaBridge();
let browserBusy = false;
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
const requiredText = (value, name, max = 2000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Object.assign(new Error(`${name} must contain 1–${max.toLocaleString()} characters.`), { status: 400 });
  return value.trim();
};
async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 1_000_000) throw Object.assign(new Error('Request exceeds 1 MB.'), { status: 413 });
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected an object');
    return parsed;
  } catch { throw Object.assign(new Error('Request must be a JSON object.'), { status: 400 }); }
}
function stream(res) {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  return { signal: controller.signal, emit: event => { if (!res.destroyed) res.write(JSON.stringify(event) + '\n'); } };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  const url = new URL(req.url, base);
  try {
    // The API stays on loopback; only the local UI and published Pages origin may call it.
    if (![`${host}:${port}`, `localhost:${port}`].includes(req.headers.host)) return json(res, 403, { error: 'Local requests only.' });
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) return json(res, 403, { error: 'Cross-origin requests are not allowed.' });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (origin && allowedOrigins.has(origin)) res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.writeHead(204); return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ...bridge.status, engine: 'laya.Router', queued: bridge.pending.size });
    if (req.method === 'GET' && url.pathname === '/api/logs/sample') return json(res, 200, { logs: sampleLogs() });
    if (req.method === 'POST' && url.pathname === '/api/classify') {
      const data = await body(req);
      const prompt = requiredText(data.prompt, 'Prompt', 1800);
      const reply = await bridge.call({ op: 'predict', state: prompt, questions: classificationQuestions });
      return json(res, 200, classificationResult(reply));
    }
    if (req.method === 'POST' && url.pathname === '/api/logs/rank') {
      const data = await body(req);
      const query = requiredText(data.query, 'Question', 500);
      const logs = requiredText(data.logs, 'Logs', 700_000);
      const { lines, groups } = groupLogs(logs);
      if (bridge.status.status !== 'ready') return json(res, 503, { error: bridge.status.detail });
      const { emit, signal } = stream(res);
      const started = Date.now();
      const ranked = [];
      let inferenceTotal = 0;
      const questions = { relevance: { type: 'choice', instructions: 'How useful is this log entry for investigating the user question? Match meaning and evidence, not just error severity.', criteria: {
        critical: 'Directly identifies a cause or decisive evidence for the user question',
        relevant: 'Related context or a symptom useful for the investigation',
        noise: 'Unrelated to the user question or routine activity',
      } } };
      emit({ type: 'started', total: lines.length, unique: groups.length });
      try {
        for (let offset = 0; offset < groups.length; offset += 4) {
          if (signal.aborted) return;
          const batch = groups.slice(offset, offset + 4);
          const reply = await bridge.call({ op: 'batch', requests: batch.map(g => ({
            state: `User question: ${query}\nLog entry: ${g.message}`, questions, max_len: 1024, head_max_len: 256,
          })) });
          inferenceTotal += reply.inference_ms;
          batch.forEach((group, i) => {
            const result = reply.result[i];
            const answer = result.answers.relevance;
            const score = answer.probabilities.critical + 0.5 * answer.probabilities.relevant;
            ranked.push({ ...group, score, category: answer.choice, probabilities: answer.probabilities, raw: result });
          });
          emit({ type: 'progress', processed: ranked.reduce((n, g) => n + g.occurrences.length, 0), total: lines.length,
            uniqueProcessed: ranked.length, unique: groups.length });
        }
        ranked.sort((a, b) => b.score - a.score);
        emit({ type: 'complete', ranked, total: lines.length, unique: groups.length, inference_ms: inferenceTotal, elapsed_ms: Date.now() - started });
      } catch (error) { emit({ type: 'error', error: error.message }); }
      return res.end();
    }
    if (req.method === 'POST' && url.pathname === '/api/e2e/run') {
      const data = await body(req);
      const task = requiredText(data.task, 'Task', 700);
      const expectation = requiredText(data.expectation, 'Expectation', 500);
      if (browserBusy) return json(res, 409, { error: 'A browser run is already active. Wait for it to finish.' });
      if (bridge.status.status !== 'ready') return json(res, 503, { error: bridge.status.detail });
      browserBusy = true;
      const { emit, signal } = stream(res);
      try { await runBrowser({ bridge, base, task, expectation, emit, signal }); }
      catch (error) { emit({ type: 'error', error: error.message }); }
      finally { browserBusy = false; res.end(); }
      return;
    }
    if (req.method !== 'GET') return json(res, 404, { error: 'Endpoint not found.' });
    const files = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/favicon.svg': 'favicon.svg', '/sample-logs.json': 'sample-logs.json', '/sandbox': 'sandbox.html', '/sandbox.html': 'sandbox.html', '/sandbox.js': 'sandbox.js', '/sandbox.css': 'sandbox.css' };
    const file = files[url.pathname];
    if (!file) return json(res, 404, { error: 'Not found.' });
    const content = await readFile(resolve('public', file));
    const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };
    res.writeHead(200, { 'Content-Type': mime[extname(file)] }); res.end(content);
  } catch (error) { if (!res.headersSent) json(res, error.status || 500, { error: error.message }); else res.end(); }
});
server.listen(port, host, () => console.log(`Laya Lab: ${base}`));
server.on('error', error => { console.error(error.message); bridge.close(); process.exit(1); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { bridge.close(); server.close(); process.exit(); });
