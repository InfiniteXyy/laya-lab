import { chromium } from 'playwright';

// Observe rendered DOM, including labels, values, disabled state and viewport geometry.
// The sandbox disallows navigation outside its origin and starts fresh for every run.
export async function observe(page) {
  return page.evaluate(() => {
    const visible = el => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight;
    };
    const all = [...document.querySelectorAll('body *')].filter(visible);
    const controls = all.filter(el => el.matches('button,a[href],input:not([type=hidden]),select,textarea,[role=button]'));
    const elements = controls.map((el, i) => {
      const id = `e${i}`;
      el.setAttribute('data-agent-id', id);
      const r = el.getBoundingClientRect();
      return { id, tag: el.tagName.toLowerCase(), role: el.getAttribute('role'),
        name: el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.innerText?.trim() || el.getAttribute('placeholder') || el.getAttribute('name') || '',
        value: el.value ?? null, disabled: !!el.disabled, type: el.type || '',
        options: el.tagName === 'SELECT' ? [...el.options].map(o => ({ value: o.value, text: o.text })) : undefined,
        bounds: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } };
    });
    const visibleElements = all.map(el => ({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role'),
      text: (el.children.length ? '' : el.innerText || '').trim().slice(0, 240),
      name: el.getAttribute('aria-label') || '', control: el.getAttribute('data-agent-id') || undefined }));
    const regions = [...document.querySelectorAll('header,section,aside,[role=status]')].filter(visible)
      .map(el => ({ region: el.getAttribute('aria-label') || el.tagName.toLowerCase(), text: el.innerText }));
    return { url: location.pathname, title: document.title, text: document.body.innerText.slice(0, 10000), elements, visibleElements, regions,
      visibleElementCount: all.length, viewport: { width: innerWidth, height: innerHeight } };
  });
}

export function actionsFor(observation, task, history) {
  const quoted = [...task.matchAll(/["“]([^"”]{1,100})["”]/g)].map(m => m[1]);
  const actions = [];
  for (const el of observation.elements) {
    if (el.disabled) continue;
    if (el.tag === 'select') {
      for (const option of el.options) if (option.value !== el.value) actions.push({ type: 'select', element: el.id, value: option.value, description: `Select ${option.text} in ${el.name}` });
    } else if (el.tag === 'input' || el.tag === 'textarea') {
      if (el.type === 'checkbox') actions.push({ type: 'check', element: el.id, description: `Toggle ${el.name}` });
      else for (const value of [...new Set(quoted)]) if (el.value !== value) actions.push({ type: 'fill', element: el.id, value, description: `Fill ${el.name} with ${JSON.stringify(value)}` });
    } else actions.push({ type: 'click', element: el.id, description: `Click ${el.name}` });
  }
  // Repeating an identical action in an unchanged state cannot make progress.
  return actions.filter(a => !history.some(h => h.before === observation.text && h.description === a.description));
}

export async function runBrowser({ bridge, base, task, expectation, emit, signal }) {
  let browser;
  const started = Date.now();
  const history = [];
  let inferenceTotal = 0;
  try {
    const launchOptions = { headless: true };
    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
    else if (process.env.PLAYWRIGHT_CHANNEL || process.platform === 'win32') launchOptions.channel = process.env.PLAYWRIGHT_CHANNEL || 'msedge';
    else launchOptions.executablePath = chromium.executablePath();
    browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({ viewport: { width: 1000, height: 760 }, reducedMotion: 'reduce' });
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(`${base}/sandbox`);
    emit({ type: 'started', detail: 'Fresh Chromium session opened', task, expectation });
    for (let step = 0; step <= 10; step++) {
      if (signal.aborted) return;
      const observation = await observe(page);
      const screenshot = (await page.screenshot({ type: 'jpeg', quality: 75 })).toString('base64');
      emit({ type: 'observation', step, observation, screenshot });
      const state = history.length ? `${task}\nAlready completed: ${history.map(h => h.description).join('; ')}` : task;
      // Ask Laya which semantic region matters before judging it. Flattening the
      // whole page lets catalog entries contaminate cart assertions.
      const focus = await bridge.call({ op: 'predict', state: expectation, questions: { region: {
        type: 'choice', instructions: 'Which webpage region contains the evidence needed to evaluate this assertion?',
        criteria: Object.fromEntries(observation.regions.map((region, i) => [`r${i}`, region.region])),
      } } });
      inferenceTotal += focus.inference_ms;
      const region = observation.regions[Number(focus.result.answers.region.choice.slice(1))];
      if (!region) throw new Error('Laya selected an unavailable evidence region.');
      emit({ type: 'focus', step, region: region.region, evidence: region.text, inference_ms: focus.inference_ms, raw: focus.result });
      if (signal.aborted) return;
      const verdict = await bridge.call({ op: 'predict', state: region.text, questions: { outcome: {
        type: 'noul', instructions: `Is the following assertion satisfied by the webpage? ${expectation}`,
      } }, max_len: 1024, head_max_len: 256 });
      inferenceTotal += verdict.inference_ms;
      if (signal.aborted) return;
      const assessment = verdict.result.answers.outcome;
      const passed = assessment.noul >= 0.6;
      const outcome = { choice: passed ? 'passed' : 'pending', assessment, threshold: 0.6,
        probabilities: { passed: assessment.noul, pending: 1 - assessment.noul } };
      emit({ type: 'assertion', step, outcome, inference_ms: verdict.inference_ms, raw: verdict.result });
      if (outcome.choice === 'passed' || outcome.choice === 'failed') {
        emit({ type: 'complete', status: outcome.choice, steps: history.length, inference_ms: inferenceTotal, elapsed_ms: Date.now() - started,
          confidence: outcome.probabilities[outcome.choice], expectation, evidence: observation.text, modelVerdict: true });
        return;
      }
      if (step === 10) break;
      const actions = actionsFor(observation, task, history);
      if (!actions.length) { emit({ type: 'complete', status: 'inconclusive', detail: 'No untried actions remain on this screen.', steps: history.length }); return; }
      const candidates = [...actions, { type: 'stop', description: 'Stop because the requested product or action is unavailable' }];
      const decision = await bridge.call({ op: 'predict', state, questions: { next: {
        type: 'choice', instructions: 'Which browser action should be performed to fulfill this user request?',
        criteria: Object.fromEntries(candidates.map((a, i) => [`a${i}`, a.description])),
      } }, max_len: 2048, head_max_len: 768 });
      inferenceTotal += decision.inference_ms;
      const answer = decision.result.answers.next;
      const action = candidates[Number(answer.choice.slice(1))];
      if (!action) throw new Error('Laya returned an unavailable action.');
      if (signal.aborted) return;
      if (action.type === 'stop') { emit({ type: 'complete', status: 'inconclusive', detail: 'Laya chose to stop because no action meets the task.', steps: history.length }); return; }
      const target = page.locator(`[data-agent-id="${action.element}"]`);
      if (action.type === 'click') await target.click();
      if (action.type === 'fill') await target.fill(action.value);
      if (action.type === 'select') await target.selectOption(action.value);
      if (action.type === 'check') await target.click();
      history.push({ description: action.description, before: observation.text });
      emit({ type: 'action', step: step + 1, action, confidence: answer.probabilities[answer.choice], candidates,
        inference_ms: decision.inference_ms, raw: decision.result });
    }
    emit({ type: 'complete', status: 'inconclusive', detail: 'The 10-step limit was reached without a passing Laya assertion.', steps: history.length });
  } finally { await browser?.close(); }
}
