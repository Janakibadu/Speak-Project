import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api/client.js';
import TeacherLayout from '../components/TeacherLayout.jsx';
import { useTeacherAuth } from '../context/TeacherAuthContext.jsx';
import useBodyClass from '../hooks/useBodyClass.js';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import { useI18n } from '../i18n/I18nContext.jsx';

function where(item) {
  if (!item.file) return '';
  return `${item.file}${item.line ? `:${item.line}` : ''}${item.column ? ` (${item.column})` : ''}`;
}

function ReportList({ items, className, icon, render }) {
  return items.map((item, index) => (
    <div key={index} className={`report-row ${className}`}>
      <span>{icon}</span>
      <span>{render(item)}</span>
    </div>
  ));
}

// Mockup 08, backed by the importer (R09, R42, TR07): upload a module bundle,
// read the validation report, publish the draft (Design §7.6).
export default function ContentImportPage() {
  const { t, tServer } = useI18n();
  useBodyClass('app');
  useDocumentTitle(t('titles.contentImport'));
  const { token } = useTeacherAuth();

  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // { report, versionId? } of the last upload
  const [result, setResult] = useState(null);
  const [versions, setVersions] = useState([]);

  const loadVersions = useCallback(async () => {
    try {
      const data = await apiRequest('/content/versions', { token });
      setVersions(data.versions);
    } catch (err) {
      setError(err.message);
    }
  }, [token]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  function reset() {
    setFile(null);
    setResult(null);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  }

  function pickFile(picked) {
    if (!picked) return;
    reset();
    setNotice('');
    setFile(picked);
  }

  async function handleUpload() {
    if (!file) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = new FormData();
      body.append('bundle', file);
      const data = await apiRequest('/content/import', { method: 'POST', body, token });
      setResult({ report: data.report, versionId: data.versionId });
      await loadVersions();
    } catch (err) {
      if (err.data?.report) setResult({ report: err.data.report });
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handlePublish(versionId) {
    setError('');
    try {
      await apiRequest(`/content/${versionId}/publish`, { method: 'POST', token });
      setNotice(t('import.publishedOk'));
      if (result?.versionId === versionId) reset();
      await loadVersions();
    } catch (err) {
      setError(err.message);
    }
  }

  const report = result?.report;
  const publishedCount = versions.filter((v) => v.status === 'published').length;
  const statusPill = { draft: 'pill-sun', published: 'pill-mint', archived: 'pill-sky' };

  return (
    <>
      <style>{`
        .dropzone {
          border: 2.5px dashed var(--line); border-radius:20px; padding:36px; text-align:center; background:#fff;
          margin-bottom:22px; display:block; cursor:pointer;
        }
        .dropzone.dragging { border-color: var(--sky); background: rgba(76,201,240,.06); }
        .report-row { display:flex; align-items:flex-start; gap:12px; padding:10px 4px; border-top:1px solid var(--line); font-size:14px; overflow-wrap:anywhere; }
        .report-row:first-child { border-top:none; }
        .report-section { font-weight:700; margin:16px 0 4px; }
        .ok { color: var(--mint-ink); }
        .warn { color: var(--sun-ink); }
        .err { color: var(--coral-ink); }
        .import-foot { display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap; margin-bottom:28px; }
        .report-where { color: var(--ink-faint); font-size:12.5px; }
      `}</style>

      <TeacherLayout
        active="contentImport"
        title={t('import.title')}
        showAvatar={false}
        actions={
          <span className="pill pill-sky">
            {t('import.publishedModules', { count: publishedCount })}
          </span>
        }
      >
        {error && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            {tServer(error)}
          </div>
        )}
        {notice && (
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            {notice}
          </div>
        )}

        <label
          className={`dropzone${dragging ? ' dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pickFile(e.dataTransfer.files[0]);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".zip"
            hidden
            onChange={(e) => pickFile(e.target.files[0])}
          />
          <div style={{ fontSize: 40 }}>📦</div>
          <div className="h3" style={{ margin: '10px 0 6px' }}>
            {t('import.dropTitle')}
          </div>
          <div className="muted">
            {t('import.or')} <b style={{ color: 'var(--ink)' }}>{t('import.browse')}</b> —{' '}
            {t('import.dropHint')}
          </div>
          {file && (
            <div className="pill pill-sky" style={{ marginTop: 14 }}>
              📎 {file.name}
            </div>
          )}
        </label>

        {file && !report && (
          <div className="import-foot">
            <span />
            <div style={{ display: 'flex', gap: 12 }}>
              <button className="btn btn-md btn-ghost" type="button" onClick={reset}>
                {t('import.discard')}
              </button>
              <button
                className="btn btn-md btn-coral"
                type="button"
                disabled={busy}
                onClick={handleUpload}
              >
                {busy ? t('import.uploading') : t('import.upload')}
              </button>
            </div>
          </div>
        )}

        {report && (
          <>
            <div className="h3" style={{ marginBottom: 12 }}>
              {report.module
                ? t('import.reportTitle', {
                    week: report.module.week,
                    area: t(`areas.${report.module.area}`),
                  })
                : file?.name}
            </div>
            <div className="card" style={{ marginBottom: 20 }}>
              <div className={`report-row ${result.versionId ? 'ok' : 'err'}`}>
                {result.versionId ? '✅' : '⛔'}{' '}
                {t(result.versionId ? 'import.draftReady' : 'import.rejected')}
              </div>
              {report.counts && (
                <>
                  <div className="report-row ok">
                    📄{' '}
                    {t('import.statTasks', {
                      tasks: report.counts.tasks,
                      trials: report.counts.trials,
                    })}
                  </div>
                  <div className="report-row ok">
                    🖼️ {t('import.statMedia', { count: report.counts.mediaReferenced })}
                  </div>
                </>
              )}

              {report.errors.length > 0 && (
                <div className="report-section err">
                  {t('import.errors', { count: report.errors.length })}
                </div>
              )}
              <ReportList
                items={report.errors}
                className="err"
                icon="⛔"
                render={(e) => (
                  <>
                    {e.message} <span className="report-where">{where(e)}</span>
                  </>
                )}
              />

              {report.corrections.length > 0 && (
                <div className="report-section warn">
                  {t('import.corrections', { count: report.corrections.length })}
                </div>
              )}
              <ReportList
                items={report.corrections}
                className="warn"
                icon="✏️"
                render={(c) => (
                  <>
                    {c.from} → {c.to} ({c.reason}){' '}
                    <span className="report-where">
                      {c.file} ×{c.count}
                    </span>
                  </>
                )}
              />

              {report.warnings.length > 0 && (
                <div className="report-section warn">
                  {t('import.warnings', { count: report.warnings.length })}
                </div>
              )}
              <ReportList
                items={report.warnings}
                className="warn"
                icon="⚠️"
                render={(w) => (
                  <>
                    {w.message} <span className="report-where">{where(w)}</span>
                  </>
                )}
              />
            </div>

            <div className="import-foot">
              <span />
              <div style={{ display: 'flex', gap: 12 }}>
                <button className="btn btn-md btn-ghost" type="button" onClick={reset}>
                  {t('import.discard')}
                </button>
                {result.versionId && (
                  <button
                    className="btn btn-md btn-coral"
                    type="button"
                    onClick={() => handlePublish(result.versionId)}
                  >
                    {t('import.publish')}
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        <div className="h3" style={{ marginBottom: 12 }}>
          {t('import.versionsTitle')}
        </div>
        <div className="card table-scroll" style={{ padding: 0 }}>
          <table className="data">
            <tbody>
              <tr>
                <th>{t('import.columns.module')}</th>
                <th>{t('import.columns.status')}</th>
                <th>{t('import.columns.content')}</th>
                <th>{t('import.columns.imported')}</th>
                <th></th>
              </tr>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td>{t('import.moduleLabel', { week: v.week, area: t(`areas.${v.area}`) })}</td>
                  <td>
                    <span className={`pill ${statusPill[v.status]}`}>
                      {t(`import.status.${v.status}`)}
                    </span>
                  </td>
                  <td>
                    {t('import.trialsShort', { tasks: v.counts.tasks, trials: v.counts.trials })}
                  </td>
                  <td>
                    {new Date(v.importedAt).toLocaleDateString()}
                    {v.importedBy ? ` · ${v.importedBy}` : ''}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {v.status === 'draft' && (
                      <button className="btn btn-ghost btn-sm" onClick={() => handlePublish(v.id)}>
                        {t('import.publish')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {versions.length === 0 && <div className="empty-state">{t('import.noVersions')}</div>}
        </div>
      </TeacherLayout>
    </>
  );
}
