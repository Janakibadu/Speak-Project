import { useI18n } from '../i18n/I18nContext.jsx';
import { unlockAudio } from './audio.js';

// Shown while a task's media load (NFR19), then as one big start button: the
// tap is the user gesture iPad Safari needs before any sound can play.
export default function StartGate({ done, total, failed, onStart, onRetry }) {
  const { t } = useI18n();
  const loading = done < total;
  const percent = total ? Math.round((done / total) * 100) : 100;

  function start() {
    unlockAudio();
    onStart();
  }

  return (
    <div className="player-stage">
      {loading && (
        <div className="player-card" style={{ textAlign: 'center' }}>
          <div className="h3">{t('player.loading')}</div>
          <div className="progress-track" style={{ width: 280, margin: '18px auto 8px' }}>
            <div
              className="progress-fill"
              style={{ width: `${percent}%`, background: 'var(--sky)' }}
            ></div>
          </div>
          <div className="muted">{t('player.loadingCount', { done, total })}</div>
        </div>
      )}
      {!loading && failed > 0 && (
        <div className="player-card" style={{ textAlign: 'center' }}>
          <div className="alert alert-error">{t('player.loadFailed', { count: failed })}</div>
          <button className="btn btn-lg btn-coral" type="button" onClick={onRetry}>
            {t('player.retry')}
          </button>
        </div>
      )}
      {!loading && failed === 0 && (
        <button className="player-start" type="button" onClick={start}>
          <span aria-hidden="true">▶</span>
          <span className="player-start-label">{t('player.start')}</span>
        </button>
      )}
    </div>
  );
}
