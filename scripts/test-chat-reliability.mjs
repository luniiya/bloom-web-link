// Run inside the BWL container: node /tmp/bwl-live-reliability.mjs
import http from 'node:http';
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:9377';
const userId = 'reliability-test-' + Date.now();
const fixture = http.createServer((req, res) => {
 if (req.url === '/hang') return;
 res.setHeader('content-type', 'text/html');
 res.end('<!doctype html><title>Chat regression fixture</title><div id="messages"><p class="incoming">old</p></div><div id="typing" hidden>writing</div>');
});
await new Promise(r => fixture.listen(0, '127.0.0.1', r));
const fixtureUrl = `http://127.0.0.1:${fixture.address().port}/`;
async function api(path, body, method = body ? 'POST' : 'GET', signal) {
 const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify({ userId, ...body }) : undefined, signal });
 const data = await r.json(); if (!r.ok) throw Object.assign(new Error(JSON.stringify(data)), { status: r.status }); return data;
}
let tabId, dashId;
const evaluate = expression => api(`/tabs/${tabId}/evaluate`, { expression });
const wait = options => api(`/tabs/${tabId}/wait-reply`, { messageSelector: '.incoming', typingSelector: '#typing', ...options });
try {
 for (let i = 0; i < 30; i++) { const r = await fetch(base + '/gateway/health').catch(() => null); if (r?.ok) break; await new Promise(r => setTimeout(r, 500)); }
 const tab = await api('/tabs', { sessionKey: 'chat', url: fixtureUrl }); tabId = tab.tabId;
 assert.equal(tab.navigationOk, true);
 const initial = await wait({ timeout: 0 }); assert.deepEqual(initial.messages, []); assert.equal(initial.typing, 'not_typing');
 console.log('PASS baseline excludes existing chat text');
 await evaluate(`(() => { setTimeout(() => { document.querySelector('#typing').hidden = false; document.querySelector('#messages').insertAdjacentHTML('beforeend', '<p class="incoming">par</p>'); }, 200); setTimeout(() => { document.querySelector('#messages').lastElementChild.textContent = 'completed reply'; document.querySelector('#typing').hidden = true; }, 700); return true; })()`);
 const reply = await wait({ cursor: initial.cursor, timeout: 5000 });
 assert.deepEqual(reply.messages.map(m => m.text), ['completed reply']); assert.equal(reply.typing, 'not_typing');
 console.log('PASS streamed reply settles and waits for typing to stop');
 const repeat = await wait({ cursor: reply.cursor, timeout: 150 }); assert.deepEqual(repeat.messages, []); assert.equal(repeat.timedOut, true);
 await evaluate(`document.querySelector('#messages').insertAdjacentHTML('beforeend','<p class="incoming">between calls</p>')`);
 const between = await wait({ cursor: repeat.cursor, timeout: 1000 }); assert.deepEqual(between.messages.map(m => m.text), ['between calls']);
 console.log('PASS timeouts are normal; replies between calls are not missed or duplicated');
 const controller = new AbortController();
 const pending = api(`/tabs/${tabId}/wait-reply`, { messageSelector: '.incoming', cursor: 0, timeout: 20000 }, 'POST', controller.signal).catch(e => e);
 await new Promise(r => setTimeout(r, 300)); controller.abort(); await pending;
 await new Promise(r => setTimeout(r, 300));
 const afterCancel = await wait({ timeout: 0 }); assert.equal(afterCancel.ok, true);
 console.log('PASS cancellation releases the active wait');
 const pinned = await api(`/tabs/${tabId}/lifetime`, { keepOpen: true }); assert.equal(pinned.lifetime.keepOpen, true); assert.equal(pinned.lifetime.idleTimeoutMs, 0);
 console.log('PASS local idle cleanup disabled and explicit keep-open works');
 const dash = await api('/tabs', { sessionKey: 'dashboard', url: `http://127.0.0.1:6080/#tab/${userId}/${tabId}` }); dashId = dash.tabId;
 await new Promise(r => setTimeout(r, 1000));
 const ui = await api(`/tabs/${dashId}/evaluate`, { expression: `({label:document.querySelector('#keep-open-button').textContent, status:document.querySelector('#lifetime-status').textContent})` });
 assert.equal(ui.result.label, 'Allow idle cleanup'); assert.match(ui.result.status, /Kept open/);
 console.log('PASS real dashboard renders pin and lifetime state');
 await api(`/tabs/${tabId}?userId=${userId}`, undefined, 'DELETE');
 const history = await api(`/tabs/${tabId}/history?userId=${userId}`);
 assert.equal(history.reason, 'user_closed'); assert.equal(history.url, fixtureUrl); assert.match(history.text, /between calls/);
 await new Promise(r => setTimeout(r, 3500));
 const closedUi = await api(`/tabs/${dashId}/evaluate`, { expression: `({reason:document.querySelector('#closure-reason').textContent,reopen:document.querySelector('#reopen-button').disabled})` });
 assert.equal(closedUi.result.reason, 'Closed by request'); assert.equal(closedUi.result.reopen, false);
 await api(`/tabs/${dashId}/evaluate`, { expression: `document.querySelector('#reopen-button').click()` });
 await new Promise(r => setTimeout(r, 2000));
 const restored = await api(`/tabs/${dashId}/evaluate`, { expression: 'location.hash' }); assert.notEqual(restored.result.split('/').at(-1), tabId);
 console.log('PASS closed tab has saved text, correct cause and working reopen button');
 // Opening a nonresponding URL must retain a usable tab ID and all other tabs.
 const hanging = await api('/tabs', { sessionKey: 'hang', url: fixtureUrl + 'hang' });
 assert.equal(hanging.navigationOk, false); assert.equal(hanging.code, 'navigation_timeout'); assert.ok(hanging.tabId);
 const state = await api('/dashboard/state');
 assert.ok(state.sessions.find(s => s.userId === userId).tabs.some(t => t.tabId === hanging.tabId && t.navigationError));
 console.log('PASS navigation timeout retains tab and reports visible error');
 console.log('ALL LIVE RELIABILITY CHECKS PASSED');
} finally {
 await api(`/sessions/${userId}`, undefined, 'DELETE').catch(() => {});
 fixture.closeAllConnections(); await new Promise(r => fixture.close(r));
}
