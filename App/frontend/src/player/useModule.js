import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client.js';

// A published module with its tasks and media map (GET /api/modules/:id/tasks),
// kept for the page session so moving between tasks does not refetch it.
const modules = new Map();

// Adaption tasks (C) are only shown after too many mistakes (R32, W9), so
// the normal path leaves them out.
export function pathTasks(data) {
  return data.tasks.filter((task) => !task.isAdaption);
}

export default function useModule(moduleId, token) {
  const [state, setState] = useState(() => ({
    data: modules.get(moduleId) || null,
    error: null,
  }));

  useEffect(() => {
    if (modules.has(moduleId)) {
      setState({ data: modules.get(moduleId), error: null });
      return undefined;
    }
    let cancelled = false;
    setState({ data: null, error: null });
    apiRequest(`/modules/${moduleId}/tasks`, { token })
      .then((data) => {
        modules.set(moduleId, data);
        if (!cancelled) setState({ data, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ data: null, error });
      });
    return () => {
      cancelled = true;
    };
  }, [moduleId, token]);

  return state;
}

export function clearModules() {
  modules.clear();
}
