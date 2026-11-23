/* 本機 localStorage 存檔。損壞只提示，唔默默刪除。讀檔用遊戲時間，唔用牆上時鐘跳未來。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./engine.js"));
  } else {
    root.StarfallSoloSave = factory(root.StarfallSoloEngine);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Engine) {
  "use strict";
  var SAVE_KEY = "starfall-solo.v1";
  var C = Engine.CONST;

  function isFiniteNumber(n) {
    return typeof n === "number" && isFinite(n);
  }

  function isNonNegInt(n) {
    return Number.isInteger(n) && n >= 0;
  }

  function validatePlayer(p, expectId) {
    if (!p || typeof p !== "object") throw new Error("缺玩家資料。");
    if (p.player_id !== expectId) throw new Error("玩家編號不符。");
    var ints = [
      "rations", "alloy", "standby", "patrols", "locked_patrols", "recalling",
      "recycle_workers", "supply_workers",
    ];
    for (var i = 0; i < ints.length; i++) {
      if (!isNonNegInt(p[ints[i]])) throw new Error("玩家數值無效。");
    }
    if (!isFiniteNumber(p.protection_until) || p.protection_until < 0) {
      throw new Error("保護時間無效。");
    }
    if (typeof p.supply_built !== "boolean" || typeof p.armory_built !== "boolean") {
      throw new Error("設施標記無效。");
    }
    if (p.training_complete_at != null && !isFiniteNumber(p.training_complete_at)) {
      throw new Error("訓練時間無效。");
    }
    if (p.recall_complete_at != null && !isFiniteNumber(p.recall_complete_at)) {
      throw new Error("遣返時間無效。");
    }
    if (p.recycle_workers > C.MAX_WORKERS_PER_FACILITY || p.supply_workers > C.MAX_WORKERS_PER_FACILITY) {
      throw new Error("派工人數超過上限。");
    }
    if (p.recycle_workers + p.supply_workers > C.MAX_PRODUCTION_WORKERS) {
      throw new Error("生產人數超過上限。");
    }
    if (p.supply_workers > 0 && !p.supply_built) throw new Error("未建成補給棚但已派工。");
    if ((p.training_complete_at != null || p.recall_complete_at != null || p.patrols > 0 || p.locked_patrols > 0 || p.recalling > 0) && !p.armory_built) {
      throw new Error("未建成整備艙但已有巡衛或隊列。");
    }
    if (Engine.roster(p) !== C.ROSTER_SIZE) throw new Error("人口編制不符。");
    if (p.rations < 0 || p.alloy < 0) throw new Error("資源不可為負。");
  }

  function validateEvent(ev) {
    if (!ev || typeof ev !== "object") throw new Error("事件資料無效。");
    if (typeof ev.text !== "string") throw new Error("事件文字無效。");
    if (ev.at != null && !isFiniteNumber(ev.at)) throw new Error("事件時間無效。");
  }

  function validateBattle(b, label) {
    if (!b || typeof b !== "object") throw new Error(label + "資料無效。");
    if (typeof b.attacker_id !== "string" || typeof b.defender_id !== "string") {
      throw new Error(label + "雙方無效。");
    }
    if (!isNonNegInt(b.attack_force) || !isNonNegInt(b.defense_force)) {
      throw new Error(label + "兵力無效。");
    }
    if (typeof b.resolved !== "boolean") throw new Error(label + "結算標記無效。");
    if (!isFiniteNumber(b.started_at) || !isFiniteNumber(b.resolves_at)) {
      throw new Error(label + "時間無效。");
    }
  }

  function validateSnapshot(data) {
    if (!data || typeof data !== "object") throw new Error("存檔不是物件。");
    if (data.kind !== "starfall-solo") throw new Error("不是單機存檔。");
    if (data.version !== 1) throw new Error("存檔版本不支援。");
    if (!isFiniteNumber(data.clock) || data.clock < 0) throw new Error("存檔計時無效。");
    if (typeof data.paused !== "boolean") throw new Error("暫停標記無效。");
    var m = data.match;
    if (!m || typeof m !== "object") throw new Error("缺對局資料。");
    if (m.mode !== "solo") throw new Error("對局類型不符。");
    if (m.phase !== "playing" && m.phase !== "finished") throw new Error("對局階段無效。");
    if (!isFiniteNumber(m.started_at)) throw new Error("開局時間無效。");
    if (!m.players || typeof m.players !== "object") throw new Error("缺雙方資料。");
    validatePlayer(m.players[C.HUMAN_ID], C.HUMAN_ID);
    validatePlayer(m.players[C.AI_ID], C.AI_ID);
    if (!Array.isArray(m.applied_cycles) || !Array.isArray(m.events)) {
      throw new Error("週期或事件資料無效。");
    }
    var ci;
    for (ci = 0; ci < m.applied_cycles.length; ci++) {
      if (!Number.isInteger(m.applied_cycles[ci]) || m.applied_cycles[ci] < 1) {
        throw new Error("週期編號無效。");
      }
    }
    for (ci = 0; ci < m.events.length; ci++) validateEvent(m.events[ci]);
    if (m.started_at - Engine.CONST.EPS > data.clock) {
      throw new Error("存檔計時早於開局。");
    }
    if (m.phase === "finished") {
      if (!m.result || typeof m.result !== "object") throw new Error("終局結果缺失。");
      if (m.result.kind !== "win" && m.result.kind !== "draw") throw new Error("終局種類無效。");
      if (!isFiniteNumber(m.result.finished_at)) throw new Error("終局時間無效。");
      if (m.result.kind === "win" && typeof m.result.winner_id !== "string") {
        throw new Error("勝方標記無效。");
      }
      if (m.result.kind === "draw" && m.result.winner_id != null) {
        throw new Error("和局不應有勝方。");
      }
    } else if (m.result != null) {
      throw new Error("進行中對局不應已有終局結果。");
    }
    if (m.battle != null) validateBattle(m.battle, "戰鬥");
    if (m.last_battle != null) validateBattle(m.last_battle, "上一場戰鬥");
    var pending = m.battle && m.battle.resolved === false ? m.battle : null;
    var human = m.players[C.HUMAN_ID];
    var ai = m.players[C.AI_ID];
    if (pending) {
      var atk = m.players[pending.attacker_id];
      var dfn = m.players[pending.defender_id];
      if (!atk || !dfn) throw new Error("戰鬥玩家不符。");
      if (atk.locked_patrols !== pending.attack_force || dfn.locked_patrols !== pending.defense_force) {
        throw new Error("鎖定兵力與戰鬥人數不一致。");
      }
    } else if (human.locked_patrols !== 0 || ai.locked_patrols !== 0) {
      throw new Error("無進行中戰鬥時不應有鎖定兵力。");
    }
    var clock = new Engine.FrozenClock(data.clock);
    var restored = Engine.restoreMatch(data, clock);
    if (!Engine.invariantsOk(restored)) throw new Error("讀取後人口或資源不變條件不成立。");
    return data;
  }

  function readRaw(storage) {
    storage = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!storage) return null;
    try {
      return storage.getItem(SAVE_KEY);
    } catch (err) {
      return null;
    }
  }

  function writeRaw(storage, raw) {
    storage = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!storage) throw new Error("呢個環境冇本機存檔。");
    storage.setItem(SAVE_KEY, raw);
  }

  function load(storage) {
    var raw = readRaw(storage);
    if (raw == null || raw === "") {
      return { ok: true, empty: true, raw: raw };
    }
    try {
      var data = JSON.parse(raw);
      validateSnapshot(data);
      return { ok: true, empty: false, data: data, raw: raw };
    } catch (err) {
      return {
        ok: false,
        empty: false,
        error: "存檔損壞或無法解讀。原存檔仍保留，沒有被刪除。",
        detail: err && err.message ? String(err.message) : "",
        raw: raw,
      };
    }
  }

  function save(storage, snapshot) {
    validateSnapshot(snapshot);
    writeRaw(storage, JSON.stringify(snapshot));
    return { ok: true };
  }

  function clear(storage) {
    storage = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!storage) return;
    storage.removeItem(SAVE_KEY);
  }

  return {
    SAVE_KEY: SAVE_KEY,
    validateSnapshot: validateSnapshot,
    load: load,
    save: save,
    clear: clear,
    readRaw: readRaw,
  };
});
