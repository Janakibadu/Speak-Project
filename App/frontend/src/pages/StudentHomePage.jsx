import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import { useStudentAuth } from '../context/StudentAuthContext.jsx';
import { STUDENT_STARS } from '../data/demoData.js';
import useBodyClass from '../hooks/useBodyClass.js';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import { useI18n } from '../i18n/I18nContext.jsx';

const TILE_LOOKS = [
  { icon: '📖', gradient: 'linear-gradient(160deg, var(--coral), #ff9a8b)', rotate: -1.5 },
  { icon: '🧩', gradient: 'linear-gradient(160deg, var(--sky), #8fdcf5)', rotate: 1 },
  { icon: '🎵', gradient: 'linear-gradient(160deg, var(--grape), #c39af0)', rotate: -0.8 },
  { icon: '🌳', gradient: 'linear-gradient(160deg, var(--mint), #6fe8c4)', rotate: 1.2 },
];

// Mockup 10. Tiles are the published modules (GET /api/modules); until
// assignments exist (W10) every published module is shown. Stars and
// progress are not recorded yet, so the star count is still sample data.
export default function StudentHomePage() {
  const { t, tServer } = useI18n();
  useBodyClass('app-student');
  useDocumentTitle(t('titles.studentHome'));

  const navigate = useNavigate();
  const { token, student, logout } = useStudentAuth();
  const [modules, setModules] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiRequest('/modules', { token })
      .then((data) => setModules(data.modules))
      .catch(setError);
  }, [token]);

  function handleSignOut() {
    logout();
    navigate('/');
  }

  return (
    <>
      <style>{`
        .tile-grid { display:grid; grid-template-columns: repeat(3, 1fr); gap:22px; margin-top:10px; max-width:1100px; }
        .tile .icon { font-size:44px; }
        .tile .lock { font-size:30px; opacity:.6; }
      `}</style>

      <div className="student-top">
        <img className="logo-mark" src="/img/speak-logo.png" alt="SPEAK" style={{ height: 64 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span className="pill pill-sun">⭐ {t('student.stars', { count: STUDENT_STARS })}</span>
          <LanguageSwitcher />
          <button
            className="avatar"
            type="button"
            style={{ background: 'var(--coral)' }}
            title={t('nav.logout')}
            onClick={handleSignOut}
          >
            🧒
          </button>
        </div>
      </div>

      <div className="student-main" style={{ position: 'relative' }}>
        <div className="h1" style={{ fontSize: 30 }}>
          {t('student.hello', { name: student?.displayName || '' })}
        </div>
        <div className="muted" style={{ fontSize: 15, marginBottom: 6 }}>
          🔊 „{t('student.tapCard')}“
        </div>

        {error && <div className="alert alert-error">{tServer(error.message)}</div>}
        {modules && modules.length === 0 && (
          <div className="muted" style={{ fontSize: 17, marginTop: 20 }}>
            {t('student.noModules')}
          </div>
        )}

        <div className="tile-grid">
          {(modules || []).map((m, i) => {
            const look = TILE_LOOKS[i % TILE_LOOKS.length];
            return (
              <Link
                key={m.id}
                className="tile"
                to={`/module/${m.id}`}
                style={{
                  color: '#fff',
                  background: look.gradient,
                  transform: `rotate(${look.rotate}deg)`,
                }}
              >
                <div className="icon">{look.icon}</div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 19 }}>
                    {t('student.moduleTitle', {
                      week: m.week,
                      area: t(`student.areas.${m.area}`),
                    })}
                  </div>
                  <div className="muted" style={{ color: 'rgba(255,255,255,.9)' }}>
                    {t('student.taskCount', { count: m.taskCount })}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
