import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import { useStudentAuth } from '../context/StudentAuthContext.jsx';
import useBodyClass from '../hooks/useBodyClass.js';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import { useI18n } from '../i18n/I18nContext.jsx';
import useModule from '../player/useModule.js';

const STOP_ICON = { done: '✅', current: '▶', finish: '🏁' };

// Mockup 11 — the task path of one module, with the child's progress from
// the server (R35). Done tasks can be played again; the current one is where
// the child continues, including an adaption task their mistakes call for
// (R32). Later tasks open one after the other.
export default function ModulePlayerPage() {
  const { t, tServer } = useI18n();
  useBodyClass('app-student');
  useDocumentTitle(t('titles.modulePlayer'));

  const { moduleId } = useParams();
  const { token } = useStudentAuth();
  const { data, error } = useModule(moduleId, token);
  const [progress, setProgress] = useState(null);
  const [progressError, setProgressError] = useState(null);

  useEffect(() => {
    apiRequest(`/modules/${moduleId}/progress`, { token })
      .then(setProgress)
      .catch(setProgressError);
  }, [moduleId, token]);

  const failure = error || progressError;
  if (failure?.status === 404) return <Navigate to="/student-home" replace />;
  if (failure) return <div className="alert alert-error">{tServer(failure.message)}</div>;
  if (!data || !progress) return null;

  const { module } = data;
  // Adaption tasks show up only when they are due or were played.
  const shown = progress.tasks.filter(
    (task) => !task.isAdaption || task.status === 'pending' || task.status === 'done'
  );
  let n = 0;
  const stops = shown.map((task) => {
    if (!task.isAdaption) n += 1;
    const state =
      task.id === progress.current ? 'current' : task.status === 'done' ? 'done' : 'todo';
    return {
      key: task.id,
      n,
      type: task.isAdaption ? null : task.format,
      state,
      to: state === 'todo' ? null : `/play/${moduleId}/${task.id}`,
      label: t(`player.formats.${task.format}`),
    };
  });
  stops.push({
    key: 'finish',
    n: n + 1,
    state: progress.current === null ? 'done' : 'finish',
    label: t('module.stops.reward'),
    reward: true,
  });
  const path = {
    progress: progress.total ? Math.round((100 * progress.done) / progress.total) : 0,
    stops,
  };

  return (
    <>
      <style>{`
        .path { position:relative; padding: 30px 60px; max-width:900px; margin:0 auto; }
        .stop-row { display:flex; align-items:center; justify-content:space-between; margin-bottom:36px; gap:16px; }
        .stop-row:nth-child(even) { flex-direction:row-reverse; }
        .stop {
          width:96px; height:96px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex:none;
          font-size:36px; box-shadow: var(--shadow-md); border: 5px solid #fff; position:relative; text-decoration:none;
        }
        .stop.done { background: var(--mint); }
        .stop.current { background: var(--coral); width:112px; height:112px; font-size:42px; color:#fff; }
        .stop.todo { background: #fff; color: var(--ink-faint); border-color: var(--line); }
        .stop-label { max-width:300px; }
        .stop-label .tag { font-size:12px; font-weight:700; color: var(--ink-faint); text-transform:uppercase; letter-spacing:.05em; }
        @media (max-width: 640px) { .path { padding: 24px 16px; } }
      `}</style>

      <div className="student-top">
        <Link className="brand" to="/student-home" style={{ textDecoration: 'none' }}>
          <img className="logo-mark" src="/img/speak-logo.png" alt="SPEAK" style={{ height: 65 }} />
        </Link>
        <div className="h3">
          {t('student.moduleTitle', { week: module.week, area: t(`student.areas.${module.area}`) })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="progress-track" style={{ width: 200 }}>
            <div
              className="progress-fill"
              style={{ width: `${path.progress}%`, background: 'var(--coral)' }}
            ></div>
          </div>
          <LanguageSwitcher />
        </div>
      </div>

      <div className="path">
        {path.stops.map((stop, i) => {
          const cls = stop.state === 'finish' ? 'todo' : stop.state;
          const content = STOP_ICON[stop.state] || stop.n;
          const node = stop.to ? (
            <Link className={`stop ${cls}`} to={stop.to}>
              {content}
            </Link>
          ) : (
            <div className={`stop ${cls}`}>{content}</div>
          );
          const tag = stop.reward
            ? t('module.taskN', { n: stop.n })
            : stop.type
              ? t('module.taskTag', { n: stop.n, type: stop.type })
              : t('module.practice');
          const label = (
            <div className="stop-label">
              <div className="tag">{tag}</div>
              <div className="h3">
                {stop.reward ? '🏆 ' : ''}
                {stop.label}
                {stop.state === 'current' ? ` — ${t('module.youAreHere')}` : ''}
              </div>
            </div>
          );
          // Even rows are row-reversed by CSS, so their markup order is flipped
          // too — every stop ends up on the left, as in the mockup.
          return (
            <div
              className="stop-row"
              key={stop.key}
              style={i === path.stops.length - 1 ? { marginBottom: 0 } : undefined}
            >
              {i % 2 === 0 ? (
                <>
                  {node}
                  {label}
                </>
              ) : (
                <>
                  {label}
                  {node}
                </>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
