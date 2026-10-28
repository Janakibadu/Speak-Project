import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { STORAGE_KEYS, onSessionExpired } from '../api/session.js';
import { clearMedia } from '../player/media.js';
import { clearModules } from '../player/useModule.js';

const { token: TOKEN_KEY, info: INFO_KEY } = STORAGE_KEYS.STUDENT;

const StudentAuthContext = createContext(null);

export function StudentAuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [student, setStudent] = useState(() => {
    const raw = localStorage.getItem(INFO_KEY);
    return raw ? JSON.parse(raw) : null;
  });

  const login = useCallback((newToken, newStudent) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(INFO_KEY, JSON.stringify(newStudent));
    setToken(newToken);
    setStudent(newStudent);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(INFO_KEY);
    clearMedia(); // a shared iPad starts the next child clean
    clearModules();
    setToken(null);
    setStudent(null);
  }, []);

  // R16: the API layer reports a rejected token; end the session here too.
  useEffect(() => onSessionExpired('STUDENT', logout), [logout]);

  return (
    <StudentAuthContext.Provider value={{ token, student, login, logout }}>
      {children}
    </StudentAuthContext.Provider>
  );
}

export function useStudentAuth() {
  const ctx = useContext(StudentAuthContext);
  if (!ctx) throw new Error('useStudentAuth must be used within StudentAuthProvider');
  return ctx;
}
