// Where each role's session lives in the browser, plus the listeners that
// let the API layer end a session (R16) without importing React contexts.
export const STORAGE_KEYS = {
  TEACHER: { token: 'speak_teacher_token', info: 'speak_teacher_info' },
  STUDENT: { token: 'speak_student_token', info: 'speak_student_info' },
};

const expiredListeners = { TEACHER: new Set(), STUDENT: new Set() };

export function readToken(role) {
  return localStorage.getItem(STORAGE_KEYS[role].token);
}

// Renewed teacher tokens are written here only, not into React state, so a
// renewal never re-runs effects that depend on the token.
export function storeToken(role, token) {
  localStorage.setItem(STORAGE_KEYS[role].token, token);
}

export function onSessionExpired(role, listener) {
  expiredListeners[role].add(listener);
  return () => expiredListeners[role].delete(listener);
}

export function expireSession(role) {
  expiredListeners[role].forEach((listener) => listener());
}

// The role claim of one of our own tokens (not verified: display logic only).
export function tokenRole(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role === 'TEACHER' || payload.role === 'STUDENT' ? payload.role : null;
  } catch {
    return null;
  }
}
