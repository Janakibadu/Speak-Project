import { useCallback, useEffect, useState } from 'react';
import http, { apiRequest } from '../api/client.js';
import TeacherLayout from '../components/TeacherLayout.jsx';
import { useTeacherAuth } from '../context/TeacherAuthContext.jsx';
import useBodyClass from '../hooks/useBodyClass.js';
import useClasses from '../hooks/useClasses.js';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import { useI18n } from '../i18n/I18nContext.jsx';
import { loadedUrl, preload } from '../player/media.js';

// Mockup 09: results of the teacher's students (GET /api/results).
// R41 filters (week, area, class, student) and sortable columns; R37 one
// task question by question; R43 reset a module for a student; R45 print
// and R48 CSV export of what the filters show.
const NO_FILTERS = { week: '', area: '', classId: '', studentId: '' };

const SORTS = {
  student: (r) => r.studentName.toLowerCase(),
  module: (r) => r.week * 10 + (r.area === 'grammar' ? 1 : 0),
  task: (r) => r.week * 1000 + r.position,
  score: (r) => r.score ?? -1,
  mistakes: (r) => r.mistakes ?? -1,
  completedAt: (r) => (r.completedAt ? new Date(r.completedAt).getTime() : 0),
};

function sortRows(rows, { key, dir }) {
  const value = SORTS[key];
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
}

const scoreColour = (score) =>
  score === null
    ? 'var(--line)'
    : score >= 80
      ? 'var(--mint)'
      : score >= 50
        ? 'var(--sun)'
        : 'var(--coral)';

