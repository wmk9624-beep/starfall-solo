/* 本機 localStorage 存檔。損壞只提示，唔默默刪除。讀檔用遊戲時間，唔用牆上時鐘跳未來。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./engine.js"), require("./catchup.js"));
  } else {
    root.StarfallSoloSave = factory(root.StarfallSoloEngine, root.StarfallSoloCatchup);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Engine, Catchup) {
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
      "duty_workers", "exploring", "explore_seq", "recovering", "wards", "locked_wards",
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
    if (typeof p.recycle_upgraded !== "boolean" || typeof p.supply_upgraded !== "boolean") {
      throw new Error("升級標記無效。");
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
    if (p.duty_workers > C.DUTY_MAX) throw new Error("值守人數超過上限。");
    if (p.exploring > 1 || p.recovering > 1) throw new Error("重複探索槽。");
    if (p.exploring > 0 && p.recovering > 0) throw new Error("探索與歸途不能同時佔用。");
    if (p.supply_workers > 0 && !p.supply_built) throw new Error("未建成補給棚但已派工。");
    if (p.supply_upgraded && !p.supply_built) throw new Error("未建成補給棚但已升級。");
    var hasTroops = p.patrols > 0 || p.locked_patrols > 0 || p.recalling > 0 || p.wards > 0 || p.locked_wards > 0;
    if ((p.training_complete_at != null || p.recall_complete_at != null || hasTroops) && !p.armory_built) {
      throw new Error("未建成整備艙但已有巡衛或隊列。");
    }
    if (p.training_complete_at != null) {
      if (p.training_unit !== C.UNIT_PATROL && p.training_unit !== C.UNIT_WARD) {
        throw new Error("訓練兵種無效。");
      }
    } else if (p.training_unit != null) {
      throw new Error("無訓練時不應有訓練兵種。");
    }
    if (p.recalling > 0) {
      if (p.recalling_unit !== C.UNIT_PATROL && p.recalling_unit !== C.UNIT_WARD) {
        throw new Error("遣返兵種無效。");
      }
      if (!isFiniteNumber(p.recall_complete_at)) {
        throw new Error("遣返中的人員缺少完成時間。");
      }
    } else if (p.recalling_unit != null) {
      throw new Error("無遣返時不應有遣返兵種。");
    } else if (p.recall_complete_at != null) {
      throw new Error("沒有遣返人員但仍有完成時間。");
    }
    if (p.pending_choice != null) {
      var ch = p.pending_choice;
      if (!ch || typeof ch !== "object") throw new Error("待選擇資料無效。");
      if (!Engine.Events.eventById(ch.event_id)) throw new Error("待選擇事件無效。");
      if (!isFiniteNumber(ch.arrived_at) || !isFiniteNumber(ch.deadline_at)) {
        throw new Error("待選擇時間無效。");
      }
      if (ch.deadline_at < ch.arrived_at) throw new Error("過期或顛倒的待選擇。");
      if (p.exploring !== 1) throw new Error("待選擇與探索槽不一致。");
    } else if (p.exploring === 1) {
      if (p.explore_complete_at == null || !isFiniteNumber(p.explore_complete_at)) {
        throw new Error("探索中缺少到達時間。");
      }
    } else if (p.explore_complete_at != null) {
      throw new Error("無探索時不應有到達時間。");
    }
    if (p.recovering === 1) {
      if (p.recover_complete_at == null || !isFiniteNumber(p.recover_complete_at)) {
        throw new Error("歸途缺少結束時間。");
      }
    } else if (p.recover_complete_at != null) {
      throw new Error("無歸途時不應有歸途時間。");
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
    if (!b.attack_comp || !b.defense_comp) throw new Error(label + "缺少兵種構成。");
    function checkComp(comp, heads, tag) {
      if (!comp || typeof comp !== "object") throw new Error(label + tag + "構成無效。");
      if (!isNonNegInt(comp.patrol) || !isNonNegInt(comp.ward)) throw new Error(label + tag + "兵種無效。");
      if (comp.patrol + comp.ward !== heads) throw new Error(label + tag + "人數與構成不符。");
    }
    checkComp(b.attack_comp, b.attack_force, "攻方");
    checkComp(b.defense_comp, b.defense_force, "守方");
  }

  function validateStory(data) {
    if (!Engine.StoryEngine) throw new Error("缺少故事規則模組。");
    var SE = Engine.StoryEngine;
    if (Object.prototype.hasOwnProperty.call(data, "story_schema") && data.story_schema !== 1) {
      throw new Error("故事存檔版本不支援。");
    }
    if (SE.hasStoryPayload(data)) {
      if (data.story_schema !== 1) throw new Error("新故事存檔缺有效版本標記。");
      if (!data.story || typeof data.story !== "object") throw new Error("新存檔缺故事欄位。");
      SE.validateStoryState(data.story);
      var finished = data.match && data.match.phase === "finished";
      if (finished && data.story.chapter_status === "not_started" && data.story.ending_id == null && !data.story.legacy_finished_unstarted) {
        throw new Error("已結束對局的故事狀態不完整。");
      }
    }
    if (data.ui_route != null && typeof data.ui_route !== "object") {
      throw new Error("介面路由資料無效。");
    }
  }

  function validateSnapshot(data) {
    if (!data || typeof data !== "object") throw new Error("存檔不是物件。");
    if (data.kind !== "starfall-solo") throw new Error("不是單機存檔。");
    if (data.version !== 1) throw new Error("存檔版本不支援。");
    if (!isFiniteNumber(data.clock) || data.clock < 0) throw new Error("存檔計時無效。");
    if (typeof data.paused !== "boolean") throw new Error("暫停標記無效。");
    if (data.manual_paused != null && typeof data.manual_paused !== "boolean") {
      throw new Error("手動暫停標記無效。");
    }
    if (data.wall_anchor != null && !isFiniteNumber(data.wall_anchor)) {
      throw new Error("牆鐘錨點無效。");
    }
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
    if (data.expansion_schema !== 1) throw new Error("擴充版本標記無效。");
    validateStory(data);
    if (pending) {
      var atk = m.players[pending.attacker_id];
      var dfn = m.players[pending.defender_id];
      if (!atk || !dfn) throw new Error("戰鬥玩家不符。");
      if ((atk.locked_patrols + atk.locked_wards) !== pending.attack_force ||
          (dfn.locked_patrols + dfn.locked_wards) !== pending.defense_force) {
        throw new Error("鎖定兵力與戰鬥人數不一致。");
      }
      if (atk.locked_patrols !== pending.attack_comp.patrol || atk.locked_wards !== pending.attack_comp.ward) {
        throw new Error("攻方鎖定兵種與構成不一致。");
      }
      if (dfn.locked_patrols !== pending.defense_comp.patrol || dfn.locked_wards !== pending.defense_comp.ward) {
        throw new Error("守方鎖定兵種與構成不一致。");
      }
    } else if (human.locked_patrols !== 0 || ai.locked_patrols !== 0 || human.locked_wards !== 0 || ai.locked_wards !== 0) {
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
      if (Catchup && typeof Catchup.migrateSnapshot === "function") {
        data = Catchup.migrateSnapshot(data);
      }
      data = Engine.expandMigrate(data);
      if (Engine.StoryEngine && typeof Engine.StoryEngine.migrateSnapshot === "function") {
        data = Engine.StoryEngine.migrateSnapshot(data);
      }
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
    var data = snapshot;
    if (Catchup && typeof Catchup.migrateSnapshot === "function") {
      data = Catchup.migrateSnapshot(snapshot);
    }
    data = Engine.expandMigrate(data);
    if (Engine.StoryEngine && typeof Engine.StoryEngine.migrateSnapshot === "function") {
      data = Engine.StoryEngine.migrateSnapshot(data);
    }
    validateSnapshot(data);
    writeRaw(storage, JSON.stringify(data));
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
