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
  const C = Engine.CONST;
  const TICK_MS = 250;

  const app = document.getElementById("app");
  const sheetRoot = document.getElementById("sheet-root");
  const store = {
    screen: "menu", // menu | game
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
  };
  let sheetMounted = false;
  let eventsBound = false;
  let cmdSeq = 0;

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
    if (store.manualPaused) {
      store.pausedNotice = store.match.phase === "playing";
      render();
      return;
    }
    let anchor = store.lastWallAnchor;
    const loaded = Save.load(localStorage);
    if (anchor == null && loaded.ok && loaded.data) anchor = loaded.data.wall_anchor;
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
          <p>單機對電腦。飛船已墜，喺呢個星球守住你嘅前哨。</p>
        </div>
      </header>
      <section class="card">
        <p class="lobby-copy">保留建造、採集、練兵同掠奪。亦可升級產能並留人值守、派船員探索兩選事件、訓練巡衛或守陣。第一章《無聲的歸航》喺地圖入面讀固定故事，唔會另開第二套探索。對手係固定規則嘅自動前哨，同一套指令同成本，唔會暗送資源。離開時對局繼續，返回後補算，可能戰敗；探索逾時會自動走穩妥路線。只有按「暫停」先會真的停。存檔只寫呢個瀏覽器。故事選擇只用遊戲裡嘅合金，不是付款。</p>
        <p class="save-note">呢個係本機靜態原型，無需登入。兩個實體手機未必可以打開 127.0.0.1。重新開始要確認。舊存檔若未帶牆鐘錨點，會按已暫停處理，避免突然補算。</p>
        ${errorBlock()}
        ${corruptBox}
        <button class="btn" id="btn-continue" type="button" ${canContinue ? "" : "disabled"}>繼續存檔</button>
        <button class="btn secondary" id="btn-new" type="button">開始新對局</button>
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
    store.route = StoryUi.navigate(ensureRoute(), action);
    store.pageSig = "";
    if (store.match !== matchRef) {
      showError("導航不應重建對局。");
    }
  }

  function chromeFlags(state) {
    return assignFlags(state);
  }

  function hudMarkup(state) {
    const you = state.you;
    const paused = !!(store.manualPaused && state.phase === "playing");
    return `
      <div class="topline">
        <div class="time"><span id="hud-time">${fmtTime(state.match_time)}</span><small>8 分鐘後先計勝　15 分鐘限時　單機　離開後會補算　讀故事唔會暫停對局</small></div>
        <div class="pills">
          <span class="pill on">${escapeHtml(you.display_name)}　你</span>
          <span class="pill cpu">${escapeHtml(state.opponent ? state.opponent.display_name : "自動前哨")}　電腦</span>
        </div>
      </div>
      <div class="resources" id="hud-resources">
        <div class="res food"><div class="k">口糧</div><div class="v" id="hud-rations">${you.rations}</div></div>
        <div class="res alloy"><div class="k">合金</div><div class="v" id="hud-alloy">${you.alloy}</div></div>
        <div class="res"><div class="k">待命船員</div><div class="v" id="hud-standby">${you.standby}</div></div>
        <div class="res"><div class="k">巡衛${you.locked_patrols ? "（鎖 " + you.locked_patrols + "）" : ""}</div><div class="v" id="hud-patrols">${you.patrols}</div></div>
        <div class="res"><div class="k">守陣${you.locked_wards ? "（鎖 " + you.locked_wards + "）" : ""}</div><div class="v" id="hud-wards">${you.wards || 0}</div></div>
      </div>
      <div class="hud-controls row">
        ${paused && state.phase === "playing" ? `<button class="btn small" id="btn-resume" type="button">繼續</button>` : `<button class="btn small" id="btn-pause" type="button" ${state.phase === "playing" ? "" : "disabled"}>暫停</button>`}
        <button class="btn small" id="btn-menu" type="button">返回首頁</button>
        <button class="btn small" id="btn-new-ingame" type="button">重新開始</button>
      </div>`;
  }

  function alertMarkup(state) {
    const you = state.you;
    const opp = state.opponent;
    const paused = !!(store.manualPaused && state.phase === "playing");
    const route = ensureRoute();
    let pauseBanner = "";
    if (paused) {
      pauseBanner = `<div class="pause-banner" role="status"><strong>已手動暫停。</strong>呢段時間離開唔會補算。按「繼續」先再計時。閱讀故事仍然可以，但唔能提交未確認嘅故事選擇。</div>`;
    } else if (state.phase === "playing") {
      pauseBanner = `<div class="pause-banner" role="status"><strong>離開時對局繼續，返回後補算，可能戰敗。</strong>讀地圖或故事時對局照跑。唔保證手機系統喺背景真執行；最長補算到 15 分鐘終局。</div>`;
    }
    let banner = "";
    if (state.phase === "finished" && state.result) {
      const kind = state.result.kind === "draw" ? "和局" : (state.result.you_won ? "你勝出" : "你敗咗");
      const story = state.story || {};
      let storyBox = "";
      if (story.legacy_finished_unstarted || story.chapter_status === "unavailable") {
        storyBox = `<div class="story-result"><strong>故事功能在當局未啟用。</strong>${(story.ending_text || []).map((p) => " " + escapeHtml(p)).join("")}</div>`;
      } else if (story.forced || story.ending_variant === "forced") {
        storyBox = `<div class="story-result forced" role="status"><strong>故事未完成｜系統自動收束</strong>${(story.ending_text || []).map((p) => `<p>${escapeHtml(p)}</p>`).join("")}</div>`;
      } else if (story.ending_id) {
        storyBox = `<div class="story-result"><strong>故事結局：${escapeHtml(story.ending_title || story.ending_id)}</strong>${story.ending_variant && story.ending_variant !== "base" ? "（" + escapeHtml(story.ending_variant) + "）" : ""}${(story.ending_text || []).map((p) => `<p>${escapeHtml(p)}</p>`).join("")}</div>`;
      } else {
        storyBox = `<div class="story-result"><strong>尚未有故事結局。</strong></div>`;
      }
      banner = `<div class="banner result" id="match-result-banner"><strong>戰局結果：${kind}。</strong> ${escapeHtml(state.result.reason)}${storyBox}${route.page !== "base" ? `<p class="assign-hint">終局結果在任何頁面都會顯示，可返回基地查看建設現況。</p>` : ""}</div>`;
    } else if (state.battle && !state.battle.resolved) {
      const role = state.battle.you_attack ? "你出征中" : "你嘅前哨被攻打";
      banner = `<div class="banner battle">${role}：攻 ${state.battle.attack_force} 對守 ${state.battle.defense_force}，約 ${fmtTime(state.battle.remaining)} 後結算。</div>`;
    } else if (state.battle && state.battle.resolved && state.battle.resolution) {
      const r = state.battle.resolution;
      const map = { attack_win: "攻方勝", defense_win: "守方勝", draw: "打和" };
      banner = `<div class="banner">上一場${map[r.outcome] || ""}。掠奪合金 ${r.loot_alloy}、口糧 ${r.loot_rations}。傷亡退回船員：攻 ${r.attacker_casualties}、守 ${r.defender_casualties}。</div>`;
    }
    const oppProt = opp && opp.protection_remaining > 0 ? `對方受襲保護 ${fmtTime(opp.protection_remaining)}` : "";
    const oppLine = opp ? `<p class="muted opp-line" id="opp-line">對方：口糧 ${opp.rations}　合金 ${opp.alloy}　待命 ${opp.standby}　巡衛 ${opp.patrols}${opp.locked_patrols ? "（鎖 " + opp.locked_patrols + "）" : ""}　守陣 ${opp.wards || 0}${opp.locked_wards ? "（鎖 " + opp.locked_wards + "）" : ""}。${oppProt}</p>` : "";
    let exploreAlert = "";
    const entry = StoryUi ? StoryUi.exploreEntry(state, route) : { visible: false };
    if (entry.visible) {
      if (entry.return_and_open) {
        exploreAlert = `<div class="choice-entry explore-alert" role="status">
          <p class="assign-status">探索事件「${escapeHtml(entry.title)}」尚餘 <span id="explore-remain">${fmtTime(entry.remain)}</span>，逾時走穩妥路線。故事頁不會吞掉呢個入口。</p>
          <button class="btn" type="button" data-return-explore="1">返回基地並打開抉擇</button>
        </div>`;
      } else {
        exploreAlert = `<div class="choice-entry explore-alert" role="status">
          <p class="assign-status">探索已到達：「${escapeHtml(entry.title)}」。尚餘 <span id="explore-remain">${fmtTime(entry.remain)}</span> 要揀，逾時走穩妥路線。</p>
          <button class="btn" type="button" data-open-choice="1">打開抉擇</button>
        </div>`;
      }
    }
    return `${pauseBanner}${banner}${errorBlock()}${oppLine}${exploreAlert}`;
  }

  function navMarkup(state) {
    const route = ensureRoute();
    return `
      <nav class="bottom-nav" aria-label="主要頁面">
        <button class="nav-btn ${route.tab === "base" ? "on" : ""}" type="button" data-nav-tab="base">基地</button>
        <button class="nav-btn ${route.tab === "map" ? "on" : ""}" type="button" data-nav-tab="map">地圖</button>
        <button class="nav-btn ${route.tab === "log" ? "on" : ""}" type="button" data-nav-tab="log">紀錄</button>
      </nav>`;
  }

  function backRow(route) {
    if (!route || route.page === "base") return "";
    const backToMap = route.page === "location" || route.page === "story" || route.page === "hero";
    return `<div class="back-row">
      ${backToMap ? `<button class="btn small" type="button" data-nav-back="1">返回地圖</button>` : ""}
      <button class="btn small secondary" type="button" data-nav-tab="base">返回基地</button>
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
    return `${backRow(ensureRoute())}
      <section class="card">
        <h2>星球地圖</h2>
        <p class="desc">呢張地圖只有三個固定故事地點，唔會派船員、亦唔用 20 秒探索倒數。原有探索仍喺基地進行。</p>
        ${heroStrip(story)}
      </section>
      <div class="loc-list">${cards}</div>`;
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
    const optionBtns = choices.map((ch) => {
      const cost = ch.cost_alloy > 0 ? `<span class="cost-note">消耗${ch.cost_alloy}合金</span>` : "";
      const why = !ch.enabled && ch.reason ? `<span class="option-reason">${escapeHtml(ch.reason)}</span>` : (ch.stance_change ? `<span class="option-reason">將改變立場，原英雄專屬解析會放棄。</span>` : "");
      return `<button class="btn story-option ${ch.enabled ? "" : "is-locked"}" type="button" data-story-choice="${ch.id}" ${ch.enabled && !flags.paused && !flags.finished ? "" : "disabled"}>${escapeHtml(ch.label)} ${cost}${why}</button>`;
    }).join("");
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
      <section class="card">
        <h2>故事紀錄</h2>
        <p class="assign-status">璃棱 ${rel.liling || 0}　秋纓 ${rel.qiuying || 0}　烏燼 ${rel.wujin || 0}</p>
        <p class="desc">結局：${escapeHtml(ending)}</p>
        <ul class="log">${history || "<li>尚未作出故事選擇。</li>"}</ul>
      </section>
      <section class="card">
        <h2 class="log-heading">最近戰況</h2>
        <ul class="log">${events || "<li>尚未有新事件。</li>"}</ul>
      </section>`;
  }

  function basePageMarkup(state) {
    const you = state.you;
    const raid = state.raid || {};
    const paused = !!(store.manualPaused && state.phase === "playing");
    const prot = you.protection_remaining > 0 ? `你受襲保護仲有 ${fmtTime(you.protection_remaining)}` : "";
    const pressureTxt = you.pressure_high
      ? "艙壓：過高（升級加成暫停，派人值守可恢復）"
      : (you.recycle_upgraded || you.supply_upgraded ? "艙壓：穩定" : "艙壓：穩定（未升級時無需值守）");
    const exploreReason = (state.explore && state.explore.reason) || "";
    const exploreBtnDisabled = (state.phase !== "playing") || paused || !state.explore || !state.explore.can;
    let exploreBlock = "";
    if (you.pending_choice) {
      exploreBlock = `<p class="assign-hint muted">上方有探索抉擇入口，請喺時限內打開。</p>`;
    } else if (you.exploring) {
      exploreBlock = `<p class="assign-status">探索途中，約 ${fmtTime(you.explore_remaining)} 到達。</p>`;
    } else if (you.recovering) {
      exploreBlock = `<p class="assign-status">有人歸途休養，約 ${fmtTime(you.recover_remaining)} 返回待命。</p>`;
    } else {
      exploreBlock = `<button class="btn small" type="button" data-explore="1" ${exploreBtnDisabled ? "disabled" : ""}>出發探索（口糧 1、佔 1 人、60 秒）</button>
        ${exploreReason ? `<p class="assign-hint muted">${escapeHtml(exploreReason)}</p>` : `<p class="assign-hint muted">事件有兩條確定代價，唔會改對方保護。</p>`}`;
    }
    const commandBody = `
      <p class="desc">開局已有，不可拆。固定保護底線：口糧 6、合金 6，打輸都搶唔走。</p>
      ${prot ? `<p class="tag">${prot}</p>` : ""}
      <p class="assign-status">${escapeHtml(pressureTxt)}</p>
      ${workerBtns("duty", you, state)}
      ${exploreBlock}`;
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
      : `<button class="btn small" type="button" data-build="supply">建造（合金 5）</button>`;
    const trainBusy = !!you.training;
    const trainPatrolDis = trainBusy || you.standby < 1 || you.rations < 3 || you.alloy < 2 || paused || state.phase !== "playing";
    const trainWardDis = trainBusy || you.standby < 1 || you.rations < 4 || you.alloy < 1 || paused || state.phase !== "playing";
    const trainPatrolWhy = trainBusy ? "隊列已有訓練。" : (you.standby < 1 ? "冇待命船員可以送去訓練。" : (you.rations < 3 ? "口糧不足（要 3）。" : (you.alloy < 2 ? "合金不足，練巡衛要 2。" : "")));
    const trainWardWhy = trainBusy ? "隊列已有訓練。" : (you.standby < 1 ? "冇待命船員可以送去訓練。" : (you.rations < 4 ? "口糧不足，練守陣要 4。" : (you.alloy < 1 ? "合金不足，練守陣要 1。" : "")));
    const trainTxt = you.training ? `訓練中，約 ${fmtTime(you.training_remaining)} 完成` : "隊列空閒";
    const recallTxt = you.recalling_active ? `遣返 ${you.recalling} 人，約 ${fmtTime(you.recall_remaining)} 完成，不退款` : "";
    const armoryBody = you.armory_built
      ? `<p class="assign-status">巡衛 ${you.patrols}${you.locked_patrols ? "（鎖 " + you.locked_patrols + "）" : ""}　守陣 ${you.wards || 0}${you.locked_wards ? "（鎖 " + you.locked_wards + "）" : ""}</p>
         <div class="row assign-row">
           <button class="btn small" type="button" data-train="patrol" ${trainPatrolDis ? "disabled" : ""}>練巡衛（口糧 3、合金 2）</button>
           <button class="btn small" type="button" data-train="ward" ${trainWardDis ? "disabled" : ""}>練守陣（口糧 4、合金 1）</button>
         </div>
         <p class="assign-hint muted">${escapeHtml(trainPatrolWhy || trainWardWhy || "守陣偏防衛，無攻勢唔能出征。")}</p>
         <div class="row assign-row">
           <button class="btn small" type="button" data-open-recall="patrol" ${(!you.patrols || you.recalling_active || paused) ? "disabled" : ""}>遣返巡衛</button>
           <button class="btn small" type="button" data-open-recall="ward" ${(!(you.wards) || you.recalling_active || paused) ? "disabled" : ""}>遣返守陣</button>
         </div>
         <p class="desc">${trainTxt}${recallTxt ? "。" + recallTxt : ""}。隊列最多 1 個。被鎖兵不可遣返。</p>`
      : `<button class="btn small" type="button" data-build="armory">建造（合金 8）</button>`;
    const events = (state.events || []).slice().reverse().slice(0, 8)
      .map((ev) => `<li>${escapeHtml(ev.text)}</li>`).join("");
    return `
      ${facCard("指揮艙", "保護底線、值守艙壓、派出探索。", commandBody, "command")}
      ${facCard("回收廠", "從殘骸拆合金。", recycleBody, "recycle")}
      ${facCard("補給棚", "種植與過濾口糧。", supplyBody, "supply")}
      ${facCard("整備艙", "把船員練成巡衛或守陣，或遣返。", armoryBody, "armory")}
      <section class="card">
        <h2 class="log-heading">戰況紀錄</h2>
        <ul class="log">${events || "<li>尚未有新事件。</li>"}</ul>
      </section>
      ${state.phase !== "waiting" ? `
      <div class="raid-dock">
        <button class="btn warn" id="btn-raid" type="button" ${raid.can && !paused ? "" : "disabled"}>出兵掠奪</button>
        <div class="hint">${paused && state.phase === "playing" ? "計時已暫停，繼續後先可以出征。" : (raid.can ? "選擇出征構成。至少 1 名巡衛；守陣可一齊派出但無攻勢。對方守軍會全部鎖定。" : escapeHtml(raid.reason || ""))}</div>
      </div>` : ""}`;
  }

  function pageMarkup(state) {
    const route = ensureRoute();
    if (route.page === "map") return mapPageMarkup(state);
    if (route.page === "location") return locationPageMarkup(state);
    if (route.page === "story") return storyPageMarkup(state);
    if (route.page === "hero") return heroPageMarkup(state);
    if (route.page === "log") return logPageMarkup(state);
    return basePageMarkup(state);
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
      const on = btn.getAttribute("data-nav-tab") === route.tab;
      btn.classList.toggle("on", on);
    });
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
      setText("hud-patrols", String(you.patrols));
      setText("hud-wards", String(you.wards || 0));
    }
    const entry = StoryUi ? StoryUi.exploreEntry(state, ensureRoute()) : null;
    if (entry && entry.visible) setText("explore-remain", fmtTime(entry.remain));
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
      page.innerHTML = pageMarkup(state);
      if (sameRoute && !opts.resetScroll) page.scrollTop = y;
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
    if (sheet.kind === "story") {
      const costLine = sheet.cost_alloy > 0
        ? `<p class="cost-note">此選擇將消耗${sheet.cost_alloy}合金。這是遊戲內資源，不是付款或購買。</p>`
        : `<p class="desc">此選擇不消耗口糧或合金，但仍會永久改變故事方向。</p>`;
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
    if (store.clock && store.clock.paused) {
      showError("計時已暫停，請先按繼續。");
      return false;
    }
    store.busy = true;
    const transactional = payload.type === "story_choice";
    let checkpoint = null;
    try {
      if (!payload.command_id) payload.command_id = cmdId();
      if (transactional) {
        checkpoint = UiSync.captureCommandCheckpoint(store.match, store.ai, buildPersistExtra());
      }
      store.match.command(C.HUMAN_ID, payload);
      if (store.ai) store.ai.consider(store.match);
      const saved = persist("command");
      if (!saved || !saved.ok) {
        if (checkpoint) {
          store.match = UiSync.restoreCommandCheckpoint(Engine, store.clock, checkpoint, store.ai);
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
    window.addEventListener("resize", syncDockPadding);
  }

  function tick() {
    if (store.screen !== "game" || !store.match || !store.clock) return;
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
  const testMode = typeof window !== "undefined" && window.__STARFALL_TEST__;
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
