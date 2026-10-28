import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { STORAGE_KEYS, onSessionExpired } from '../api/session.js';

const { token: TOKEN_KEY, info: INFO_KEY } = STORAGE_KEYS.TEACHER;

const TeacherAuthContext = createContext(null);

export function TeacherAuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [teacher, setTeacher] = useState(() => {
    const raw = localStorage.getItem(INFO_KEY);
    return raw ? JSON.parse(raw) : null;
  });

  const login = useCallback((newToken, newTeacher) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(INFO_KEY, JSON.stringify(newTeacher));
    setToken(newToken);
    setTeacher(newTeacher);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(INFO_KEY);
    setToken(null);
    setTeacher(null);
  }, []);

  // R16: the API layer reports a rejected token; end the session here too.
  useEffect(() => onSessionExpired('TEACHER', logout), [logout]);

  return (
    <TeacherAuthContext.Provider value={{ token, teacher, login, logout }}>
      {children}
    </TeacherAuthContext.Provider>
  );
}

export function useTeacherAuth() {
  const ctx = useContext(TeacherAuthContext);
  if (!ctx) throw new Error('useTeacherAuth must be used within TeacherAuthProvider');
  return ctx;
}
