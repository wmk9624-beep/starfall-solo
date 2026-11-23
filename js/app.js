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
    if (!store.match || !store.clock) return;
    try {
      const manual = !!store.manualPaused;
      const snap = store.match.snapshot({ paused: manual });
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
    } catch (err) {
      store.saveStatus = "保存失敗";
      showError(err.message || "保存失敗。原存檔若仍在則未被覆蓋。");
    }
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
        <p class="lobby-copy">保留建造、採集、練兵同掠奪。亦可升級產能並留人值守、派船員探索兩選事件、訓練巡衛或守陣。對手係固定規則嘅自動前哨，同一套指令同成本，唔會暗送資源。離開時對局繼續，返回後補算，可能戰敗；探索逾時會自動走穩妥路線。只有按「暫停」先會真的停。存檔只寫呢個瀏覽器。</p>
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

  function renderGame() {
    const state = stateNow();
    if (!state) {
      store.screen = "menu";
      renderMenu();
      return;
    }
    const you = state.you;
    const opp = state.opponent;
    const raid = state.raid || {};
    const paused = !!(store.manualPaused && state.phase === "playing");
    let pauseBanner = "";
    if (paused) {
      pauseBanner = `<div class="pause-banner" role="status"><strong>已手動暫停。</strong>呢段時間離開唔會補算。按「繼續」先再計時。</div>`;
    } else if (state.phase === "playing") {
      pauseBanner = `<div class="pause-banner" role="status"><strong>離開時對局繼續，返回後補算，可能戰敗。</strong>唔保證手機系統喺背景真執行；最長補算到 15 分鐘終局。</div>`;
    }
    let banner = "";
    if (state.phase === "finished" && state.result) {
      const kind = state.result.kind === "draw" ? "和局" : (state.result.you_won ? "你勝出" : "你敗咗");
      banner = `<div class="banner result"><strong>${kind}。</strong> ${escapeHtml(state.result.reason)}</div>`;
    } else if (state.battle && !state.battle.resolved) {
      const role = state.battle.you_attack ? "你出征中" : "你嘅前哨被攻打";
      banner = `<div class="banner battle">${role}：攻 ${state.battle.attack_force} 對守 ${state.battle.defense_force}，約 ${fmtTime(state.battle.remaining)} 後結算。</div>`;
    } else if (state.battle && state.battle.resolved && state.battle.resolution) {
      const r = state.battle.resolution;
      const map = { attack_win: "攻方勝", defense_win: "守方勝", draw: "打和" };
      banner = `<div class="banner">上一場${map[r.outcome] || ""}。掠奪合金 ${r.loot_alloy}、口糧 ${r.loot_rations}。傷亡退回船員：攻 ${r.attacker_casualties}、守 ${r.defender_casualties}。</div>`;
    }

    const trainTxt = you.training ? `訓練中，約 ${fmtTime(you.training_remaining)} 完成` : "隊列空閒";
    const recallTxt = you.recalling_active ? `遣返 ${you.recalling} 人，約 ${fmtTime(you.recall_remaining)} 完成，不退款` : "";
    const prot = you.protection_remaining > 0 ? `你受襲保護仲有 ${fmtTime(you.protection_remaining)}` : "";
    const oppProt = opp && opp.protection_remaining > 0 ? `對方受襲保護 ${fmtTime(opp.protection_remaining)}` : "";

    const pressureTxt = you.pressure_high
      ? "艙壓：過高（升級加成暫停，派人值守可恢復）"
      : (you.recycle_upgraded || you.supply_upgraded ? "艙壓：穩定" : "艙壓：穩定（未升級時無需值守）");
    const exploreReason = (state.explore && state.explore.reason) || "";
    const exploreBtnDisabled = (state.phase !== "playing") || paused || !state.explore || !state.explore.can;
    let exploreBlock = "";
    if (you.pending_choice) {
      const ev = you.pending_choice.event || {};
      exploreBlock = `<div class="choice-entry">
        <p class="assign-status">探索已到達：「${escapeHtml(ev.title || "事件")}」。尚餘 ${fmtTime(you.pending_choice.remain)} 要揀，逾時走穩妥路線。</p>
        <button class="btn" type="button" data-open-choice="1">打開抉擇</button>
      </div>`;
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

    const events = (state.events || []).slice().reverse().slice(0, 12)
      .map((ev) => `<li>${escapeHtml(ev.text)}</li>`).join("");

    app.innerHTML = `
      <div class="topline">
        <div class="time">${fmtTime(state.match_time)}<small>8 分鐘後先計勝　15 分鐘限時　單機　離開後會補算</small></div>
        <div class="pills">
          <span class="pill on">${escapeHtml(you.display_name)}　你</span>
          <span class="pill cpu">${escapeHtml(opp ? opp.display_name : "自動前哨")}　電腦</span>
        </div>
      </div>
      ${pauseBanner}
      ${banner}
      ${errorBlock()}
      <div class="resources">
        <div class="res food"><div class="k">口糧</div><div class="v">${you.rations}</div></div>
        <div class="res alloy"><div class="k">合金</div><div class="v">${you.alloy}</div></div>
        <div class="res"><div class="k">待命船員</div><div class="v">${you.standby}</div></div>
        <div class="res"><div class="k">巡衛${you.locked_patrols ? "（鎖 " + you.locked_patrols + "）" : ""}</div><div class="v">${you.patrols}</div></div>
        <div class="res"><div class="k">守陣${you.locked_wards ? "（鎖 " + you.locked_wards + "）" : ""}</div><div class="v">${you.wards || 0}</div></div>
      </div>
      ${opp ? `<p class="muted opp-line">對方：口糧 ${opp.rations}　合金 ${opp.alloy}　待命 ${opp.standby}　巡衛 ${opp.patrols}${opp.locked_patrols ? "（鎖 " + opp.locked_patrols + "）" : ""}　守陣 ${opp.wards || 0}${opp.locked_wards ? "（鎖 " + opp.locked_wards + "）" : ""}。${oppProt}</p>` : ""}
      ${facCard("指揮艙", "保護底線、值守艙壓、派出探索。", commandBody, "command")}
      ${facCard("回收廠", "從殘骸拆合金。", recycleBody, "recycle")}
      ${facCard("補給棚", "種植與過濾口糧。", supplyBody, "supply")}
      ${facCard("整備艙", "把船員練成巡衛或守陣，或遣返。", armoryBody, "armory")}
      <section class="card">
        <h2 class="log-heading">戰況紀錄</h2>
        <ul class="log">${events || "<li>尚未有新事件。</li>"}</ul>
        <div class="row" style="margin-top:0.6rem">
          ${paused && state.phase === "playing" ? `<button class="btn small" id="btn-resume" type="button">繼續</button>` : `<button class="btn small" id="btn-pause" type="button" ${state.phase === "playing" ? "" : "disabled"}>暫停</button>`}
          <button class="btn small" id="btn-menu" type="button">返回首頁</button>
          <button class="btn small" id="btn-new-ingame" type="button">重新開始</button>
        </div>
      </section>
      ${state.phase !== "waiting" ? `
      <div class="dock">
        <button class="btn warn" id="btn-raid" type="button" ${raid.can && !paused ? "" : "disabled"}>出兵掠奪</button>
        <div class="hint">${paused && state.phase === "playing" ? "計時已暫停，繼續後先可以出征。" : (raid.can ? "選擇出征構成。至少 1 名巡衛；守陣可一齊派出但無攻勢。對方守軍會全部鎖定。" : escapeHtml(raid.reason || ""))}</div>
      </div>` : ""}
    `;
    renderSheet();
    syncDockPadding();
  }

  function render() {
    if (store.screen !== "game" || !store.match) renderMenu();
    else renderGame();
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
    const dock = app.querySelector(".dock");
    const h = dock ? dock.getBoundingClientRect().height : 0;
    app.style.setProperty("--dock-space", Math.max(0, Math.ceil(h || 136)) + "px");
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
    try {
      if (!payload.command_id) payload.command_id = cmdId();
      store.match.command(C.HUMAN_ID, payload);
      if (store.ai) store.ai.consider(store.match);
      persist("command");
      clearError();
      if (!keepSheet) render();
      return true;
    } catch (err) {
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
    store.clock = new Engine.ForegroundClock(0);
    store.match = Engine.createSoloMatch(store.clock, 0);
    store.ai = new AI.SoloAI();
    store.ai.consider(store.match);
    store.screen = "game";
    store.manualPaused = false;
    store.detached = false;
    store.pausedNotice = false;
    store.sheet = null;
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
      if (btn.id === "btn-pause") { pauseGame("manual"); render(); return; }
      if (btn.id === "btn-resume") { resumeGame(); render(); return; }
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
    if (action === "force" || action === "refresh") {
      render();
      return;
    }
    if (action === "sheet" && store.sheet) renderSheet();
  }

  bindEventsOnce();
  renderMenu();
  setInterval(tick, TICK_MS);
})();
