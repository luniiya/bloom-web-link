// Runs inside the browser. A single MutationObserver waits for changes; no
// screenshot capture, page refresh, or repeated transcript delivery is needed.
export function observeReply(options) {
  const { messageSelector, typingSelector, baseline = null, timeoutMs = 0, quietMs = 700, waitForTyping = true, waitId } = options;
  const visible = e => !!(e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
  const read = () => ({
    messages: Array.from(document.querySelectorAll(messageSelector)).filter(visible).map(e => (e.innerText || e.textContent || '').trim()).filter(Boolean),
    typing: typingSelector ? (Array.from(document.querySelectorAll(typingSelector)).some(visible) ? 'typing' : 'not_typing') : 'unknown',
  });
  // Validate selectors before installing resources.
  const initial = read();
  if (!timeoutMs) return initial;
  return new Promise(resolve => {
    let observer, timer, quietTimer, done = false;
    const key = '__bwlReplyWaits';
    const registry = window[key] ||= new Map();
    const finish = reason => {
      if (done) return; done = true;
      observer?.disconnect(); clearTimeout(timer); clearTimeout(quietTimer);
      window.removeEventListener('pagehide', onHide);
      registry.delete(waitId);
      resolve({ ...read(), reason });
    };
    const onHide = () => finish('navigated');
    const check = () => {
      clearTimeout(quietTimer);
      const sample = read();
      if (!options.hasPending && JSON.stringify(sample.messages) === JSON.stringify(baseline)) return;
      if (waitForTyping && sample.typing === 'typing') return;
      quietTimer = setTimeout(() => finish('reply'), quietMs);
    };
    registry.set(waitId, () => finish('cancelled'));
    observer = new MutationObserver(check);
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    window.addEventListener('pagehide', onHide, { once: true });
    timer = setTimeout(() => finish('timeout'), timeoutMs);
    check();
  });
}

export function updateReplyStream(stream, messages) {
  const old = stream.previous || [];
  if (!stream.initialized) {
    stream.previous = messages; stream.initialized = true;
    return;
  }
  // Find maximal old-suffix/new-prefix overlap (handles trimmed chat logs).
  let overlap = Math.min(old.length, messages.length);
  while (overlap > 0 && !old.slice(-overlap).every((m, i) => m === messages[i])) overlap--;
  // Streaming text edits replace the tail; return the completed replacement.
  if (!overlap && old.length && messages.length && old[0] === messages[0]) {
    while (overlap < Math.min(old.length, messages.length) && old[overlap] === messages[overlap]) overlap++;
  }
  for (const text of messages.slice(overlap)) stream.events.push({ cursor: ++stream.cursor, text });
  stream.events = stream.events.slice(-100);
  stream.previous = messages;
}
