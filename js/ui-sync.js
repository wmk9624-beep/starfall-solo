/* 單機 UI 時序守衛：可在 Node 測試。不是瀏覽器畫面實測。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.StarfallSoloUiSync = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function prepareRestartConfirm(clock) {
    var wasRunning = !!(clock && clock.paused === false);
    var timeBefore = clock && typeof clock.now === "function" ? clock.now() : null;
    if (wasRunning) clock.pause();
    return { wasRunning: wasRunning, timeBefore: timeBefore };
  }

  function settleRestartConfirm(clock, prep, confirmed) {
    prep = prep || {};
    if (confirmed) {
      return { startNew: true, resumed: false };
    }
    if (prep.wasRunning && clock && typeof clock.resume === "function") {
      clock.resume();
      return { startNew: false, resumed: true };
    }
    return { startNew: false, resumed: false };
  }

  function presentationAfterAdvance(phase, hasSheet) {
    if (phase === "finished") {
      return { closeSheet: true, pause: true, forceRender: true, refreshGame: false, persist: "finished" };
    }
    if (hasSheet) {
      return { closeSheet: false, pause: false, forceRender: false, refreshGame: false, persist: "tick" };
    }
    return { closeSheet: false, pause: false, forceRender: false, refreshGame: true, persist: "tick" };
  }

  function runRestartConfirm(clock, confirmFn) {
    var prep = prepareRestartConfirm(clock);
    var ok = false;
    if (typeof confirmFn === "function") ok = !!confirmFn();
    return settleRestartConfirm(clock, prep, ok);
  }

  function shouldRefreshGameView(pres, flags) {
    flags = flags || {};
    if (pres && pres.forceRender) return "force";
    if (pres && pres.refreshGame && !flags.pointerDown && !flags.busy) return "refresh";
    if (flags.hasSheet) return "sheet";
    return "skip";
  }

  var ASSIGN_MAX_PER = 2;
  var ASSIGN_MAX_PRODUCTION = 5;

  function assignControlState(opts) {
    opts = opts || {};
    var current = Number(opts.current) || 0;
    var standby = Number(opts.standby) || 0;
    var others = Number(opts.productionOthers) || 0;
    var maxPer = opts.maxPer != null ? Number(opts.maxPer) : ASSIGN_MAX_PER;
    var maxProd = opts.maxProd != null ? Number(opts.maxProd) : ASSIGN_MAX_PRODUCTION;
    var inc = { enabled: false, reason: "" };
    var dec = { enabled: false, reason: "" };
    if (!opts.built) {
      inc.reason = "設施未建成。";
      dec.reason = "設施未建成。";
    } else if (opts.finished) {
      inc.reason = "對局已經結束。";
      dec.reason = "對局已經結束。";
    } else if (opts.paused) {
      inc.reason = "計時已暫停，請先按繼續。";
      dec.reason = "計時已暫停，請先按繼續。";
    } else {
      if (current <= 0) dec.reason = "呢座已經冇人可調回。";
      else dec.enabled = true;
      if (current >= maxPer) inc.reason = "呢座最多派 " + maxPer + " 人。";
      else if (standby < 1) inc.reason = "冇待命船員可派。";
      else if (others + current + 1 > maxProd) inc.reason = "至少要留 1 人唔投入生產。";
      else inc.enabled = true;
    }
    return {
      current: current,
      standby: standby,
      maxPer: maxPer,
      inc: inc,
      dec: dec
    };
  }

  function workerCount(you, facility) {
    if (!you) return 0;
    if (facility === "recycle") return Number(you.recycle_workers) || 0;
    if (facility === "supply") return Number(you.supply_workers) || 0;
    if (facility === "duty") return Number(you.duty_workers) || 0;
    return 0;
  }

  function otherProduction(you, facility) {
    if (!you) return 0;
    if (facility === "recycle") return Number(you.supply_workers) || 0;
    if (facility === "supply") return Number(you.recycle_workers) || 0;
    return 0;
  }

  function resolveRelativeAssign(you, facility, delta, flags) {
    flags = flags || {};
    delta = Number(delta);
    if (delta !== 1 && delta !== -1) {
      return { ok: false, reason: "無效派工操作。" };
    }
    if (facility !== "recycle" && facility !== "supply" && facility !== "duty") {
      return { ok: false, reason: "呢座設施唔能派工。" };
    }
    var current = workerCount(you, facility);
    var built = facility === "supply" ? !!(you && you.supply_built) : true;
    var state = assignControlState({
      current: current,
      standby: you && you.standby,
      productionOthers: facility === "duty" ? 0 : otherProduction(you, facility),
      maxPer: facility === "duty" ? 1 : 2,
      paused: !!flags.paused,
      finished: !!flags.finished,
      built: built
    });
    if (delta > 0 && !state.inc.enabled) return { ok: false, reason: state.inc.reason, current: current };
    if (delta < 0 && !state.dec.enabled) return { ok: false, reason: state.dec.reason, current: current };
    return {
      ok: true,
      current: current,
      target: current + delta,
      payload: { type: "assign", facility: facility, count: current + delta }
    };
  }

  function openChoiceSheet(you, flags) {
    flags = flags || {};
    if (flags.paused) return { ok: false, reason: "計時已暫停，請先按繼續。" };
    if (flags.finished || flags.phase === "finished") return { ok: false, reason: "對局已經結束。" };
    if (!you || !you.pending_choice) return { ok: false, reason: "而家冇待抉擇嘅探索事件。" };
    var ch = you.pending_choice;
    return {
      ok: true,
      sheet: {
        kind: "choice",
        event: ch.event || null,
        remain: ch.remain,
        can_pick_b: !!ch.can_pick_b,
        event_id: ch.event_id
      }
    };
  }

  function choiceSubmit(you, option, flags) {
    flags = flags || {};
    if (flags.finished || flags.phase === "finished") {
      return { ok: false, close: true, reason: "對局已經結束，唔能再選擇。", coverResult: false };
    }
    if (!you || !you.pending_choice) {
      return { ok: false, close: true, reason: "而家冇待抉擇嘅探索事件。" };
    }
    if (option !== "A" && option !== "B") return { ok: false, reason: "請選擇 A 或 B。" };
    if (option === "B" && you.pending_choice.can_pick_b === false) {
      return { ok: false, reason: "條件唔夠，唔能選呢條路線。" };
    }
    return { ok: true, payload: { type: "choose", option: option } };
  }

  function openRaidSheet(you, raid, flags) {
    flags = flags || {};
    if (flags.paused) return { ok: false, reason: "計時已暫停，請先按繼續。" };
    if (flags.finished || flags.phase === "finished") return { ok: false, reason: "對局已經結束。" };
    if (raid && raid.can === false) {
      return { ok: false, reason: raid.reason || "而家唔能出征。" };
    }
    var patrolMax = Number(you && you.patrols) || 0;
    var wardMax = Number(you && you.wards) || 0;
    if (patrolMax < 1) {
      return { ok: false, reason: "至少要有 1 名可出征巡衛。守陣無攻勢唔能出征。" };
    }
    return {
      ok: true,
      sheet: {
        kind: "raid",
        controls: { patrol: true, ward: true },
        patrolMax: patrolMax,
        wardMax: wardMax,
        patrol: patrolMax,
        ward: 0,
        value: patrolMax,
        unit: "patrol"
      }
    };
  }

  function adjustRaidSheet(sheet, unit, delta) {
    if (!sheet || sheet.kind !== "raid") return sheet;
    var out = Object.assign({}, sheet);
    var d = Number(delta) || 0;
    if (unit === "ward") {
      var w = (Number(out.ward) || 0) + d;
      if (w < 0) w = 0;
      if (w > (out.wardMax || 0)) w = out.wardMax || 0;
      out.ward = w;
    } else {
      var p = (Number(out.patrol) || 0) + d;
      if (p < 0) p = 0;
      if (p > (out.patrolMax || 0)) p = out.patrolMax || 0;
      out.patrol = p;
      out.value = p;
    }
    return out;
  }

  function raidSubmit(sheet, you, state, flags) {
    flags = flags || {};
    if (flags.finished || (state && state.phase === "finished")) {
      return { ok: false, close: true, reason: "對局已經結束。", coverResult: false };
    }
    if (flags.paused) return { ok: false, reason: "計時已暫停，請先按繼續。" };
    var liveP = Number(you && you.patrols) || 0;
    var liveW = Number(you && you.wards) || 0;
    var patrol = Number(sheet && (sheet.patrol != null ? sheet.patrol : sheet.value)) || 0;
    var ward = Number(sheet && sheet.ward) || 0;
    if (!Number.isInteger(patrol) || !Number.isInteger(ward) || patrol < 0 || ward < 0) {
      return { ok: false, reason: "出征構成無效。" };
    }
    if (patrol > liveP || ward > liveW) {
      return {
        ok: false,
        stale: true,
        close: false,
        reason: "可出征人數已變，請重新選擇。",
        live: { patrol: liveP, ward: liveW }
      };
    }
    if (patrol < 1) {
      return { ok: false, reason: "無攻勢唔能出征。守陣唔可以獨自或組成無攻勢隊伍去偷空城。" };
    }
    if (state && state.raid && state.raid.can === false) {
      return { ok: false, reason: state.raid.reason || "而家唔能出征。" };
    }
    return { ok: true, payload: { type: "raid", comp: { patrol: patrol, ward: ward } } };
  }

  function openRecallSheet(you, unit, flags) {
    flags = flags || {};
    unit = unit === "ward" ? "ward" : "patrol";
    if (flags.paused) return { ok: false, reason: "計時已暫停，請先按繼續。" };
    if (flags.finished || flags.phase === "finished") return { ok: false, reason: "對局已經結束。" };
    if (you && you.recalling_active) return { ok: false, reason: "而家已有遣返進行中。" };
    var max = unit === "ward" ? (Number(you && you.wards) || 0) : (Number(you && you.patrols) || 0);
    if (max < 1) return { ok: false, reason: "沒有可遣返嘅呢種兵力。" };
    return { ok: true, sheet: { kind: "recall", unit: unit, max: max, value: max, controls: { unit: unit } } };
  }

  function recallSubmit(sheet, you, state, flags) {
    flags = flags || {};
    if (flags.finished || (state && state.phase === "finished")) {
      return { ok: false, close: true, reason: "對局已經結束。", coverResult: false };
    }
    if (flags.paused) return { ok: false, reason: "計時已暫停，請先按繼續。" };
    var unit = sheet && sheet.unit === "ward" ? "ward" : "patrol";
    var live = unit === "ward" ? (Number(you && you.wards) || 0) : (Number(you && you.patrols) || 0);
    var count = Number(sheet && sheet.value);
    if (!Number.isInteger(count) || count < 1) {
      return { ok: false, reason: "至少要遣返 1 名未被鎖定嘅兵力。" };
    }
    if (count > live) {
      return { ok: false, stale: true, close: false, reason: "可遣返人數已變，請重新選擇。", liveMax: live };
    }
    if (you && you.recalling_active) return { ok: false, reason: "而家已有遣返進行中。" };
    return { ok: true, payload: { type: "recall", count: count, unit: unit } };
  }

  function syncSheet(sheet, state, flags) {
    flags = flags || {};
    if (!sheet) return { sheet: null, close: false };
    if (flags.finished || (state && state.phase === "finished")) {
      return { sheet: null, close: true, coverResult: false, forceRender: true };
    }
    var you = state && state.you;
    if (sheet.kind === "choice") {
      if (!you || !you.pending_choice) return { sheet: null, close: true };
      return {
        sheet: Object.assign({}, sheet, {
          remain: you.pending_choice.remain,
          can_pick_b: !!you.pending_choice.can_pick_b,
          event: you.pending_choice.event,
          event_id: you.pending_choice.event_id
        }),
        close: false
      };
    }
    if (sheet.kind === "raid") {
      var pMax = Number(you && you.patrols) || 0;
      var wMax = Number(you && you.wards) || 0;
      var patrol = Number(sheet.patrol != null ? sheet.patrol : sheet.value) || 0;
      var ward = Number(sheet.ward) || 0;
      var clamped = false;
      if (patrol > pMax) { patrol = pMax; clamped = true; }
      if (ward > wMax) { ward = wMax; clamped = true; }
      if (patrol < 0) patrol = 0;
      if (ward < 0) ward = 0;
      return {
        sheet: Object.assign({}, sheet, {
          controls: { patrol: true, ward: true },
          patrolMax: pMax,
          wardMax: wMax,
          patrol: patrol,
          ward: ward,
          value: patrol,
          submitEnabled: pMax >= 1 && patrol >= 1
        }),
        close: false,
        staleClamped: clamped
      };
    }
    if (sheet.kind === "recall") {
      var u = sheet.unit === "ward" ? "ward" : "patrol";
      var max = u === "ward" ? (Number(you && you.wards) || 0) : (Number(you && you.patrols) || 0);
      var value = Number(sheet.value) || 0;
      var recClamped = false;
      if (value > max) { value = max; recClamped = true; }
      return {
        sheet: Object.assign({}, sheet, {
          unit: u,
          max: max,
          value: value,
          submitEnabled: max >= 1 && value >= 1
        }),
        close: false,
        staleClamped: recClamped
      };
    }
    return { sheet: sheet, close: false };
  }

  function choiceEntryVisible(you, flags) {
    flags = flags || {};
    if (flags.finished || flags.phase === "finished") return false;
    return !!(you && you.pending_choice);
  }

  function captureCommandCheckpoint(match, ai, extra) {
    if (match && typeof match.advance === "function") match.advance();
    return {
      snap: match.snapshot(extra || {}),
      ai: ai && typeof ai.toJSON === "function" ? ai.toJSON() : null
    };
  }

  function restoreCommandCheckpoint(engine, clock, checkpoint, ai) {
    if (!checkpoint || !checkpoint.snap) return null;
    var restored = engine.restoreMatch(checkpoint.snap, clock);
    if (ai && checkpoint.ai && typeof ai.restore === "function") ai.restore(checkpoint.ai);
    return restored;
  }

  function saveSnapshotOrThrow(Save, storage, snapshot) {
    return Save.save(storage, snapshot);
  }

  return {
    prepareRestartConfirm: prepareRestartConfirm,
    settleRestartConfirm: settleRestartConfirm,
    runRestartConfirm: runRestartConfirm,
    presentationAfterAdvance: presentationAfterAdvance,
    shouldRefreshGameView: shouldRefreshGameView,
    assignControlState: assignControlState,
    resolveRelativeAssign: resolveRelativeAssign,
    workerCount: workerCount,
    openChoiceSheet: openChoiceSheet,
    choiceSubmit: choiceSubmit,
    openRaidSheet: openRaidSheet,
    adjustRaidSheet: adjustRaidSheet,
    raidSubmit: raidSubmit,
    openRecallSheet: openRecallSheet,
    recallSubmit: recallSubmit,
    syncSheet: syncSheet,
    choiceEntryVisible: choiceEntryVisible,
    captureCommandCheckpoint: captureCommandCheckpoint,
    restoreCommandCheckpoint: restoreCommandCheckpoint,
    saveSnapshotOrThrow: saveSnapshotOrThrow
  };
});
