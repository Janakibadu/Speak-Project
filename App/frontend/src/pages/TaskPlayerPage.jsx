import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import StudentTopBar from '../components/StudentTopBar.jsx';
import { useStudentAuth } from '../context/StudentAuthContext.jsx';
import useBodyClass from '../hooks/useBodyClass.js';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import { useI18n } from '../i18n/I18nContext.jsx';
import { isAudioUnlocked } from '../player/audio.js';
import { loadedUrl, preload, taskAssetIds } from '../player/media.js';
import StartGate from '../player/StartGate.jsx';
import TaskPlayer from '../player/TaskPlayer.jsx';
import useModule, { pathTasks } from '../player/useModule.js';

// Plays one task of a published module: preload its media, open the audio
// gate, run the TaskPlayer, then go on to the next task on the path.
export default function TaskPlayerPage() {
  const { t, tServer } = useI18n();
  useBodyClass('app-student');
  useDocumentTitle(t('titles.taskPlayer'));

  const { moduleId, taskId } = useParams();
  const navigate = useNavigate();
  const { token } = useStudentAuth();
  const { data, error } = useModule(moduleId, token);

  const tasks = data ? pathTasks(data) : [];
  const position = tasks.findIndex((task) => String(task.id) === taskId);
  const task = tasks[position];
  const next = tasks[position + 1];

  const [load, setLoad] = useState({ done: 0, total: 0, failed: 0, finished: false });
  const [started, setStarted] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!task) return undefined;
    let cancelled = false;
    setStarted(false);
    setLoad({ done: 0, total: 0, failed: 0, finished: false });
    preload(taskAssetIds(task, data.media), token, (done, total) => {
      if (!cancelled) setLoad((s) => ({ ...s, done, total }));
    }).then((failed) => {
      if (cancelled) return;
      setLoad((s) => ({ ...s, failed: failed.length, finished: true }));
      // Audio is already unlocked after the first task: start straight away.
      if (failed.length === 0 && isAudioUnlocked()) setStarted(true);
      // Warm the next task's media while this one is played.
      if (failed.length === 0 && next) preload(taskAssetIds(next, data.media), token);
    });
    return () => {
      cancelled = true;
    };
  }, [task, next, data, token, attempt]);

  const resolve = useCallback(
    (name) => (name && data?.media[name] ? loadedUrl(data.media[name].id) : null),
    [data]
  );

  const backTo = `/module/${moduleId}`;
  if (error) {
    if (error.status === 404) return <Navigate to="/student-home" replace />;
    return (
      <>
        <StudentTopBar title={t('titles.taskPlayer')} progress={0} backTo={backTo} />
        <div className="player-stage">
          <div className="alert alert-error">{tServer(error.message)}</div>
        </div>
      </>
    );
  }
  if (!data) return null;
  if (!task) return <Navigate to={backTo} replace />;

  const title = t('module.taskTag', { n: position + 1, type: task.format });

  if (!started) {
    return (
      <>
        <StudentTopBar title={title} progress={0} backTo={backTo} />
        <StartGate
          done={load.finished ? load.total : load.done}
          total={load.finished ? load.total : Math.max(load.total, 1)}
          failed={load.failed}
          onStart={() => setStarted(true)}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      </>
    );
  }

  return (
    <TaskPlayer
      key={task.id}
      task={task}
      resolve={resolve}
      title={title}
      backTo={backTo}
      onDone={() => navigate(next ? `/play/${moduleId}/${next.id}` : backTo)}
    />
  );
}
