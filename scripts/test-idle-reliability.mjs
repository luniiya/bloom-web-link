import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
const dir = fs.mkdtempSync('/tmp/bwl-idle-test-');
// Shorten only the two cleanup intervals; execute the production callbacks.
fs.writeFileSync(dir + '/timers.mjs', `const interval = globalThis.setInterval; globalThis.setInterval = (fn, ms, ...args) => interval(fn, ms === 60000 && /SESSION_TIMEOUT_MS|tabLifetime/.test(String(fn)) ? 100 : ms, ...args);`);
const server = spawn('node', ['--import', dir + '/timers.mjs', '/app/server.js'], { cwd: '/app', env: { ...process.env, BWL_PORT: '9391', PORT: '9391', BWL_BIND_HOST: '127.0.0.1', SESSION_TIMEOUT_MS: '700', TAB_INACTIVITY_MS: '700', BWL_PROFILE_DIR: dir + '/profiles', BWL_ACCESS_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; server.stdout.on('data', b => { logs = (logs + b).slice(-30000); }); server.stderr.on('data', b => { logs = (logs + b).slice(-30000); });
const fixture = http.createServer((_, res) => res.end('<!doctype html><p class="incoming">old</p>'));
await new Promise(r => fixture.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:9391'; const pageUrl = `http://127.0.0.1:${fixture.address().port}/`;
const delay = ms => new Promise(r => setTimeout(r, ms));
async function api(path, body, method = body ? 'POST' : 'GET', signal) {
 const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal });
 const data = await res.json(); if (!res.ok) throw new Error(JSON.stringify(data)); return data;
}
try {
 for (let i = 0; i < 100; i++) { const r = await fetch(base + '/health').catch(() => null); if (r?.ok) break; await delay(100); }
 const make = userId => api('/tabs', { userId, sessionKey: 'chat', url: pageUrl });
 const pin = await make('pinned'); await api(`/tabs/${pin.tabId}/lifetime`, { userId: 'pinned', keepOpen: true });
 const view = await make('viewed'); await api(`/tabs/${view.tabId}/lifetime`, { userId: 'viewed', viewing: true });
 const waiting = await make('waiting');
 const controller = new AbortController();
 const pending = api(`/tabs/${waiting.tabId}/wait-reply`, { userId: 'waiting', messageSelector: '.incoming', timeout: 10000 }, 'POST', controller.signal).catch(e => e);
 const idle = await make('idle'); await api('/dashboard/state');
 await delay(1600);
 const state = await api('/dashboard/state');
 for (const user of ['pinned', 'viewed', 'waiting']) assert.ok(state.sessions.some(s => s.userId === user), user + ' must survive cleanup');
 assert.equal(state.sessions.some(s => s.userId === 'idle'), false);
 const history = await api(`/tabs/${idle.tabId}/history?userId=idle`); assert.match(history.reason, /idle_timeout|session_timeout/);
 console.log('PASS real cleanup preserves pinned, dashboard-viewed and reply-waiting sessions; idle sessions still expire');
 controller.abort(); await pending;
 for (const user of ['pinned', 'viewed']) await api(`/sessions/${user}`, undefined, 'DELETE');
 // The remaining waiting session now expires naturally; final idle closure
 // must retire the browser, and the next navigation must use a fresh runtime.
 await delay(3000);
 assert.match(logs, /idle_session_cleanup/);
 const fresh = await make('fresh'); assert.equal(fresh.navigationOk, true);
 console.log('PASS final idle closure retires the browser; subsequent navigation succeeds');
 console.log('ALL IDLE CLEANUP CHECKS PASSED');
} catch (e) { console.error(logs.slice(-12000)); throw e; }
finally {
 server.kill('SIGTERM');
 await Promise.race([new Promise(r => server.once('exit', r)), delay(5000).then(() => server.kill('SIGKILL'))]);
 fixture.closeAllConnections(); await new Promise(r => fixture.close(r)); fs.rmSync(dir, { recursive: true, force: true });
}
