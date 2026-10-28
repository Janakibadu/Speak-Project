import { Link, Navigate, useParams } from 'react-router-dom';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import { useStudentAuth } from '../context/StudentAuthContext.jsx';
import useBodyClass from '../hooks/useBodyClass.js';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import { useI18n } from '../i18n/I18nContext.jsx';
import useModule, { pathTasks } from '../player/useModule.js';

const STOP_ICON = { done: '✅', current: '▶', finish: '🏁' };

// Mockup 11 — the task path of one published module. Progress is not
// recorded yet (W7, W10), so the first task is "current" and the rest open.
export default function ModulePlayerPage() {
  const { t, tServer } = useI18n();
  useBodyClass('app-student');
  useDocumentTitle(t('titles.modulePlayer'));

  const { moduleId } = useParams();
  const { token } = useStudentAuth();
  const { data, error } = useModule(moduleId, token);

  if (error?.status === 404) return <Navigate to="/student-home" replace />;
  if (error) return <div className="alert alert-error">{tServer(error.message)}</div>;
  if (!data) return null;

  const { module } = data;
  const stops = [
    ...pathTasks(data).map((task, i) => ({
      n: i + 1,
      type: task.format,
      state: i === 0 ? 'current' : 'todo',
      to: `/play/${moduleId}/${task.id}`,
      label: t(`player.formats.${task.format}`),
    })),
  ];
  stops.push({
    n: stops.length + 1,
    state: 'finish',
    label: t('module.stops.reward'),
    reward: true,
  });
  const path = { progress: 0, stops };

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
          const tag = stop.type
            ? t('module.taskTag', { n: stop.n, type: stop.type })
            : t('module.taskN', { n: stop.n });
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
              key={stop.n}
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
