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
        <p class="lobby-copy">保留建造、採集、練兵同掠奪。對手係固定規則嘅自動前哨，遵守同你一樣嘅人口、資源、隊列、鎖兵、保護同生產，唔會暗送資源。離開時對局繼續，返回後補算，可能戰敗。瀏覽器背景唔保證真係執行，只喺你返嚟或重新載入時按經過時長追補，最長到 15 分鐘終局。只有按「暫停」先會真的停，暫停期間離開唔會補算。存檔只寫呢個瀏覽器。</p>
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

  function workerBtns(facility, count, built) {
    if (!built) return "";
    const buttons = [0, 1, 2].map((n) => {
      const on = n === count;
      return `<button class="btn${on ? "" : " small"}" type="button" data-assign="${facility}" data-count="${n}" ${on ? "disabled" : ""}>${n} 人</button>`;
    }).join("");
    return `<div class="row"><span class="tag">而家 ${count} 人</span>${buttons}</div>`;
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

    const commandBody = `<p class="desc">開局已有，不可拆。固定保護底線：口糧 6、合金 6，打輸都搶唔走。</p>${prot ? `<p class="tag">${prot}</p>` : ""}`;
    const recycleBody = workerBtns("recycle", you.recycle_workers, true) + `<p class="desc">開局已有。每人每 30 秒產合金 1。</p>`;
    const supplyBody = you.supply_built
      ? workerBtns("supply", you.supply_workers, true) + `<p class="desc">每人每 30 秒產口糧 2。</p>`
      : `<button class="btn small" type="button" data-build="supply">建造（合金 5）</button>`;
    const armoryBody = you.armory_built
      ? `<div class="row">
           <button class="btn small" type="button" data-train="1" ${you.training ? "disabled" : ""}>練兵（口糧 3、合金 2）</button>
           <button class="btn small" type="button" data-open-recall="1" ${(!you.patrols || you.recalling_active) ? "disabled" : ""}>遣返</button>
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
      </div>
      ${opp ? `<p class="muted opp-line">對方：口糧 ${opp.rations}　合金 ${opp.alloy}　待命 ${opp.standby}　巡衛 ${opp.patrols}${opp.locked_patrols ? "（鎖 " + opp.locked_patrols + "）" : ""}。${oppProt}</p>` : ""}
      ${facCard("指揮艙", "存放固定保護底線，協調整座前哨。", commandBody, "command")}
      ${facCard("回收廠", "從殘骸拆合金。", recycleBody, "recycle")}
      ${facCard("補給棚", "種植與過濾口糧。", supplyBody, "supply")}
      ${facCard("整備艙", "把船員練成巡衛，或遣返。", armoryBody, "armory")}
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
        <div class="hint">${paused && state.phase === "playing" ? "計時已暫停，繼續後先可以出征。" : (raid.can ? "選擇出征人數後派出。出征巡衛會被鎖定至結算。單機唔檢查對手在線。" : escapeHtml(raid.reason || ""))}</div>
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
    const title = sheet.kind === "raid" ? "出征人數" : "遣返人數";
    const verb = sheet.kind === "raid" ? "確認出征" : "確認遣返";
    const desc = sheet.kind === "raid"
      ? "至少 1 名可出征巡衛。對方守軍會按開戰當刻鎖定。單機對電腦唔檢查對手在線。"
      : "只可遣返未被鎖定嘅巡衛，30 秒後變回船員，不退回口糧或合金。";
    const err = store.error ? `<p class="err" id="sheet-err" role="alert">${escapeHtml(store.error)}</p>` : `<p class="err" id="sheet-err" role="alert"></p>`;
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
          <button class="btn warn" id="sheet-ok" type="button">${verb}</button>
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
    const err = document.getElementById("sheet-err");
    if (err) err.textContent = store.error || "";
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

  function openSheet(kind, max) {
    if (!max || max < 1) {
      showError(kind === "raid" ? "至少要有 1 名可出征巡衛。" : "沒有可遣返嘅巡衛。");
      render();
      return;
    }
    if (store.clock && store.clock.paused) {
      showError("計時已暫停，請先按繼續。");
      render();
      return;
    }
    clearError();
    store.sheet = { kind, max, value: max };
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
    const value = store.sheet.value;
    const ok = sendCommand({ type: kind, count: value }, { keepSheet: true });
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
        sendCommand({ type: "assign", facility: btn.dataset.assign, count: Number(btn.dataset.count) });
        return;
      }
      if (btn.dataset.build) {
        sendCommand({ type: "build", facility: btn.dataset.build });
        return;
      }
      if (btn.dataset.train) {
        sendCommand({ type: "train" });
        return;
      }
      if (btn.dataset.openRecall) {
        const st = stateNow();
        openSheet("recall", st && st.you ? st.you.patrols : 0);
        return;
      }
      if (btn.id === "btn-raid") {
        const st = stateNow();
        openSheet("raid", st && st.you ? st.you.patrols : 0);
      }
    });

    sheetRoot.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn || !store.sheet) return;
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
