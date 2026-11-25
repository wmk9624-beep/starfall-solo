(() => {
  const Engine = window.StarfallSoloEngine;
  const Save = window.StarfallSoloSave;
  const AI = window.StarfallSoloAI;
  const Catchup = window.StarfallSoloCatchup;
  const UiSync = window.StarfallSoloUiSync || {
    prepareRestartConfirm: function (clock) {
      const wasRunning = !!(clock && clock.paused === false);
      const timeBefore = clock && clock.now ? clock.now() : null;
      if (wasRunning) clock.pause();
      return { wasRunning: wasRunning, timeBefore: timeBefore };
    },
    settleRestartConfirm: function (clock, prep, confirmed) {
      if (confirmed) return { startNew: true, resumed: false };
      if (prep && prep.wasRunning && clock && clock.resume) {
        clock.resume();
        return { startNew: false, resumed: true };
      }
      return { startNew: false, resumed: false };
    },
    presentationAfterAdvance: function (phase, hasSheet) {
      if (phase === "finished") return { closeSheet: true, pause: true, forceRender: true, refreshGame: false, persist: "finished" };
      if (hasSheet) return { closeSheet: false, pause: false, forceRender: false, refreshGame: false, persist: "tick" };
      return { closeSheet: false, pause: false, forceRender: false, refreshGame: true, persist: "tick" };
    },
    runRestartConfirm: function (clock, confirmFn) {
      const prep = this.prepareRestartConfirm(clock);
      const ok = typeof confirmFn === "function" ? !!confirmFn() : false;
      return this.settleRestartConfirm(clock, prep, ok);
    },
    shouldRefreshGameView: function (pres, flags) {
      flags = flags || {};
      if (pres && pres.forceRender) return "force";
      if (pres && pres.refreshGame && !flags.pointerDown && !flags.busy) return "refresh";
      if (flags.hasSheet) return "sheet";
      return "skip";
    }
  };
  const StoryUi = window.StarfallSoloStoryUi;
  const Campaign = window.StarfallSoloCampaign;
  const C = Engine.CONST;
  const TICK_MS = 250;

  const app = document.getElementById("app");
  const sheetRoot = document.getElementById("sheet-root");
  const store = {
    screen: "menu", // menu | game
    mode: "legacy", // legacy | campaign
    campaignRaw: null,
    campaignRevision: 0,
    campaignConflict: false,
    match: null,
    ai: null,
    clock: null,
    error: "",
    sheet: null,
    busy: false,
    saveStatus: "",
    loadError: "",
    pausedNotice: false,
    manualPaused: false,
    confirming: false,
    lastWallAnchor: null,
    detached: false,
    pointerDown: false,
    route: null,
    pageSig: "",
    hudSig: "",
    chromeStruct: "",
    navSig: "",
    hudCtrlSig: "",
    alertSig: "",
    pageCtrlSig: "",
    shellMounted: false,
    storySelectedHero: null,
    routeScrollPositions: new Map(),
    pendingScrollRestore: null,
  };
  let sheetMounted = false;
  let eventsBound = false;
  let cmdSeq = 0;
  function campaignToken() {
    if (!Campaign) return null;
    try {
      let token = sessionStorage.getItem('starfall-campaign-tab-id');
      if (!token) { token = cmdId(); sessionStorage.setItem('starfall-campaign-tab-id',token); }
      return token;
    } catch(e) { return 'tab-' + Math.random().toString(36).slice(2); }
  }
  let activeCampaignToken = null;
  function campaignOwner() { if (!activeCampaignToken) activeCampaignToken = campaignToken(); return activeCampaignToken; }


  function cmdId() {
    cmdSeq += 1;
    if (crypto && crypto.randomUUID) return "p-" + crypto.randomUUID();
    return "p-" + Date.now().toString(36) + "-" + cmdSeq;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
  }

  function showError(message) {
    store.error = message || "操作失敗。";
  }

  function clearError() {
    store.error = "";
  }

  function errorBlock() {
    return store.error ? `<p class="err" id="app-err" role="alert">${escapeHtml(store.error)}</p>` : "";
  }

  function wallNow() {
    return (Catchup && Catchup.defaultWall) ? Catchup.defaultWall() : (Date.now() / 1000);
  }

  function persist(reason, opts) {
    if (!store.match || !store.clock) return { ok: false, error: "沒有可保存的對局。" };
    try {
      const manual = !!store.manualPaused;
      if (store.mode === 'campaign') {
        if (!Campaign) throw new Error('缺少旅程規則模組。');
        if (store.campaignConflict) throw new Error('另一分頁已更新旅程，請重新載入較新進度；本分頁不再寫入。');
        const anchor = Catchup.nextWallAnchor(store.lastWallAnchor, wallNow(), {
          manualPaused:manual, confirming:!!store.confirming, playing:store.match.phase === 'playing',
          alreadyDetached:!!(opts && opts.alreadyDetached)
        });
        const snap = Campaign.build(store.match, {
          manual_paused:manual, wall_anchor:anchor, ui_route:store.route || null,
          ai:store.ai ? store.ai.toJSON() : null,
          revision:store.campaignRevision + 1, transaction_id:cmdId(),
          owner:{token:campaignOwner(),expires:wallNow()+20}
        });
        const written = Campaign.commit(localStorage,store.campaignRaw,snap,campaignOwner(),wallNow(),Save,Engine);
        if (!written.ok) {
          if (written.code === 'conflict' || written.code === 'locked') store.campaignConflict=true;
          throw new Error(written.error);
        }
        store.campaignRaw=written.raw;
        store.campaignRevision=snap.revision;
        store.lastWallAnchor=anchor;
        store.saveStatus='已保存';store.loadError='';
        return {ok:true};
      }
      const snap = store.match.snapshot({ paused: manual, ui_route: store.route || null });
      snap.ai = store.ai ? store.ai.toJSON() : null;
      snap.pause_reason = reason || "";
      snap.manual_paused = manual;
      snap.wall_anchor = Catchup.nextWallAnchor(store.lastWallAnchor, wallNow(), {
        manualPaused: manual,
        confirming: !!store.confirming,
        playing: store.match.phase === "playing",
        alreadyDetached: !!(opts && opts.alreadyDetached)
      });
      snap.catchup_schema = 2;
      Save.save(localStorage, snap);
      store.lastWallAnchor = snap.wall_anchor;
      store.saveStatus = "已保存";
      store.loadError = "";
      return { ok: true };
    } catch (err) {
      const msg = "保存失敗。本次變更尚未寫入存檔，原存檔仍保留。";
      store.saveStatus = "保存失敗";
      showError(err && err.message ? String(err.message) + "。" + msg : msg);
      return { ok: false, error: msg };
    }
  }

  function buildPersistExtra() {
    return { paused: !!store.manualPaused, ui_route: store.route || null };
  }

  function pauseGame(reason) {
    if (!store.clock) return;
    store.manualPaused = true;
    store.clock.pause();
    if (store.match && store.match.phase === "playing") {
      store.pausedNotice = true;
      persist(reason || "manual");
    }
  }

  function resumeGame() {
    if (!store.clock || !store.match) return;
    if (store.match.phase !== "playing") {
      store.pausedNotice = false;
      return;
    }
    store.manualPaused = false;
    store.detached = false;
    store.clock.resume();
    store.pausedNotice = false;
    persist("resume");
  }

  function detachClockKeepRunning() {
    if (!store.clock || !store.match) return;
    if (store.confirming) return;
    const alreadyDetached = !!store.detached;
    if (store.clock.pause) store.clock.pause();
    persist(store.manualPaused ? "detach-paused" : "detach", { alreadyDetached: alreadyDetached });
    if (!store.manualPaused) store.detached = true;
  }

  function applyReturnCatchup(wallAnchor) {
    if (!Catchup || !store.match || !store.clock) return { skipped: true };
    const report = Catchup.applyOfflineCatchup(
      store.match,
      store.ai,
      store.clock,
      {
        manual_paused: store.manualPaused,
        confirming: store.confirming,
        wall_anchor: wallAnchor,
      },
      wallNow()
    );
    if (store.match.phase === "finished") {
      if (store.clock.pause) store.clock.pause();
      store.pausedNotice = false;
      store.detached = false;
      persist("caught-up-finished");
      return report;
    }
    if (store.manualPaused) {
      if (store.clock.pause) store.clock.pause();
      store.pausedNotice = true;
      persist("manual-stay");
      return report;
    }
    store.detached = false;
    store.clock.resume();
    store.pausedNotice = false;
    persist("caught-up");
    return report;
  }

  function onReturnToForeground() {
    if (store.screen !== "game" || !store.match) return;
    if (store.confirming) return;
    if (store.mode==='campaign' && campaignStorageConflict()) {render();return;}
    if (store.manualPaused) {
      store.pausedNotice = store.match.phase === "playing";
      render();
      return;
    }
    let anchor = store.lastWallAnchor;
    const loaded = store.mode==='campaign' ? Campaign.load(localStorage,Save,Engine) : Save.load(localStorage);
    if (anchor == null && loaded.ok && loaded.data) anchor = store.mode==='campaign'?loaded.data.run.wall_anchor:loaded.data.wall_anchor;
    applyReturnCatchup(anchor);
    render();
  }

  function stateNow() {
    if (!store.match) return null;
    return store.match.publicView(C.HUMAN_ID);
  }

  function renderMenu() {
    store.shellMounted = false;
    store.pageSig = "";
    store.hudSig = "";
    store.chromeStruct = "";
    store.navSig = "";
    store.hudCtrlSig = "";
    store.alertSig = "";
    store.pageCtrlSig = "";
    if (app && app.classList) app.classList.remove("is-game");
    unmountSheet();
    const loaded = Save.load(localStorage);
    const canContinue = loaded.ok && !loaded.empty;
    const corrupt = !loaded.ok;
    if (corrupt) store.loadError = loaded.error;
    else if (!store.loadError) store.loadError = "";
    const corruptBox = corrupt
      ? `<div class="corrupt-box" role="alert">${escapeHtml(loaded.error)}${loaded.detail ? "（" + escapeHtml(loaded.detail) + "）" : ""} 你仍然可以先備份或檢查呢個瀏覽器嘅存檔；重新開始要先確認，確認前唔會刪除原存檔。</div>`
      : "";
    app.innerHTML = `
      <header class="brand">
        <div class="mark" aria-hidden="true"><span></span></div>
        <div>
          <h1>墜星前哨</h1>
          <p>六名倖存者，一段來自遠方的求救訊號。</p>
        </div>
      </header>
      <section class="card">
        <span class="eyebrow">A SMALL OUTPOST. A DISTANT SIGNAL.</span>
        <h2 class="lobby-title">守住前哨，決定要相信誰。</h2>
        <p class="lobby-copy">在最長15分鐘的單機對局中，調配船員、建立補給、防守基地。前往地圖追查《無聲的歸航》，在電台回覆失聯探索隊。</p>
        <div class="lobby-features"><span>基地總覽</span><span>分區管理</span><span>探索與抉擇</span></div>
        <p class="save-note">第8分鐘起，合金達40可勝出。閱讀與離開畫面期間，對局仍會繼續；按「暫停」可停止計時。進度保存在目前瀏覽器。</p>
        ${errorBlock()}
        ${corruptBox}
        <button class="btn" id="btn-continue" type="button" ${canContinue ? "" : "disabled"}>繼續存檔</button>
        <button class="btn secondary" id="btn-new" type="button">開始新對局</button>
        ${Campaign ? `<div class="campaign-menu"><h2>持續故事旅程 · 兩章</h2>
          <p class="desc">獨立存檔；原有單局不會被覆蓋。每局仍以口糧20、合金8、6名船員開始，15分鐘只結算基地。</p>
          <button class="btn" id="btn-campaign-continue" type="button">繼續持續旅程</button>
          <button class="btn secondary" id="btn-campaign-new" type="button">開始全新持續旅程</button>
          <button class="btn secondary" id="btn-campaign-import" type="button">從舊存檔複製可核實故事歷史</button>
          <p class="desc">原單局仍可用上方按鈕繼續；舊檔若缺歷史會標示「未記錄」，不假造故事選擇。</p>
        </div>` : ''}
        <div class="outpost-mode-link"><h2>長期基地＋15分鐘外拓 · 獨立模式</h2>
          <p class="desc">從墜星求救開始，長期保留基地與傷亡。此模式使用獨立存檔，不會讀寫上方兩種模式的進度。</p>
          <a class="btn" href="outpost.html" id="link-outpost">進入長期前哨</a>
        </div>
      </section>`;
  }

  function facCard(title, desc, body, extraClass) {
    return `
      <section class="card">
        <div class="fac">
          <div class="mod ${extraClass}" aria-hidden="true"></div>
          <div>
            <h2>${title}</h2>
            <p class="desc">${desc}</p>
            ${body}
          </div>
        </div>
      </section>`;
  }

  function assignFlags(state) {
    return {
      paused: !!(store.manualPaused || (store.clock && store.clock.paused)),
      finished: !!(state && state.phase === "finished")
    };
  }

  function workerBtns(facility, you, state) {
    if (facility === "supply" && (!you || !you.supply_built)) return "";
    if (facility === "duty" && !you) return "";
    const current = facility === "duty" ? (you.duty_workers || 0) : (facility === "recycle" ? you.recycle_workers : you.supply_workers);
    const others = facility === "duty" ? 0 : (facility === "recycle" ? you.supply_workers : you.recycle_workers);
    const ctrl = UiSync.assignControlState({
      current: current,
      standby: you.standby,
      productionOthers: others,
      maxPer: facility === "duty" ? 1 : 2,
      paused: assignFlags(state).paused,
      finished: assignFlags(state).finished,
      built: true
    });
    const reasons = [];
    if (!ctrl.dec.enabled && ctrl.dec.reason) reasons.push(ctrl.dec.reason);
    if (!ctrl.inc.enabled && ctrl.inc.reason) reasons.push(ctrl.inc.reason);
    const hint = reasons.length
      ? reasons.join(" ") + " 調回採集人手可用嚟練兵。"
      : "調回採集人手可用嚟練兵。";
    return `
      <div class="assign-box">
        <p class="assign-status">已派 ${ctrl.current} 人（最多 ${ctrl.maxPer}）　全域待命 ${ctrl.standby} 人</p>
        <div class="row assign-row">
          <button class="btn small" type="button" data-assign="${facility}" data-assign-delta="-1" ${ctrl.dec.enabled ? "" : "disabled"} aria-label="調回 1 人">－調回1人</button>
          <button class="btn small" type="button" data-assign="${facility}" data-assign-delta="1" ${ctrl.inc.enabled ? "" : "disabled"} aria-label="派 1 人">＋派1人</button>
        </div>
        <p class="assign-hint muted">${escapeHtml(hint)}</p>
      </div>`;
  }

  function ensureRoute() {
    store.route = StoryUi ? StoryUi.normalizeRoute(store.route || StoryUi.defaultRoute()) : { tab: "base", page: "base" };
    return store.route;
  }

  function goRoute(action) {
    if (!StoryUi) return;
    const matchRef = store.match;
    const before = ensureRoute();
    const page = document.getElementById("page-root");
    if (page) store.routeScrollPositions.set(StoryUi.routeKey(before), page.scrollTop);
    store.route = StoryUi.navigate(before, action);
    // Only the Back action restores the previous reading position. Entering a new page starts at its top.
    store.pendingScrollRestore = action && action.type === "back"
      ? (store.routeScrollPositions.get(StoryUi.routeKey(store.route)) ?? 0)
      : null;
    // Opening hero details and returning to the same story is a reading detour:
    // keep the step-1 hero selection and its scroll position intact.
    const readingDetour = action && action.type === "open-hero" && before.page === "story";
    const readingReturn = action && action.type === "back" && before.page === "hero" &&
      store.route.page === "story" && store.route.nodeId === before.nodeId;
    if (!readingDetour && !readingReturn &&
        (store.route.page !== "story" || store.route.nodeId !== before.nodeId)) {
      store.storySelectedHero = null;
    }
    store.pageSig = "";
    if (store.match !== matchRef) showError("導航不應重建對局。");
  }

    function chromeFlags(state) {
    return assignFlags(state);
  }

  // Read the authoritative engine roster; no UI population constant.
  function currentPopulation(state) {
    const player = store.match && store.match.players && store.match.players[C.HUMAN_ID];
    if (player && typeof Engine.roster === "function") return Engine.roster(player);
    const you = state && state.you;
    if (!you) return 0;
    // Only a defensive display fallback before a match is attached.
    return (you.standby || 0) + (you.recycle_workers || 0) +
      (you.supply_workers || 0) + (you.duty_workers || 0) +
      (you.patrols || 0) + (you.wards || 0) +
      (you.training || 0) + (you.recalling || 0) +
      (you.exploring ? 1 : 0) + (you.recovering ? 1 : 0);
  }

  function lastBattleSummary(state) {
    const prior = store.match && store.match.last_battle;
    const resolution = (prior && prior.resolution) ||
      (state && state.battle && state.battle.resolved && state.battle.resolution);
    if (!resolution) return "暫無已結算戰鬥。";
    const map = { attack_win: "攻方勝出", defense_win: "守方勝出", draw: "平手" };
    const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
    return `上一場${map[resolution.outcome] || "戰鬥已結束"}。掠奪合金 ${n(resolution.loot_alloy)}、口糧 ${n(resolution.loot_rations)}。攻方傷亡 ${n(resolution.attacker_casualties)}、守方傷亡 ${n(resolution.defender_casualties)}（回待命）。`;
  }

  function hudMarkup(state) {
    const you = state.you;
    const paused = !!(store.manualPaused && state.phase === "playing");
    const status = state.phase === "finished" ? "本局已結束" : (paused ? "已手動暫停" : "對局進行中 · 離頁會補算");
    return `
      <div class="compact-hud">
        <div class="hud-primary">
          <div class="hud-timer"><span class="hud-k">遊戲時間</span><strong id="hud-time">${fmtTime(state.match_time)}</strong></div>
          <span class="hud-live-status" id="hud-status" role="status">${status}</span>
          <div class="hud-pause-control">
            ${paused ? `<button class="btn small" id="btn-resume" type="button">繼續</button>` : `<button class="btn small" id="btn-pause" type="button" ${state.phase === "playing" ? "" : "disabled"}>暫停</button>`}
          </div>
        </div>
        <div class="hud-stats" aria-label="前哨資源及人口">
          <span class="hud-stat">口糧 <strong id="hud-rations">${you.rations}</strong></span>
          <span class="hud-stat">合金 <strong id="hud-alloy">${you.alloy}</strong></span>
          <span class="hud-stat">人口 <strong id="hud-population">${currentPopulation(state)}</strong> <span class="hud-standby-label">（待命 <strong id="hud-standby">${you.standby}</strong>）</span></span>
        </div>
        <details class="hud-more">
          <summary>戰況與選單</summary>
          <div class="hud-more-content">
            <button class="btn small secondary" type="button" data-nav-tab="log">紀錄</button>
            <p>你：${escapeHtml(you.display_name)}　對手：${escapeHtml(state.opponent ? state.opponent.display_name : "自動前哨")}</p>
            <p>巡衛 <strong id="hud-patrols">${you.patrols}</strong>${you.locked_patrols ? "（鎖 " + you.locked_patrols + "）" : ""}　守陣 <strong id="hud-wards">${you.wards || 0}</strong>${you.locked_wards ? "（鎖 " + you.locked_wards + "）" : ""}</p>
            ${state.opponent ? `<p id="opp-line">對方：口糧 ${state.opponent.rations}　合金 ${state.opponent.alloy}　待命 ${state.opponent.standby}　巡衛 ${state.opponent.patrols}${state.opponent.locked_patrols ? "（鎖 " + state.opponent.locked_patrols + "）" : ""}　守陣 ${state.opponent.wards || 0}${state.opponent.locked_wards ? "（鎖 " + state.opponent.locked_wards + "）" : ""}。${state.opponent.protection_remaining > 0 ? "對方受襲保護 " + fmtTime(state.opponent.protection_remaining) : ""}</p>` : ""}
            <details class="battle-history"><summary>上一場戰鬥：掠奪與傷亡</summary><p id="last-battle-summary">${escapeHtml(lastBattleSummary(state))}</p></details>
            <p>第8分鐘後合金40可勝；最長15分鐘。閱讀故事不會暫停，只有手動暫停才停止計時；離頁後返回會補算。</p>
            <div class="hud-secondary-actions">
              <button class="btn small secondary" id="btn-menu" type="button">返回首頁</button>
              ${store.mode === 'campaign' ? '<p>持續旅程不會被普通重新開始覆蓋；請於本局結束後選擇下一局。</p>' : '<button class="btn small secondary" id="btn-new-ingame" type="button">重新開始</button>'}
            </div>
          </div>
        </details>
      </div>`;
  }

    function resultDetailMarkup(state) {
    const story = state.story || {};
    if (!(state.phase === "finished" && state.result)) return "";
    const kind = state.result.kind === "draw" ? "和局" : (state.result.you_won ? "你勝出" : "你敗咗");
    let storyBox = "";
    if (store.mode === 'campaign' && state.campaign) {
      const c=state.campaign;
      const chapterLabel=c.chapter===1?'第一章：碎光小隊':'第二章：回聲井';
      const status=c.chapter===1
        ? (c.chapter1_confirmed ? '第一章已由玩家確認收尾。':'通訊／主線若未完成仍被保留；本局結束不替你選擇。')
        : (c.chapter2_confirmed?'第二章已由玩家確認完成，目前故事內容至此。':'回聲井進度保留，可在下一局繼續。');
      const hero=state.story&&state.story.assigned_hero&&StoryUi.Data.HEROES[state.story.assigned_hero];
      const history=c.runs.map(r=>`${escapeHtml(r.run_id)}：${r.result==='win'?'勝':r.result==='loss'?'敗':'和'}；補給棚${r.base&&r.base.supply_built?'已建':'未建'}，整備艙${r.base&&r.base.armory_built?'已建':'未建'}，深拆${r.base&&r.base.recycle_upgraded?'已升級':'未升級'}，密植${r.base&&r.base.supply_upgraded?'已升級':'未升級'}`).join('；');
      const echo=c.echo;
      return `<section class="card full-final-result" id="full-final-result" tabindex="-1" aria-labelledby="campaign-final-title"><h2 id="campaign-final-title">本局基地結算：${kind}</h2>
        <p>${escapeHtml(state.result.reason||'')}</p>
        ${campaignContinueButtons(state, true)}
        <p><strong>${chapterLabel}</strong>｜${escapeHtml(status)}</p>
        <p>失聯隊：${escapeHtml((state.comms.decisions||[]).join('、')||'未有確認選擇')}；${state.comms.stage==='completed'?'已收到第三段':'未完通訊保留原狀'}。</p>
        <p>英雄：${hero?escapeHtml(hero.name)+'已獲指派':'尚未正式指派'}；故事結局：${story.completed_by_player?'玩家親自決定 '+escapeHtml(story.ending_title||story.ending_id):'未由玩家確認，不代選'}。</p>
        <p>人物關係：${StoryUi.Data.heroList().map(h=>escapeHtml(h.name)+' '+(story.relation&&story.relation[h.relation_key]||0)).join('、')}。</p>
        ${story.completed_by_player?`<section class="story-result"><h3>${escapeHtml(story.ending_title||'玩家故事結局')}</h3>${(story.ending_text||[]).map(t=>`<p>${escapeHtml(t)}</p>`).join('')}</section>`:''}
        ${echo?`<p>回聲井：${escapeHtml(echo.branch)}；${escapeHtml((echo.decisions||[]).join('、')||'尚未選擇')}；${echo.confirmed?'玩家已確認':'仍未完結'}。</p>
          ${echo.confirmed?`<p>${echo.outcome==='echo_shared'?'玩家選擇公開可核對的回聲，但沒有向未來的第三章作出承諾。':'玩家選擇把已核對的紀錄封存於前哨，保留六名倖存者的自主選擇。'}</p>`:''}`:''}
        <p>基地：補給棚${state.you.supply_built?'已建':'未建'}，整備艙${state.you.armory_built?'已建':'未建'}；${state.you.pressure_high?'艙壓過高':'艙壓正常'}。</p>
        <p>歷次基地結果：${history||'尚未結算'}</p>
        <p class="assign-hint">本局勝敗只影響前哨處境，不會覆蓋故事選擇。兩章結束後不提供虛構的第三章。</p></section>`;
    }
    if (story.legacy_finished_unstarted || story.chapter_status === "unavailable") {
      storyBox = `<section class="story-result"><h3>本局故事未啟用</h3>${(story.ending_text || []).map((p) => `<p>${escapeHtml(p)}</p>`).join("")}</section>`;
    } else if (story.forced || story.ending_variant === "forced") {
      storyBox = `<section class="story-result forced"><h3>故事未完成｜系統自動收束</h3>${(story.ending_text || []).map((p) => `<p>${escapeHtml(p)}</p>`).join("")}</section>`;
    } else if (story.ending_id) {
      storyBox = `<section class="story-result"><h3>故事結局：${escapeHtml(story.ending_title || story.ending_id)}</h3>${story.ending_variant && story.ending_variant !== "base" ? `<p>結局版本：${escapeHtml(story.ending_variant)}</p>` : ""}${(story.ending_text || []).map((p) => `<p>${escapeHtml(p)}</p>`).join("")}</section>`;
    } else storyBox = `<p>尚未有故事結局。</p>`;
    const comms = state.comms || {};
    const commsStatus = comms.stage === 'completed'
      ? (comms.outcome === 'located' ? '失聯隊位置已記錄，保留日後聯絡方向。' : '失聯隊於裂谷隱蔽，記錄已保存。') + (comms.variant === 'verified' ? '已驗證回波。' : '採用免費低功率記錄。')
      : comms.stage === 'unavailable' ? '舊存檔：本局未啟用失聯隊通訊。'
      : '通訊未完成，系統強制封存；不是玩家選擇。';
    const you = state.you || {};
    const facilityStatus = `補給棚${you.supply_built?'已建':'未建'}、整備艙${you.armory_built?'已建':'未建'}、深拆${you.recycle_upgraded?'已升級':'未升級'}、密植${you.supply_upgraded?'已升級':'未升級'}；${you.pressure_high?'艙壓過高':'艙壓正常'}。`;
    const heroSummary = StoryUi && StoryUi.Data && state.story && state.story.assigned_hero
      ? (StoryUi.Data.HEROES[state.story.assigned_hero] || {}).name + '的人格建議曾獲正式採用。'
      : '三份人格檔案沒有獲正式指派；仍保留在前哨資料庫。';
    storyBox += `<section class="comms-final-summary"><h3>失聯隊通訊</h3><p>${escapeHtml(commsStatus)}</p><h3>英雄與基地</h3><p>${escapeHtml(heroSummary)}</p><p>${escapeHtml(facilityStatus)}</p></section>`;
    return `<section class="card full-final-result" id="full-final-result" tabindex="-1" aria-labelledby="final-result-title"><h2 id="final-result-title">戰局結果：${kind}</h2><p>${escapeHtml(state.result.reason)}</p>${storyBox}</section>`;
  }

  function alertMarkup(state) {
    const you = state.you;
    const paused = !!(store.manualPaused && state.phase === "playing");
    const route = ensureRoute();
    const entry = StoryUi ? StoryUi.exploreEntry(state, route) : { visible: false };
    const parts = [];
    if (state.phase === "finished" && state.result) {
      const kind = state.result.kind === "draw" ? "和局" : (state.result.you_won ? "你勝出" : "你敗咗");
      // Keep the stable v0 test/UI selector on the compact finish notice;
      // the long economic + story result remains in #full-final-result.
      parts.push(`<div class="critical-notice final-notice" id="match-result-banner" role="status"><strong>戰局已結束：${kind}</strong><span class="final-short-reason">${escapeHtml(state.result.reason || "")}</span><button class="btn small" type="button" data-show-result="1">查看完整結局</button></div>`);
    } else if (paused) {
      parts.push(`<div class="critical-notice pause-notice" role="status">已手動暫停 · 離頁不補算</div>`);
    } else if (state.battle && !state.battle.resolved) {
      const role = state.battle.you_attack ? "你出征中" : "前哨正遭攻打";
      parts.push(`<div class="critical-notice danger-notice" role="status"><strong>${role}</strong> · 約 ${fmtTime(state.battle.remaining)} 後結算</div>`);
    }
    if (entry.visible) {
      parts.push(`<div class="choice-entry explore-alert critical-notice" role="status"><span>探索抉擇：「${escapeHtml(entry.title)}」· 尚餘 <strong id="explore-remain">${fmtTime(entry.remain)}</strong>，逾時選A</span><button class="btn" type="button" ${entry.return_and_open ? 'data-return-explore="1"' : 'data-open-choice="1"'}>${entry.return_and_open ? "返回基地並選擇" : "打開抉擇"}</button></div>`);
    }
    if (state.phase === "playing" && (!(state.campaign && state.campaign.chapter===2)) && state.comms &&
        (state.comms.stage === "choice_one" || state.comms.stage === "choice_two") && route.page !== "radio") {
      parts.push(`<div class="critical-notice radio-notice" role="status"><span><strong>失聯隊等待回覆</strong> · 電台有新訊息</span><button class="btn small" type="button" data-open-page="radio">前往電台</button></div>`);
    }
    if (state.phase === 'playing' && state.campaign && state.campaign.chapter===2 && state.campaign.echo &&
        ['choice_one','choice_two','awaiting_confirmation'].includes(state.campaign.echo.stage) && route.page!=='radio') {
      parts.push('<div class="critical-notice radio-notice" role="status"><span><strong>回聲井等待決定</strong> · 第二章有新訊息</span><button class="btn small" type="button" data-open-page="radio">前往電台</button></div>');
    }
    if (store.error) parts.push(errorBlock());
    return parts.join("");
  }

    function navMarkup(state) {
    const route = ensureRoute();
    return `<nav class="bottom-nav" aria-label="主要頁面">
      <button class="nav-btn ${route.tab === "base" ? "on" : ""}" ${route.tab === "base" ? 'aria-current="page"' : ""} type="button" data-nav-tab="base">基地</button>
      <button class="nav-btn ${route.tab === "map" ? "on" : ""}" ${route.tab === "map" ? 'aria-current="page"' : ""} type="button" data-nav-tab="map">地圖</button>
      <button class="nav-btn ${route.tab === "radio" ? "on" : ""}" ${route.tab === "radio" ? 'aria-current="page"' : ""} type="button" data-nav-tab="radio">電台<span id="nav-radio-badge" class="nav-badge" aria-label="有待回覆訊息" ${state.campaign && state.campaign.chapter===2 ? (state.campaign.echo && ['choice_one','choice_two','awaiting_confirmation'].includes(state.campaign.echo.stage) ? '' : 'hidden') : (state.comms && /^choice_/.test(state.comms.stage) ? '' : 'hidden')}></span></button>
      <button class="nav-btn ${route.tab === "manage" || route.tab === "log" ? "on" : ""}" ${route.tab === "manage" || route.tab === "log" ? 'aria-current="page"' : ""} type="button" data-nav-tab="manage">管理</button>
    </nav>`;
  }

  function backRow(route) {
    if (!route || route.page === "base") return "";
    const backDest = route.stack && route.stack.length ? route.stack[route.stack.length - 1].page : (route.page === "map" || route.page === "log" ? "base" : "map");
    const labels = { base: "基地", map: "地圖", radio: "電台", manage: "管理中心", location: "地點", story: "故事", hero: "英雄詳情", log: "紀錄" };
    const backLabel = labels[backDest] || "上一層";
    return `<div class="back-row">
      <button class="btn small" type="button" data-nav-back="1" aria-label="返回${backLabel}">返回${backLabel}</button>
      ${backDest !== "base" ? `<button class="btn small secondary" type="button" data-nav-tab="base">返回基地</button>` : ""}
    </div>`;
  }

    function paras(lines) {
    return (lines || []).map((p) => `<p class="story-p">${escapeHtml(p)}</p>`).join("");
  }

  function heroStrip(story) {
    const Data = StoryUi && StoryUi.Data;
    if (!Data) return "";
    return `<div class="hero-strip">${Data.heroList().map((h) => {
      const rel = (story && story.relation && story.relation[h.relation_key]) || 0;
      return `<button class="hero-chip" type="button" data-open-hero="${h.id}">${escapeHtml(h.name)}　關係 ${rel}</button>`;
    }).join("")}</div>`;
  }

  function commsPanel(state) {
    const c = state.comms;
    if (!c) return '';
    const blocked = state.phase !== 'playing' || store.manualPaused || (store.clock && store.clock.paused);
    const time = c.remaining == null ? '' : `約 <strong id="comms-countdown">${fmtTime(c.remaining)}</strong> 後回覆`;
    let text = '';
    let choices = '';
    if (c.stage === 'waiting_first') text = `指揮艙收到失聯探索隊「碎光小隊」的斷續呼號，正在校準頻道。${time}。`;
    else if (c.stage === 'choice_one') {
      text = '第一段回覆｜隊員伊珞：「我們被落石隔在地底，北面還有一處低功率發射塔。你要我們走開闊的碎石脊，還是躲進裂谷？」';
      choices = `<button class="btn story-option" type="button" data-comms-choice="COMMS-RIDGE" ${blocked?'disabled':''}>引導前往碎石脊｜較容易定位（免費）</button>
        <button class="btn story-option" type="button" data-comms-choice="COMMS-QUIET" ${blocked?'disabled':''}>讓隊員進入裂谷｜保留隱蔽（免費）</button>`;
    } else if (c.stage === 'waiting_second') text = `隊員按你的指示移動；電波穿過岩層時斷斷續續。${time}。`;
    else if (c.stage === 'choice_two') {
      text = `第二段回覆｜伊珞：「我們抵達舊訊號碑。低功率回覆足夠傳送記錄，但若修復增幅片，會留下更完整的證據。」${c.clue?'你之前的短探索提供了岩層回聲線索。':'暫無短探索的額外岩層線索，仍可免費繼續。'}`;
      choices = `<button class="btn story-option" type="button" data-comms-choice="COMMS-FREE" ${blocked?'disabled':''}>保持低功率回覆｜免費完成</button>
        <button class="btn story-option" type="button" data-comms-choice="COMMS-BOOST" ${blocked || state.you.alloy<2?'disabled':''}>修復增幅片｜消耗2合金（驗證版）</button>
        ${state.you.alloy<2?'<p class="assign-hint">合金不足仍可選免費回覆。</p>':''}`;
    } else if (c.stage === 'waiting_third') text = `第三段回覆正在穿過干擾區。${time}。你仍可返回基地管理前哨。`;
    else if (c.stage === 'completed') text = c.outcome === 'located'
      ? `已收到第三段回覆｜「碎光小隊」成功將位置標記在安全航圖上；${c.variant==='verified'?'增幅回波也留下可核對的完整證據。':'使用低功率記錄，沒有額外花費。'}這些遠方隊員不會加入本局六名船員。`
      : `已收到第三段回覆｜隊員決定在裂谷內隱蔽，電台保留返航方向；${c.variant==='verified'?'增幅記錄確認了附近的地形。':'低功率訊號已足夠保存足跡。'}他們不加入本局六名船員。`;
    else if (c.stage === 'forced') text = '對局先行結束。通訊由系統標記為「未完成／失聯」，不是玩家選擇的結果。';
    else text = '這份舊對局於通訊功能推出前結束；本局未啟用失聯隊通訊。';
    return `<section class="card comms-card" id="comms-panel" aria-label="失聯探索隊通訊">
      <div class="comms-head"><h2>失聯隊電台</h2><span class="tag">回覆 ${c.replies.length}／3</span></div>
      <p class="desc">同一局遊戲時間的三次短回覆；不是20秒探索事件，閱讀不會自動暫停。</p>
      <p class="comms-message">${text}</p>
      <p class="assign-hint">${escapeHtml(c.advice || '')}</p>
      ${choices?`<div class="comms-options">${choices}</div>`:''}
    </section>`;
  }

  function guidePanel(state) {
    const c=state.comms;
    if (!c || !c.guide || c.stage==='unavailable') return '';
    const rows=[['assign','調派至少1位船員到回收廠'],['build','建造任一設施（使用原本合金成本）'],['explore','派出一次原有短探索']];
    return `<details class="card guide-panel preserved-detail" id="guide-tasks"><summary>開局指引 · 三個小任務</summary>
      <p class="desc">配合失聯隊通訊的三個基地操作提示。可自行完成，也可以全部略過。</p>
      ${rows.map(([id,label])=>`<div class="guide-row"><span>${escapeHtml(label)}：${c.guide[id]==='done'?'已完成':c.guide[id]==='skipped'?'已略過':'未完成'}</span>${c.guide[id]==='pending'?`<button class="btn small" type="button" data-guide-skip="${id}" ${state.phase!=='playing'||store.manualPaused?'disabled':''}>略過</button>`:''}</div>`).join('')}
      <button class="btn secondary" type="button" data-guide-skip="all" ${state.phase!=='playing'||store.manualPaused?'disabled':''}>略過所有未完成小任務</button>
    </details>`;
  }

  function mapPageMarkup(state) {
    const Data = StoryUi.Data;
    const story = state.story || {};
    const cards = Data.LOCATIONS.map((loc) => {
      const st = StoryUi.locationState(story, loc);
      let status = "未開啟";
      if (st.current) status = "可決定";
      else if (st.resolved) status = "已完成";
      else if (st.unlocked) status = "可進入";
      return `<button class="loc-card" type="button" data-open-location="${loc.id}" ${st.unlocked ? "" : "disabled"}>
        <strong>${escapeHtml(loc.name)}</strong>
        <span class="muted">${escapeHtml(status)}</span>
        <p class="desc">${escapeHtml(loc.summary)}</p>
        ${st.unlocked ? "" : `<p class="assign-hint">需要先完成上一幕。</p>`}
      </button>`;
    }).join("");
    const echo=state.campaign && state.campaign.chapter===2 ? state.campaign.echo : null;
    const echoSite=echo ? `<section class="card echo-map-site"><span class="eyebrow">CHAPTER TWO</span><h2>回聲井｜${echo.branch==='ridge'?'脊上信標':echo.branch==='quiet'?'谷底靜默':'噪音記錄器'}</h2>
      <p class="desc">${echo.stage==='calibrating'?'信號尚在局內校準。校準後才開放新地點，不會自動暴露基地座標。':echo.branch==='ridge'?'已定位碎石脊，新地點現已可進入。':'回聲井已定位，可展開本章對話與選擇。'}</p>
      <button class="btn secondary" type="button" data-open-page="radio" ${echo.stage==='calibrating'?'disabled':''}>${echo.stage==='calibrating'?'校準中：稍後可進入':'進入回聲井'}</button></section>` : '';
    return `${backRow(ensureRoute())}
      <header class="page-heading"><span class="eyebrow">PLANET EXPEDITION</span><h1>探索地圖</h1><p>派出船員尋找物資，或沿著遺跡追查遠燈號的過去。</p></header>
      ${shortExploreMarkup(state)}
      <section class="card">
        <h2>星球地圖</h2>
        <p class="desc">三處遺跡串起第一章《無聲的歸航》。故事選擇沒有倒數；對局會繼續計時。</p>
      </section>
      <div class="loc-list">${cards}</div>
      ${echoSite}
      <details class="card preserved-detail" id="map-heroes"><summary>三份人格檔案</summary>${heroStrip(story)}</details>
      <details class="card preserved-detail" id="map-radio"><summary>展開電台快捷面板</summary>${echo?echoPanel(state):commsPanel(state)}</details>`;
  }

  function locationPageMarkup(state) {
    const Data = StoryUi.Data;
    const route = ensureRoute();
    const loc = Data.LOCATIONS.filter((l) => l.id === route.locId)[0];
    if (!loc) return mapPageMarkup(state);
    const story = state.story || {};
    const st = StoryUi.locationState(story, loc);
    const node = Data.NODES[loc.node_id];
    return `${backRow(route)}
      <section class="card">
        <h2>${escapeHtml(loc.name)}</h2>
        <p class="desc">${escapeHtml(loc.summary)}</p>
        ${heroStrip(story)}
        ${st.unlocked
          ? `<button class="btn story-option" type="button" data-open-story="${loc.node_id}">進入${escapeHtml(node ? node.title : "故事")}</button>`
          : `<p class="assign-hint">需要先完成上一幕，先可以進入呢個地點嘅故事。</p>`}
      </section>`;
  }

  function storyPageMarkup(state) {
    const Data = StoryUi.Data;
    const route = ensureRoute();
    const node = Data.NODES[route.nodeId];
    if (!node) return mapPageMarkup(state);
    const story = state.story || {};
    const unlocked = StoryUi.nodeUnlocked(story, node.id);
    const resolved = (story.resolved_nodes || []).indexOf(node.id) !== -1;
    const current = story.current_node === node.id;
    const flags = chromeFlags(state);
    const choices = (unlocked && current && !resolved) ? (StoryUi.choiceModels(state) || []) : [];
    const chosen = (story.choice_history || []).filter((id) => {
      const c = Data.choiceById(id);
      return c && c.node_id === node.id;
    });
    const renderChoice = (ch) => {
      const cost = ch.cost_alloy > 0 ? `<span class="cost-note">消耗${ch.cost_alloy}合金</span>` : `<span class="cost-note free-cost">免費</span>`;
      const why = !ch.enabled && ch.reason ? `<span class="option-reason">${escapeHtml(ch.reason)}</span>` : (ch.stance_change ? `<span class="option-reason">將改變立場，原英雄專屬解析會放棄。</span>` : "");
      return `<button class="btn story-option ${ch.enabled ? "" : "is-locked"}" type="button" data-story-choice="${ch.id}" ${ch.enabled && !flags.paused && !flags.finished ? "" : "disabled"}>${escapeHtml(ch.label)} ${cost}${why}</button>`;
    };
    let optionBtns = choices.map(renderChoice).join("");
    if (node.id === "STORY-02" && choices.length) {
      const heroes = Data.heroList();
      const chosenHero = store.storySelectedHero;
      if (chosenHero && heroes.some((h) => h.id === chosenHero)) {
        const hero = Data.HEROES[chosenHero];
        optionBtns = `<div class="story-step-head"><span class="story-step-number">步驟 2／2</span><h3>${escapeHtml(hero.name)} · 選擇解讀方式</h3><button class="btn small secondary" type="button" data-story-hero-back="1">更換英雄</button></div>
          <p class="story-step-description">免費解讀也可到達完整故事結局；深入解碼消耗2合金，只解鎖已驗證的線索和結局版本。</p>
          ${choices.filter((ch) => ch.hero_id === chosenHero).map(renderChoice).join("")}`;
      } else {
        optionBtns = `<div class="story-step-head"><span class="story-step-number">步驟 1／2</span><h3>選擇一位正式指派的英雄</h3></div>
          <p class="story-step-description">本章只能指派一位英雄。可以改變第一幕的立場；選好英雄後再決定免費或花2合金解讀。</p>
          ${heroes.map((h) => `<button class="btn story-option hero-select-option" type="button" data-story-select-hero="${h.id}">${escapeHtml(h.name)}<span class="option-reason">${escapeHtml(h.role)} ·  查看解讀方式</span></button>`).join("")}`;
      }
    }
    let status = "";
    if (!unlocked) status = `<p class="assign-hint">需要先完成上一幕。</p>`;
    else if (resolved) status = `<p class="assign-status">呢一幕已確認：${escapeHtml(chosen[0] || "已選擇")}。返回唔會撤銷。</p>`;
    else if (story.chapter_status === "unavailable") status = `<p class="assign-hint">本局故事功能未啟用。</p>`;
    else if (flags.finished) status = `<p class="assign-hint">對局已結束，唔能再提交故事選擇。</p>`;
    else if (flags.paused) status = `<p class="assign-hint">計時已暫停，繼續後先可以確認選擇。</p>`;
    return `${backRow(route)}
      <article class="card story-card">
        <h2>${escapeHtml(node.title)}</h2>
        <div class="story-scene">${paras(node.scene)}</div>
        ${heroStrip(story)}
        ${status}
        ${optionBtns ? `<div class="story-options">${optionBtns}</div>` : ""}
      </article>`;
  }

  function heroPageMarkup(state) {
    const Data = StoryUi.Data;
    const route = ensureRoute();
    const hero = Data.HEROES[route.heroId];
    if (!hero) return mapPageMarkup(state);
    const story = state.story || {};
    const rel = (story.relation && story.relation[hero.relation_key]) || 0;
    const used = !!(story.flags && story.flags.hero_ability_used && story.assigned_hero === hero.id);
    const trusted = story.flags && story.flags.initial_trust === hero.id;
    return `${backRow(route)}
      <section class="card">
        <h2>${escapeHtml(hero.name)}</h2>
        <p class="tag">${escapeHtml(hero.role)}</p>
        <p class="desc">${escapeHtml(hero.background)}</p>
        <p class="desc">${escapeHtml(hero.personality)}</p>
        <p class="assign-status">關係 ${rel}／3。${trusted ? "你曾初步信任呢份檔案。" : "尚未成為初步信任對象。"}${used ? " 本章已正式指派並用過一次性能力：" + escapeHtml(hero.ability_name) + "。" : " 專屬能力：「" + escapeHtml(hero.ability_name) + "」，整章三名英雄共用一次。"}</p>
        <p class="assign-hint muted">人格檔案不佔人口、唔生產、唔參戰，亦唔免費造兵。</p>
      </section>`;
  }

  function logPageMarkup(state) {
    const story = state.story || {};
    const Data = StoryUi.Data;
    const rel = story.relation || {};
    const history = (story.choice_history || []).map((id) => {
      const c = Data.choiceById(id);
      return `<li>${escapeHtml(c ? c.label : id)}</li>`;
    }).join("");
    const events = (state.events || []).slice().reverse().slice(0, 12)
      .map((ev) => `<li>${escapeHtml(ev.text)}</li>`).join("");
    let ending = "尚未完結。";
    if (story.legacy_finished_unstarted || story.chapter_status === "unavailable") ending = "本局故事未啟用。";
    else if (story.forced || story.ending_variant === "forced") ending = "故事未完成，系統自動收束。";
    else if (story.ending_id) ending = (story.ending_title || story.ending_id) + (story.ending_variant && story.ending_variant !== "base" ? "（" + story.ending_variant + "）" : "");
    return `${backRow(ensureRoute())}
      ${managementHeader("records")}
      <section class="card">
        <h2>故事紀錄</h2>
        <p class="assign-status">璃棱 ${rel.liling || 0}　秋纓 ${rel.qiuying || 0}　烏燼 ${rel.wujin || 0}</p>
        <p class="desc">結局：${escapeHtml(ending)}</p>
        <ul class="log">${history || "<li>尚未作出故事選擇。</li>"}</ul>
      </section>
      <section class="card">
        <h2 class="log-heading">最近戰況</h2>
        <details class="battle-history"><summary>上一場戰鬥：掠奪與攻守傷亡</summary><p>${escapeHtml(lastBattleSummary(state))}</p></details>
        <ul class="log">${events || "<li>尚未有新事件。</li>"}</ul>
      </section>`;
  }

  function shortExploreMarkup(state) {
    const you = state.you;
    const disabled = state.phase !== "playing" || store.manualPaused || !state.explore || !state.explore.can;
    let body;
    if (you.pending_choice) body = `<p class="desc">探索隊已抵達，請在時限內決定行動。</p><button class="btn" type="button" data-open-choice="1">查看探索抉擇</button>`;
    else if (you.exploring) body = `<p class="desc">探索隊正在前往目標，約 <strong id="explore-arrival-time">${fmtTime(you.explore_remaining)}</strong> 後抵達。</p>`;
    else if (you.recovering) body = `<p class="desc">船員正在歸途休養，約 <strong id="explore-recovery-time">${fmtTime(you.recover_remaining)}</strong> 後返回待命。</p>`;
    else body = `<p class="desc">派出1名待命船員，60秒後抵達。抵達後有20秒選擇行動，逾時採用穩妥路線。</p><button class="btn" type="button" data-explore="1" ${disabled ? "disabled" : ""}>出發探索 · 口糧1</button>${state.explore && state.explore.reason ? `<p class="assign-hint">${escapeHtml(state.explore.reason)}</p>` : ""}`;
    return `<section class="card short-explore"><div class="section-label"><span class="eyebrow">FIELD TEAM</span><span class="tag">短探索</span></div><h2>派出探索隊</h2>${body}</section>`;
  }

  function managementHeader(section) {
    const sections = [["production", "生產"], ["crew", "人員"], ["defense", "防衛"], ["records", "紀錄"]];
    return `<header class="page-heading"><span class="eyebrow">OUTPOST CONTROL</span><h1>玩家管理中心</h1><p>調配人手、整理設施，為下一步行動做好準備。</p></header>
      <nav class="management-tabs" aria-label="管理分類">${sections.map(([id, label]) => `<button class="management-tab ${section === id ? "on" : ""}" type="button" data-manage-section="${id}" ${section === id ? 'aria-current="page"' : ""}>${label}</button>`).join("")}</nav>`;
  }

  function crewOverview(state) {
    const y = state.you;
    const counts = [
      ["待命", y.standby], ["回收廠", y.recycle_workers], ["補給棚", y.supply_workers],
      ["指揮艙值守", y.duty_workers || 0], ["巡衛", y.patrols], ["守陣", y.wards || 0],
      ["訓練中", y.training ? 1 : 0], ["遣返中", y.recalling || 0],
      ["探索中", y.exploring ? 1 : 0], ["歸途休養", y.recovering ? 1 : 0]
    ];
    return `<section class="card"><div class="section-label"><h2>船員分布</h2><span class="tag">共 ${currentPopulation(state)} 人</span></div><p class="desc">每位船員只佔一個崗位。巡衛與守陣人數包括已出征的人手。</p><dl class="crew-grid">${counts.map(([label, count]) => `<div><dt>${label}</dt><dd>${count}</dd></div>`).join("")}</dl><button class="btn secondary" type="button" data-manage-section="production">前往生產派工</button></section>`;
  }

  function facilityIcon(kind) {
    const shapes = {
      command: '<path d="M14 44h36V26H14zM20 44V32h24v12M32 26V10M24 12l8 8 8-8M24 8a13 13 0 0 0 16 0"/><path d="M8 48h48M24 36h4m8 0h4"/>',
      recycle: '<path d="M10 46h44V28L42 18 30 28V18L10 30zM38 15V7h10v18M18 35h6m8 0h6m6 0h4M17 42h30M7 50h50"/>',
      supply: '<path d="M10 46V28a22 22 0 0 1 44 0v18zM6 50h52M32 44V25m0 11c-10 0-13-6-13-11 9 0 13 5 13 11Zm0-7c10 0 13-6 13-11-9 0-13 5-13 11Z"/>',
      armory: '<path d="M12 46V24l20-12 20 12v22M7 50h50M23 46V30h18v16M18 24h28M27 8h10M32 4v8"/><path d="m27 36 5-3 5 3v5l-5 4-5-4z"/>'
    };
    return `<svg viewBox="0 0 64 56" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${shapes[kind] || shapes.command}</svg>`;
  }

  function currentObjective(state) {
    const c = state.comms || {};
    const g = c.guide || {};
    if (state.phase === "finished") return { title: "本次航程已結束", text: "回顧戰局、失聯小隊與基地的最後狀況。", action: 'data-show-result="1"', label: "查看完整結局" };
    if (state.battle && !state.battle.resolved) return { title: "留意前哨防線", text: "戰鬥正在進行，前往防衛頁查看可用兵力。", action: 'data-open-manage="defense"', label: "查看防衛" };
    if (c.stage === "choice_one" || c.stage === "choice_two") return { title: "失聯隊等緊你的回覆", text: "碎光小隊傳來新消息，前往電台決定下一步。", action: 'data-open-page="radio"', label: "回覆電台" };
    if (g.assign === "pending") return { title: "先建立合金來源", text: "派至少1名船員到回收廠，開始從殘骸回收合金。", action: 'data-open-manage="production"', label: "前往派工" };
    if (g.build === "pending") return { title: "為基地添一座設施", text: "補給棚需要5合金，整備艙需要8合金。按你的計劃選擇。", action: 'data-open-manage="production"', label: "查看設施" };
    if (g.explore === "pending") return { title: "看看前哨以外的世界", text: "用1口糧派出1名待命船員，尋找附近的線索。", action: 'data-open-page="map"', label: "前往地圖" };
    return { title: "決定前哨的下一步", text: state.you.alloy >= 40 ? "合金已達40；第8分鐘起會判定勝負。探索與故事仍可繼續。" : `距離40合金尚欠${Math.max(0, 40 - state.you.alloy)}。你亦可繼續探索與查閱人格檔案。`, action: 'data-open-page="map"', label: "查看探索" };
  }

  function basePageMarkup(state) {
    const y = state.you;
    const objective = currentObjective(state);
    const facilities = [
      ["command", "指揮艙", "crew", true, y.pressure_high ? "艙壓過高 · 需要值守" : `值守 ${y.duty_workers || 0}／1 · 艙壓穩定`],
      ["recycle", "回收廠", "production", true, `派工 ${y.recycle_workers}／2${y.recycle_upgraded ? " · 深拆已升級" : " · 基礎回收"}`],
      ["supply", "補給棚", "production", y.supply_built, y.supply_built ? `派工 ${y.supply_workers}／2${y.supply_upgraded ? " · 密植已升級" : " · 生態補給"}` : "待建造 · 合金5"],
      ["armory", "整備艙", "defense", y.armory_built, y.armory_built ? `巡衛 ${y.patrols} · 守陣 ${y.wards || 0}` : "待建造 · 合金8"]
    ];
    const c = state.comms || {};
    const radioText = /^choice_/.test(c.stage) ? "新訊息 · 等待你的回覆" : c.stage === "completed" ? "三段回覆已收錄" : c.stage === "forced" ? "通訊未完成 · 已封存" : c.stage === "unavailable" ? "本局未啟用" : "正在接收遠方的訊號";
    return `<header class="page-heading base-heading"><span class="eyebrow">FARLIGHT / SURFACE OUTPOST</span><h1>墜星前哨<span>基地總覽</span></h1><p>六名倖存者，一座仍然亮著燈的前哨。</p></header>
      <div class="overview-grid"><section class="outpost-scene ${y.pressure_high ? "under-pressure" : ""}" aria-label="基地設施總覽"><div class="scene-caption"><span class="scene-live">地表設施</span><span>${y.pressure_high ? "艙壓警示" : "艙壓穩定"}</span></div><div class="facility-grid">${facilities.map(([id, title, section, built, detail]) => `<button class="facility-tile ${id} ${built ? "is-built" : "is-blueprint"}" type="button" data-open-manage="${section}" aria-label="${title}：${detail}，進入管理"><span class="facility-art">${facilityIcon(id)}</span><span class="facility-name">${title}<span class="facility-arrow" aria-hidden="true">↗</span></span><span class="facility-state">${detail}</span></button>`).join("")}</div><p class="scene-footnote">點選設施，進入相應管理分類</p></section>
      <aside class="overview-aside"><section class="card objective-card"><span class="eyebrow">CURRENT OBJECTIVE</span><h2>${objective.title}</h2><p class="desc">${objective.text}</p><button class="btn" type="button" ${objective.action}>${objective.label}<span aria-hidden="true"> →</span></button></section>
      <button class="card signal-entry" type="button" data-open-page="radio"><span class="eyebrow">DEEP SPACE RADIO</span><strong>失聯隊電台<span aria-hidden="true"> ↗</span></strong><span class="signal-status">${radioText}</span></button>
      <button class="card signal-entry map-entry" type="button" data-open-page="map"><span class="eyebrow">UNKNOWN HORIZON</span><strong>探索與遺跡<span aria-hidden="true"> ↗</span></strong><span class="signal-status">派出探索隊 · 追查無聲的歸航</span></button></aside></div>
      ${guidePanel(state)}`;
  }

  function managementFacilitiesMarkup(state, section) {
    const you = state.you;
    const raid = state.raid || {};
    const paused = !!(store.manualPaused && state.phase === "playing");
    const prot = you.protection_remaining > 0 ? `受襲保護尚餘 <strong id="protection-time">${fmtTime(you.protection_remaining)}</strong>` : "";
    const pressureTxt = you.pressure_high
      ? "艙壓：過高（升級加成暫停，派人值守可恢復）"
      : (you.recycle_upgraded || you.supply_upgraded ? "艙壓：穩定" : "艙壓：穩定（未升級時無需值守）");
    const commandBody = `
      <p class="desc">開局已有，不可拆。固定保護底線：口糧 6、合金 6，打輸都搶唔走。</p>
      ${prot ? `<p class="tag">${prot}</p>` : ""}
      <p class="assign-status">${escapeHtml(pressureTxt)}</p>
      ${workerBtns("duty", you, state)}
      <button class="btn small secondary" type="button" data-open-page="map">前往地圖派出探索隊</button>`;
    const recycleUp = you.recycle_upgraded
      ? `<p class="tag">已升級深拆。艙壓穩定且有人開工時，成座每週期再 +1 合金。</p>`
      : `<button class="btn small" type="button" data-upgrade="recycle" ${paused || state.phase !== "playing" || you.alloy < 6 ? "disabled" : ""}>升級深拆（合金 6）</button>
         <p class="assign-hint muted">${state.phase !== "playing" || paused ? "暫停或終局唔能升級。" : (you.alloy < 6 ? "合金不足，深拆要 6。" : "升級後要留 1 人值守先有加成。")}</p>`;
    const recycleBody = workerBtns("recycle", you, state) + `<p class="desc">開局已有。每人每 30 秒產合金 1。</p>` + recycleUp;
    const supplyUp = !you.supply_built ? "" : (you.supply_upgraded
      ? `<p class="tag">已升級密植。艙壓穩定且有人開工時，成座每週期再 +1 口糧。</p>`
      : `<button class="btn small" type="button" data-upgrade="supply" ${paused || state.phase !== "playing" || you.alloy < 4 ? "disabled" : ""}>升級密植（合金 4）</button>
         <p class="assign-hint muted">${state.phase !== "playing" || paused ? "暫停或終局唔能升級。" : (you.alloy < 4 ? "合金不足，密植要 4。" : "升級後要留 1 人值守先有加成。")}</p>`);
    const supplyBody = you.supply_built
      ? workerBtns("supply", you, state) + `<p class="desc">每人每 30 秒產口糧 2。</p>` + supplyUp
      : `<button class="btn small" type="button" data-build="supply" ${paused || state.phase !== "playing" || you.alloy < 5 ? "disabled" : ""}>建造（合金 5）</button>${you.alloy < 5 ? '<p class="assign-hint">合金不足，建造需要5合金。</p>' : ''}`;
    const trainBusy = !!you.training;
    const trainPatrolDis = trainBusy || you.standby < 1 || you.rations < 3 || you.alloy < 2 || paused || state.phase !== "playing";
    const trainWardDis = trainBusy || you.standby < 1 || you.rations < 4 || you.alloy < 1 || paused || state.phase !== "playing";
    const trainPatrolWhy = trainBusy ? "隊列已有訓練。" : (you.standby < 1 ? "冇待命船員可以送去訓練。" : (you.rations < 3 ? "口糧不足（要 3）。" : (you.alloy < 2 ? "合金不足，練巡衛要 2。" : "")));
    const trainWardWhy = trainBusy ? "隊列已有訓練。" : (you.standby < 1 ? "冇待命船員可以送去訓練。" : (you.rations < 4 ? "口糧不足，練守陣要 4。" : (you.alloy < 1 ? "合金不足，練守陣要 1。" : "")));
    const trainTxt = you.training ? `訓練中，約 <strong id="training-time">${fmtTime(you.training_remaining)}</strong> 完成` : "隊列空閒";
    const recallTxt = you.recalling_active ? `遣返 ${you.recalling} 人，約 <strong id="recall-time">${fmtTime(you.recall_remaining)}</strong> 完成，不退款` : "";
    const armoryBody = you.armory_built
      ? `<p class="assign-status">巡衛 ${you.patrols}${you.locked_patrols ? "（鎖 " + you.locked_patrols + "）" : ""}　守陣 ${you.wards || 0}${you.locked_wards ? "（鎖 " + you.locked_wards + "）" : ""}</p>
         <div class="row assign-row">
           <button class="btn small" type="button" data-train="patrol" ${trainPatrolDis ? "disabled" : ""}>練巡衛（口糧 3、合金 2）</button>
           <button class="btn small" type="button" data-train="ward" ${trainWardDis ? "disabled" : ""}>練守陣（口糧 4、合金 1）</button>
         </div>
         <p class="assign-hint muted">${escapeHtml(trainPatrolWhy || trainWardWhy || "守陣偏防衛，無攻勢唔能出征。")}</p>
         <div class="row assign-row">
           <button class="btn small" type="button" data-open-recall="patrol" ${(!you.patrols || you.recalling_active || paused || state.phase !== "playing") ? "disabled" : ""}>遣返巡衛</button>
           <button class="btn small" type="button" data-open-recall="ward" ${(!(you.wards) || you.recalling_active || paused || state.phase !== "playing") ? "disabled" : ""}>遣返守陣</button>
         </div>
         <p class="desc">${trainTxt}${recallTxt ? "。" + recallTxt : ""}。隊列最多 1 個。被鎖兵不可遣返。</p>`
      : `<button class="btn small" type="button" data-build="armory" ${paused || state.phase !== "playing" || you.alloy < 8 ? "disabled" : ""}>建造（合金 8）</button>${you.alloy < 8 ? '<p class="assign-hint">合金不足，建造需要8合金。</p>' : ''}`;
    if (section === "production") return `<div class="management-grid">
      ${facCard("回收廠", "每位船員每30秒回收1合金。", recycleBody, "recycle")}
      ${facCard("補給棚", "每位船員每30秒生產2口糧。", supplyBody, "supply")}</div>`;
    if (section === "crew") return `<div class="management-grid">${crewOverview(state)}
      ${facCard("指揮艙", "安排值守，維持升級設施的艙壓。", commandBody, "command")}</div>`;
    return `<div class="management-grid">
      ${facCard("整備艙", "訓練巡衛與守陣，或遣返船員。", armoryBody, "armory")}
      <section class="card"><h2>防線與出征</h2><p class="desc">巡衛可進攻與防守；守陣擅長防守，可隨巡衛一同出征。</p><p class="assign-status">${prot || "目前沒有受襲保護。"}</p><details class="battle-history preserved-detail" id="defense-history"><summary>上一場戰鬥</summary><p>${escapeHtml(lastBattleSummary(state))}</p></details>
      ${state.phase !== "waiting" ? `
      <div class="raid-dock">
        <button class="btn warn" id="btn-raid" type="button" ${raid.can && !paused ? "" : "disabled"}>出兵掠奪</button>
        <div class="hint">${paused && state.phase === "playing" ? "計時已暫停，繼續後先可以出征。" : (raid.can ? "選擇出征構成。至少 1 名巡衛；守陣可一齊派出但無攻勢。對方守軍會全部鎖定。" : escapeHtml(raid.reason || ""))}</div>
      </div>` : ""}</section></div>`;
  }

  function managementPageMarkup(state) {
    const section = ensureRoute().section || "production";
    const y = state.you;
    const alloyRate = y.recycle_workers + (y.bonus_active && y.recycle_upgraded && y.recycle_workers > 0 ? 1 : 0);
    const rationRate = y.supply_built ? y.supply_workers * 2 + (y.bonus_active && y.supply_upgraded && y.supply_workers > 0 ? 1 : 0) : 0;
    return `${backRow(ensureRoute())}${managementHeader(section)}
      <div class="management-summary"><span>待命 <strong>${y.standby}</strong> 人</span><span>生產 <strong>${y.recycle_workers + y.supply_workers}</strong> 人</span><span>值守 <strong>${y.duty_workers || 0}</strong> 人</span></div>
      ${section === "production" ? `<p class="production-rate">目前每30秒產出：合金 <strong>${alloyRate}</strong> · 口糧 <strong>${rationRate}</strong></p>` : ""}
      ${y.pressure_high ? `<div class="critical-notice danger-notice">艙壓過高，升級加成已暫停。<button class="btn small secondary" type="button" data-manage-section="crew">安排值守</button></div>` : ""}
      ${managementFacilitiesMarkup(state, section)}`;
  }

  // Single UI condition and handler contract for both the journey panel and the final result.
  // This never confirms a chapter, settles a Run, or starts a Run by itself.
  function campaignContinuation(state) {
    const c = state && state.campaign;
    const finished = !!(state && state.phase === "finished");
    const done = !!(c && c.chapter === 2 && c.chapter2_confirmed);
    return {
      done,
      canNext: !!(c && finished && !done && !(c.chapter === 1 && !c.chapter1_confirmed)),
      canContinueFirst: !!(c && finished && c.chapter === 1 && !c.chapter1_confirmed),
      nextLabel: c && c.chapter === 1 ? "續篇：進入第二章〈回聲井〉" : "開始下一局，繼續第二章"
    };
  }

  function campaignContinueButtons(state, inResult) {
    const choice = campaignContinuation(state);
    if (!choice.canNext && !choice.canContinueFirst) return "";
    const message = choice.canContinueFirst
      ? `<p class="assign-hint">也可不確認章末，先開始下一局繼續等待伊珞回覆。</p>` : "";
    const label = choice.canContinueFirst ? "繼續第一章通訊（下一局）" : choice.nextLabel;
    return `<div class="${inResult ? "final-continue" : "journey-continue"}" aria-label="旅程續局操作">
      ${message}<button class="btn${choice.canContinueFirst ? " secondary" : ""}" type="button" data-campaign-next="1">${label}</button>
    </div>`;
  }

  function campaignJourneyPanel(state) {
    if (store.mode !== 'campaign' || !state.campaign) return '';
    const c=state.campaign;
    const done=campaignContinuation(state).done;
    const ready=c.chapter===1 && (state.comms.stage==='completed' || state.phase==='finished');
    const confirm=c.chapter===1&&!c.chapter1_confirmed&&ready;
    const label=c.chapter===1?'第一章｜碎光小隊':'第二章｜回聲井';
    return `<section class="card campaign-journey" id="campaign-journey" aria-label="持續旅程進度">
      <div class="section-label"><h2>${label}</h2><span class="tag">${escapeHtml(c.run_id)}</span></div>
      <p class="desc">故事跨局保留 · 基地每局重新部署 · 本局15分鐘結算不會替你選故事。</p>
      ${c.history_unknown?'<p class="assign-hint">舊存檔部分歷史未記錄；未知選擇不會被冒認。</p>':''}
      ${confirm?`<button class="btn" type="button" data-campaign-confirm-ch1="1">${state.comms.stage==='completed'?'確認第一章收尾':'以未完通訊紀錄收尾（噪音記錄器）'}</button>`:''}
      ${c.chapter===1&&c.chapter1_confirmed?'<p>第一章已由玩家確認；請完成當前基地Run後再明確進入第二章。</p>':''}
      ${campaignContinueButtons(state, false)}
      ${done?'<p><strong>兩章旅程已完成｜目前故事內容至此。</strong> 可在紀錄及人物頁查看過去決定。</p>':''}
    </section>`;
  }

  function echoPanel(state) {
    const c=state.campaign, e=c&&c.echo;
    if (!e) return '';
    const blocked=state.phase!=='playing'||store.manualPaused||(store.clock&&store.clock.paused);
    const branchTitle=e.branch==='ridge'?'脊上信標':e.branch==='quiet'?'谷底靜默':'噪音記錄器';
    const intro=e.branch==='ridge'
      ?'伊珞留下可辨識的碎石脊方位。脊上信標仍亮著，風砂將至，是否沿脊協助接應？'
      :e.branch==='quiet'
      ?'伊珞在裂谷下避開了可疑回波。只有斷續的脈衝，必須先校準，避免把前哨座標暴露給未知接收者。'
      :'舊呼號只剩雜訊，沒有足夠紀錄還原你未曾作出的決定。基地找到噪音記錄器，可由中性線索繼續調查。';
    const prior=e.prior_result==='win'?'上一局勝利，基地設備尚能支援重聽。':e.prior_result==='loss'?'上一局失利，部分接收器受損，但調查仍可繼續。':e.prior_result==='draw'?'上一局沒有勝負優勢，雙方都留下零散紀錄。':'過往基地結果未記錄。';
    const boost=state.comms.decisions.includes('COMMS-BOOST')?'先前核證的增幅回波為這段訊息提供更清楚的頻率註記；不額外提供資源。':'';
    const exploreClue=state.comms.clue?'先前短探索已留下岩層回聲線索，這次能比對記錄器上的刻痕。':'之前未取得短探索岩層線索，仍可免費辨識回聲。';
    const hero=state.story&&state.story.assigned_hero;
    const advice=hero==='HERO-01'?'璃棱提醒：沿脊線的方位較穩定，但仍需查證。':hero==='HERO-02'?'秋纓提醒：在風砂前保留飲水與口糧，不要勉強出發。':hero==='HERO-03'?'烏燼提醒：先封閉未授權頻道，避免未知目標循訊追蹤。':'三位專家仍在等待正式指派。';
    let content='',controls='';
    if (e.stage==='calibrating') content=`校準中，約 <strong id="echo-countdown">${fmtTime(Math.max(0,e.next_at-state.now))}</strong> 後可確認來源。遊戲暫停時不會倒數。`;
    else if (e.stage==='choice_one') {
      content=e.branch==='ridge'?'伊珞：「脊上風砂正起。直接標記坐標，或用少量合金修復舊接收片接應？」':e.branch==='quiet'?'伊珞：「谷底信號已校準。請選擇留下低功率標記，還是修復接收片提升核證？」':'記錄器：「呼號不完整，仍可免費標記方向；額外合金只能核證細節。」';
      controls=`<button class="btn" type="button" data-echo-choice="ECHO-MARK" ${blocked?'disabled':''}>標記回聲源｜免費</button>
        <button class="btn secondary" type="button" data-echo-choice="ECHO-ASSIST" ${blocked||state.you.alloy<2?'disabled':''}>修復接收片接應｜消耗2合金（只增核證線索）</button>
        ${state.you.alloy<2?'<p class="assign-hint">合金不足，可選免費標記，仍可完整通關。</p>':''}`;
    } else if (e.stage==='waiting_reply') content=`回聲沿岩層傳播，約 <strong id="echo-countdown">${fmtTime(Math.max(0,e.next_at-state.now))}</strong> 後會有回音。你仍可繼續管理基地。`;
    else if (e.stage==='choice_two') {
      content=(e.branch==='ridge'?'脊上信標回報了清楚的座標。':e.branch==='quiet'?'谷底微弱的回聲證實，避開明碼的路線仍可行。':'噪音記錄器找回了一個可核對的舊頻率。')+
        (e.decisions[0]==='ECHO-ASSIST'?' 修復的接收片額外指出回音來自兩道岩壁，不代表有新的救援隊。':' 免費記錄已足以辨識來源。')+
        ' 現在要向倖存者公開這份回聲，還是把它封存供內部核對？';
      controls=`<button class="btn" type="button" data-echo-choice="ECHO-OPEN" ${blocked?'disabled':''}>共享回聲，留下可驗證紀錄｜免費</button>
        <button class="btn secondary" type="button" data-echo-choice="ECHO-SEAL" ${blocked?'disabled':''}>封存頻道，只供前哨內部查看｜免費</button>`;
    } else if (e.stage==='awaiting_confirmation') {
      content='兩次回應已完成，但這還不是章節結局。只有你確認，旅程才真正收束。';
      controls=`<button class="btn" type="button" data-campaign-confirm-ch2="1">確認第二章結局（由玩家決定）</button>`;
    } else {
      content=e.outcome==='echo_shared'?'你選擇共享可核對的回聲；外界尚未回覆，六名倖存者知道自己的聲音仍能傳到遠方。':'你選擇封存座標，只在前哨留下可驗證的紀錄；未知宇宙未獲前哨位置。';
      content+=' 〈回聲井〉至此完成，目前只製作兩章，沒有未開放的第三章。';
    }
    return `<section class="card comms-card echo-panel" id="echo-panel"><span class="eyebrow">CHAPTER TWO · 原創固定故事</span>
      <h2>回聲井｜${branchTitle}</h2><p class="story-p">${escapeHtml(intro)}</p><p class="desc">${escapeHtml(prior)} ${escapeHtml(boost)} ${escapeHtml(exploreClue)}</p>
      <p class="comms-message">${content}</p><p class="assign-hint">${escapeHtml(advice)}</p><div class="comms-options">${controls}</div>
      <p class="desc">伊珞與碎光小隊只存在於通訊中，不會成為第7名可派船員。</p></section>`;
  }

  function radioPageMarkup(state) {
    const isSecond=store.mode==='campaign'&&state.campaign&&state.campaign.chapter===2;
    return `${backRow(ensureRoute())}<header class="page-heading"><span class="eyebrow">DEEP SPACE RADIO</span><h1>${isSecond?'回聲井電台':'失聯隊電台'}</h1><p>等待使用局內時鐘，閱讀不會自動暫停，離頁返回仍按遊戲規則補算。</p></header>
      ${campaignJourneyPanel(state)}${isSecond?echoPanel(state):commsPanel(state)}<button class="btn secondary" type="button" data-open-page="base">返回基地總覽</button>`;
  }

  function pageMarkup(state) {
    const route = ensureRoute();
    let content;
    if (route.page === "map") content = mapPageMarkup(state);
    else if (route.page === "radio") content = radioPageMarkup(state);
    else if (route.page === "manage") content = managementPageMarkup(state);
    else if (route.page === "location") content = locationPageMarkup(state);
    else if (route.page === "story") content = storyPageMarkup(state);
    else if (route.page === "hero") content = heroPageMarkup(state);
    else if (route.page === "log") content = logPageMarkup(state);
    else content = campaignJourneyPanel(state) + basePageMarkup(state);
    return resultDetailMarkup(state) + content;
  }

  function mountGameShell(state) {
    app.innerHTML = `
      <div class="game-shell">
        <div id="hud-root" class="hud-root">${hudMarkup(state)}</div>
        <div id="alert-root" class="alert-root">${alertMarkup(state)}</div>
        <div id="page-root" class="page-root">${pageMarkup(state)}</div>
        <div id="nav-root">${navMarkup(state)}</div>
      </div>`;
    store.shellMounted = true;
    if (app && app.classList) app.classList.add("is-game");
    rememberChromeSigs(state);
    renderSheet();
    syncDockPadding();
  }

  function rememberChromeSigs(state) {
    const flags = Object.assign(chromeFlags(state), { hasError: !!store.error });
    const route = ensureRoute();
    store.pageSig = StoryUi ? StoryUi.pageSignature(route, state) : "";
    store.hudSig = StoryUi ? StoryUi.hudSignature(state, flags) : "";
    store.chromeStruct = StoryUi ? StoryUi.chromeStructureSignature(state, flags, route) : "";
    store.navSig = StoryUi ? StoryUi.navSignature(route) : "";
    store.hudCtrlSig = StoryUi ? StoryUi.hudControlSignature(state, flags) : "";
    store.alertSig = StoryUi ? StoryUi.alertStructureSignature(state, flags, route) : "";
    store.pageCtrlSig = StoryUi ? StoryUi.pageControlSignature(state, route, flags) : "";
  }

  function patchNavActive(route) {
    const nav = document.getElementById("nav-root");
    if (!nav) return;
    route = route || ensureRoute();
    nav.querySelectorAll("[data-nav-tab]").forEach((btn) => {
      const tab = btn.getAttribute("data-nav-tab");
      const on = tab === route.tab || (tab === "manage" && route.tab === "log");
      btn.classList.toggle("on", on);
      if (on) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
    const logButton = document.querySelector && document.querySelector('#hud-root [data-nav-tab="log"]');
    if (logButton) {
      logButton.classList.toggle("on", route.tab === "log");
      if (route.tab === "log") logButton.setAttribute("aria-current", "page");
      else logButton.removeAttribute("aria-current");
    }
    store.navSig = StoryUi ? StoryUi.navSignature(route) : store.navSig;
  }

  function patchHudControls(state) {
    const paused = !!(store.manualPaused && state.phase === "playing");
    const btn = document.getElementById("btn-pause") || document.getElementById("btn-resume");
    if (!btn) return;
    if (paused) {
      btn.id = "btn-resume";
      btn.textContent = "繼續";
      btn.disabled = false;
    } else {
      btn.id = "btn-pause";
      btn.textContent = "暫停";
      btn.disabled = state.phase !== "playing";
    }
    store.hudCtrlSig = StoryUi ? StoryUi.hudControlSignature(state, chromeFlags(state)) : store.hudCtrlSig;
  }

  function patchChromeText(state) {
    const you = state && state.you;
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    if (you) {
      setText("hud-time", fmtTime(state.match_time));
      setText("hud-rations", String(you.rations));
      setText("hud-alloy", String(you.alloy));
      setText("hud-standby", String(you.standby));
      setText("hud-population", String(currentPopulation(state)));
      setText("last-battle-summary", lastBattleSummary(state));
      setText("hud-patrols", String(you.patrols));
      setText("hud-wards", String(you.wards || 0));
      setText("hud-status", state.phase === "finished" ? "本局已結束" : (store.manualPaused ? "已手動暫停" : "對局進行中 · 離頁會補算"));
    }
    const entry = StoryUi ? StoryUi.exploreEntry(state, ensureRoute()) : null;
    if (entry && entry.visible) setText("explore-remain", fmtTime(entry.remain));
    if (state.comms && state.comms.remaining != null) setText("comms-countdown", fmtTime(state.comms.remaining));
    if (state.campaign && state.campaign.echo && state.campaign.echo.next_at!=null)
      setText('echo-countdown',fmtTime(Math.max(0,state.campaign.echo.next_at-state.now)));
    if (you && you.exploring) setText("explore-arrival-time", fmtTime(you.explore_remaining));
    if (you && you.recovering) setText("explore-recovery-time", fmtTime(you.recover_remaining));
    if (you && you.training) setText("training-time", fmtTime(you.training_remaining));
    if (you && you.recalling_active) setText("recall-time", fmtTime(you.recall_remaining));
    if (you && you.protection_remaining > 0) setText("protection-time", fmtTime(you.protection_remaining));
    const radioBadge = document.getElementById("nav-radio-badge");
    if (radioBadge) radioBadge.hidden = !(state.campaign && state.campaign.chapter===2
      ? state.campaign.echo && ['choice_one','choice_two','awaiting_confirmation'].includes(state.campaign.echo.stage)
      : state.comms && /^choice_/.test(state.comms.stage));
    const opp = state && state.opponent;
    const oppLine = document.getElementById("opp-line");
    if (oppLine && opp) {
      const oppProt = opp.protection_remaining > 0 ? `對方受襲保護 ${fmtTime(opp.protection_remaining)}` : "";
      oppLine.textContent = `對方：口糧 ${opp.rations}　合金 ${opp.alloy}　待命 ${opp.standby}　巡衛 ${opp.patrols}${opp.locked_patrols ? "（鎖 " + opp.locked_patrols + "）" : ""}　守陣 ${opp.wards || 0}${opp.locked_wards ? "（鎖 " + opp.locked_wards + "）" : ""}。${oppProt}`;
    }
  }

  function patchLiveChrome(state, opts) {
    opts = opts || {};
    const hud = document.getElementById("hud-root");
    const alerts = document.getElementById("alert-root");
    const page = document.getElementById("page-root");
    const nav = document.getElementById("nav-root");
    if (!hud || !alerts || !page || !nav) {
      mountGameShell(state);
      return { replacedChrome: true, rebuiltPage: true, replacedNav: true };
    }
    const flags = Object.assign(chromeFlags(state), {
      pointerDown: !!store.pointerDown,
      hasError: !!store.error
    });
    const route = ensureRoute();
    const plan = StoryUi.planChromePageUpdate({
      flags: flags,
      prevNavSig: store.navSig,
      nextNavSig: StoryUi.navSignature(route),
      prevHudCtrlSig: store.hudCtrlSig,
      nextHudCtrlSig: StoryUi.hudControlSignature(state, flags),
      prevAlertSig: store.alertSig,
      nextAlertSig: StoryUi.alertStructureSignature(state, flags, route),
      prevPageCtrlSig: store.pageCtrlSig,
      nextPageCtrlSig: StoryUi.pageControlSignature(state, route, flags),
      forceNav: !!opts.forceNav,
      forceHud: !!opts.forceHud || !!opts.forceChrome,
      forceAlerts: !!opts.forceAlerts || !!opts.forceChrome,
      forcePage: !!opts.forcePage,
      sameRoute: !!(store.pageSig && store.pageSig.split("|")[0] === (StoryUi.pageSignature(route, state) || "").split("|")[0]),
      resetScroll: !!opts.resetScroll
    });
    let replacedNav = false;
    let replacedHud = false;
    let replacedAlerts = false;
    if (plan.replaceNav) {
      if (opts.replaceNavHtml) {
        nav.innerHTML = navMarkup(state);
        replacedNav = true;
      } else {
        patchNavActive(route);
      }
    } else {
      patchNavActive(route);
    }
    if (plan.replaceHud) {
      if (opts.replaceHudHtml) {
        hud.innerHTML = hudMarkup(state);
        replacedHud = true;
      } else {
        patchHudControls(state);
        patchChromeText(state);
      }
    }
    if (plan.replaceAlerts) {
      alerts.innerHTML = alertMarkup(state);
      replacedAlerts = true;
    }
    patchChromeText(state);
    patchHudControls(state);
    const nextPage = StoryUi.pageSignature(route, state);
    const sameRoute = store.pageSig && store.pageSig.split("|")[0] === nextPage.split("|")[0];
    let rebuiltPage = false;
    if (plan.rebuildPage) {
      const y = page.scrollTop;
      const openDetails = sameRoute ? Array.from(page.querySelectorAll("details[id]")).filter((el) => el.open).map((el) => el.id) : [];
      const focused = document.activeElement;
      // Restore focus after a structural page update, not a timer/text-only tick.
      // Include existing campaign/comms/echo actions and scope the two possible
      // data-campaign-next buttons to the panel that actually held focus.
      const focusAttrs = ["data-assign", "data-assign-delta", "data-build", "data-upgrade", "data-train", "data-manage-section", "data-guide-skip", "data-campaign-next", "data-campaign-confirm-ch1", "data-campaign-confirm-ch2", "data-comms-choice", "data-echo-choice", "data-story-choice", "data-story-select-hero", "data-story-hero-back", "data-open-hero", "data-open-location", "data-open-story", "data-show-result", "data-nav-back", "data-open-page"];
      const focusScope = focused && focused.closest
        ? (focused.closest("#full-final-result") ? "#full-final-result " :
           focused.closest("#campaign-journey") ? "#campaign-journey " : "") : "";
      const focusSelector = sameRoute && focused && page.contains(focused)
        ? focusScope + focusAttrs.filter((attr) => focused.hasAttribute(attr)).map((attr) => `[${attr}="${focused.getAttribute(attr)}"]`).join("") : "";
      page.innerHTML = pageMarkup(state);
      openDetails.forEach((id) => { const el = document.getElementById(id); if (el) el.open = true; });
      if (focusSelector) { const replacement = page.querySelector(focusSelector); if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true }); }
      if (store.pendingScrollRestore != null) {
        page.scrollTop = store.pendingScrollRestore;
        store.pendingScrollRestore = null;
      } else if (sameRoute && !opts.resetScroll) page.scrollTop = y;
      else page.scrollTop = 0;
      rebuiltPage = true;
    }
    rememberChromeSigs(state);
    if (rebuiltPage && sameRoute && !opts.resetScroll) {
      /* rememberChromeSigs does not touch scroll */
    }
    renderSheet();
    return {
      replacedChrome: replacedHud || replacedAlerts || replacedNav,
      replacedNav: replacedNav,
      replacedHud: replacedHud,
      replacedAlerts: replacedAlerts,
      rebuiltPage: rebuiltPage
    };
  }


  function renderGame(opts) {
    opts = opts || {};
    const state = stateNow();
    if (!state) {
      store.screen = "menu";
      store.shellMounted = false;
      renderMenu();
      return;
    }
    ensureRoute();
    if (opts.full || !store.shellMounted || !app.querySelector(".game-shell")) {
      mountGameShell(state);
      return;
    }
    patchLiveChrome(state, {
      forceChrome: !!opts.forceChrome,
      forcePage: !!opts.forcePage,
      forceNav: !!opts.forceNav,
      forceHud: !!opts.forceHud,
      forceAlerts: !!opts.forceAlerts,
      replaceNavHtml: !!opts.replaceNavHtml,
      replaceHudHtml: !!opts.replaceHudHtml || !!opts.forceChrome,
      resetScroll: !!opts.resetScroll
    });
  }

  function render() {
    if (store.screen !== "game" || !store.match) renderMenu();
    else renderGame({ full: !store.shellMounted, forceChrome: true, forcePage: true });
  }

  function sheetMarkup() {
    const sheet = store.sheet;
    if (!sheet) return "";
    const err = store.error ? `<p class="err" id="sheet-err" role="alert">${escapeHtml(store.error)}</p>` : `<p class="err" id="sheet-err" role="alert"></p>`;
    if (sheet.kind === "choice") {
      const ev = sheet.event || {};
      const remain = sheet.remain != null ? fmtTime(sheet.remain) : "";
      const canB = !!sheet.can_pick_b;
      return `
        <div class="sheet" id="sheet">
          <div class="card">
            <h2>${escapeHtml(ev.title || "探索抉擇")}</h2>
            <p class="desc">${escapeHtml(ev.text || "")}</p>
            <p class="assign-status" id="choice-remain">尚餘 ${remain}，逾時自動走穩妥路線。</p>
            ${err}
            <button class="btn" id="choice-a" type="button">${escapeHtml((ev.optionA && ev.optionA.label) || "穩妥")}：${escapeHtml((ev.optionA && ev.optionA.detail) || "")}</button>
            <button class="btn secondary" id="choice-b" type="button" ${canB ? "" : "disabled"}>${escapeHtml((ev.optionB && ev.optionB.label) || "冒險")}：${escapeHtml((ev.optionB && ev.optionB.detail) || "")}</button>
            ${canB ? "" : `<p class="assign-hint muted">條件唔夠，只能選穩妥路線。</p>`}
            <button class="btn secondary" id="sheet-cancel" type="button">稍後再揀（介面入口仍在）</button>
          </div>
        </div>`;
    }
    if (sheet.kind === 'comms' || sheet.kind === 'echo') {
      const before = stateNow() && stateNow().you ? stateNow().you.alloy : 0;
      const after = before - sheet.cost_alloy;
      return `<div class="sheet" id="sheet"><div class="card">
        <h2>${sheet.kind==='echo'?'確認回聲井選擇':'確認失聯隊通訊回覆'}</h2><p class="assign-status">${escapeHtml(sheet.label)}</p>
        <p class="desc">選擇會影響後續對白或收束；確認後不可撤回。使用的是本局遊戲合金，無真實付款，完整故事可免費走完。</p>
        <div class="alloy-preview"><span>目前合金 <strong>${before}</strong></span><span aria-hidden="true">→</span><span>確認後 <strong>${after}</strong></span></div>
        ${sheet.cost_alloy && before < sheet.cost_alloy ? '<p class="assign-hint">合金不足，可返回選擇免費回覆。</p>' : ''}
        ${err}<button class="btn" id="sheet-ok" type="button" ${before < sheet.cost_alloy?'disabled':''}>確認回覆</button>
        <button class="btn secondary" id="sheet-cancel" type="button">返回電台</button>
      </div></div>`;
    }
    if (sheet.kind === "story") {
      const costLine = sheet.cost_alloy > 0
        ? `<p class="cost-note">此選擇將消耗${sheet.cost_alloy}合金。這是遊戲內資源，不是付款或購買。</p>`
        : `<p class="desc">此選擇不消耗口糧或合金，但仍會永久改變故事方向。</p>`;
      const currentAlloy = stateNow() && stateNow().you ? stateNow().you.alloy : 0;
      const afterAlloy = currentAlloy - (sheet.cost_alloy || 0);
      const alloyPreview = `<div class="alloy-preview" aria-label="合金扣費預覽"><span>目前合金 <strong id="story-alloy-before">${currentAlloy}</strong></span><span aria-hidden="true">→</span><span>確認後 <strong id="story-alloy-after">${afterAlloy}</strong></span></div>`;
      const stance = sheet.stance_change
        ? `<p class="assign-hint">改變立場後，原英雄的專屬解析機會將永久放棄。</p>`
        : "";
      return `
        <div class="sheet" id="sheet">
          <div class="card">
            <h2>確認故事選擇</h2>
            <p class="assign-status">${escapeHtml(sheet.label || "")}</p>
            <p class="desc">此選擇不可逆。確認後不能用重試、連按或重新載入撤回旗標或重複扣資源。</p>
            ${costLine}
            ${alloyPreview}
            ${stance}
            ${err}
            <button class="btn" id="sheet-ok" type="button">確認提交</button>
            <button class="btn secondary" id="sheet-cancel" type="button">返回再想</button>
          </div>
        </div>`;
    }
    if (sheet.kind === "raid") {
      const submitOn = sheet.submitEnabled !== false && (sheet.patrol || 0) >= 1;
      return `
        <div class="sheet" id="sheet">
          <div class="card">
            <h2>出征構成</h2>
            <p class="desc">至少派出 1 名有攻勢嘅巡衛。守陣可一齊去但無攻勢，唔能單獨偷空城。對方守軍會按開戰當刻全部鎖定。</p>
            <p class="assign-status">可出征：巡衛 ${sheet.patrolMax || 0}　守陣 ${sheet.wardMax || 0}</p>
            ${err}
            <div class="stepper raid-stepper">
              <span class="step-label">巡衛</span>
              <button class="btn small" id="raid-patrol-minus" type="button" ${ (sheet.patrol || 0) <= 0 ? "disabled" : "" } aria-label="減少巡衛">－</button>
              <span id="raid-patrol-val">${sheet.patrol || 0}</span>
              <button class="btn small" id="raid-patrol-plus" type="button" ${ (sheet.patrol || 0) >= (sheet.patrolMax || 0) ? "disabled" : "" } aria-label="增加巡衛">＋</button>
            </div>
            <div class="stepper raid-stepper">
              <span class="step-label">守陣</span>
              <button class="btn small" id="raid-ward-minus" type="button" ${ (sheet.ward || 0) <= 0 ? "disabled" : "" } aria-label="減少守陣">－</button>
              <span id="raid-ward-val">${sheet.ward || 0}</span>
              <button class="btn small" id="raid-ward-plus" type="button" ${ (sheet.ward || 0) >= (sheet.wardMax || 0) ? "disabled" : "" } aria-label="增加守陣">＋</button>
            </div>
            <button class="btn warn" id="sheet-ok" type="button" ${submitOn ? "" : "disabled"}>確認出征</button>
            <button class="btn secondary" id="sheet-cancel" type="button">取消</button>
          </div>
        </div>`;
    }
    const unitName = sheet.unit === "ward" ? "守陣" : "巡衛";
    const title = "遣返" + unitName + "人數";
    const desc = "只可遣返未被鎖定嘅" + unitName + "，30 秒後變回船員，不退回口糧或合金。";
    return `
      <div class="sheet" id="sheet">
        <div class="card">
          <h2>${title}</h2>
          <p class="desc">${desc}</p>
          ${err}
          <div class="stepper">
            <button class="btn small" id="sheet-minus" type="button">－</button>
            <span id="sheet-val">${sheet.value}</span>
            <button class="btn small" id="sheet-plus" type="button">＋</button>
          </div>
          <button class="btn warn" id="sheet-ok" type="button" ${sheet.submitEnabled === false ? "disabled" : ""}>確認遣返</button>
          <button class="btn secondary" id="sheet-cancel" type="button">取消</button>
        </div>
      </div>`;
  }

  function unmountSheet() {
    sheetRoot.innerHTML = "";
    sheetMounted = false;
  }

  function patchSheetValue() {
    const el = document.getElementById("sheet-val");
    if (el && store.sheet) el.textContent = String(store.sheet.value);
    const rp = document.getElementById("raid-patrol-val");
    if (rp && store.sheet) rp.textContent = String(store.sheet.patrol || 0);
    const rw = document.getElementById("raid-ward-val");
    if (rw && store.sheet) rw.textContent = String(store.sheet.ward || 0);
    if (store.sheet && store.sheet.kind === "story") {
      const st = stateNow();
      const alloy = st && st.you ? st.you.alloy : 0;
      const before = document.getElementById("story-alloy-before");
      const after = document.getElementById("story-alloy-after");
      if (before) before.textContent = String(alloy);
      if (after) after.textContent = String(alloy - (store.sheet.cost_alloy || 0));
    }
    const err = document.getElementById("sheet-err");
    if (err) err.textContent = store.error || "";
    const remain = document.getElementById("choice-remain");
    if (remain && store.sheet && store.sheet.kind === "choice") {
      remain.textContent = "尚餘 " + fmtTime(store.sheet.remain || 0) + "，逾時自動走穩妥路線。";
    }
  }

  function renderSheet() {
    if (!store.sheet) {
      if (sheetMounted) unmountSheet();
      return;
    }
    if (!sheetMounted) {
      sheetRoot.innerHTML = sheetMarkup();
      sheetMounted = true;
      return;
    }
    patchSheetValue();
  }

  function openSheet(kind, max, extra) {
    extra = extra || {};
    const st = stateNow();
    const flags = assignFlags(st);
    let opened;
    if (kind === "choice") {
      opened = UiSync.openChoiceSheet(st && st.you, flags);
    } else if (kind === "raid") {
      opened = UiSync.openRaidSheet(st && st.you, st && st.raid, flags);
    } else {
      opened = UiSync.openRecallSheet(st && st.you, extra.unit || "patrol", flags);
    }
    if (!opened || !opened.ok) {
      showError((opened && opened.reason) || (kind === "raid" ? "至少要有 1 名可出征巡衛。守陣無攻勢唔能出征。" : (kind === "choice" ? "而家冇待抉擇嘅探索事件。" : "沒有可遣返嘅呢種兵力。")));
      render();
      return;
    }
    clearError();
    store.sheet = opened.sheet;
    sheetMounted = false;
    renderSheet();
    syncDockPadding();
  }

  function syncDockPadding() {
    if (app.classList && app.classList.contains("is-game")) {
      app.style.setProperty("--dock-space", "0px");
      return;
    }
    const dock = app.querySelector(".bottom-nav") || app.querySelector(".dock") || app.querySelector(".raid-dock");
    const h = dock ? dock.getBoundingClientRect().height : 0;
    app.style.setProperty("--dock-space", Math.max(0, Math.ceil(h || 72)) + "px");
  }

  function sendCommand(payload, opts) {
    const keepSheet = opts && opts.keepSheet;
    if (!store.match) return false;
    if (store.busy) {
      showError("上一個指令仲處理緊，請稍後再試。");
      return false;
    }
    if (store.mode === 'campaign' && store.campaignConflict) {
      showError('旅程已在其他分頁更新；本頁只讀，請重新載入。');
      return false;
    }
    if (store.clock && store.clock.paused && !(store.mode === 'campaign' && store.match.phase === 'finished' &&
        ['campaign_confirm_ch1','campaign_confirm_ch2'].includes(payload.type))) {
      showError("計時已暫停，請先按繼續。");
      return false;
    }
    store.busy = true;
    const transactional = store.mode === 'campaign' || payload.type === "story_choice" || payload.type === "comms_choice" || payload.type === "guide_skip";
    let checkpoint = null;
    let campaignBackup = null;
    try {
      if (!payload.command_id) payload.command_id = cmdId();
      if (transactional) {
        checkpoint = UiSync.captureCommandCheckpoint(store.match, store.ai, buildPersistExtra());
        if (store.mode === 'campaign') campaignBackup = Campaign.copy(store.match.campaign_state);
      }
      store.match.command(C.HUMAN_ID, payload);
      if (store.ai && store.match.phase === 'playing') store.ai.consider(store.match);
      const saved = persist("command");
      if (!saved || !saved.ok) {
        if (checkpoint) {
          store.match = UiSync.restoreCommandCheckpoint(Engine, store.clock, checkpoint, store.ai);
          if (campaignBackup) Campaign.attach(store.match, campaignBackup);
        }
        if (!keepSheet) render();
        else renderGame({ forceChrome: true, forcePage: true });
        return false;
      }
      clearError();
      if (!keepSheet) render();
      return true;
    } catch (err) {
      if (checkpoint) {
        store.match = UiSync.restoreCommandCheckpoint(Engine, store.clock, checkpoint, store.ai);
        if (campaignBackup) Campaign.attach(store.match, campaignBackup);
      }
      showError(err.message || "指令失敗。");
      if (!keepSheet) render();
      return false;
    } finally {
      store.busy = false;
    }
  }

  function confirmSheet() {
    if (!store.sheet) return;
    const submitted = store.sheet;
    const kind = store.sheet.kind;
    if (kind === "choice") return;
    const st = stateNow();
    const flags = assignFlags(st);
    if (kind === 'echo') {
      const e=st&&st.campaign&&st.campaign.echo;
      if (!e||e.stage!==submitted.stage||st.phase!=='playing'||flags.paused) {
        showError('回聲井狀態已更新，請重新查看。');store.sheet=null;unmountSheet();render();return;
      }
      const ok=sendCommand({type:'echo_choice',choice_id:submitted.choice_id},{keepSheet:true});
      if (store.sheet!==submitted) return;
      if (ok) {store.sheet=null;unmountSheet();renderGame({forcePage:true});} else renderSheet();
      return;
    }
    if (kind === 'comms') {
      const c = st && st.comms;
      const expected = submitted.stage;
      if (!c || c.stage !== expected || st.phase !== 'playing' || flags.paused) {
        showError('通訊階段已更新，請返回電台查看。');
        store.sheet = null; unmountSheet(); render(); return;
      }
      const success = sendCommand({type:'comms_choice',choice_id:submitted.choice_id},{keepSheet:true});
      if (store.sheet !== submitted) return;
      if (success) { store.sheet=null; unmountSheet(); renderGame({forcePage:true}); }
      else renderSheet();
      return;
    }
    if (kind === "story") {
      const resolved = StoryUi.storySubmit(store.sheet, st, flags);
      if (!resolved.ok) {
        showError(resolved.reason || "唔能提交呢個故事選擇。");
        if (resolved.close || resolved.finished) {
          store.sheet = null;
          unmountSheet();
          renderGame({ forceChrome: true, forcePage: true });
          return;
        }
        renderSheet();
        return;
      }
      const ok = sendCommand(resolved.payload, { keepSheet: true });
      if (store.sheet !== submitted) return;
      if (ok) {
        store.sheet = null;
        unmountSheet();
        renderGame({ forceChrome: true, forcePage: true });
      } else {
        renderSheet();
      }
      return;
    }
    const resolved = kind === "recall"
      ? UiSync.recallSubmit(store.sheet, st && st.you, st, flags)
      : UiSync.raidSubmit(store.sheet, st && st.you, st, flags);
    if (!resolved.ok) {
      showError(resolved.reason || "指令失敗。");
      if (resolved.close) {
        store.sheet = null;
        unmountSheet();
        render();
        return;
      }
      if (st) {
        const synced = UiSync.syncSheet(store.sheet, st, flags);
        store.sheet = synced.sheet;
      }
      sheetMounted = false;
      renderSheet();
      return;
    }
    const ok = sendCommand(resolved.payload, { keepSheet: true });
    if (store.sheet !== submitted) return;
    if (ok) {
      store.sheet = null;
      unmountSheet();
      render();
    } else if (!sheetMounted) {
      sheetRoot.innerHTML = sheetMarkup();
      sheetMounted = true;
    } else {
      patchSheetValue();
    }
  }

  function confirmNewGame() {
    const loaded = Save.load(localStorage);
    const has = loaded.raw != null && loaded.raw !== "";
    if (!has) {
      startNewGame();
      return;
    }
    // 確認期間安全凍結；唔開新局、唔刪原檔。確認開檔只把同一場錨點清掉以免中斷後把確認時間補回；取消後立即寫新錨點。
    store.confirming = true;
    persist("confirm-open");
    const settle = UiSync.runRestartConfirm(store.clock, function () {
      return window.confirm("確定重新開始？確認後會用新對局覆蓋呢個瀏覽器嘅單機存檔。損壞嘅原存檔亦只會喺你確認後先被覆蓋。");
    });
    store.confirming = false;
    if (settle.startNew) {
      startNewGame();
      return;
    }
    store.detached = false;
    persist("confirm-cancel");
    if (store.screen === "game") render();
  }

  function startNewGame() {
    clearError();
    store.mode = 'legacy';store.campaignConflict=false;
    const clockOpts = (typeof window !== "undefined" && window.__STARFALL_SOLO_APP_OPTS__ && window.__STARFALL_SOLO_APP_OPTS__.clockOpts) || {};
    store.clock = new Engine.ForegroundClock(0, clockOpts);
    store.match = Engine.createSoloMatch(store.clock, 0);
    store.ai = new AI.SoloAI();
    store.ai.consider(store.match);
    store.screen = "game";
    store.manualPaused = false;
    store.detached = false;
    store.pausedNotice = false;
    store.sheet = null;
    store.route = StoryUi ? StoryUi.defaultRoute() : { tab: "base", page: "base" };
    store.shellMounted = false;
    store.pageSig = "";
    store.hudSig = "";
    unmountSheet();
    store.clock.resume();
    persist("new");
    render();
  }

  function continueSave() {
    clearError();
    store.mode = 'legacy';store.campaignConflict=false;
    const loaded = Save.load(localStorage);
    if (!loaded.ok) {
      store.loadError = loaded.error;
      showError(loaded.error);
      store.screen = "menu";
      renderMenu();
      return;
    }
    if (loaded.empty) {
      showError("未有可繼續嘅存檔。");
      renderMenu();
      return;
    }
    store.clock = new Engine.ForegroundClock(loaded.data.clock);
    store.match = Engine.restoreMatch(loaded.data, store.clock);
    store.ai = new AI.SoloAI();
    store.ai.restore(loaded.data.ai);
    store.screen = "game";
    store.manualPaused = !!loaded.data.manual_paused;
    store.lastWallAnchor = loaded.data.wall_anchor != null ? loaded.data.wall_anchor : null;
    store.sheet = null;
    store.route = StoryUi ? StoryUi.normalizeRoute(loaded.data.ui_route || StoryUi.defaultRoute()) : { tab: "base", page: "base" };
    store.shellMounted = false;
    store.pageSig = "";
    store.hudSig = "";
    unmountSheet();
    if (store.match.phase !== "playing") {
      store.pausedNotice = false;
      if (store.clock.pause) store.clock.pause();
      render();
      return;
    }
    if (store.manualPaused) {
      store.pausedNotice = true;
      render();
      return;
    }
    applyReturnCatchup(loaded.data.wall_anchor);
    render();
  }

  function campaignClock(start) {
    const opts=(typeof window!=='undefined' && window.__STARFALL_SOLO_APP_OPTS__ && window.__STARFALL_SOLO_APP_OPTS__.clockOpts)||{};
    return new Engine.ForegroundClock(start,opts);
  }
  function campaignReady(match, clock, revision, raw, anchor, paused, aiSnapshot, route) {
    store.mode='campaign';store.campaignRaw=raw;store.campaignRevision=revision;
    store.campaignConflict=false;store.match=match;store.clock=clock;
    store.ai=new AI.SoloAI();
    if (aiSnapshot) store.ai.restore(aiSnapshot);
    else store.ai.consider(match);
    store.screen='game';store.manualPaused=!!paused;store.lastWallAnchor=anchor==null?null:anchor;
    store.detached=false;store.pausedNotice=!!paused;store.sheet=null;
    store.route=StoryUi?StoryUi.normalizeRoute(route||StoryUi.defaultRoute()):{tab:'base',page:'base'};
    store.shellMounted=false;store.pageSig='';store.hudSig='';
    unmountSheet();
    if (match.phase==='playing'&&!paused) clock.resume();
  }
  function startNewCampaign(fromLegacy) {
    if (!Campaign) {showError('旅程模組未載入。');renderMenu();return;}
    const existing=Campaign.load(localStorage,Save,Engine);
    if (!existing.ok) {showError(existing.error);renderMenu();return;}
    if (!existing.empty) {showError('已存在持續旅程。為免覆蓋進度，請按「繼續持續旅程」，或先自行備份並清理旅程鍵。');renderMenu();return;}
    const clock=campaignClock(0), match=Engine.createSoloMatch(clock,0);
    const camp=Campaign.newState(match);
    if (fromLegacy) {
      const old=Save.load(localStorage);
      if (!old.ok || old.empty) {showError('沒有可驗證的舊單局存檔；可直接開始全新旅程。');renderMenu();return;}
      const legacy=old.data;
      // Save.load() 會為舊單局補預設欄位；只有原 raw 實際存在的欄位才可當作已記歷史。
      const original=JSON.parse(old.raw);
      const recordedStory=Object.prototype.hasOwnProperty.call(original,'story_schema')&&
        Object.prototype.hasOwnProperty.call(original,'story')&&original.story_schema===1;
      const recordedComms=Object.prototype.hasOwnProperty.call(original,'comms_schema')&&
        Object.prototype.hasOwnProperty.call(original,'comms')&&original.comms_schema===1;
      if (recordedStory && legacy.story && legacy.story.chapter_status!=='unavailable' &&
          legacy.story.ending_variant!=='forced' && !legacy.story.legacy_finished_unstarted) camp.story=Campaign.copy(legacy.story);
      else camp.history_unknown=true;
      if (recordedComms && legacy.comms && !['unavailable','forced'].includes(legacy.comms.stage)) {
        camp.comms=Campaign.copy(legacy.comms);
        if (camp.comms.next_at!=null) camp.comms.next_at=Math.max(0,camp.comms.next_at-legacy.clock);
      } else camp.history_unknown=true;
      if (!recordedStory || !legacy.story.flags || !legacy.story.flags.initial_trust) camp.history_unknown=true;
      if (!recordedComms || !legacy.comms.decisions || !legacy.comms.decisions.length) camp.history_unknown=true;
    }
    Campaign.attach(match,camp);
    campaignReady(match,clock,0,null,null,false,null,null);
    const saved=persist('campaign-new');
    if (!saved.ok) {store.mode='legacy';store.screen='menu';store.match=null;renderMenu();return;}
    store.clock.resume();render();
  }
  function continueCampaign() {
    if (!Campaign) return;
    const loaded=Campaign.load(localStorage,Save,Engine);
    if (!loaded.ok || loaded.empty) {showError(loaded.error||'尚未建立持續旅程。');renderMenu();return;}
    const other=loaded.data.owner;
    if (other.token!==campaignOwner() && other.expires>wallNow()) {
      showError('另一分頁正在操作這份旅程。為保護進度，暫不允許寫入；請返回原分頁，或等原分頁關閉且鎖定逾時後再載入。');renderMenu();return;
    }
    const snap=loaded.data.run,clock=campaignClock(snap.clock);
    const match=Campaign.restore(loaded.data,Engine,clock);
    campaignReady(match,clock,loaded.data.revision,loaded.raw,snap.wall_anchor,!!snap.manual_paused,snap.ai,snap.ui_route);
    if (match.phase==='playing'&&!store.manualPaused) applyReturnCatchup(snap.wall_anchor);
    render();
  }
  function startNextCampaignRun() {
    if (store.mode!=='campaign'||!store.match||store.campaignConflict) return;
    if (store.match.phase!=='finished') {showError('請先完成這一局基地行動。');renderGame({forceAlerts:true});return;}
    const old=store.match,oldClock=store.clock,oldAi=store.ai,oldRev=store.campaignRevision;
    try {
      const clock=campaignClock(0), next=Campaign.freshRun(old,clock,Engine);
      const ai=new AI.SoloAI();ai.consider(next);
      store.match=next;store.clock=clock;store.ai=ai;store.manualPaused=false;store.lastWallAnchor=null;
      store.route=StoryUi.defaultRoute();store.storySelectedHero=null;
      const saved=persist('campaign-next-run');
      if (!saved.ok) throw new Error('續局保存失敗，未開始新的Run。');
      store.shellMounted=false;store.sheet=null;unmountSheet();clock.resume();render();
    } catch(e) {
      store.match=old;store.clock=oldClock;store.ai=oldAi;store.campaignRevision=oldRev;
      showError(e.message||'下一局啟動失敗。');render();
    }
  }
  function campaignStorageConflict() {
    if (store.mode==='campaign'&&!store.campaignConflict) {
      try { if (localStorage.getItem(Campaign.KEY)!==store.campaignRaw) {
        store.campaignConflict=true;
        showError('偵測到另一分頁已寫入較新旅程；本頁停止提交，請重新載入。');
        return true;
      }} catch(e) {showError('無法確認旅程存檔，請檢查瀏覽器儲存空間。');return true;}
    }
    return store.campaignConflict;
  }

  function bindEventsOnce() {
    if (eventsBound) return;
    eventsBound = true;
    document.addEventListener("pointerdown", () => { store.pointerDown = true; }, true);
    document.addEventListener("pointerup", () => { store.pointerDown = false; }, true);
    document.addEventListener("pointercancel", () => { store.pointerDown = false; }, true);

    app.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn || !app.contains(btn)) return;
      if (btn.id === "btn-new" || btn.id === "btn-new-ingame") { confirmNewGame(); return; }
      if (btn.id === 'btn-campaign-continue') { continueCampaign();return; }
      if (btn.id === 'btn-campaign-new') { startNewCampaign(false);return; }
      if (btn.id === 'btn-campaign-import') { startNewCampaign(true);return; }
      if (btn.dataset.campaignNext) { startNextCampaignRun();return; }
      if (btn.dataset.campaignConfirmCh1) { sendCommand({type:'campaign_confirm_ch1'});return; }
      if (btn.dataset.campaignConfirmCh2) { sendCommand({type:'campaign_confirm_ch2'});return; }
      if (btn.id === "btn-continue") { continueSave(); return; }
      if (btn.id === "btn-menu") {
        detachClockKeepRunning();
        store.screen = "menu";
        store.sheet = null;
        unmountSheet();
        renderMenu();
        return;
      }
      if (btn.id === "btn-pause") { pauseGame("manual"); renderGame({ forceHud: true, forceAlerts: true, forceNav: false, forcePage: false }); return; }
      if (btn.id === "btn-resume") { resumeGame(); renderGame({ forceHud: true, forceAlerts: true, forceNav: false, forcePage: false }); return; }
      if (btn.dataset.openComms) {
        goRoute({type:'tab',tab:'radio'});
        renderGame({forcePage:true,forceAlerts:true,resetScroll:true});
        return;
      }
      if (btn.dataset.openPage) {
        goRoute({ type: "tab", tab: btn.dataset.openPage });
        renderGame({ forcePage: true, forceAlerts: true, resetScroll: true });
        return;
      }
      if (btn.dataset.openManage || btn.dataset.manageSection) {
        const section = btn.dataset.openManage || btn.dataset.manageSection;
        goRoute({ type: section === "records" ? "open-records" : (btn.dataset.openManage ? "open-manage" : "manage-section"), section: section });
        renderGame({ forcePage: true, forceAlerts: true, resetScroll: true });
        return;
      }
      if (btn.dataset.navTab) {
        goRoute({ type: btn.dataset.navTab === "base" ? "return-base" : "tab", tab: btn.dataset.navTab });
        renderGame({ forcePage: true, forceNav: false, forceHud: false, forceAlerts: true, resetScroll: true });
        return;
      }
      if (btn.dataset.navBack) {
        goRoute({ type: "back" });
        renderGame({ forcePage: true, forceNav: false, forceHud: false, forceAlerts: true, resetScroll: true });
        return;
      }
      if (btn.dataset.openLocation) {
        goRoute({ type: "open-location", locId: btn.dataset.openLocation });
        renderGame({ forcePage: true, resetScroll: true });
        return;
      }
      if (btn.dataset.openStory) {
        goRoute({ type: "open-story", nodeId: btn.dataset.openStory });
        renderGame({ forcePage: true, resetScroll: true });
        return;
      }
      if (btn.dataset.openHero) {
        goRoute({ type: "open-hero", heroId: btn.dataset.openHero });
        renderGame({ forcePage: true, resetScroll: true });
        return;
      }
      if (btn.dataset.returnExplore) {
        goRoute({ type: "return-base" });
        renderGame({ forcePage: true, forceChrome: true, resetScroll: true });
        openSheet("choice");
        return;
      }
      if (btn.dataset.echoChoice) {
        const st=stateNow(),id=btn.dataset.echoChoice,e=st&&st.campaign&&st.campaign.echo;
        if (!e||st.phase!=='playing'||store.manualPaused||store.campaignConflict) return;
        if (!((e.stage==='choice_one'&&['ECHO-MARK','ECHO-ASSIST'].includes(id)) ||
              (e.stage==='choice_two'&&['ECHO-OPEN','ECHO-SEAL'].includes(id)))) return;
        const cost=id==='ECHO-ASSIST'?2:0;
        store.sheet={kind:'echo',stage:e.stage,choice_id:id,cost_alloy:cost,
          label:({'ECHO-MARK':'免費標記回聲源','ECHO-ASSIST':'修復接收片接應（核證線索）','ECHO-OPEN':'公開可核對回聲','ECHO-SEAL':'內部封存回聲'})[id]};
        sheetMounted=false;renderSheet();return;
      }
      if (btn.dataset.commsChoice) {
        const id = btn.dataset.commsChoice;
        const st = stateNow();
        const c = st && st.comms;
        if (!c || st.phase !== 'playing' || store.manualPaused) return;
        const valid = (c.stage === 'choice_one' && (id === 'COMMS-RIDGE' || id === 'COMMS-QUIET')) ||
          (c.stage === 'choice_two' && (id === 'COMMS-FREE' || id === 'COMMS-BOOST'));
        if (!valid) return;
        store.sheet = {kind:'comms',stage:c.stage,choice_id:id,cost_alloy:id==='COMMS-BOOST'?2:0,
          label: ({'COMMS-RIDGE':'引導小隊走碎石脊','COMMS-QUIET':'讓小隊躲進裂谷','COMMS-FREE':'以低功率免費回覆','COMMS-BOOST':'耗2合金修復增幅片'})[id]};
        sheetMounted=false; renderSheet(); return;
      }
      if (btn.dataset.guideSkip) { sendCommand({type:'guide_skip',task:btn.dataset.guideSkip}); return; }
      if (btn.dataset.storySelectHero) {
        if (!StoryUi.Data.HEROES[btn.dataset.storySelectHero]) return;
        store.storySelectedHero = btn.dataset.storySelectHero;
        renderGame({ forcePage: true });
        return;
      }
      if (btn.dataset.storyHeroBack) {
        store.storySelectedHero = null;
        renderGame({ forcePage: true });
        return;
      }
      if (btn.dataset.showResult) {
        const page = document.getElementById("page-root");
        if (page) { page.scrollTop = 0; const result = document.getElementById("full-final-result"); if (result) result.focus({ preventScroll: true }); }
        return;
      }
      if (btn.dataset.storyChoice) {
        const st = stateNow();
        const models = StoryUi.choiceModels(st);
        const choice = models.filter((c) => c.id === btn.dataset.storyChoice)[0];
        const opened = StoryUi.openStoryConfirm(choice, st && st.story, assignFlags(st), st && st.you ? st.you.alloy : 0);
        if (!opened.ok) {
          showError(opened.reason || "唔能確認呢個選項。");
          renderGame({ forceChrome: true });
          return;
        }
        clearError();
        store.sheet = opened.sheet;
        sheetMounted = false;
        renderSheet();
        return;
      }
      if (btn.dataset.assign) {
        const st = stateNow();
        const delta = btn.dataset.assignDelta != null ? Number(btn.dataset.assignDelta) : NaN;
        if (!st || !st.you) return;
        const resolved = UiSync.resolveRelativeAssign(st.you, btn.dataset.assign, delta, assignFlags(st));
        if (!resolved.ok) {
          showError(resolved.reason);
          render();
          return;
        }
        sendCommand(resolved.payload);
        return;
      }
      if (btn.dataset.build) {
        sendCommand({ type: "build", facility: btn.dataset.build });
        return;
      }
      if (btn.dataset.train) {
        sendCommand({ type: "train", unit: btn.dataset.train === "ward" ? "ward" : "patrol" });
        return;
      }
      if (btn.dataset.upgrade) {
        sendCommand({ type: "upgrade", facility: btn.dataset.upgrade });
        return;
      }
      if (btn.dataset.explore) {
        sendCommand({ type: "explore" });
        return;
      }
      if (btn.dataset.openChoice) {
        openSheet("choice");
        return;
      }
      if (btn.dataset.openRecall) {
        const st = stateNow();
        const unit = btn.dataset.openRecall === "ward" ? "ward" : "patrol";
        const max = st && st.you ? (unit === "ward" ? st.you.wards : st.you.patrols) : 0;
        openSheet("recall", max, { unit: unit });
        return;
      }
      if (btn.id === "btn-raid") {
        openSheet("raid");
      }
    });

    sheetRoot.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn || !store.sheet) return;
      if (btn.id === "raid-patrol-minus" || btn.id === "raid-patrol-plus" || btn.id === "raid-ward-minus" || btn.id === "raid-ward-plus") {
        const unit = (btn.id.indexOf("ward") !== -1) ? "ward" : "patrol";
        const delta = (btn.id.indexOf("plus") !== -1) ? 1 : -1;
        store.sheet = UiSync.adjustRaidSheet(store.sheet, unit, delta);
        sheetMounted = false;
        renderSheet();
        return;
      }
      if (btn.id === "sheet-minus") {
        store.sheet.value = Math.max(1, store.sheet.value - 1);
        patchSheetValue();
        return;
      }
      if (btn.id === "sheet-plus") {
        store.sheet.value = Math.min(store.sheet.max, store.sheet.value + 1);
        patchSheetValue();
        return;
      }
      if (btn.id === "choice-a" || btn.id === "choice-b") {
        const option = btn.id === "choice-b" ? "B" : "A";
        const submitted = store.sheet;
        const st = stateNow();
        const resolved = UiSync.choiceSubmit(st && st.you, option, assignFlags(st));
        if (!resolved.ok) {
          showError(resolved.reason || "唔能再選擇。");
          if (resolved.close) {
            store.sheet = null;
            unmountSheet();
            render();
          } else {
            patchSheetValue();
          }
          return;
        }
        const ok = sendCommand(resolved.payload, { keepSheet: true });
        if (store.sheet !== submitted) return;
        if (ok) {
          store.sheet = null;
          unmountSheet();
          render();
        } else {
          patchSheetValue();
        }
        return;
      }
      if (btn.id === "sheet-ok") { confirmSheet(); return; }
      if (btn.id === "sheet-cancel") {
        store.sheet = null;
        clearError();
        unmountSheet();
        render();
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        if (store.screen === "game") detachClockKeepRunning();
      } else if (document.visibilityState === "visible" && store.screen === "game") {
        onReturnToForeground();
      }
    });
    window.addEventListener("pagehide", () => {
      if (store.screen === "game") detachClockKeepRunning();
    });
    window.addEventListener('storage',(event)=>{
      if (Campaign && event.key===Campaign.KEY && store.mode==='campaign' && event.newValue!==store.campaignRaw) {
        store.campaignConflict=true;showError('另一分頁已更新這份旅程，請重新載入以保護進度。');
        if (store.screen==='game') renderGame({forceAlerts:true});
      }
    });
    window.addEventListener("resize", syncDockPadding);
  }

  function tick() {
    if (store.screen !== "game" || !store.match || !store.clock) return;
    if (store.mode==='campaign' && campaignStorageConflict()) return;
    if (store.clock.paused) return;
    store.match.advance();
    if (store.ai) store.ai.consider(store.match);
    const view = store.match.publicView(C.HUMAN_ID);
    const pending = view && view.you && view.you.pending_choice;
    if (pending && store.sheet && store.sheet.kind !== "choice") {
      // 抉擇限時，關閉人數視窗但唔自動彈出，畫面會留入口。
      store.sheet = null;
      unmountSheet();
    }
    if (store.sheet) {
      const synced = UiSync.syncSheet(store.sheet, view, assignFlags(view));
      if (synced.close) {
        store.sheet = null;
        unmountSheet();
      } else {
        store.sheet = synced.sheet;
      }
    }
    const pres = UiSync.presentationAfterAdvance(store.match.phase, !!store.sheet);
    if (pres.pause) store.clock.pause();
    persist(pres.persist);
    if (pres.closeSheet) {
      store.sheet = null;
      unmountSheet();
    }
    const action = UiSync.shouldRefreshGameView(pres, {
      pointerDown: store.pointerDown,
      busy: store.busy,
      hasSheet: !!store.sheet
    });
    if (action === "force") {
      // 終局要更新結果提示，但唔好拆掉全域導覽節點。
      if (!store.shellMounted) renderGame({ full: true });
      else patchLiveChrome(view, { forceAlerts: true, forceHud: true, forceNav: false, forcePage: false, replaceHudHtml: false });
      return;
    }
    if (action === "refresh") {
      patchLiveChrome(view, {});
      if (store.sheet) renderSheet();
      return;
    }
    if (action === "sheet" && store.sheet) renderSheet();
    else if (store.shellMounted) patchLiveChrome(view, {});
  }

  function bootApp() {
    bindEventsOnce();
    renderMenu();
  }
  const testMode = typeof window !== "undefined" && (window.__STARFALL_TEST__ || window.__STARFALL_OUTPOST_PRIMARY__);
  if (!testMode) {
    bootApp();
    setInterval(tick, TICK_MS);
  }
  if (typeof window !== "undefined") {
    window.__STARFALL_SOLO_APP__ = {
      boot: bootApp,
      tick: tick,
      store: store,
      TICK_MS: TICK_MS
    };
  }
})();
