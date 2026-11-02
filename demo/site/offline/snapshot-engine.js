(() => {
  const types = [['海报',/海报/],['文创',/文创/],['包装',/包装/],['品牌/VI',/品牌|\bvi\b/i],['IP/吉祥物',/\bip\b|形象|吉祥物|角色/i],['动态',/动态|视频|短片|动画/],['插画',/插画/],['字体',/字体/],['标志',/标志|logo/i]];
  const clean = value => String(value || '').normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const names = ['庆元','木拱桥','廊桥','喜乐灵山','抱团圆','大白兔','新桥猫','朵娜贝拉','华灿','可力星','屈臣氏','KTK','非遗工坊','文明出行','文明风尚','后西游记','重生纪元','恐龙AI','IDC','有福之州'];
  let data;
  const deadline = t => t.facts.deadlines[0];
  const fees = t => t.facts.fees[0].status;
  const expired = t => {
    const d = deadline(t);
    if (d.status !== 'known' || !d.date) return false;
    if (d.date < data.today) return true;
    const f = t.fullTask.taskContext?.facts?.submissionDeadline || {};
    return f.timeZone === 'Asia/Shanghai' && f.time && Date.parse(`${d.date}T${f.time}:00+08:00`) < Date.parse(data.asOf);
  };
  const order = (a,b) => {
    const left = deadline(a), right = deadline(b);
    const x = left.status === 'known' ? left.date : '9999', y = right.status === 'known' ? right.date : '9999';
    return x.localeCompare(y) || a.event.localeCompare(b.event,'zh-CN') || a.title.localeCompare(b.title,'zh-CN') || a.id.localeCompare(b.id);
  };
  const pageSize = 20;
  const unique = values => [...new Set(values)];
  const typeUnknown = t => !t.facts.submissionForms.length || t.facts.submissionForms.every(f => ['其他','综合视觉'].includes(f));
  function criteria(question, base = {}) {
    const q = clean(question), next = { types: [], fee: 'any', allowUnknown: false, archive: false, eventIds: [], ...base };
    const wants = types.filter(([,pattern]) => pattern.test(question)).map(([type]) => type);
    const aliases = names.filter(name => q.includes(clean(name)));
    const events = data.competitions.filter(c => question.includes(c.id) || q.includes(clean(c.title)));
    const named = unique([...events.map(c=>c.id), ...data.tasks.filter(t=>aliases.some(name=>clean(t.event+' '+t.title+' '+t.fullTask.themeTask).includes(clean(name)))).map(t=>t.competitionId)]);
    if (wants.length) next.types = wants;
    if (/不限(类型|作品)|类型不限/.test(question)) next.types = [];
    if (named.length) next.eventIds = named;
    // A single theme (e.g. 文明出行) can identify an exact task inside an event.
    if (aliases.length) next.names = aliases;
    if (/费用不限|不限费用|不考虑费用|费用都可以/.test(question)) next.fee = 'any';
    else if (/只.*(收费|付费)|收费的|付费的/.test(question)) next.fee = 'paid';
    else if (/免费|不收费|没有明确收费/.test(question)) next.fee = 'free';
    if (/未知.*保留|未知.*说明|未确认.*保留|不明确|没有明确收费/.test(question)) next.allowUnknown = true;
    if (/排除未知|不要未知|只要明确|仅.*确认/.test(question)) next.allowUnknown = false;
    if (/已截止|已经截止|历史竞赛|所有竞赛|全部资料/.test(question)) next.archive = true;
    if (/未截止|没截止|还来得及/.test(question)) next.archive = false;
    const until = question.match(/(?:截止|到|之前|不晚于)[^\d]{0,5}(20\d{2}-\d{2}-\d{2})/);
    if (until) next.until = until[1];
    return next;
  }
  function selectBy(c, includeExpired = false) {
    return data.tasks.filter(t => {
      if (!includeExpired && !c.archive && expired(t)) return false;
      if (c.eventIds.length && !c.eventIds.includes(t.competitionId)) return false;
      if (c.names?.length && !c.names.some(name => clean(t.event+' '+t.title+' '+t.fullTask.themeTask).includes(clean(name)))) return false;
      if (c.types.length && !t.facts.submissionForms.some(type=>c.types.includes(type)) && !(c.allowUnknown && typeUnknown(t))) return false;
      if (c.fee !== 'any' && fees(t) !== c.fee && !(c.allowUnknown && fees(t) === 'unknown')) return false;
      if (c.until && deadline(t).status === 'known' && deadline(t).date > c.until) return false;
      return true;
    }).sort(order);
  }
  const select = question => selectBy(criteria(question));
  function context(question, previous) {
    const prev = previous?._snapshotQuery || (previous?.question ? { question: previous.question, offset: 0 } : undefined);
    const more = /^(?:更多|下一批|再来.*批|继续.*(?:看|找)|还有.*(?:候选|竞赛))/.test(question.trim());
    const fresh = /^(?:我想|帮我找|推荐|找一些|找几)/.test(question.trim());
    const old = prev && (prev.criteria || criteria(prev.question));
    const newNames = criteria(question).eventIds.length > 0;
    const next = criteria(question, old && !fresh && !newNames ? old : {});
    const changes = types.some(([,p])=>p.test(question)) || /免费|付费的|收费的|费用不限|未知.*保留|排除未知|20\d{2}-\d{2}-\d{2}/.test(question);
    return { question: fresh || !prev ? question : prev.question, criteria: next,
      offset: more && prev ? (prev.offset || 0) + pageSize : changes || newNames || fresh ? 0 : prev?.offset || 0,
      previousTaskIds: old && !fresh && !changes && !newNames ? prev.taskIds : undefined,
      more };
  }
  function feeText(t) {
    const status = fees(t), label = status === 'free' ? '免费' : status === 'paid' ? '收费' : '费用待确认';
    const details = (t.fullTask.taskContext?.rules || []).map(r=>typeof r.content==='string'?r.content:JSON.stringify(r.content)).filter(s=>/报名费|参赛费|评审费|收费|退费|元\/|元／|元[，。/]/.test(s));
    return label + (details.length ? '\n'+details.join('\n') : '');
  }
  function query(question, previous) {
    const ctx = context(question, previous);
    const discovery = /找|挑|推荐|有哪些|筛选|想做/.test(question);
    const evidence = /依据|来源|出处|原文/.test(question) && !discovery;
    const details = /要交|交什么|提交要求|完整任务|具体要求|任务详情|展开/.test(question) && !discovery;
    const fact = !/比较|对比/.test(question) && (evidence || details || !discovery && /什么时候|哪天|多少钱|费用|报名费|分几档|系列.*算|退费|退款|审核|截止.*(?:是|什么|时间|日期)/.test(question));
    let selected = selectBy(ctx.criteria, fact && ctx.criteria.eventIds.length > 0);
    const eventIds = [...new Set(selected.map(t=>t.competitionId))];
    const visible = new Set(eventIds.slice(ctx.offset,ctx.offset+pageSize));
    let items = selected.filter(t=>visible.has(t.competitionId));
    if (ctx.previousTaskIds?.length && !ctx.more) items = selected.filter(t=>ctx.previousTaskIds.includes(t.id));
    const numeral = value => Number(value) || ({一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10}[value]);
    const first = question.match(/前\s*([一二两三四五六七八九十\d]+)\s*场/);
    const nth = question.match(/第\s*([一二三四五六七八九十\d]+)\s*(场|个|项|条|方向)/);
    if (first) { const ids = unique(items.map(t=>t.competitionId)).slice(0,numeral(first[1])); items=items.filter(t=>ids.includes(t.competitionId)); }
    if (nth) items = nth[2] === '场' ? items.filter(t=>t.competitionId===unique(items.map(t=>t.competitionId))[numeral(nth[1])-1]) : items.slice(numeral(nth[1])-1,numeral(nth[1]));
    ctx.taskIds=items.map(t=>t.id);delete ctx.previousTaskIds;delete ctx.more;
    let answer;
    if (/^(今天|现在)(是|几号|什么日期)/.test(question.trim())) return { items: [], answer:`今天是 ${data.today}（北京时间）。`, context: ctx };
    if (fact) {
      const groups = unique(items.map(t=>t.competitionId)).map(id=>items.filter(t=>t.competitionId===id));
      answer = groups.map(group=>{
        const t = group[0], prefix = `**${t.event}**\n\n`;
        if (evidence) {
          const refs = group.flatMap(t=>t.evidence).filter((e,i,all)=>all.findIndex(other=>other.quote===e.quote&&other.url===e.url)===i);
          const relevant = refs.filter(e=>/费用|报名费|收费|退费|元/.test(previous?.question||'') ? /费用|报名费|参赛费|收费|退费|元/.test(e.quote) : /截止|哪天/.test(previous?.question||'') ? /截止|日期|投稿时间/.test(e.quote) : true);
          return prefix + (relevant.length ? relevant.slice(0,3).map(e=>`> ${e.quote}\n\n[查看来源](${e.url})`).join('\n\n') : `当前资料没有可定位的原句。[查看原公告](${t.fullTask.sourceUrl})`);
        }
        if (details) return prefix + group.map(t=>`**${t.title}**\n\n${t.fullTask.finalSubmissionFormat || '完整提交要求待整理。'}`).join('\n\n');
        const lines=[];
        if (/费用|多少钱|报名费|分几档|系列|退费|退款|审核/.test(question)) lines.push(unique(group.map(feeText)).join('\n\n'));
        if (/截止|什么时候|哪天/.test(question)) lines.push('截止：'+unique(group.map(t=>deadline(t).status==='known'?deadline(t).date:'待确认')).join('；')+'。');
        return prefix+lines.join('\n\n');
      }).join('\n\n');
      if (!answer) answer = '当前条件下没有可确认的任务。请给出竞赛名称，或调整费用与作品类型。';
      return { items:[], answer, context:ctx };
    }
    const hasMore = eventIds.length>ctx.offset+pageSize && !first && !nth;
    answer=items.length?`为你整理了 **${items.length} 项创作任务**，来自 **${unique(items.map(t=>t.competitionId)).length} 场竞赛**。`:'当前条件下没有符合要求的已存任务，可以调整作品类型、费用或截止时间。';
    if (items.length && !first && !nth && eventIds.length>pageSize) answer+=`\n\n当前条件下共 ${eventIds.length} 场、${selected.length} 项任务；本批展示第 ${ctx.offset+1}—${Math.min(ctx.offset+pageSize,eventIds.length)} 场。${hasMore?'可以继续问“下一批，条件不变”。':''}`;
    const unknown=items.filter(t=>ctx.criteria.types.length&&typeUnknown(t));
    if (unknown.length) answer+=`\n\n其中 ${unknown.length} 项作品类型待确认，按“未知保留”列出，不计作已确认匹配。`;
    if (/比较|对比|匹配理由/.test(question) && items.length) answer+='\n\n'+unique(items.map(t=>t.competitionId)).slice(0,3).map(id=>{
      const group=items.filter(t=>t.competitionId===id), t=group[0];
      const matching=unique(group.flatMap(t=>t.facts.submissionForms)).filter(f=>ctx.criteria.types.includes(f));
      return `**${t.event}**\n\n${unique(group.map(feeText)).join('\n\n')}\n\n截止：${deadline(t).status==='known'?deadline(t).date:'待确认'}。${matching.length?'匹配作品类型：'+matching.join('、')+'。':'作品类型尚待确认。'}可选任务：${group.map(t=>t.title).slice(0,4).join('；')}。`;
    }).join('\n\n');
    if (/国潮/.test(question) && items.length) answer+='\n\n已按海报类型筛选；“国潮”是创作偏好，公告未明确的风格不作为已确认匹配。';
    return { items, answer, context:ctx, hasMore };
  }
  function artifacts(items) {
    const groups=new Map();
    for(const t of items) { if(!groups.has(t.competitionId))groups.set(t.competitionId,[]);groups.get(t.competitionId).push(t); }
    return [...groups].map(([id,group])=>({id:'snapshot-'+id,kind:'competition_candidate',title:group[0].event,
      data:{competitionId:id,preview:{status:'ready',competitionLink:group[0].competitionLink,
        tasks:group.map(t=>({...t.preview,scopePointer:t.scopePointer,...(t.choiceId?{choiceId:t.choiceId}:{}),facts:t.facts}))}}}));
  }
  function reply(t,input) {
    if(/要交|提交|要求|交付/.test(input)) return t.fullTask.finalSubmissionFormat || '这项任务的完整提交要求尚待整理。';
    if(/来源|依据/.test(input)) return t.evidence.slice(0,3).map(e=>`> ${e.quote}\n\n[查看来源](${e.url})`).join('\n\n');
    if(t.preparedReply) return t.preparedReply;
    if(t.creativeReply) return t.creativeReply;
    const deliverables=(t.preview.deliverables||[]).map(d=>d.name).slice(0,3);
    return `围绕「${t.title}」，先把这份任务拆成三个工作方向：\n\n`+
      `1. **主题与表达**\n以已存主题「${t.fullTask.themeTask||t.title}」确定一个具体的使用场景，先比较核心形象、色彩和结构的两种表达。\n\n`+
      `2. **关键成果**\n先制作${deliverables[0]||'核心视觉'}，再用${deliverables.slice(1).join('、')||'其他要求中的应用'}检验同一设计语言能否延展。\n\n`+
      `3. **交付检查**\n按任务窗口中的原始要求核对文件、规格和配套。先完成草图和结构验证，再整理最终展示。`;
  }
  globalThis.SnapshotEngine={initialize:value=>{data=value;},select,query,artifacts,reply,expired,feeText,order};
})();
