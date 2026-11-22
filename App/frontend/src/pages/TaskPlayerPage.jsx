import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import StudentTopBar from '../components/StudentTopBar.jsx';
import { useStudentAuth } from '../context/StudentAuthContext.jsx';
import useBodyClass from '../hooks/useBodyClass.js';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import { useI18n } from '../i18n/I18nContext.jsx';
import { isAudioUnlocked } from '../player/audio.js';
import { resumeIndex, resumeStates } from '../player/engine.js';
import { loadedUrl, preload, taskAssetIds } from '../player/media.js';
import { createRecorder } from '../player/recorder.js';
import StartGate from '../player/StartGate.jsx';
import TaskPlayer from '../player/TaskPlayer.jsx';
import useModule, { pathTasks } from '../player/useModule.js';

// Plays one task of a module: preload its media and start (or resume) the
// attempt on the server (R35), open the audio gate, run the TaskPlayer while
// every tap is recorded (R33), then complete the attempt and go where the
// server says: the next task, an adaption task (R32), or back to the path.
export default function TaskPlayerPage() {
  const { t, tServer } = useI18n();
  useBodyClass('app-student');
  useDocumentTitle(t('titles.taskPlayer'));

  const { moduleId, taskId } = useParams();
  const navigate = useNavigate();
  const { token } = useStudentAuth();
  const { data, error } = useModule(moduleId, token);

  const backTo = `/module/${moduleId}`;
  const path = data ? pathTasks(data) : [];
  const task = data?.tasks.find((candidate) => String(candidate.id) === taskId);
  const position = path.indexOf(task);
  const likelyNext = path[position + 1];

  const [load, setLoad] = useState({ done: 0, total: 0, failed: 0, finished: false });
  const [attempt, setAttempt] = useState(null); // { id, initialIndex, initialStates }
  const [attemptError, setAttemptError] = useState(null);
  const [started, setStarted] = useState(false);
  const [retry, setRetry] = useState(0);
  const [finishing, setFinishing] = useState(null); // null | 'saving' | error message

  const recorder = useMemo(() => createRecorder(token), [token, task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!task) return undefined;
    let cancelled = false;
    setStarted(false);
    setAttempt(null);
    setAttemptError(null);
    setFinishing(null);
    setLoad({ done: 0, total: 0, failed: 0, finished: false });

    const media = preload(taskAssetIds(task, data.media), token, (done, total) => {
      if (!cancelled) setLoad((s) => ({ ...s, done, total }));
    });
    const begun = apiRequest('/attempts', { method: 'POST', body: { taskId: task.id }, token });

    media.then((failed) => {
      if (!cancelled) setLoad((s) => ({ ...s, failed: failed.length, finished: true }));
    });
    begun
      .then(({ attempt: started, responses }) => {
        if (cancelled) return;
        const states = resumeStates(task.trials, responses, task.attemptsPerTrial);
        setAttempt({
          id: started.id,
          initialIndex: resumeIndex(task.trials, states),
          initialStates: states,
        });
      })
      .catch((err) => !cancelled && setAttemptError(err));

    Promise.all([media, begun]).then(
      ([failed]) => {
        if (cancelled || failed.length > 0) return;
        // Audio is already unlocked after the first task: start straight away.
        if (isAudioUnlocked()) setStarted(true);
        // Warm the next task's media while this one is played.
        if (likelyNext) preload(taskAssetIds(likelyNext, data.media), token);
      },
      () => {}
    );

    return () => {
      cancelled = true;
    };
  }, [task, likelyNext, data, token, retry]);

  const resolve = useCallback(
    (name) => (name && data?.media[name] ? loadedUrl(data.media[name].id) : null),
    [data]
  );

  const onAnswer = useCallback(
    (trialId, optionId) => recorder.record({ attemptId: attempt.id, trialId, optionId }),
    [recorder, attempt]
  );

  async function finish() {
    setFinishing('saving');
    try {
      await recorder.flush();
      const result = await apiRequest(`/attempts/${attempt.id}/complete`, {
        method: 'PATCH',
        token,
      });
      navigate(result.next ? `/play/${moduleId}/${result.next}` : backTo);
    } catch (err) {
      setFinishing(err.message || 'Request failed.');
    }
  }

  const failure = error || attemptError;
  if (failure) {
    if (failure.status === 404) return <Navigate to={error ? '/student-home' : backTo} replace />;
    return (
      <>
        <StudentTopBar title={t('titles.taskPlayer')} progress={0} backTo={backTo} />
        <div className="player-stage">
          <div className="alert alert-error">{tServer(failure.message)}</div>
        </div>
      </>
    );
  }
  if (!data) return null;
  if (!task) return <Navigate to={backTo} replace />;

  const title = task.isAdaption
    ? t(`player.formats.${task.format}`)
    : t('module.taskTag', { n: position + 1, type: task.format });

  if (finishing && finishing !== 'saving') {
    return (
      <>
        <StudentTopBar title={title} progress={100} backTo={backTo} />
        <div className="player-stage">
          <div className="player-card" style={{ textAlign: 'center' }}>
            <div className="alert alert-error">{t('player.saveFailed')}</div>
            <button className="btn btn-lg btn-coral" type="button" onClick={finish}>
              {t('player.retry')}
            </button>
          </div>
        </div>
      </>
    );
  }

  if (!started || !attempt) {
    const ready = load.finished && attempt;
    return (
      <>
        <StudentTopBar title={title} progress={0} backTo={backTo} />
        <StartGate
          done={ready ? load.total : load.done}
          total={ready ? load.total : Math.max(load.total, load.done + 1)}
          failed={load.failed}
          onStart={() => setStarted(true)}
          onRetry={() => setRetry((n) => n + 1)}
        />
      </>
    );
  }

  return (
    <TaskPlayer
      key={`${task.id}:${attempt.id}`}
      task={task}
      resolve={resolve}
      title={title}
      backTo={backTo}
      initialIndex={attempt.initialIndex}
      initialStates={attempt.initialStates}
      onAnswer={onAnswer}
      onDone={finishing ? () => {} : finish}
    />
  );
}
