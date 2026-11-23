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
      if (current >= maxPer) inc.reason = "呢座最多派 2 人。";
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
    if (facility !== "recycle" && facility !== "supply") {
      return { ok: false, reason: "呢座設施唔能派工。" };
    }
    var current = workerCount(you, facility);
    var built = facility === "recycle" ? true : !!(you && you.supply_built);
    var state = assignControlState({
      current: current,
      standby: you && you.standby,
      productionOthers: otherProduction(you, facility),
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

  return {
    prepareRestartConfirm: prepareRestartConfirm,
    settleRestartConfirm: settleRestartConfirm,
    runRestartConfirm: runRestartConfirm,
    presentationAfterAdvance: presentationAfterAdvance,
    shouldRefreshGameView: shouldRefreshGameView,
    assignControlState: assignControlState,
    resolveRelativeAssign: resolveRelativeAssign,
    workerCount: workerCount
  };
});
