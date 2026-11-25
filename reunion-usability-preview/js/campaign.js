/* 墜星前哨：兩章有限旅程。Campaign/Run 存於同一權威快照；不接觸舊單局鍵。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StarfallSoloCampaign = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var KEY = 'starfall-solo.campaign.v1';
  var SCHEMA = 1;
  function copy(x) { return JSON.parse(JSON.stringify(x)); }
  function fail(msg, code) { var e = new Error(msg); e.code = code || 'invalid'; throw e; }
  function integer(n, min) { return Number.isInteger(n) && n >= (min || 0); }
  function nonnegative(n) { return typeof n === 'number' && isFinite(n) && n >= 0; }
  function echoNew(branch, prior, start) {
    var wait = branch === 'ridge' ? 0 : branch === 'quiet' ? 35 : 45;
    return {
      schema: 1, branch: branch, prior_result: prior || 'unknown',
      stage: wait ? 'calibrating' : 'choice_one', next_at: wait ? start + wait : null,
      replies: [], decisions: [], outcome: null, confirmed: false
    };
  }
  function echoValidate(e) {
    if (!e || e.schema !== 1 || !['ridge','quiet','noise'].includes(e.branch) ||
      !['win','loss','draw','unknown'].includes(e.prior_result) ||
      !['calibrating','choice_one','waiting_reply','choice_two','awaiting_confirmation','completed'].includes(e.stage) ||
      !Array.isArray(e.decisions) || !Array.isArray(e.replies) || e.decisions.length > 2 || e.replies.length > 1 ||
      typeof e.confirmed !== 'boolean') fail('回聲井資料結構無效。');
    if (e.decisions.length > 0 && !['ECHO-MARK','ECHO-ASSIST'].includes(e.decisions[0])) fail('回聲井第一項選擇無效。');
    if (e.decisions.length > 1 && !['ECHO-OPEN','ECHO-SEAL'].includes(e.decisions[1])) fail('回聲井第二項選擇無效。');
    var shape = {calibrating:[0,0],choice_one:[0,0],waiting_reply:[1,0],choice_two:[1,1],awaiting_confirmation:[2,1],completed:[2,1]};
    if (e.decisions.length !== shape[e.stage][0] || e.replies.length !== shape[e.stage][1]) fail('回聲井階段與選擇紀錄矛盾。');
    if (['calibrating','waiting_reply'].includes(e.stage) ? !nonnegative(e.next_at) : e.next_at !== null) fail('回聲井等候時刻無效。');
    if (e.stage === 'completed') {
      if (!e.confirmed || !['echo_shared','echo_guarded'].includes(e.outcome) ||
        e.outcome !== (e.decisions[1] === 'ECHO-OPEN' ? 'echo_shared' : 'echo_guarded')) fail('回聲井結局與確認紀錄矛盾。');
    } else if (e.confirmed || e.outcome !== null) fail('未完章節不得先有結局。');
    return e;
  }
  function echoArrive(e, now) {
    if (!e || e.next_at === null || now + 1e-7 < e.next_at) return false;
    if (e.stage === 'calibrating') { e.stage = 'choice_one'; e.next_at = null; return true; }
    if (e.stage === 'waiting_reply') { e.stage = 'choice_two'; e.replies.push(1); e.next_at = null; return true; }
    return false;
  }
  function echoChoice(e, id, now, alloy) {
    echoValidate(e);
    var cost = 0;
    if (e.stage === 'choice_one') {
      if (id !== 'ECHO-MARK' && id !== 'ECHO-ASSIST') fail('目前不能使用這項接應方式。');
      cost = id === 'ECHO-ASSIST' ? 2 : 0;
      if (alloy < cost) fail('合金不足，可改用免費標記。', 'no_alloy');
      e.decisions.push(id);
      e.stage = 'waiting_reply'; e.next_at = now + 60;
    } else if (e.stage === 'choice_two') {
      if (id !== 'ECHO-OPEN' && id !== 'ECHO-SEAL') fail('目前不能使用這項收束方式。');
      e.decisions.push(id); e.stage = 'awaiting_confirmation';
    } else fail('目前沒有待選的回聲井訊息。');
    echoValidate(e);
    return cost;
  }
  function echoConfirm(e) {
    echoValidate(e);
    if (e.stage !== 'awaiting_confirmation') fail('請先完成回聲井兩項選擇。');
    e.stage = 'completed'; e.outcome = e.decisions[1] === 'ECHO-OPEN' ? 'echo_shared' : 'echo_guarded'; e.confirmed = true;
    echoValidate(e);
  }
  function branchOf(c) {
    if (!c || !c.chapter1_confirmed) return 'noise';
    if (c.chapter1_resolution !== 'recorded') return 'noise';
    var first = c.comms && c.comms.decisions && c.comms.decisions[0];
    return first === 'COMMS-RIDGE' ? 'ridge' : first === 'COMMS-QUIET' ? 'quiet' : 'noise';
  }
  function runResult(match) {
    if (!match.result) return 'unknown';
    if (match.result.kind === 'draw') return 'draw';
    return match.result.winner_id === 'p_human' ? 'win' : 'loss';
  }
  function newState(match) {
    return {
      chapter: 1, chapter1_confirmed: false, chapter1_resolution: null,
      chapter2_confirmed: false, story: copy(match.story), comms: copy(match.comms), echo: null,
      history_unknown: false, runs: [], settlement_ids: [], run_index: 1, run_id: 'run-0001'
    };
  }
  function attach(match, state) {
    match.campaign_mode = true;
    match.campaign_state = state;
    match.story = copy(state.story); match.comms = copy(state.comms);
    match.campaign_echo = state.echo ? copy(state.echo) : null;
    return match;
  }
  function sync(match) {
    var c = match.campaign_state;
    if (!c) fail('對局沒有旅程狀態。');
    c.story = copy(match.story); c.comms = copy(match.comms);
    c.echo = match.campaign_echo ? copy(match.campaign_echo) : null;
    return c;
  }
  function settle(match) {
    if (!match.campaign_mode || !match.campaign_state || match.phase !== 'finished' || !match.result) return false;
    var c = match.campaign_state, id = c.run_id + ':final';
    if (c.settlement_ids.indexOf(id) >= 0) return false;
    c.settlement_ids.push(id);
    var p=match.players.p_human;
    c.runs.push({id:id, run_id:c.run_id, chapter:c.chapter, result:runResult(match),
      reason:match.result.reason, finished_at:match.result.finished_at,
      base:{rations:p.rations,alloy:p.alloy,supply_built:!!p.supply_built,armory_built:!!p.armory_built,
        recycle_upgraded:!!p.recycle_upgraded,supply_upgraded:!!p.supply_upgraded,
        battle:match.last_battle && match.last_battle.resolution ? copy(match.last_battle.resolution) : null}});
    sync(match);
    return true;
  }
  function confirmCh1(match) {
    var c = match.campaign_state;
    if (!c || c.chapter !== 1 || c.chapter1_confirmed) fail('第一章不在待確認階段。');
    if (match.comms.stage === 'completed') c.chapter1_resolution = 'recorded';
    else if (match.phase === 'finished') c.chapter1_resolution = 'incomplete';
    else fail('通訊尚未完成。可等下次回覆，或在本局結算後保留未完成紀錄。');
    c.chapter1_confirmed = true;
    sync(match);
    return {resolution:c.chapter1_resolution};
  }
  function confirmCh2(match) {
    var c = match.campaign_state;
    if (!c || c.chapter !== 2 || c.chapter2_confirmed || !match.campaign_echo) fail('第二章不可確認。');
    echoConfirm(match.campaign_echo);
    c.chapter2_confirmed = true; sync(match);
    return {ending:match.campaign_echo.outcome};
  }
  function freshRun(oldMatch, clock, Engine) {
    var old = oldMatch.campaign_state;
    if (!old || oldMatch.phase !== 'finished') fail('只可在基地Run結束後續局。');
    if (old.chapter === 2 && old.chapter2_confirmed) fail('目前故事內容到第二章為止。');
    var c = copy(sync(oldMatch));
    var newMatch = Engine.createSoloMatch(clock, clock.now());
    c.run_index += 1;
    c.run_id = 'run-' + String(c.run_index).padStart(4, '0');
    var nextChapter = c.chapter === 1 && c.chapter1_confirmed ? 2 : c.chapter;
    if (nextChapter === 2 && c.chapter === 1) {
      c.chapter = 2;
      var prior = c.runs.length ? c.runs[c.runs.length-1].result : 'unknown';
      c.echo = echoNew(branchOf(c), prior, clock.now());
    } else if (c.chapter === 2 && c.echo && c.echo.next_at !== null) {
      c.echo.next_at = clock.now() + Math.max(0, c.echo.next_at - oldMatch.result.finished_at);
    }
    if (c.chapter === 1 && c.comms.next_at !== null) {
      c.comms.next_at = clock.now() + Math.max(0, c.comms.next_at - oldMatch.result.finished_at);
    }
    return attach(newMatch, c);
  }
  function validateCampaign(c, run) {
    if (!c || typeof c !== 'object' || ![1,2].includes(c.chapter) ||
      typeof c.chapter1_confirmed !== 'boolean' || typeof c.chapter2_confirmed !== 'boolean' ||
      typeof c.history_unknown !== 'boolean' || !integer(c.run_index,1) ||
      c.run_id !== 'run-' + String(c.run_index).padStart(4,'0') ||
      !Array.isArray(c.runs) || !Array.isArray(c.settlement_ids) ||
      !c.story || !c.comms) fail('旅程必要欄位或版本無效。');
    if (c.chapter1_confirmed) {
      if (!['recorded','incomplete'].includes(c.chapter1_resolution)) fail('第一章收尾標記無效。');
      if (c.chapter1_resolution === 'recorded' && c.comms.stage !== 'completed') fail('已確認通訊沒有完整回覆。');
      if (c.chapter1_resolution === 'incomplete' && c.comms.stage === 'completed') fail('完整通訊不能冒充未完紀錄。');
    } else if (c.chapter1_resolution !== null || c.chapter !== 1) fail('第二章不可繞過第一章確認。');
    if (c.chapter === 1 && (c.echo !== null || c.chapter2_confirmed)) fail('第一章不應有回聲井進度。');
    if (c.chapter === 2) {
      echoValidate(c.echo);
      if (c.chapter2_confirmed !== c.echo.confirmed) fail('第二章確認與結局矛盾。');
    }
    if (c.runs.length !== c.settlement_ids.length || c.runs.length > c.run_index ||
      new Set(c.settlement_ids).size !== c.settlement_ids.length) fail('Run結算紀錄重複或缺失。');
    c.runs.forEach(function (r, i) {
      if (!r || typeof r.id !== 'string' || r.id !== c.settlement_ids[i] || r.id !== r.run_id+':final' ||
        ![1,2].includes(r.chapter) || !['win','loss','draw'].includes(r.result) ||
        !nonnegative(r.finished_at) || typeof r.reason !== 'string' || !r.base ||
        !integer(r.base.rations) || !integer(r.base.alloy) ||
        ['supply_built','armory_built','recycle_upgraded','supply_upgraded'].some(function(k){return typeof r.base[k]!=='boolean';}))
        fail('Run摘要無效。');
    });
    if (run) {
      if (!run.match || run.match.campaign_mode !== true || run.match.mode !== 'solo' ||
        !run.match.players || !run.story || !run.comms || run.match.campaign_echo === undefined) fail('Run與旅程關聯無效。');
      if (JSON.stringify(c.story) !== JSON.stringify(run.story) ||
          JSON.stringify(c.comms) !== JSON.stringify(run.comms) ||
          JSON.stringify(c.echo) !== JSON.stringify(run.match.campaign_echo)) fail('Campaign與Run快照不一致。');
      var settled = c.settlement_ids.includes(c.run_id+':final');
      if ((run.match.phase === 'finished') !== settled) fail('Run階段與唯一結算標記矛盾。');
      if (c.runs.length !== c.run_index - (settled ? 0 : 1)) fail('Run結算數量與局數矛盾。');
      c.runs.forEach(function (r,i) { if (r.run_id !== 'run-'+String(i+1).padStart(4,'0')) fail('結算局次不連續。'); });
      if (settled) {
        var last=c.runs[c.runs.length-1];
        var result=run.match.result;
        if (!result || last.run_id!==c.run_id || last.finished_at!==result.finished_at ||
            last.reason!==result.reason || last.result!==(result.kind==='draw'?'draw':(result.winner_id==='p_human'?'win':'loss')))
          fail('Run結果與不可重複結算紀錄矛盾。');
      }
    }
    return c;
  }
  function build(match, meta) {
    meta = meta || {};
    var c = copy(sync(match));
    var run = match.snapshot({paused: !!meta.manual_paused, ui_route:meta.ui_route || null});
    run.manual_paused = !!meta.manual_paused;
    run.wall_anchor = meta.wall_anchor == null ? null : meta.wall_anchor;
    run.catchup_schema = 2;
    run.ai = meta.ai || null;
    var out = {kind:'starfall-campaign', schema:SCHEMA, revision:meta.revision || 1,
      transaction_id:meta.transaction_id || 'initial', owner:meta.owner || null,
      campaign:c, run:run};
    validateCampaign(c,run);
    return out;
  }
  function validateEnvelope(data, Save, Engine) {
    if (!data || data.kind !== 'starfall-campaign' || data.schema !== SCHEMA || !integer(data.revision,1) ||
      typeof data.transaction_id !== 'string' || !data.transaction_id ||
      !data.run || !data.campaign || !data.owner || typeof data.owner.token !== 'string' ||
      !nonnegative(data.owner.expires)) fail('旅程存檔版本或必需欄位無效。');
    Save.validateSnapshot(data.run);
    validateCampaign(data.campaign,data.run);
    var m = Engine.restoreMatch(data.run, new Engine.FrozenClock(data.run.clock));
    if (!Engine.invariantsOk(m)) fail('旅程人口不變項失效。');
    return data;
  }
  function load(storage, Save, Engine) {
    var raw;
    try { raw = storage.getItem(KEY); } catch(e) { return {ok:false, error:String(e.message || e), raw:null}; }
    if (raw == null || raw === '') return {ok:true, empty:true, raw:raw};
    try { var data=JSON.parse(raw); validateEnvelope(data, Save, Engine); return {ok:true, empty:false, raw:raw, data:data}; }
    catch(e) { return {ok:false, empty:false, raw:raw, error:'旅程存檔損壞或不支援，原始內容已保留：'+(e.message||e)}; }
  }
  function commit(storage, expectedRaw, next, token, now, Save, Engine) {
    try {
      if (typeof token !== 'string' || !token) fail('缺少分頁識別。');
      var current = storage.getItem(KEY);
      if (current !== expectedRaw) fail('另一分頁已更新旅程，停止寫入。請重新載入確認較新進度。','conflict');
      if (current != null) {
        var previous=JSON.parse(current);
        validateEnvelope(previous, Save, Engine);
        if (previous.owner.token !== token && previous.owner.expires > now) fail('旅程正在另一分頁操作，請在原分頁繼續或稍後接管。','locked');
        if (next.revision !== previous.revision + 1) fail('旅程修訂號不連續。','conflict');
      } else if (next.revision !== 1) fail('新旅程修訂號無效。');
      next.owner={token:token,expires:now+20};
      validateEnvelope(next,Save,Engine);
      var encoded=JSON.stringify(next);
      storage.setItem(KEY, encoded);
      if (storage.getItem(KEY)!==encoded) fail('寫入後校驗失敗；可能有另一分頁競爭。','conflict');
      return {ok:true,raw:encoded,data:next};
    } catch(e) { return {ok:false,code:e.code||'save_failed',error:String(e.message||e),raw:expectedRaw}; }
  }
  function restore(data, Engine, clock) {
    var m=Engine.restoreMatch(data.run,clock);
    attach(m,copy(data.campaign));
    return m;
  }
  return {KEY:KEY,SCHEMA:SCHEMA,copy:copy,newState:newState,attach:attach,sync:sync,settle:settle,
    confirmCh1:confirmCh1,confirmCh2:confirmCh2,freshRun:freshRun,
    echoNew:echoNew,echoValidate:echoValidate,echoArrive:echoArrive,echoChoice:echoChoice,echoConfirm:echoConfirm,
    branchOf:branchOf,runResult:runResult,build:build,validateCampaign:validateCampaign,
    validateEnvelope:validateEnvelope,load:load,commit:commit,restore:restore};
});
