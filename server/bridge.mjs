import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export class LayaBridge {
  status = { status: 'loading', detail: 'Starting local Python Router' };
  pending = new Map();
  constructor() {
    const local = resolve(process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
    this.child = spawn(process.env.LAYA_PYTHON || (existsSync(local) ? local : 'python'),
      ['-u', resolve('server/laya_worker.py')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    createInterface({ input: this.child.stdout }).on('line', line => {
      try {
        const msg = JSON.parse(line);
        if (msg.event === 'status') { this.status = msg; console.log(`[Laya] ${msg.status}: ${msg.detail}`); return; }
        const job = this.pending.get(msg.id);
        if (!job) return;
        clearTimeout(job.timer); this.pending.delete(msg.id);
        if (msg.error) job.reject(new Error(msg.error)); else job.resolve(msg);
      } catch { console.error('[Laya] Non-protocol output ignored'); }
    });
    this.child.stderr.on('data', data => process.stderr.write(data));
    this.child.on('error', error => this.fail(error.message));
    this.child.on('exit', code => this.fail(this.status.status === 'error' ? this.status.detail : `Python worker exited (${code}). Restart npm run dev.`));
  }
  fail(detail) {
    this.status = { status: 'error', detail };
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(new Error(detail)); }
    this.pending.clear();
  }
  call(payload) {
    if (this.status.status !== 'ready') return Promise.reject(Object.assign(new Error(this.status.detail), { status: 503 }));
    if (this.pending.size >= 6) return Promise.reject(Object.assign(new Error('Laya is busy. Try again after the current run.'), { status: 429 }));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Laya inference timed out after 180 seconds.')); }, 180_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ ...payload, id }) + '\n');
    });
  }
  close() { this.child.kill(); }
}
