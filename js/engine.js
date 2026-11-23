/* 墜星前哨單機：由雙人 Python 權威邏輯最小移植嘅可測 JS 引擎。
 * 數值同勝負基線不變。單機明確移除「對手在線先開新戰」。
 * 可注入時鐘；前景／暫停由 ForegroundClock 負責，存檔只記遊戲時間。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.StarfallSoloEngine = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var C = {
    START_RATIONS: 20,
    START_ALLOY: 8,
    ROSTER_SIZE: 6,
    START_STANDBY: 6,
    START_PATROLS: 0,
    CYCLE_SECONDS: 30,
    TRAIN_SECONDS: 30,
    RECALL_SECONDS: 30,
    BATTLE_SECONDS: 30,
    PROTECTION_SECONDS: 90,
    TRAIN_RATIONS_COST: 3,
    TRAIN_ALLOY_COST: 2,
    SUPPLY_ALLOY_COST: 5,
    ARMORY_ALLOY_COST: 8,
    MAX_WORKERS_PER_FACILITY: 2,
    MIN_NOT_IN_PRODUCTION: 1,
    CARRY_PER_SURVIVOR: 4,
    FLOOR_RATIONS: 6,
    FLOOR_ALLOY: 6,
    VICTORY_ALLOY: 40,
    VICTORY_ELIGIBLE_AT: 8 * 60,
    TIME_LIMIT: 15 * 60,
    EPS: 1e-9,
    HUMAN_ID: "p_human",
    AI_ID: "p_ai",
    HUMAN_NAME: "倖存者",
    AI_NAME: "自動前哨",
  };
  C.MAX_PRODUCTION_WORKERS = C.ROSTER_SIZE - C.MIN_NOT_IN_PRODUCTION;

  function CommandError(message, code) {
    this.name = "CommandError";
    this.message = message;
    this.code = code || "rejected";
  }
  CommandError.prototype = Object.create(Error.prototype);
  CommandError.prototype.constructor = CommandError;

  function near(a, b) {
    return Math.abs(a - b) <= C.EPS;
  }

  function leq(a, b) {
    return a <= b + C.EPS;
  }

  function isProductionCycle(elapsed) {
    var cycle = Math.round(elapsed / C.CYCLE_SECONDS);
    if (cycle >= 1 && near(elapsed, cycle * C.CYCLE_SECONDS)) {
      return { ok: true, cycle: cycle };
    }
    return { ok: false, cycle: cycle };
  }

  function defaultWall() {
    if (typeof performance !== "undefined" && performance.now) {
      return performance.now() / 1000;
    }
    return Date.now() / 1000;
  }

  function FrozenClock(start) {
    this._now = Number(start || 0);
  }
  FrozenClock.prototype.now = function () {
    return this._now;
  };
  FrozenClock.prototype.set = function (value) {
    this._now = Number(value);
    return this._now;
  };
  FrozenClock.prototype.advance = function (seconds) {
    this._now += Number(seconds);
    return this._now;
  };
  Object.defineProperty(FrozenClock.prototype, "paused", {
    get: function () { return true; },
  });
  FrozenClock.prototype.pause = function () {
    return this._now;
  };
  FrozenClock.prototype.resume = function () {
    return this._now;
  };

  function ForegroundClock(start, opts) {
    opts = opts || {};
    this._now = Number(start || 0);
    this._running = false;
    this._anchor = 0;
    this._wall = opts.wall || defaultWall;
  }
  ForegroundClock.prototype.now = function () {
    if (!this._running) return this._now;
    return this._now + (this._wall() - this._anchor);
  };
  ForegroundClock.prototype.pause = function () {
    if (this._running) {
      this._now = this.now();
      this._running = false;
    }
    return this._now;
  };
  ForegroundClock.prototype.resume = function () {
    if (!this._running) {
      this._anchor = this._wall();
      this._running = true;
    }
    return this._now;
  };
  ForegroundClock.prototype.set = function (value) {
    this._now = Number(value);
    if (this._running) this._anchor = this._wall();
    return this._now;
  };
  Object.defineProperty(ForegroundClock.prototype, "paused", {
    get: function () {
      return !this._running;
    },
  });

  function newId(prefix) {
    prefix = prefix || "";
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    }
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function makePlayer(id, name) {
    return {
      player_id: id,
      display_name: name,
      rations: C.START_RATIONS,
      alloy: C.START_ALLOY,
      standby: C.START_STANDBY,
      patrols: C.START_PATROLS,
      locked_patrols: 0,
      recalling: 0,
      recycle_workers: 0,
      supply_workers: 0,
      supply_built: false,
      armory_built: false,
      training_complete_at: null,
      recall_complete_at: null,
      protection_until: 0,
    };
  }

  function trainingActive(p) {
    return p.training_complete_at != null;
  }

  function recallActive(p) {
    return p.recall_complete_at != null;
  }

  function productionWorkers(p) {
    return p.recycle_workers + p.supply_workers;
  }

  function roster(p) {
    var training = trainingActive(p) ? 1 : 0;
    return (
      p.standby +
      p.recycle_workers +
      p.supply_workers +
      training +
      p.patrols +
      p.locked_patrols +
      p.recalling
    );
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function Match(clock) {
    this.clock = clock;
    this.players = {};
    this.phase = "waiting";
    this.started_at = null;
    this.result = null;
    this.battle = null;
    this.last_battle = null;
    this.applied_cycles = {};
    this.processed_commands = {};
    this.events = [];
    this.event_seq = 0;
    this.mode = "solo";
  }

  Match.prototype.playerList = function () {
    return [this.players[C.HUMAN_ID], this.players[C.AI_ID]].filter(Boolean);
  };

  Match.prototype.opponent = function (playerId) {
    if (playerId === C.HUMAN_ID) return this.players[C.AI_ID] || null;
    if (playerId === C.AI_ID) return this.players[C.HUMAN_ID] || null;
    return null;
  };

  Match.prototype.log = function (t, text, kind) {
    this.event_seq += 1;
    this.events.push({ id: this.event_seq, at: t, text: text, kind: kind || "info" });
    if (this.events.length > 80) this.events = this.events.slice(-80);
  };

  Match.prototype.begin = function (now) {
    if (now == null) now = this.clock.now();
    this.players[C.HUMAN_ID] = makePlayer(C.HUMAN_ID, C.HUMAN_NAME);
    this.players[C.AI_ID] = makePlayer(C.AI_ID, C.AI_NAME);
    this.phase = "playing";
    this.started_at = now;
    this.log(now, "倖存者同自動前哨同時降落殘艙。單機對局開始計時（只計前景時間）。", "sys");
    return this;
  };

  Match.prototype.advance = function (now) {
    if (now == null) now = this.clock.now();
    if (this.phase !== "playing" || this.started_at == null) return;

    var times = {};
    function addTime(t) {
      times[String(t)] = t;
    }
    var elapsed = now - this.started_at;
    if (elapsed + C.EPS >= C.CYCLE_SECONDS) {
      var maxCycle = Math.floor((elapsed + C.EPS) / C.CYCLE_SECONDS);
      for (var c = 1; c <= maxCycle; c++) {
        if (!this.applied_cycles[c]) addTime(this.started_at + c * C.CYCLE_SECONDS);
      }
    }
    var list = this.playerList();
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.training_complete_at != null && leq(p.training_complete_at, now)) {
        addTime(p.training_complete_at);
      }
      if (p.recall_complete_at != null && leq(p.recall_complete_at, now)) {
        addTime(p.recall_complete_at);
      }
    }
    if (this.battle && !this.battle.resolved && leq(this.battle.resolves_at, now)) {
      addTime(this.battle.resolves_at);
    }
    var offsets = [C.VICTORY_ELIGIBLE_AT, C.TIME_LIMIT];
    for (var o = 0; o < offsets.length; o++) {
      var checkpoint = this.started_at + offsets[o];
      if (leq(checkpoint, now)) addTime(checkpoint);
    }

    var ordered = Object.keys(times)
      .map(function (k) { return times[k]; })
      .sort(function (a, b) { return a - b; });
    for (var ti = 0; ti < ordered.length; ti++) {
      var t = ordered[ti];
      if (this.phase !== "playing") break;
      if (t > now + C.EPS) break;
      this._applyBatch(t);
      this._checkVictory(t);
    }
  };

  Match.prototype._applyBatch = function (t) {
    if (this.started_at == null) return;
    var elapsed = t - this.started_at;
    var cyc = isProductionCycle(elapsed);
    if (cyc.ok && !this.applied_cycles[cyc.cycle] && cyc.cycle >= 1) {
      this.applied_cycles[cyc.cycle] = true;
      var plist = this.playerList();
      for (var i = 0; i < plist.length; i++) {
        var p = plist[i];
        var alloy = p.recycle_workers * 1;
        var rations = p.supply_built ? p.supply_workers * 2 : 0;
        p.alloy += alloy;
        p.rations += rations;
        if (alloy || rations) {
          this.log(t, p.display_name + "本週期回收合金 " + alloy + "、補給口糧 " + rations + "。", "prod");
        }
      }
    }
    var list = this.playerList();
    var j;
    for (j = 0; j < list.length; j++) {
      var tp = list[j];
      if (tp.training_complete_at != null && leq(tp.training_complete_at, t)) {
        tp.training_complete_at = null;
        tp.patrols += 1;
        this.log(t, tp.display_name + "完成訓練，多咗 1 名巡衛。", "train");
      }
    }
    for (j = 0; j < list.length; j++) {
      var rp = list[j];
      if (rp.recall_complete_at != null && leq(rp.recall_complete_at, t)) {
        var n = rp.recalling;
        rp.recalling = 0;
        rp.recall_complete_at = null;
        rp.standby += n;
        this.log(t, rp.display_name + "完成遣返，" + n + " 名巡衛退回待命船員。", "recall");
      }
    }
    if (this.battle && !this.battle.resolved && leq(this.battle.resolves_at, t)) {
      this._resolveBattle(this.battle, t);
    }
  };

  Match.prototype._loot = function (survivors, defender) {
    var cap = survivors * C.CARRY_PER_SURVIVOR;
    var lootableAlloy = Math.max(0, defender.alloy - C.FLOOR_ALLOY);
    var lootableRations = Math.max(0, defender.rations - C.FLOOR_RATIONS);
    var takeAlloy = Math.min(lootableAlloy, cap);
    var takeRations = Math.min(lootableRations, cap - takeAlloy);
    return { alloy: takeAlloy, rations: takeRations };
  };

  Match.prototype._resolveBattle = function (battle, t) {
    if (battle.resolved) return;
    var A = battle.attack_force;
    var D = battle.defense_force;
    var atk = this.players[battle.attacker_id];
    var dfn = this.players[battle.defender_id];

    var outcome, atkCas, dfnCas, loot;
    if (A > D) {
      outcome = "attack_win";
      atkCas = Math.floor(Math.min(A, D) / 2);
      dfnCas = Math.min(A, D);
      loot = this._loot(A - atkCas, dfn);
    } else if (A < D) {
      outcome = "defense_win";
      atkCas = Math.min(A, D);
      dfnCas = Math.floor(Math.min(A, D) / 2);
      loot = { alloy: 0, rations: 0 };
    } else {
      outcome = "draw";
      atkCas = A >= 1 ? 1 : 0;
      dfnCas = D >= 1 ? 1 : 0;
      loot = { alloy: 0, rations: 0 };
    }

    if (atk.locked_patrols < A || dfn.locked_patrols < D) {
      atkCas = Math.min(atkCas, atk.locked_patrols);
      dfnCas = Math.min(dfnCas, dfn.locked_patrols);
    }

    atk.locked_patrols -= A;
    atk.patrols += A - atkCas;
    atk.standby += atkCas;

    dfn.locked_patrols -= D;
    dfn.patrols += D - dfnCas;
    dfn.standby += dfnCas;

    dfn.alloy -= loot.alloy;
    dfn.rations -= loot.rations;
    atk.alloy += loot.alloy;
    atk.rations += loot.rations;

    dfn.protection_until = t + C.PROTECTION_SECONDS;
    battle.resolved = true;
    battle.resolution = {
      outcome: outcome,
      attack_force: A,
      defense_force: D,
      attacker_casualties: atkCas,
      defender_casualties: dfnCas,
      loot_alloy: loot.alloy,
      loot_rations: loot.rations,
      resolved_at: t,
    };
    this.last_battle = battle;
    this.battle = null;

    var text;
    if (outcome === "attack_win") {
      text =
        atk.display_name + "攻勝 " + dfn.display_name + "（" + A + " 對 " + D + "）。" +
        "傷亡：攻 " + atkCas + "、守 " + dfnCas + "，全部退回船員。" +
        "掠奪合金 " + loot.alloy + "、口糧 " + loot.rations + "。";
    } else if (outcome === "defense_win") {
      text =
        dfn.display_name + "守住前哨（" + A + " 對 " + D + "）。" +
        "傷亡：攻 " + atkCas + "、守 " + dfnCas + "，全部退回船員。今次冇掠奪。";
    } else {
      text =
        atk.display_name + "同 " + dfn.display_name + "打和（" + A + " 對 " + D + "）。" +
        "雙方各退回 " + (atkCas || 0) + " 名巡衛做船員。今次冇掠奪。";
    }
    this.log(t, text + "守方受襲保護 " + String(C.PROTECTION_SECONDS) + " 秒。", "battle");
  };

  Match.prototype._checkVictory = function (t) {
    if (this.phase !== "playing" || this.started_at == null) return;
    var elapsed = t - this.started_at;
    if (elapsed + C.EPS < C.VICTORY_ELIGIBLE_AT) return;
    var players = this.playerList();
    if (players.length !== 2) return;
    var p1 = players[0];
    var p2 = players[1];
    var a1 = p1.alloy >= C.VICTORY_ALLOY;
    var a2 = p2.alloy >= C.VICTORY_ALLOY;
    if (a1 && a2) {
      this._finishDraw(t, "雙方喺同一批次都達到合金 40，判和");
      return;
    }
    if (a1 || a2) {
      this._finishWin(t, a1 ? p1 : p2, "達到合金 40 嘅一方勝出");
      return;
    }
    if (elapsed + C.EPS >= C.TIME_LIMIT) {
      if (p1.alloy !== p2.alloy) {
        this._finishWin(t, p1.alloy > p2.alloy ? p1 : p2, "滿 15 分鐘，現有合金較高");
      } else if (p1.rations !== p2.rations) {
        this._finishWin(t, p1.rations > p2.rations ? p1 : p2, "滿 15 分鐘，合金相同，現有口糧較高");
      } else {
        this._finishDraw(t, "滿 15 分鐘，合金同口糧都相同，判和");
      }
    }
  };

  Match.prototype._finishWin = function (t, winner, reason) {
    this.phase = "finished";
    this.result = { kind: "win", winner_id: winner.player_id, reason: reason, finished_at: t };
    this.log(t, "對局結束：" + winner.display_name + "勝出。" + reason + "。", "result");
  };

  Match.prototype._finishDraw = function (t, reason) {
    this.phase = "finished";
    this.result = { kind: "draw", winner_id: null, reason: reason, finished_at: t };
    this.log(t, "對局結束：和局。" + reason + "。", "result");
  };

  Match.prototype.command = function (playerId, payload, now) {
    if (now == null) now = this.clock.now();
    this.advance(now);
    var commandId = String((payload && payload.command_id) || "").trim();
    if (!commandId) throw new CommandError("指令缺少 command_id。", "bad_request");
    var player = this.players[playerId];
    if (!player) throw new CommandError("會話無效。", "unauthorized");
    var dedupKey = player.player_id + "::" + commandId;
    if (Object.prototype.hasOwnProperty.call(this.processed_commands, dedupKey)) {
      return clone(this.processed_commands[dedupKey]);
    }
    if (this.phase === "finished") {
      throw new CommandError("對局已經結束，唔能再下指令。", "finished");
    }
    if (this.phase !== "playing") {
      throw new CommandError("對局未開始。", "waiting");
    }
    var typ = String((payload && payload.type) || "");
    var result;
    if (typ === "assign") result = this._cmdAssign(player, payload, now);
    else if (typ === "build") result = this._cmdBuild(player, payload, now);
    else if (typ === "train") result = this._cmdTrain(player, now);
    else if (typ === "recall") result = this._cmdRecall(player, payload, now);
    else if (typ === "raid") result = this._cmdRaid(player, payload, now);
    else throw new CommandError("唔識呢種指令。", "bad_request");

    var wrapped = Object.assign({ ok: true, command_id: commandId }, result);
    this.processed_commands[dedupKey] = wrapped;
    this.advance(now);
    return clone(wrapped);
  };

  Match.prototype._cmdAssign = function (player, payload, now) {
    var facility = String((payload && payload.facility) || "");
    var count = Number(payload && payload.count);
    if (!Number.isInteger(count)) throw new CommandError("派工人數無效。", "bad_request");
    if (count < 0 || count > C.MAX_WORKERS_PER_FACILITY) {
      throw new CommandError("每個產出設施最多派 2 人。", "limit");
    }
    var current;
    if (facility === "recycle") current = player.recycle_workers;
    else if (facility === "supply") {
      if (!player.supply_built) throw new CommandError("補給棚未建成，唔能夠派工。", "not_built");
      current = player.supply_workers;
    } else {
      throw new CommandError("呢座設施唔能派工。", "bad_request");
    }
    var delta = count - current;
    if (delta > 0 && player.standby < delta) {
      throw new CommandError("待命船員唔夠派。", "no_crew");
    }
    var newRecycle = facility === "recycle" ? count : player.recycle_workers;
    var newSupply = facility === "supply" ? count : player.supply_workers;
    if (newRecycle + newSupply > C.MAX_PRODUCTION_WORKERS) {
      throw new CommandError("至少要留 1 人唔投入生產。", "must_keep_one");
    }
    player.standby -= delta;
    var name;
    if (facility === "recycle") {
      player.recycle_workers = count;
      name = "回收廠";
    } else {
      player.supply_workers = count;
      name = "補給棚";
    }
    this.log(now, player.display_name + "將" + name + "派工設為 " + count + " 人。", "assign");
    return { assigned: { facility: facility, count: count } };
  };

  Match.prototype._cmdBuild = function (player, payload, now) {
    var facility = String((payload && payload.facility) || "");
    if (facility === "supply") {
      if (player.supply_built) {
        throw new CommandError("補給棚已經建成，每種設施最多一座，不可拆除或退款。", "already_built");
      }
      if (player.alloy < C.SUPPLY_ALLOY_COST) {
        throw new CommandError("合金不足，起補給棚要 " + C.SUPPLY_ALLOY_COST + "。", "no_alloy");
      }
      player.alloy -= C.SUPPLY_ALLOY_COST;
      player.supply_built = true;
      this.log(now, player.display_name + "建成補給棚，花費合金 " + C.SUPPLY_ALLOY_COST + "。", "build");
      return { built: "supply" };
    }
    if (facility === "armory") {
      if (player.armory_built) {
        throw new CommandError("整備艙已經建成，每種設施最多一座，不可拆除或退款。", "already_built");
      }
      if (player.alloy < C.ARMORY_ALLOY_COST) {
        throw new CommandError("合金不足，起整備艙要 " + C.ARMORY_ALLOY_COST + "。", "no_alloy");
      }
      player.alloy -= C.ARMORY_ALLOY_COST;
      player.armory_built = true;
      this.log(now, player.display_name + "建成整備艙，花費合金 " + C.ARMORY_ALLOY_COST + "。", "build");
      return { built: "armory" };
    }
    throw new CommandError("呢座設施唔能建造。", "bad_request");
  };

  Match.prototype._cmdTrain = function (player, now) {
    if (!player.armory_built) throw new CommandError("未建造整備艙，唔能練兵。", "not_built");
    if (trainingActive(player)) {
      throw new CommandError("整備艙隊列最多 1 個，而家已經有訓練進行中。", "busy");
    }
    if (player.rations < C.TRAIN_RATIONS_COST) {
      throw new CommandError("口糧不足（要 3），要搶到或產到口糧先可以再開新訓練。", "no_rations");
    }
    if (player.alloy < C.TRAIN_ALLOY_COST) {
      throw new CommandError("合金不足，練兵要合金 2。", "no_alloy");
    }
    if (player.standby < 1) throw new CommandError("冇待命船員可以送去訓練。", "no_crew");
    player.rations -= C.TRAIN_RATIONS_COST;
    player.alloy -= C.TRAIN_ALLOY_COST;
    player.standby -= 1;
    player.training_complete_at = now + C.TRAIN_SECONDS;
    this.log(
      now,
      player.display_name +
        "開始練兵，消耗口糧 " +
        C.TRAIN_RATIONS_COST +
        "、合金 " +
        C.TRAIN_ALLOY_COST +
        "，" +
        String(C.TRAIN_SECONDS) +
        " 秒後完成。",
      "train"
    );
    return { training_complete_at: player.training_complete_at };
  };

  Match.prototype._cmdRecall = function (player, payload, now) {
    var count = Number(payload && payload.count);
    if (!Number.isInteger(count)) throw new CommandError("遣返人數無效。", "bad_request");
    if (count < 1) throw new CommandError("至少要遣返 1 名未被鎖定嘅巡衛。", "bad_request");
    if (!player.armory_built) throw new CommandError("未建造整備艙，唔能遣返。", "not_built");
    if (recallActive(player)) throw new CommandError("而家已有遣返進行中。", "busy");
    if (player.patrols < count) {
      throw new CommandError("可遣返嘅巡衛唔夠。被鎖定嘅巡衛不可遣返。", "locked_or_short");
    }
    player.patrols -= count;
    player.recalling = count;
    player.recall_complete_at = now + C.RECALL_SECONDS;
    this.log(
      now,
      player.display_name +
        "開始遣返 " +
        count +
        " 名巡衛，" +
        String(C.RECALL_SECONDS) +
        " 秒後退回船員，不退回口糧或合金。",
      "recall"
    );
    return { recall_complete_at: player.recall_complete_at, count: count };
  };

  Match.prototype._cmdRaid = function (player, payload, now) {
    var count = Number(payload && payload.count);
    if (!Number.isInteger(count)) throw new CommandError("出征人數無效。", "bad_request");
    if (count < 1) throw new CommandError("出征至少要 1 名巡衛。", "need_one");
    var opp = this.opponent(player.player_id);
    if (!opp) throw new CommandError("仲未有對手。", "waiting");
    // 單機明確移除「對手在線」限制：電腦對手永遠在場，背景改為暫停計時。
    if (this.battle && !this.battle.resolved) {
      throw new CommandError("同一對玩家同時最多一場未結算戰鬥。", "battle_pending");
    }
    if (now + C.EPS < opp.protection_until) {
      var remain = Math.max(0, Math.round(opp.protection_until - now));
      throw new CommandError("對方受襲保護仲有 " + remain + " 秒，唔能再開戰。", "protected");
    }
    if (player.patrols < count) {
      throw new CommandError("可出征巡衛唔夠。被鎖定或遣返中嘅巡衛不可再出征。", "locked_or_short");
    }
    var A = count;
    var D = opp.patrols;
    player.patrols -= A;
    player.locked_patrols += A;
    opp.patrols -= D;
    opp.locked_patrols += D;
    var battle = {
      battle_id: newId("b_"),
      attacker_id: player.player_id,
      defender_id: opp.player_id,
      attack_force: A,
      defense_force: D,
      started_at: now,
      resolves_at: now + C.BATTLE_SECONDS,
      resolved: false,
      resolution: null,
    };
    this.battle = battle;
    this.log(
      now,
      player.display_name +
        "向 " +
        opp.display_name +
        "出征 " +
        A +
        " 名巡衛；守軍鎖定 " +
        D +
        " 名。" +
        String(C.BATTLE_SECONDS) +
        " 秒後結算。",
      "battle"
    );
    return {
      battle_id: battle.battle_id,
      attack_force: A,
      defense_force: D,
      resolves_at: battle.resolves_at,
    };
  };

  Match.prototype.raidBlockReason = function (player, now) {
    if (this.phase === "waiting") return "對局未開始。";
    if (this.phase === "finished") return "對局已經結束。";
    var opp = this.opponent(player.player_id);
    if (!opp) return "仲未有對手。";
    if (this.battle && !this.battle.resolved) return "而家已有一場未結算戰鬥。";
    if (now + C.EPS < opp.protection_until) {
      var remain = Math.max(0, Math.round(opp.protection_until - now));
      return "對方受襲保護仲有 " + remain + " 秒。";
    }
    if (player.patrols < 1) return "至少要有 1 名可出征巡衛。";
    return null;
  };

  Match.prototype._playerView = function (p, now) {
    var trainLeft = p.training_complete_at != null ? Math.max(0, p.training_complete_at - now) : null;
    var recallLeft = p.recall_complete_at != null ? Math.max(0, p.recall_complete_at - now) : null;
    var prot = Math.max(0, p.protection_until - now);
    return {
      player_id: p.player_id,
      display_name: p.display_name,
      rations: p.rations,
      alloy: p.alloy,
      standby: p.standby,
      patrols: p.patrols,
      locked_patrols: p.locked_patrols,
      recalling: p.recalling,
      recycle_workers: p.recycle_workers,
      supply_workers: p.supply_workers,
      supply_built: p.supply_built,
      armory_built: p.armory_built,
      command_built: true,
      training: trainingActive(p),
      training_remaining: trainLeft,
      recalling_active: recallActive(p),
      recall_remaining: recallLeft,
      protection_remaining: prot,
      roster: roster(p),
    };
  };

  Match.prototype.publicView = function (viewerId, now) {
    if (now == null) now = this.clock.now();
    this.advance(now);
    var viewer = this.players[viewerId];
    if (!viewer) throw new CommandError("會話無效。", "unauthorized");
    var opp = this.opponent(viewerId);
    var matchTime = 0;
    if (this.started_at != null && this.phase !== "waiting") {
      matchTime = Math.max(0, now - this.started_at);
    }
    if (this.phase === "finished" && this.result) {
      matchTime = Math.max(0, this.result.finished_at - (this.started_at || this.result.finished_at));
    }
    var result = null;
    if (this.result) {
      result = {
        kind: this.result.kind,
        winner_id: this.result.winner_id,
        reason: this.result.reason,
        finished_at: this.result.finished_at,
        you_won: this.result.kind === "win" && this.result.winner_id === viewerId,
      };
    }
    var battle = null;
    var source = this.battle || this.last_battle;
    if (source) {
      battle = {
        battle_id: source.battle_id,
        attacker_id: source.attacker_id,
        defender_id: source.defender_id,
        attack_force: source.attack_force,
        defense_force: source.defense_force,
        started_at: source.started_at,
        resolves_at: source.resolves_at,
        resolved: source.resolved,
        resolution: source.resolution,
        you_attack: source.attacker_id === viewerId,
        remaining: !source.resolved ? Math.max(0, source.resolves_at - now) : 0,
      };
    }
    var reason = this.raidBlockReason(viewer, now);
    return {
      mode: "solo",
      phase: this.phase,
      now: now,
      match_time: matchTime,
      victory_eligible_from: C.VICTORY_ELIGIBLE_AT,
      time_limit: C.TIME_LIMIT,
      you: this._playerView(viewer, now),
      opponent: opp ? this._playerView(opp, now) : null,
      battle: battle,
      result: result,
      events: this.events.slice(),
      raid: { can: reason == null, reason: reason, max: viewer.patrols },
      paused: !!(this.clock && this.clock.paused),
    };
  };

  Match.prototype.snapshot = function (extra) {
    extra = extra || {};
    return {
      version: 1,
      kind: "starfall-solo",
      clock: this.clock.now(),
      paused: extra.paused != null ? !!extra.paused : !!(this.clock && this.clock.paused),
      match: {
        phase: this.phase,
        started_at: this.started_at,
        result: this.result ? clone(this.result) : null,
        battle: this.battle ? clone(this.battle) : null,
        last_battle: this.last_battle ? clone(this.last_battle) : null,
        applied_cycles: Object.keys(this.applied_cycles).map(Number).sort(function (a, b) { return a - b; }),
        processed_commands: clone(this.processed_commands),
        events: clone(this.events),
        event_seq: this.event_seq,
        players: clone(this.players),
        mode: "solo",
      },
    };
  };

  function restoreMatch(snap, clock) {
    if (!snap || snap.kind !== "starfall-solo" || snap.version !== 1 || !snap.match) {
      throw new Error("存檔格式無效。");
    }
    var m = new Match(clock);
    var data = snap.match;
    m.phase = data.phase;
    m.started_at = data.started_at;
    m.result = data.result ? clone(data.result) : null;
    m.battle = data.battle ? clone(data.battle) : null;
    m.last_battle = data.last_battle ? clone(data.last_battle) : null;
    m.applied_cycles = {};
    (data.applied_cycles || []).forEach(function (c) { m.applied_cycles[c] = true; });
    m.processed_commands = data.processed_commands ? clone(data.processed_commands) : {};
    m.events = data.events ? clone(data.events) : [];
    m.event_seq = data.event_seq || 0;
    m.players = data.players ? clone(data.players) : {};
    if (typeof clock.set === "function") clock.set(snap.clock);
    return m;
  }

  function createSoloMatch(clock, now) {
    var m = new Match(clock);
    m.begin(now != null ? now : clock.now());
    return m;
  }

  function invariantsOk(match) {
    var players = match.playerList();
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (p.rations < 0 || p.alloy < 0) return false;
      if (p.standby < 0 || p.patrols < 0 || p.locked_patrols < 0 || p.recalling < 0) return false;
      if (p.recycle_workers < 0 || p.supply_workers < 0) return false;
      if (p.recycle_workers > C.MAX_WORKERS_PER_FACILITY) return false;
      if (p.supply_workers > C.MAX_WORKERS_PER_FACILITY) return false;
      if (productionWorkers(p) > C.MAX_PRODUCTION_WORKERS) return false;
      if (roster(p) !== C.ROSTER_SIZE) return false;
    }
    return true;
  }

  return {
    CONST: C,
    CommandError: CommandError,
    FrozenClock: FrozenClock,
    ForegroundClock: ForegroundClock,
    Match: Match,
    createSoloMatch: createSoloMatch,
    restoreMatch: restoreMatch,
    roster: roster,
    invariantsOk: invariantsOk,
    isProductionCycle: isProductionCycle,
    near: near,
    leq: leq,
  };
});
