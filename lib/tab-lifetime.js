// Protection is explicit and shared by every automatic cleanup path.
export function tabProtected(tab, now = Date.now(), lock) {
  return !!(tab.creating || tab.keepOpen || tab.pendingReplyWaits > 0 || tab.viewedUntil > now || lock?.active || lock?.queue?.length || lock?.queued > 0);
}

export function sessionProtected(session, now = Date.now(), locks = new Map()) {
  for (const group of session.tabGroups.values()) {
    for (const [id, tab] of group) if (tabProtected(tab, now, locks.get(id))) return true;
  }
  return false;
}

export function tabLifetime(tab, timeoutMs, now = Date.now(), lock) {
  // Existing actions increment toolCalls. Observe those centrally without having
  // to teach every action handler a second activity bookkeeping convention.
  if (tab._activityCalls !== tab.toolCalls) {
    tab._activityCalls = tab.toolCalls;
    tab.lastActivityAt = now;
  }
  const protectedNow = tabProtected(tab, now, lock);
  const expiresAt = timeoutMs > 0 && !protectedNow ? (tab.lastActivityAt || now) + timeoutMs : null;
  return { keepOpen: !!tab.keepOpen, protected: protectedNow, expiresAt, idleTimeoutMs: timeoutMs };
}

export function shouldRecoverSession(canRotate, session, now, locks) {
  // Destroying an unproxied session does not rotate anything and loses other tabs.
  return !!canRotate && !sessionProtected(session, now, locks);
}

export async function finishIdleSession(closeSession, browserUnused, retireBrowser) {
  await closeSession();
  // Recheck after asynchronous context closure: a new session/creation may
  // have appeared in the meantime. Never restart a browser someone is using.
  if (browserUnused()) await retireBrowser();
}
