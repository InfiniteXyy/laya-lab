# Laya Lab

A light, developer-focused playground demonstrating three real uses of the Python `laya.Router` API. All decisions are produced by Laya inference. There are no keyword-routing fallbacks, fake result timers, or prerecorded browser actions.

**Website:** https://infinitexyy.github.io/laya-lab/

GitHub Pages serves the interface. To run the demos, start the local backend below, open the published site, choose **Connect Laya**, and connect to `http://127.0.0.1:3000`. Allow local network access if your browser prompts. If your browser blocks this connection, use the identical interface at the local URL instead. Python and Playwright run on your computer; GitHub Pages does not run the backend. A connection is only attempted after you choose Connect. Reconnect after reloading the published page.

## Run

Once dependencies are installed, start the app with:

```powershell
npm run dev
```

Open **http://127.0.0.1:3000**. The header shows when the model is ready. The server stays on loopback and starts one persistent Python worker, warming the English checkpoint before accepting predictions.

Fresh installation on Windows (Node.js 20+ and Python 3.10+):

```powershell
git clone https://github.com/InfiniteXyy/laya-lab.git
cd laya-lab
npm install
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm run dev
```

Windows uses the installed Microsoft Edge through Playwright's Chromium API in a fresh headless context. It does **not** attach to your personal browser profile. To use Chrome instead, set `$env:PLAYWRIGHT_CHANNEL='chrome'` before starting. Alternatively set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an installed Chromium executable.

On macOS/Linux, create `.venv` with `python3 -m venv .venv`, install requirements with `.venv/bin/python -m pip install -r requirements.txt`, and run `npx playwright install chromium`. The server discovers the platform's virtual-environment executable automatically.

First inference may download a checkpoint from Hugging Face. Subsequent runs reuse the local cache. Prompt and log contents are processed locally, without calling a hosted AI API. The interface uses system fonts and includes all of its visual assets.

## Demos

### Classification

`POST /api/classify` takes `{ "prompt": "..." }`. A single `Router.predict` call evaluates the intent, a model destination (Luna, Sol, or Astra), and six independent tool choices. The UI shows actual probabilities and inference duration.

The destinations are illustrative labels chosen by Laya. This demo does not call those downstream models or execute the selected tools. Laya's own checkpoint is separately identified in `routing.model`.

### Browser pilot

`POST /api/e2e/run` takes `{ "task": "...", "expectation": "..." }` and streams newline-delimited JSON.

1. Playwright starts a clean instance of the included `/sandbox` storefront.
2. It collects visible DOM elements, enabled controls, labels, values, geometry, semantic regions, and a real screenshot.
3. Laya chooses which region contains evidence relevant to the expectation.
4. Laya's `noul` head evaluates the expectation against that region. A probability of at least 0.60 is a model pass; the threshold is visible in the UI and raw trace.
5. If not satisfied, Laya chooses from actions derived from currently observed controls, including a stop option. Playwright performs exactly that selected action and observes again.
6. The loop ends on Laya's pass, its stop choice, cancellation, an error, no remaining actions, or the 10-action budget. The screen after the final action is evaluated too.

Supported actions: click, fill, select, and checkbox toggle. Put literal text to type in double quotes in the task, for example `Search for "Mechanical Keyboard"`. Laya is a decision model, not a text generator, so fill values must be supplied as candidates. Browser navigation is restricted to the local sandbox origin. Arbitrary external websites are intentionally outside this demo's scope.

The included positive journeys are adding a product, filtering the catalog, and searching for a product. A nonexistent-product example demonstrates an inconclusive run. Probabilities are model outputs, not verified reliability estimates; novel tasks can fail or receive incorrect judgments. The raw trace and screen captures expose those mistakes. There are no hidden deterministic pass rules in the application.

### Signal finder

`POST /api/logs/rank` takes `{ "query": "...", "logs": "..." }` and streams progress and results. `Router.predict_batch` evaluates messages in batches of four. All nonempty lines are accounted for. Exact duplicate messages (after removing only a leading ISO timestamp) share one model decision; every original line and occurrence remains inspectable.

Each message receives probabilities for `critical`, `relevant`, and `noise`. Sorting uses `P(critical) + 0.5 × P(relevant)`, displayed as a 0–100 relevance score. Severity does not determine rank. The editable sample contains 240 lines / 24 unique messages. Users can paste logs or import `.log`, `.txt`, or `.jsonl` files.

Limits: 2,000 nonempty lines, 700,000 characters total, 1,500 characters per line, 500 characters per question. Oversized input is rejected, not silently dropped. Keep individual records concise for the model's context window.

## Structure

| File | Responsibility |
| --- | --- |
| `public/index.html`, `style.css`, `app.js` | Responsive interface, stream rendering, cancellation, raw evidence |
| `public/sandbox.*` | Interactive storefront with search, category filtering, and cart state |
| `server/index.mjs` | Local HTTP API, validation, log batching, stream lifecycle |
| `server/bridge.mjs` | Persistent Python worker protocol, bounded queue, timeouts, health |
| `server/laya_worker.py` | Actual `Router.predict` and `Router.predict_batch` calls |
| `server/browser.mjs` | DOM observation, Laya evidence/action decisions, Playwright execution |
| `server/decisions.mjs` | Classification schemas and log grouping/sample data |

The original `script.py` is preserved.

## Configuration

Set environment variables before starting; no API key is needed.

| Variable | Default |
| --- | --- |
| `PORT` | `3000` |
| `LAYA_PYTHON` | Platform-specific `.venv` Python, falling back to `python` |
| `LAYA_DEVICE` | `cpu` |
| `LAYA_THREADS` | `4` |
| `PLAYWRIGHT_CHANNEL` | `msedge` on Windows; bundled Chromium elsewhere |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | Unset; overrides channel when provided |

`GET /api/health` reports import/loading/error/ready state. Readiness requires an actual successful prediction. Inference has a 180-second response timeout. Cancellation prevents subsequent batches or browser actions; an in-flight PyTorch call finishes in the worker before the next queued request. Only one browser journey runs at a time. Restart the server after editing backend source.

## Verification

```powershell
npm test
npm run test:live
```

Run the app first for `test:live`. It exercises the actual backend and model: weather/code classification, two distinct questions over all 240 sample logs, three successful browser journeys, and a nonexistent-product journey that must not pass. Positive browser tests independently verify the observed cart, category, search input, and catalog contents rather than trusting the model's verdict alone. Results are saved to `artifacts/live-results.json`; the latest browser frame is saved to `artifacts/e2e-latest.jpg`.

The English checkpoint currently emits a Laya warning about an out-of-range temperature bucket for choices with 11+ options. The bundled storefront's action lists remain below that size. Displayed scores should still be treated as model probabilities, not calibrated guarantees.

## Publishing

The Pages workflow publishes only `public/` when `main` changes. Relative asset paths support project Pages URLs. The sample log file is example input, not a cached AI result. All routing, log ranking, and browser decisions still call the real backend.

The backend binds only to loopback and permits browser requests from its local origin and `https://infinitexyy.github.io`. Other origins are rejected. CORS operates at the origin level, so other projects under that same GitHub Pages origin share this allowance. No credentials, checkpoints, or private logs are published. A standalone public backend would require a separate Python/Playwright host and authentication; none is provisioned here.