export default function ResultsPage() {
  const { t, tServer } = useI18n();
  useBodyClass('app');
  useDocumentTitle(t('titles.results'));

  const { token } = useTeacherAuth();
  const { classes } = useClasses();
  const [modules, setModules] = useState([]);
  const [students, setStudents] = useState([]);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [data, setData] = useState(null);
  const [sort, setSort] = useState({ key: 'student', dir: 1 });
  const [detail, setDetail] = useState(null);
  const [notice, setNotice] = useState(null); // { kind, text }

  const query = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value !== '')
  ).toString();

  const load = useCallback(() => {
    apiRequest(`/results${query ? `?${query}` : ''}`, { token })
      .then(setData)
      .catch((err) => setNotice({ kind: 'error', text: tServer(err.message) }));
  }, [query, token, tServer]);

  useEffect(load, [load]);

  useEffect(() => {
    apiRequest('/modules', { token })
      .then((res) => setModules(res.modules))
      .catch(() => setModules([]));
  }, [token]);

  // The student filter lists the chosen class's students, else all of them.
  useEffect(() => {
    const ids = filters.classId ? [Number(filters.classId)] : classes.map((c) => c.id);
    Promise.all(ids.map((id) => apiRequest(`/classes/${id}/students`, { token })))
      .then((lists) => setStudents(lists.flatMap((list) => list.students)))
      .catch(() => setStudents([]));
  }, [classes, filters.classId, token]);

  const setFilter = (key) => (event) =>
    setFilters((f) => ({
      ...f,
      [key]: event.target.value,
      ...(key === 'classId' ? { studentId: '' } : {}),
    }));

  const moduleName = (r) => t('student.moduleTitle', { week: r.week, area: t(`areas.${r.area}`) });
  const weeks = [...new Set(modules.map((m) => m.week))].sort((a, b) => a - b);

  function sortBy(key) {
    setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }));
  }

  async function reset(pair) {
    const module = moduleName(pair);
    if (!window.confirm(t('results.confirmReset', { student: pair.studentName, module }))) return;
    try {
      await apiRequest(`/students/${pair.studentId}/modules/${pair.moduleId}/reset`, {
        method: 'POST',
        token,
      });
      setNotice({
        kind: 'success',
        text: t('results.resetDone', { student: pair.studentName, module }),
      });
      setDetail(null);
      load();
    } catch (err) {
      setNotice({ kind: 'error', text: tServer(err.message) });
    }
  }

  async function exportCsv(level) {
    try {
      const params = new URLSearchParams(query);
      params.set('level', level);
      const res = await http.get(`/results/export.csv?${params}`, {
        responseType: 'blob',
        headers: { Authorization: `Bearer ${token}` },
      });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `speak-${level}-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setNotice({ kind: 'error', text: t('results.exportFailed') });
    }
  }

  async function openDetail(row) {
    try {
      const res = await apiRequest(`/results/attempts/${row.attemptId}`, { token });
      const ids = res.trials
        .flatMap((trial) => trial.options.map((o) => o.imageId))
        .filter(Boolean);
      await preload(ids, token);
      setDetail(res);
    } catch (err) {
      setNotice({ kind: 'error', text: tServer(err.message) });
    }
  }

  const rows = data ? sortRows(data.rows, sort) : [];
  // Only a module the student has begun can be reset.
  const started = (pair) =>
    data.rows.some((r) => r.studentId === pair.studentId && r.moduleId === pair.moduleId);
  const header = (key, label) => (
    <th>
      <button className="sort-btn" type="button" onClick={() => sortBy(key)}>
        {label}
        {sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );

  return (
    <>
      <style>{`
        .filters { display:flex; gap:10px; margin-bottom:18px; flex-wrap:wrap; }
        .filter {
          padding:9px 16px; border-radius:12px; background:#fff; border:1px solid var(--line); font-size:13.5px; font-weight:600;
          color:var(--ink-soft); display:flex; align-items:center; gap:6px; font-family:var(--font-clean);
        }
        .filter select {
          border:none; background:none; font:inherit; color:inherit; cursor:pointer; outline:none; padding:0;
        }
        .score-dot { width:12px; height:12px; border-radius:50%; display:inline-block; margin-right:6px; vertical-align:middle; }
        .sort-btn { border:none; background:none; padding:0; font:inherit; color:inherit; text-transform:inherit; letter-spacing:inherit; cursor:pointer; }
        .mini-track { width:120px; display:inline-block; vertical-align:middle; margin-right:8px; }
        .detail-trial { display:flex; align-items:center; gap:14px; padding:10px 0; border-top:1px solid var(--line); flex-wrap:wrap; }
        .detail-option { position:relative; width:64px; height:64px; border-radius:12px; border:3px solid var(--line); background:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; overflow:hidden; }
        .detail-option img { max-width:100%; max-height:100%; object-fit:contain; }
        .detail-option.correct { border-color: var(--mint); }
        .detail-option .tap { position:absolute; top:2px; right:2px; font-size:11px; font-weight:800; background:#fff; border-radius:8px; padding:0 4px; }
        @media print {
          .filters, .no-print, .sort-btn::after { display:none !important; }
          .card { box-shadow:none !important; }
        }
      `}</style>

      <TeacherLayout
        active="results"
        title={t('results.title')}
        showAvatar={false}
        actions={
          <div className="no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-md btn-ghost"
              type="button"
              onClick={() => exportCsv('tasks')}
            >
              ⬇️ {t('results.exportTasks')}
            </button>
            <button
              className="btn btn-md btn-ghost"
              type="button"
              onClick={() => exportCsv('responses')}
            >
              ⬇️ {t('results.exportResponses')}
            </button>
            <button className="btn btn-md btn-primary" type="button" onClick={() => window.print()}>
              🖨️ {t('results.print')}
            </button>
          </div>
        }
      >
        <div className="filters">
          <label className="filter">
            {t('results.filterUnit')}:
            <select value={filters.week} onChange={setFilter('week')}>
              <option value="">{t('results.all')}</option>
              {weeks.map((week) => (
                <option key={week} value={week}>
                  {week}
                </option>
              ))}
            </select>
          </label>
          <label className="filter">
            {t('results.filterArea')}:
            <select value={filters.area} onChange={setFilter('area')}>
              <option value="">{t('results.all')}</option>
              <option value="vocabulary">{t('areas.vocabulary')}</option>
              <option value="grammar">{t('areas.grammar')}</option>
            </select>
          </label>
          <label className="filter">
            {t('results.filterClass')}:
            <select value={filters.classId} onChange={setFilter('classId')}>
              <option value="">{t('results.all')}</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="filter">
            {t('results.filterStudent')}:
            <select value={filters.studentId} onChange={setFilter('studentId')}>
              <option value="">{t('results.all')}</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
            </select>
          </label>
        </div>

        {notice && (
          <div
            className={`alert ${notice.kind === 'success' ? 'alert-success' : 'alert-error'} no-print`}
            role="status"
            style={{ marginBottom: 16 }}
          >
            {notice.text}
          </div>
        )}

        {detail && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div className="h3">
                  🧒 {detail.attempt.studentName} · {moduleName(detail.attempt)} ·{' '}
                  {detail.attempt.format} {t(`player.formats.${detail.attempt.format}`)}
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  {detail.attempt.status === 'completed'
                    ? t('results.detailSummary', {
                        score: detail.attempt.score ?? '–',
                        firstTry: detail.attempt.firstTryScore ?? '–',
                        mistakes: detail.attempt.mistakes ?? 0,
                      })
                    : t('results.inProgress')}
                </div>
              </div>
              <button
                className="btn btn-sm btn-ghost no-print"
                type="button"
                onClick={() => setDetail(null)}
              >
                ✕ {t('results.close')}
              </button>
            </div>
            {detail.trials.length === 0 && (
              <div className="muted" style={{ marginTop: 12 }}>
                {t('results.noQuestions')}
              </div>
            )}
            {detail.trials.map((trial) => (
              <div className="detail-trial" key={trial.id}>
                <div style={{ width: 90, fontWeight: 700 }}>
                  {t('results.question', { n: trial.position })}
                </div>
                {trial.options.map((option) => {
                  const taps = trial.responses.filter((r) => r.optionId === option.id);
                  const src = option.imageId ? loadedUrl(option.imageId) : null;
                  return (
                    <div
                      key={option.id}
                      className={`detail-option${option.correct ? ' correct' : ''}`}
                      title={option.correct ? t('results.correctAnswer') : ''}
                    >
                      {src ? <img src={src} alt="" /> : option.text || option.id}
                      {taps.map((tap) => (
                        <span
                          key={tap.attemptNumber}
                          className="tap"
                          style={{ color: tap.correct ? 'var(--mint-ink)' : 'var(--coral-ink)' }}
                        >
                          {tap.correct ? '✓' : '✗'}
                          {tap.attemptNumber}
                        </span>
                      ))}
                    </div>
                  );
                })}
                <div className="muted">
                  {trial.responses.length === 0
                    ? t('results.notAnswered')
                    : trial.responses.some((r) => r.correct)
                      ? t('results.rightOnTry', {
                          n: trial.responses.find((r) => r.correct).attemptNumber,
                        })
                      : t('results.answerShown')}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="h3" style={{ marginBottom: 12 }}>
          {t('results.progressTitle')}
        </div>
        <div className="card table-scroll" style={{ padding: 0, marginBottom: 24 }}>
          <table className="data">
            <tbody>
              <tr>
                <th>{t('table.student')}</th>
                <th>{t('results.filterClass')}</th>
                <th>{t('table.module')}</th>
                <th>{t('results.completion')}</th>
                <th className="no-print"></th>
              </tr>
              {(data?.summary || []).map((pair) => (
                <tr key={`${pair.studentId}:${pair.moduleId}`}>
                  <td>🧒 {pair.studentName}</td>
                  <td>{pair.className}</td>
                  <td>{moduleName(pair)}</td>
                  <td>
                    <span className="progress-track mini-track">
                      <span
                        className="progress-fill"
                        style={{
                          display: 'block',
                          width: `${pair.completion}%`,
                          background: 'var(--mint)',
                        }}
                      ></span>
                    </span>
                    {t('results.tasksDone', { done: pair.done, total: pair.total })}
                  </td>
                  <td style={{ textAlign: 'right' }} className="no-print">
                    <button
                      className="btn btn-outline"
                      type="button"
                      disabled={!started(pair)}
                      style={{ height: 32, padding: '0 12px', fontSize: 12 }}
                      onClick={() => reset(pair)}
                    >
                      {t('results.resetModule')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.summary.length === 0 && (
            <div className="empty-state">{t('results.emptyProgress')}</div>
          )}
        </div>

        <div className="h3" style={{ marginBottom: 12 }}>
          {t('results.tasksTitle')}
        </div>
        <div className="card table-scroll" style={{ padding: 0, marginBottom: 20 }}>
          <table className="data">
            <tbody>
              <tr>
                {header('student', t('table.student'))}
                {header('module', t('table.module'))}
                {header('task', t('table.task'))}
                {header('score', t('results.score'))}
                {header('mistakes', t('results.mistakes'))}
                <th>{t('results.attempts')}</th>
                <th>{t('classes.status')}</th>
                {header('completedAt', t('results.date'))}
                <th className="no-print"></th>
              </tr>
              {rows.map((r) => (
                <tr key={r.attemptId}>
                  <td>🧒 {r.studentName}</td>
                  <td>{moduleName(r)}</td>
                  <td>
                    {r.isAdaption
                      ? t('module.practice')
                      : `${r.format} ${t(`player.formats.${r.format}`)}`}
                  </td>
                  <td>
                    <span className="score-dot" style={{ background: scoreColour(r.score) }}></span>
                    {r.score === null ? '–' : `${r.score}%`}
                  </td>
                  <td>{r.mistakes ?? '–'}</td>
                  <td>{r.attempts}</td>
                  <td>
                    {r.status !== 'completed' ? (
                      <span className="pill pill-sun">{t('results.inProgress')}</span>
                    ) : r.needsRemediation ? (
                      <span className="pill pill-coral">{t('results.practised')}</span>
                    ) : (
                      <span className="pill pill-mint">{t('results.completed')}</span>
                    )}
                  </td>
                  <td>{r.completedAt ? new Date(r.completedAt).toLocaleDateString() : '–'}</td>
                  <td style={{ textAlign: 'right' }} className="no-print">
                    <button
                      className="btn btn-ghost"
                      type="button"
                      style={{ height: 32, padding: '0 12px', fontSize: 12 }}
                      onClick={() => openDetail(r)}
                    >
                      {t('results.viewTrials')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && rows.length === 0 && <div className="empty-state">{t('results.empty')}</div>}
        </div>
      </TeacherLayout>
    </>
  );
}
