/* 離線補算：用牆鐘錨點在返回／重載後沿同一時間線追補生產、AI、戰鬥與終局。
 * 唔保證手機系統喺背景真執行。手動暫停同 restart confirm 期間唔補算。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./engine.js"));
  } else {
    root.StarfallSoloCatchup = factory(root.StarfallSoloEngine);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Engine) {
  "use strict";
  var C = Engine.CONST;
  var EPS = C.EPS;

  function defaultWall() {
    return Date.now() / 1000;
  }

  function isLegacyUnanchored(data) {
    return !!(data && data.wall_anchor == null && data.catchup_schema == null);
  }

  function migrateSnapshot(data) {
    if (!data || typeof data !== "object") return data;
    var out = Object.assign({}, data);
    // 真正舊 v1（無 catchup_schema、無牆鐘錨點）一律安全暫停，包括 paused:false。
    if (isLegacyUnanchored(out)) {
      out.manual_paused = true;
      out.wall_anchor = null;
      out.catchup_schema = 2;
      return out;
    }
    if (typeof out.manual_paused !== "boolean") {
      out.manual_paused = typeof out.paused === "boolean" ? out.paused : true;
    }
    if (out.wall_anchor === undefined) {
      out.wall_anchor = null;
    }
    if (typeof out.catchup_schema !== "number") out.catchup_schema = 2;
    return out;
  }

  function nextWallAnchor(prevAnchor, wallNow, flags) {
    flags = flags || {};
    if (flags.manualPaused || flags.confirming || flags.playing === false) return null;
    if (flags.alreadyDetached && prevAnchor != null && isFinite(Number(prevAnchor))) {
      return Number(prevAnchor);
    }
    return wallNow;
  }

  function shouldCatchUp(meta) {
    if (!meta) return false;
    if (meta.confirming) return false;
    if (meta.manual_paused) return false;
    if (meta.phase === "finished") return false;
    if (meta.wall_anchor == null) return false;
    return true;
  }

  function elapsedWall(anchor, wallNow) {
    if (anchor == null || !isFinite(Number(anchor)) || !isFinite(Number(wallNow))) return 0;
    var e = Number(wallNow) - Number(anchor);
    return e > 0 ? e : 0;
  }

  function capTarget(match, fromGameTime, elapsed) {
    var target = fromGameTime + elapsed;
    if (match && match.started_at != null) {
      var limit = match.started_at + C.TIME_LIMIT;
      if (target > limit) target = limit;
    }
    if (target < fromGameTime) target = fromGameTime;
    return target;
  }

  function addTime(times, t, now, cap) {
    if (t == null || !isFinite(t)) return;
    if (t > now + EPS && t <= cap + EPS) times.push(t);
  }

  function nextWakeup(match, ai, now, cap) {
    var times = [];
    if (match.started_at != null) {
      var maxCycle = Math.floor(((cap - match.started_at) + EPS) / C.CYCLE_SECONDS);
      for (var c = 1; c <= maxCycle; c++) {
        if (!match.applied_cycles[c]) {
          addTime(times, match.started_at + c * C.CYCLE_SECONDS, now, cap);
        }
      }
      addTime(times, match.started_at + 90, now, cap);
      addTime(times, match.started_at + C.VICTORY_ELIGIBLE_AT, now, cap);
      addTime(times, match.started_at + C.TIME_LIMIT, now, cap);
    }
    var list = match.playerList();
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      addTime(times, p.training_complete_at, now, cap);
      addTime(times, p.recall_complete_at, now, cap);
      addTime(times, p.explore_complete_at, now, cap);
      addTime(times, p.recover_complete_at, now, cap);
      if (p.pending_choice && p.pending_choice.deadline_at != null) {
        addTime(times, p.pending_choice.deadline_at, now, cap);
      }
      if (p.protection_until > now) addTime(times, p.protection_until, now, cap);
    }
    if (match.battle && !match.battle.resolved) {
      addTime(times, match.battle.resolves_at, now, cap);
    }
    if (match.comms && (!match.campaign_mode || match.campaign_state.chapter === 1) && match.comms.next_at != null) addTime(times, match.comms.next_at, now, cap);
    if (match.campaign_mode && match.campaign_echo && match.campaign_echo.next_at != null) addTime(times, match.campaign_echo.next_at, now, cap);
    if (ai && ai._lastRaidAt != null) addTime(times, ai._lastRaidAt + 90, now, cap);
    if (ai && ai._lastExploreAt != null) addTime(times, ai._lastExploreAt + 90, now, cap);
    times.sort(function (a, b) { return a - b; });
    if (!times.length) return cap;
    return times[0];
  }

  function catchUpTo(match, ai, clock, target, opts) {
    opts = opts || {};
    var start = clock.now();
    var report = {
      started: start,
      target: target,
      steps: 0,
      finished: false,
      skipped: false,
      reason: "",
      ended: start,
    };
    if (!match || match.phase !== "playing") {
      report.skipped = true;
      report.reason = "not_playing";
      return report;
    }
    if (!(target > start + EPS)) {
      report.skipped = true;
      report.reason = "no_elapsed";
      return report;
    }
    var maxSteps = opts.maxSteps || 2000;
    var guard = 0;
    while (match.phase === "playing" && clock.now() + EPS < target && guard < maxSteps) {
      guard += 1;
      var now = clock.now();
      var next = nextWakeup(match, ai, now, target);
      if (next > target) next = target;
      if (next <= now + EPS) next = target;
      if (typeof clock.set === "function") clock.set(next);
      match.advance(next);
      report.steps += 1;
      if (match.phase !== "playing") break;
      if (ai) ai.consider(match, clock.now());
    }
    if (match.phase === "playing" && clock.now() + EPS < target) {
      if (typeof clock.set === "function") clock.set(target);
      match.advance(target);
      if (ai && match.phase === "playing") ai.consider(match, target);
      report.steps += 1;
    }
    if (match.phase === "finished" && match.result) {
      report.finished = true;
      if (typeof clock.set === "function") clock.set(match.result.finished_at);
      if (typeof clock.pause === "function") clock.pause();
    }
    report.ended = clock.now();
    return report;
  }

  function applyOfflineCatchup(match, ai, clock, meta, wallNow, opts) {
    meta = meta || {};
    if (!shouldCatchUp({
      confirming: meta.confirming,
      manual_paused: meta.manual_paused,
      phase: match ? match.phase : "waiting",
      wall_anchor: meta.wall_anchor,
    })) {
      return {
        skipped: true,
        reason: meta.manual_paused ? "manual_pause" : (meta.confirming ? "confirming" : (meta.wall_anchor == null ? "no_anchor" : "not_eligible")),
        ended: clock ? clock.now() : 0,
        elapsed: 0,
        steps: 0,
        finished: false,
      };
    }
    var elapsed = elapsedWall(meta.wall_anchor, wallNow);
    var target = capTarget(match, clock.now(), elapsed);
    var report = catchUpTo(match, ai, clock, target, opts);
    report.elapsed = elapsed;
    report.target = target;
    return report;
  }

  return {
    defaultWall: defaultWall,
    isLegacyUnanchored: isLegacyUnanchored,
    migrateSnapshot: migrateSnapshot,
    nextWallAnchor: nextWallAnchor,
    shouldCatchUp: shouldCatchUp,
    elapsedWall: elapsedWall,
    capTarget: capTarget,
    nextWakeup: nextWakeup,
    catchUpTo: catchUpTo,
    applyOfflineCatchup: applyOfflineCatchup,
  };
});
