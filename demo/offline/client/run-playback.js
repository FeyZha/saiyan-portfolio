// A clock-based presentation of already stored results. The saved final data is
// immutable; reconnecting only reads the elapsed presentation, never starts work.
(() => {
  const waitMs = 500, cardMs = 260;
  const textTime = run => Math.min(1800, Math.max(800, Array.from(run.answer).length * 32));
  const cardCount = run => Math.min(6, run.artifacts.reduce((sum, artifact) => sum + (artifact.data?.preview?.tasks?.length || 0), 0));
  const duration = run => waitMs + textTime(run) + cardCount(run) * cardMs + 300;
  function start(run, now = Date.now()) {
    run._playback = { startedAt: now };
    run.updatedAt = new Date(now + duration(run)).toISOString();
    return run;
  }
  function view(run, now = Date.now()) {
    if (!run._playback) return run;
    const elapsed = Math.max(0, now - run._playback.startedAt);
    const result = { ...run };
    delete result._playback;
    const done = elapsed >= duration(run);
    const cards = Math.max(0, Math.floor((elapsed - waitMs - textTime(run)) / cardMs) + 1);
    const characters = Array.from(run.answer);
    const answer = done ? run.answer : characters.slice(0, Math.floor(characters.length * Math.min(1, Math.max(0, elapsed - waitMs) / textTime(run)))).join('');
    const phase = done ? 'completed' : cards > 0 ? 'reviewing' : 'running';
    result.status = done ? 'completed' : 'running';
    result.settled = done;
    result.answer = answer;
    result.updatedAt = new Date(run._playback.startedAt + Math.min(elapsed, duration(run))).toISOString();
    result.artifacts = cards > 0 || done ? run.artifacts : [];
    result.answerReview = { ...run.answerReview };
    if (!done && cards === 0) delete result.answerReview.candidateList;
    result.presentation = { revision: Math.floor(Math.min(elapsed, duration(run)) / 100) + 1,
      draftAnswer: answer, draftKind: 'delivery', phase, visibleItems: done ? undefined : cards,
      activity: done ? undefined : { id: run.runId, agent: 'main', status: 'running', label: cards > 0 ? '整理创作任务' : answer ? '生成回答' : '查阅竞赛资料' } };
    return result;
  }
  function cancel(run, now = Date.now()) {
    const result = view(run, now);
    if (result.settled) return result;
    return { ...result, status: 'cancelled', settled: true,
      presentation: { ...result.presentation, revision: result.presentation.revision + 1, phase: 'cancelled', activity: undefined } };
  }
  globalThis.RunPlayback = { start, view, cancel, duration };
})();
