import { useEffect, useMemo, useState } from 'react';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import TeacherLayout from '../components/TeacherLayout.jsx';
import { useTeacherAuth } from '../context/TeacherAuthContext.jsx';
import useBodyClass from '../hooks/useBodyClass.js';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import { useI18n } from '../i18n/I18nContext.jsx';

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Legend, Tooltip);

// Chart colours: the theme's (theme.css :root), one per module.
const PALETTE = ['#4cc9f0', '#9b5de5', '#06d6a0', '#ffc93c', '#ff6b6b', '#2b2d42'];
const LINE = '#e7e9f5';
const MINT = '#06d6a0';

// Mockup 05, R36, R40: the teacher's classes at a glance (GET /api/progress).
// Completion is the share of a module's tasks a student has finished,
// averaged over every assigned student and module.
export default function TeacherDashboardPage() {
  const { t, tServer } = useI18n();
  useBodyClass('app');
  useDocumentTitle(t('titles.dashboard'));

  const { teacher, token } = useTeacherAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiRequest('/progress', { token })
      .then(setData)
      .catch((err) => setError(err.message));
  }, [token]);

  const moduleName = (m) => t('student.moduleTitle', { week: m.week, area: t(`areas.${m.area}`) });

  // R40: completion per class, one bar per assigned module.
  const classChart = useMemo(() => {
    if (!data) return null;
    const classes = data.classes.filter((c) => c.completion !== null);
    return {
      labels: classes.map((c) => c.name),
      datasets: data.modules.map((m, i) => ({
        label: moduleName(m),
        data: classes.map((c) => c.modules.find((x) => x.moduleId === m.moduleId)?.completion ?? 0),
        backgroundColor: PALETTE[i % PALETTE.length],
        borderRadius: 6,
      })),
    };
  }, [data, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = data?.stats;
  const statusPill = (row) =>
    row.status !== 'completed'
      ? ['pill-sun', t('dashboard.results.inProgress')]
      : row.needsRemediation
        ? ['pill-coral', t('dashboard.results.needsSupport')]
        : ['pill-mint', t('dashboard.results.completed')];

  return (
    <>
      <style>{`
        .grid-stats { display:grid; grid-template-columns: repeat(4, 1fr); gap:16px; margin-bottom:22px; }
        .stat { padding:18px 20px; }
        .stat .num { font-family:var(--font-fun); font-size:30px; font-weight:800; }
        .two-col { display:grid; grid-template-columns: 1.4fr 1fr; gap:20px; }
        .chart-box { position:relative; height:260px; }
        .donut-box { position:relative; height:180px; margin: 6px auto 14px; }
        .donut-num { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-family:var(--font-fun); font-weight:800; font-size:24px; pointer-events:none; }
        @media (max-width: 900px) { .grid-stats { grid-template-columns: repeat(2, 1fr); } .two-col { grid-template-columns: 1fr; } }
      `}</style>

      <TeacherLayout
        active="dashboard"
        title={`${t('dashboard.greeting', { name: teacher?.fullName || '' })} 👋`}
        actions={<span className="pill pill-sky">🇪🇺 {t('dashboard.euHosted')}</span>}
      >
        {error && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            {tServer(error)}
          </div>
        )}

        <div className="grid-stats">
          <div className="card stat">
            <div className="muted">{t('dashboard.statClasses')}</div>
            <div className="num">{stats?.classes ?? '–'}</div>
          </div>
          <div className="card stat">
            <div className="muted">{t('dashboard.statStudents')}</div>
            <div className="num">{stats?.students ?? '–'}</div>
          </div>
          <div className="card stat">
            <div className="muted">{t('dashboard.statModules')}</div>
            <div className="num">{stats?.assignedModules ?? '–'}</div>
          </div>
          <div className="card stat">
            <div className="muted">{t('dashboard.statCompletion')}</div>
            <div className="num" style={{ color: 'var(--mint-ink)' }}>
              {stats ? `${stats.avgCompletion}%` : '–'}
            </div>
          </div>
        </div>

        <div className="two-col">
          <div className="card">
            <div className="h3" style={{ marginBottom: 16 }}>
              {t('dashboard.classCompletion')}
            </div>
            {classChart && classChart.labels.length > 0 ? (
              <div className="chart-box">
                <Bar
                  data={classChart}
                  aria-label={t('dashboard.classCompletion')}
                  role="img"
                  options={{
                    maintainAspectRatio: false,
                    scales: {
                      y: { min: 0, max: 100, ticks: { callback: (v) => `${v}%` } },
                      x: { grid: { display: false } },
                    },
                    plugins: {
                      legend: { position: 'bottom' },
                      tooltip: {
                        callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y}%` },
                      },
                    },
                  }}
                />
              </div>
            ) : (
              <div className="empty-state">
                {t('dashboard.noAssignments')}{' '}
                <Link to="/assignments" style={{ color: 'var(--ink)', fontWeight: 700 }}>
                  {t('nav.assignments')}
                </Link>
              </div>
            )}

            <div className="h3" style={{ margin: '22px 0 14px' }}>
              {t('dashboard.recentActivity')}
            </div>
            {data && data.recent.length === 0 ? (
              <div className="muted">{t('dashboard.noActivity')}</div>
            ) : (
              <div className="table-scroll">
                <table className="data">
                  <tbody>
                    <tr>
                      <th>{t('table.student')}</th>
                      <th>{t('table.module')}</th>
                      <th>{t('table.task')}</th>
                      <th>{t('table.result')}</th>
                    </tr>
                    {(data?.recent || []).map((row) => {
                      const [pill, label] = statusPill(row);
                      return (
                        <tr key={row.attemptId}>
                          <td>
                            🧒 {row.studentName} <span className="muted">({row.className})</span>
                          </td>
                          <td>{moduleName(row)}</td>
                          <td>
                            {row.format} {t(`player.formats.${row.format}`)}
                          </td>
                          <td>
                            <span className={`pill ${pill}`}>
                              {label}
                              {row.status === 'completed' && row.score !== null
                                ? ` ${row.score}%`
                                : ''}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card" style={{ textAlign: 'center' }}>
            <div className="h3">{t('dashboard.overall')}</div>
            <div className="donut-box">
              <Doughnut
                aria-label={t('dashboard.overall')}
                role="img"
                data={{
                  labels: [t('dashboard.done'), t('dashboard.open')],
                  datasets: [
                    {
                      data: [stats?.avgCompletion ?? 0, 100 - (stats?.avgCompletion ?? 0)],
                      backgroundColor: [MINT, LINE],
                      borderWidth: 0,
                    },
                  ],
                }}
                options={{
                  maintainAspectRatio: false,
                  cutout: '70%',
                  plugins: { legend: { display: false }, tooltip: { enabled: false } },
                }}
              />
              <div className="donut-num">{stats ? `${stats.avgCompletion}%` : ''}</div>
            </div>
            <div className="muted">{t('dashboard.overallHint')}</div>
            {data?.modules.map((m) => (
              <div key={m.moduleId} className="muted" style={{ marginTop: 8 }}>
                {moduleName(m)}: <b>{m.completion}%</b>
              </div>
            ))}
            <Link
              className="btn btn-md btn-primary"
              to="/results"
              style={{ width: '100%', marginTop: 16 }}
            >
              📄 {t('dashboard.viewAllResults')}
            </Link>
          </div>
        </div>
      </TeacherLayout>
    </>
  );
}
