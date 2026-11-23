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

  return {
    prepareRestartConfirm: prepareRestartConfirm,
    settleRestartConfirm: settleRestartConfirm,
    runRestartConfirm: runRestartConfirm,
    presentationAfterAdvance: presentationAfterAdvance,
    shouldRefreshGameView: shouldRefreshGameView,
  };
});
