export const TOOLS = {
  read_code: 'Read source code, inspect implementation and understand a codebase',
  debugging: 'Diagnose errors, exceptions, stack traces or broken software',
  search: 'Look up current information, weather, facts or documentation',
  edit_code: 'Write, fix, refactor or modify source code',
  run_tests: 'Run automated tests to verify code behavior or a bug fix',
  analyze_data: 'Analyze data, metrics, logs or numerical trends',
};

export const classificationQuestions = {
  intent: { type: 'choice', instructions: 'What is the primary task in the user request?', criteria: {
    debugging: 'Investigate or fix a software error, bug or exception',
    lookup: 'Find current facts, weather or information',
    coding: 'Build, implement or refactor software',
    analysis: 'Analyze data, logs or metrics',
    conversation: 'General conversation, writing or simple assistance',
  } },
  model: { type: 'choice', instructions: 'Choose the appropriate assistant model for this user request, following the capability descriptions.', criteria: {
    luna: 'Fast lightweight model for simple fact lookups, weather, search, brief writing and conversation',
    sol: 'Strong coding model for ordinary programming, debugging, tests and data analysis',
    astra: 'Most capable reasoning model for difficult architecture, complex multistep investigation and distributed system failures',
  } },
  ...Object.fromEntries(Object.entries(TOOLS).map(([name, description]) => [`tool_${name}`, {
    type: 'choice', instructions: `Should the assistant use ${name} to fulfill this request? Tool: ${description}.`,
    criteria: { use: 'This tool is needed or useful for the requested task', skip: 'This tool is unnecessary for the requested task' },
  }])),
};

export function classificationResult(reply) {
  const raw = reply.result;
  const tools = Object.keys(TOOLS).map(name => ({ name, ...raw.answers[`tool_${name}`] }));
  return { ...raw, tools, inference_ms: reply.inference_ms, selectedTools: tools.filter(t => t.choice === 'use').map(t => t.name) };
}

export function groupLogs(text) {
  const lines = text.split(/\r?\n/).map((text, i) => ({ text, line: i + 1 })).filter(l => l.text.trim());
  if (!lines.length || lines.length > 2000) throw Object.assign(new Error('Provide between 1 and 2,000 nonempty log lines.'), { status: 400 });
  if (lines.some(l => l.text.length > 1500)) throw Object.assign(new Error('Each log line must be at most 1,500 characters. Split long records before filtering.'), { status: 400 });
  const groups = new Map();
  for (const line of lines) {
    // Only timestamp prefixes are removed. All message content remains part of the key.
    const message = line.text.replace(/^\[?\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?\]?\s*/, '');
    if (!groups.has(message)) groups.set(message, { message, occurrences: [] });
    groups.get(message).occurrences.push(line);
  }
  return { lines, groups: [...groups.values()] };
}

export const sampleLogs = () => {
  const messages = [
    'INFO  gateway      GET /health status=200 duration=2ms',
    'INFO  auth         Session refreshed user=u_184 status=200',
    'DEBUG cache        Cache hit key=product:studio-headphones ttl=240s',
    'INFO  catalog      GET /products status=200 duration=18ms',
    'WARN  database     Connection pool exhausted active=50 max=50 waiting=187',
    'ERROR checkout     POST /checkout failed: connection acquisition timed out after 5000ms trace=checkout-a7',
    'ERROR payment      Payment authorization aborted: upstream checkout unavailable trace=checkout-a7',
    'INFO  scheduler    Nightly report job completed rows=1842',
    'WARN  auth         Login rejected: invalid password user=u_593 attempts=4',
    'ERROR auth         Token signature verification failed: signing key rotated but JWKS cache stale',
    'INFO  assets       GET /favicon.svg status=304 duration=1ms',
    'DEBUG worker       Heartbeat sent queue=email pending=0',
    'WARN  inventory    Stock below threshold sku=arc-lamp remaining=3',
    'ERROR database     Long-running transaction holds locks on orders table duration=92000ms trace=checkout-a7',
    'INFO  search       Search index refreshed documents=6320',
    'WARN  gateway      GET /cart p99 latency=6200ms upstream=checkout',
    'ERROR mailer       Newsletter delivery failed: SMTP rate limit exceeded campaign=weekly',
    'DEBUG metrics      Flushed 84 counters to telemetry collector',
    'INFO  deployment   Rolled out checkout v2.8.1 connection_pool_size=50',
    'INFO  backup       Snapshot completed database=orders size=842MB',
    'ERROR search       Search query failed: index products_v4 not found',
    'INFO  billing      Invoice generated customer=c_301 amount=49.00',
    'WARN  cache        Redis memory pressure: evicting least recently used keys',
    'INFO  gateway      GET /about status=200 duration=6ms',
  ];
  return Array.from({ length: 240 }, (_, i) => `${new Date(Date.UTC(2026, 8, 28, 9, 41, i)).toISOString()} ${messages[i % messages.length]}`).join('\n');
};
