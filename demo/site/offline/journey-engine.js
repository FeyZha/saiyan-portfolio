// Prepared visitor story, kept separate from the frozen contest/library facts.
(() => {
  let journey;
  const initialize = value => { journey = value; };
  function installVersions(state) {
    if (state.preparedJourneyVersions?.includes(journey.id)) return;
    state.versions ||= {};
    if (state.projects[journey.project.id] && !state.versions[journey.project.id]) state.versions[journey.project.id] = journey.milestones.map((stage, index) => ({
      time: journey.project.updated - (journey.milestones.length-index)*1000, label: stage.label,
      count: Object.values(stage.snapshot.document.store).filter(record => record.typeName === 'shape').length,
      snapshot: structuredClone(stage.snapshot), role: 'prepared_simulated_journey_milestone',
    }));
    state.preparedJourneyVersions = [...(state.preparedJourneyVersions || []), journey.id];
  }
  function install(state) {
    if (state.preparedJourneys?.includes(journey.id)) { installVersions(state); return false; }
    const project = structuredClone(journey.project);
    // Never replace a visitor's edits, appended conversations, or deletions.
    if (!state.projects[project.id]) state.projects[project.id] = project;
    const fullTask = project.snapshot.document.store['document:document'].meta.competition.fullTask;
    if (!state.handoffs[project.id]) state.handoffs[project.id] = { projectId: project.id, title: fullTask.title,
      goal: project.snapshot.document.store['document:document'].meta.competition.goal, fullTask };
    if (!state.chats[journey.chat.id]) {
      const { messages, ...chat } = structuredClone(journey.chat);
      state.chats[chat.id] = { ...chat, user: 'visitor', project: project.id, provider: 'codex', run_mode: 'auto', archived: false, busy: false };
      state.messages[chat.id] = messages;
    }
    if (!state.sessions[journey.session.id]) {
      const session = structuredClone(journey.session);
      state.sessions[session.id] = session;
      for (const run of session.runs) state.runs[run.runId] = run;
    }
    state.preparedJourneys = [...(state.preparedJourneys || []), journey.id];
    installVersions(state);
    return true;
  }
  const isTask = task => task?.id === journey.taskId;
  function stage(input) {
    if (/定稿|第三版|第3版|v3|路更宽|标题.*(大|改)|字号/i.test(input)) return 3;
    if (/第二版|第2版|v2|背景.*满|简化|精简|删.*(天际线|背景|树)|减少.*(装饰|背景)/i.test(input)) return 2;
    if (/第一版|第1版|v1|初稿|生成.*图|先出图|出一张|画一张/i.test(input)) return 1;
    return null;
  }
  function response(task, input) {
    if (!isTask(task) || /来源|依据|截止|费用|多少钱|什么时候|提交要求|要交什么/.test(input)) return null;
    if (/大段|长说明|整段|像模板|文字太多|说明.*删|删.*说明|画布.*(挤|满)/.test(input)) return { text: '这样更容易看作品。任务要求留在“竞赛任务”里，画布只留三张图和当时的判断。第三版放大一点，旧稿缩在旁边就够了。' };
    if (/放.*一起|摆.*一起|三张.*(看|比)|比较三|对比三|为什么.*(选|保留)|不生图.*(比|看)/.test(input)) return { text: '放在一起看，第一版的城市背景比礼让关系更抢眼；第二版安静下来了，但标题还比较泛。第三版的“让一步，路更宽”更直接。这次我会留第三版，前两版作为对照，不再往画布上堆说明。' };
    if (/投.*还差|还差什么|接下来.*(整理|准备)|最后.*检查/.test(input)) return { text: '视觉方向先停在第三版。后面要做的是按任务要求整理JPG、RGB、A3、300dpi文件，再补约100字设计说明和作者信息。原始PNG和这几版过程继续留着。' };
    const version = stage(input);
    if (version) return { text: ['第一版保留上海街景，原稿已在画布中。可以从背景密度和礼让关系继续讨论。',
      '第二版收掉背景装饰，保留车辆、行人和清楚的安全间距。前一版继续保留，可点击缩略图比较。',
      '第三版是标题与留白调整后的定稿。三个版本都保留在画布，可以点击缩略图分别查看。'][version-1],
      version, asset: journey.assets[version-1].path };
    if (/说明|交付|检查|保留|完成/.test(input)) return { text: journey.review };
    if (/选择|选第|选.*(斑马|第一)|构图|配色|文案/.test(input)) return { text: journey.brief };
    return { text: journey.ideas };
  }
  globalThis.JourneyEngine = { initialize, install, isTask, stage, response };
})();
