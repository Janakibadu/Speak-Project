import axios from 'axios';
import { expireSession, readToken, storeToken, tokenRole } from './session.js';

const http = axios.create({ baseURL: '/api' });

const SESSION_HEADER = 'x-session-token';

// Always send the newest stored token for the caller's role: the server may
// have renewed it since the page read it from context (NFR09).
http.interceptors.request.use((config) => {
  const auth = config.headers.Authorization;
  if (auth) {
    const role = tokenRole(auth.slice(7));
    const latest = role && readToken(role);
    if (latest) config.headers.Authorization = `Bearer ${latest}`;
  }
  return config;
});

http.interceptors.response.use(
  (res) => {
    const renewed = res.headers[SESSION_HEADER];
    if (renewed) storeToken('TEACHER', renewed);
    return res;
  },
  (err) => {
    // R16: a rejected session (missing, invalid or expired token) ends the
    // client session too; the route guards then send the user to login.
    // Login requests carry no token, so wrong credentials never land here.
    const auth = err.config?.headers?.Authorization;
    if (err.response?.status === 401 && auth) {
      const role = tokenRole(auth.slice(7));
      if (role) expireSession(role);
    }
    return Promise.reject(err);
  }
);

// Mirrors the shape the pages previously called on the old vanilla-JS
// SPEAK.request helper: request(path, { method, body, token }).
// Errors carry the server's message (403 included) and never internals (NFR14).
export async function apiRequest(path, { method = 'GET', body, token } = {}) {
  try {
    const res = await http.request({
      url: path,
      method,
      data: body,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    return res.data;
  } catch (err) {
    const error = new Error(err.response?.data?.error || 'Request failed.');
    error.status = err.response?.status;
    error.data = err.response?.data; // e.g. the import report on a 422
    throw error;
  }
}

export default http;
