/* 墜星前哨單機：由雙人 Python 權威邏輯最小移植嘅可測 JS 引擎。
 * 數值同勝負基線不變。單機明確移除「對手在線先開新戰」。
 * 可注入時鐘；前景／暫停由 ForegroundClock 負責，存檔只記遊戲時間。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./events.js"), require("./story-engine.js"), require("./campaign.js"));
  else root.StarfallSoloEngine = factory(root.StarfallSoloEvents, root.StarfallSoloStoryEngine, root.StarfallSoloCampaign);
})(typeof globalThis !== "undefined" ? globalThis : this, function (Events, StoryEngine, Campaign) {
  "use strict";
  if (!Events) throw new Error("缺少探索事件表。");
  if (!StoryEngine) throw new Error("缺少故事規則模組。");
  var Comms = StoryEngine.Comms;
  if (!Comms) throw new Error("缺少通訊模組。");

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
    // 以下為擴充草案數值，可調、未稱平衡。
    EXPLORE_SECONDS: 60,
    CHOICE_SECONDS: 20,
    RECOVER_SECONDS: 30,
    EXPLORE_RATIONS_COST: 1,
    DUTY_MAX: 1,
    RECYCLE_UPGRADE_ALLOY_COST: 6,
    SUPPLY_UPGRADE_ALLOY_COST: 4,
    WARD_TRAIN_RATIONS_COST: 4,
    WARD_TRAIN_ALLOY_COST: 1,
    UNIT_PATROL: "patrol",
    UNIT_WARD: "ward",
  };
  C.MAX_PRODUCTION_WORKERS = C.ROSTER_SIZE - C.MIN_NOT_IN_PRODUCTION;
  C.UNIT_POWER = {
    patrol: { atk: 1, def: 1 },
    ward: { atk: 0, def: 2 },
  };

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
      training_unit: null,
      recall_complete_at: null,
      recalling_unit: null,
      protection_until: 0,
      duty_workers: 0,
      recycle_upgraded: false,
      supply_upgraded: false,
      exploring: 0,
      explore_complete_at: null,
      explore_seq: 0,
      pending_choice: null,
      recovering: 0,
      recover_complete_at: null,
      wards: 0,
      locked_wards: 0,
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
      (p.standby || 0) +
      (p.recycle_workers || 0) +
      (p.supply_workers || 0) +
      (p.duty_workers || 0) +
      training +
      (p.exploring || 0) +
      (p.recovering || 0) +
      (p.patrols || 0) +
      (p.wards || 0) +
      (p.locked_patrols || 0) +
      (p.locked_wards || 0) +
      (p.recalling || 0)
    );
  }

  function normalizeUnit(unit) {
    if (unit == null || unit === "" || unit === C.UNIT_PATROL) return C.UNIT_PATROL;
    if (unit === C.UNIT_WARD) return C.UNIT_WARD;
    return null;
  }

  function trainCost(unit) {
    unit = normalizeUnit(unit) || C.UNIT_PATROL;
    if (unit === C.UNIT_WARD) {
      return { unit: unit, rations: C.WARD_TRAIN_RATIONS_COST, alloy: C.WARD_TRAIN_ALLOY_COST, label: "守陣" };
    }
    return { unit: C.UNIT_PATROL, rations: C.TRAIN_RATIONS_COST, alloy: C.TRAIN_ALLOY_COST, label: "巡衛" };
  }

  function unitLabel(unit) {
    return unit === C.UNIT_WARD ? "守陣" : "巡衛";
  }

  function emptyComp() {
    return { patrol: 0, ward: 0 };
  }

  function normalizeComp(comp) {
    comp = comp || emptyComp();
    var patrol = Number(comp.patrol) || 0;
    var ward = Number(comp.ward) || 0;
    return { patrol: patrol, ward: ward };
  }

  function compHeads(comp) {
    comp = normalizeComp(comp);
    return comp.patrol + comp.ward;
  }

  function attackPower(comp) {
    comp = normalizeComp(comp);
    return comp.patrol * C.UNIT_POWER.patrol.atk + comp.ward * C.UNIT_POWER.ward.atk;
  }

  function defensePower(comp) {
    comp = normalizeComp(comp);
    return comp.patrol * C.UNIT_POWER.patrol.def + comp.ward * C.UNIT_POWER.ward.def;
  }

  function isPurePatrolComp(comp) {
    comp = normalizeComp(comp);
    return comp.ward === 0;
  }

  function hasAnyUpgrade(p) {
    return !!(p.recycle_upgraded || p.supply_upgraded);
  }

  function cabinPressureHigh(p) {
    return hasAnyUpgrade(p) && (p.duty_workers || 0) < 1;
  }

  function upgradeBonusActive(p) {
    return !cabinPressureHigh(p);
  }

  function idleOf(p, unit) {
    return unit === C.UNIT_WARD ? (p.wards || 0) : (p.patrols || 0);
  }

  function setIdleOf(p, unit, value) {
    if (unit === C.UNIT_WARD) p.wards = value;
    else p.patrols = value;
  }

  function lockedOf(p, unit) {
    return unit === C.UNIT_WARD ? (p.locked_wards || 0) : (p.locked_patrols || 0);
  }

  function addLocked(p, unit, delta) {
    if (unit === C.UNIT_WARD) p.locked_wards = (p.locked_wards || 0) + delta;
    else p.locked_patrols = (p.locked_patrols || 0) + delta;
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
    this.story = StoryEngine.createState();
    this.comms = Comms.createState(0);
    this.campaign_mode = false;
    this.campaign_state = null;
    this.campaign_echo = null;
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
    this.story = StoryEngine.createState();
    this.comms = Comms.createState(now);
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
    function enqueuePlayerTimes(p) {
      if (p.training_complete_at != null && leq(p.training_complete_at, now)) addTime(p.training_complete_at);
      if (p.recall_complete_at != null && leq(p.recall_complete_at, now)) addTime(p.recall_complete_at);
      if (p.explore_complete_at != null && leq(p.explore_complete_at, now)) addTime(p.explore_complete_at);
      if (p.recover_complete_at != null && leq(p.recover_complete_at, now)) addTime(p.recover_complete_at);
      if (p.pending_choice && p.pending_choice.deadline_at != null && leq(p.pending_choice.deadline_at, now)) {
        addTime(p.pending_choice.deadline_at);
      }
    }
    if (this.comms && (!this.campaign_mode || this.campaign_state.chapter === 1) && this.comms.next_at != null && leq(this.comms.next_at, now)) addTime(this.comms.next_at);
    if (this.campaign_mode && this.campaign_echo && this.campaign_echo.next_at != null && leq(this.campaign_echo.next_at, now)) addTime(this.campaign_echo.next_at);
    var list = this.playerList();
    for (var i = 0; i < list.length; i++) enqueuePlayerTimes(list[i]);
    if (this.battle && !this.battle.resolved && leq(this.battle.resolves_at, now)) {
      addTime(this.battle.resolves_at);
    }
    var offsets = [C.VICTORY_ELIGIBLE_AT, C.TIME_LIMIT];
    for (var o = 0; o < offsets.length; o++) {
      var checkpoint = this.started_at + offsets[o];
      if (leq(checkpoint, now)) addTime(checkpoint);
    }

    var appliedAt = {};
    var guard = 0;
    while (this.phase === "playing" && guard < 64) {
      guard += 1;
      var ordered = Object.keys(times)
        .map(function (k) { return times[k]; })
        .filter(function (t) { return !appliedAt[String(t)] && leq(t, now); })
        .sort(function (a, b) { return a - b; });
      if (!ordered.length) break;
      var t = ordered[0];
      appliedAt[String(t)] = true;
      this._applyBatch(t);
      if (this.comms && (!this.campaign_mode || this.campaign_state.chapter === 1) && Comms.arrive(this.comms, t)) this.log(t, "失聯隊電台收到新一段訊息。", "info");
      if (this.campaign_mode && this.campaign_echo && Campaign.echoArrive(this.campaign_echo, t)) this.log(t, "回聲井收到一段新訊息。", "info");
      this._checkVictory(t);
      this.playerList().forEach(enqueuePlayerTimes);
      if (this.battle && !this.battle.resolved && leq(this.battle.resolves_at, now)) {
        addTime(this.battle.resolves_at);
      }
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
        if (upgradeBonusActive(p)) {
          if (p.recycle_upgraded && p.recycle_workers >= 1) alloy += 1;
          if (p.supply_upgraded && p.supply_built && p.supply_workers >= 1) rations += 1;
        }
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
        var trained = normalizeUnit(tp.training_unit) || C.UNIT_PATROL;
        tp.training_complete_at = null;
        tp.training_unit = null;
        setIdleOf(tp, trained, idleOf(tp, trained) + 1);
        this.log(t, tp.display_name + "完成訓練，多咗 1 名" + unitLabel(trained) + "。", "train");
      }
    }
    for (j = 0; j < list.length; j++) {
      var rp = list[j];
      if (rp.recall_complete_at != null && leq(rp.recall_complete_at, t)) {
        var n = rp.recalling;
        rp.recalling = 0;
        rp.recall_complete_at = null;
        rp.standby += n;
        rp.recalling_unit = null;
        this.log(t, rp.display_name + "完成遣返，" + n + " 名巡衛退回待命船員。", "recall");
      }
    }
    this._applyExploreBatch(t);
    if (this.battle && !this.battle.resolved && leq(this.battle.resolves_at, t)) {
      this._resolveBattle(this.battle, t);
    }
  };

  Match.prototype._applyExploreBatch = function (t) {
    if (this.phase !== "playing") return;
    var list = this.playerList();
    var i;
    for (i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.exploring > 0 && !p.pending_choice && p.explore_complete_at != null && leq(p.explore_complete_at, t)) {
        var eventId = p._queued_event_id || Events.hashPick(this.started_at, p.player_id, p.explore_seq);
        p._queued_event_id = null;
        var ev = Events.eventById(eventId) || Events.eventById("quiet_wreck");
        p.pending_choice = {
          event_id: ev.id,
          arrived_at: t,
          deadline_at: t + C.CHOICE_SECONDS
        };
        this.log(t, p.display_name + "探索到達：「" + ev.title + "」。" + C.CHOICE_SECONDS + " 秒內要揀，逾時自動走穩妥路線。", "explore");
      }
    }
    for (i = 0; i < list.length; i++) {
      var cp = list[i];
      if (this.phase !== "playing") return;
      if (cp.pending_choice && leq(cp.pending_choice.deadline_at, t)) {
        this._resolveChoice(cp, "A", t, "timeout");
      }
    }
    for (i = 0; i < list.length; i++) {
      var rp = list[i];
      if (rp.recovering > 0 && rp.recover_complete_at != null && leq(rp.recover_complete_at, t)) {
        var n = rp.recovering;
        rp.recovering = 0;
        rp.recover_complete_at = null;
        rp.standby += n;
        this.log(t, rp.display_name + "探索歸途結束，" + n + " 人返回待命。", "explore");
      }
    }
  };

  Match.prototype._resolveChoice = function (player, option, t, reason) {
    if (this.phase !== "playing") return { skipped: true };
    if (!player.pending_choice) throw new CommandError("而家冇待抉擇嘅探索事件。", "no_choice");
    var ev = Events.eventById(player.pending_choice.event_id);
    if (!ev) throw new CommandError("探索事件無效。", "bad_request");
    option = option === "B" ? "B" : "A";
    if (option === "B" && !Events.canPickB(ev, player)) {
      throw new CommandError("條件唔夠，唔能選呢條路線。", "no_rations");
    }
    if (player.exploring !== 1) throw new CommandError("探索人數異常。", "bad_state");

    player.pending_choice = null;
    player.exploring = 0;
    player.explore_complete_at = null;
    var recover = false;
    if (ev.id === "quiet_wreck") {
      if (option === "A") player.alloy += 2;
      else { player.alloy += 4; recover = true; }
    } else if (ev.id === "dry_crate") {
      if (option === "A") player.rations += 3;
      else { player.rations += 6; recover = true; }
    } else if (ev.id === "edge_scrap") {
      if (option === "A") player.alloy += 1;
      else { player.alloy += 3; recover = true; }
    } else if (ev.id === "signal_noise") {
      if (option === "B") {
        player.alloy += 2;
        player.rations -= 2;
      }
    }
    if (recover) {
      player.recovering = 1;
      player.recover_complete_at = t + C.RECOVER_SECONDS;
    } else {
      player.standby += 1;
    }
    var how = reason === "timeout" ? "逾時採用穩妥路線。" : ("選擇咗" + (option === "B" ? "冒險" : "穩妥") + "路線。");
    var opt = option === "B" ? ev.optionB : ev.optionA;
    if (player.player_id === C.HUMAN_ID && this.comms && !this.comms.clue) {
      this.comms.clue = true;
      this.log(t, "探索紀錄為失聯隊電台補足一段地形線索。", "info");
    }
    this.log(t, player.display_name + how + opt.detail + (recover ? "" : ""), "explore");
    return { option: option, event_id: ev.id, recover: recover };
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

    var atkComp = normalizeComp(battle.attack_comp || { patrol: A, ward: 0 });
    var dfnComp = normalizeComp(battle.defense_comp || { patrol: D, ward: 0 });
    var pure = isPurePatrolComp(atkComp) && isPurePatrolComp(dfnComp);
    var atkScore = pure ? A : attackPower(atkComp);
    var dfnScore = pure ? D : defensePower(dfnComp);

    var outcome, atkCas, dfnCas, loot;
    if (atkScore > dfnScore) {
      outcome = "attack_win";
      atkCas = Math.floor(Math.min(A, D) / 2);
      dfnCas = Math.min(A, D);
      loot = this._loot(A - atkCas, dfn);
    } else if (atkScore < dfnScore) {
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

    var atkLocked = (atk.locked_patrols || 0) + (atk.locked_wards || 0);
    var dfnLocked = (dfn.locked_patrols || 0) + (dfn.locked_wards || 0);
    if (atkLocked < A || dfnLocked < D) {
      atkCas = Math.min(atkCas, atkLocked);
      dfnCas = Math.min(dfnCas, dfnLocked);
    }

    // 攻方傷亡先巡衛後守陣；守方先守陣後巡衛。純巡衛時等同舊帳。
    function applyCasualties(side, comp, cas, order) {
      var left = cas;
      var i, typ, take;
      for (i = 0; i < order.length; i++) {
        typ = order[i];
        take = Math.min(left, typ === "ward" ? comp.ward : comp.patrol);
        if (typ === "ward") {
          side.locked_wards = (side.locked_wards || 0) - comp.ward;
          side.wards = (side.wards || 0) + (comp.ward - take);
        } else {
          side.locked_patrols = (side.locked_patrols || 0) - comp.patrol;
          side.patrols = (side.patrols || 0) + (comp.patrol - take);
        }
        left -= take;
      }
      side.standby += cas;
    }
    applyCasualties(atk, atkComp, atkCas, ["patrol", "ward"]);
    applyCasualties(dfn, dfnComp, dfnCas, ["ward", "patrol"]);

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
    if (this.campaign_mode) Campaign.settle(this);
    else { this.story = StoryEngine.closeIfUnfinished(this.story, t); Comms.forceClose(this.comms); }
    this.log(t, "對局結束：" + winner.display_name + "勝出。" + reason + "。", "result");
  };

  Match.prototype._finishDraw = function (t, reason) {
    this.phase = "finished";
    this.result = { kind: "draw", winner_id: null, reason: reason, finished_at: t };
    if (this.campaign_mode) Campaign.settle(this);
    else { this.story = StoryEngine.closeIfUnfinished(this.story, t); Comms.forceClose(this.comms); }
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
    var typ = String((payload && payload.type) || "");
    if (this.campaign_mode && this.phase === "finished" && (typ === "campaign_confirm_ch1" || typ === "campaign_confirm_ch2")) {
      if (playerId !== C.HUMAN_ID) throw new CommandError("章節只限玩家。", "unauthorized");
      var settled = typ === "campaign_confirm_ch1" ? this._cmdCampaignConfirmOne() : this._cmdCampaignConfirmTwo(player);
      var wrappedFinished = Object.assign({ok:true,command_id:commandId}, settled);
      this.processed_commands[dedupKey] = wrappedFinished;
      return clone(wrappedFinished);
    }
    if (this.phase === "finished") {
      throw new CommandError("對局已經結束，唔能再下指令。", "finished");
    }
    if (this.phase !== "playing") {
      throw new CommandError("對局未開始。", "waiting");
    }
    var result;
    if (typ === "assign") result = this._cmdAssign(player, payload, now);
    else if (typ === "build") result = this._cmdBuild(player, payload, now);
    else if (typ === "upgrade") result = this._cmdUpgrade(player, payload, now);
    else if (typ === "train") result = this._cmdTrain(player, payload, now);
    else if (typ === "recall") result = this._cmdRecall(player, payload, now);
    else if (typ === "raid") result = this._cmdRaid(player, payload, now);
    else if (typ === "explore") result = this._cmdExplore(player, payload, now);
    else if (typ === "choose") result = this._cmdChoose(player, payload, now);
    else if (typ === "story_choice") result = this._cmdStoryChoice(player, payload, now);
    else if (typ === "comms_choice") result = this._cmdCommsChoice(player, payload, now);
    else if (typ === "guide_skip") result = this._cmdGuideSkip(player, payload, now);
    else if (typ === "echo_choice") result = this._cmdEchoChoice(player, payload, now);
    else if (typ === "campaign_confirm_ch1") result = this._cmdCampaignConfirmOne(player);
    else if (typ === "campaign_confirm_ch2") result = this._cmdCampaignConfirmTwo(player);
    else throw new CommandError("唔識呢種指令。", "bad_request");

    var wrapped = Object.assign({ ok: true, command_id: commandId }, result);
    if (playerId === C.HUMAN_ID) Comms.observeAction(this.comms, typ, payload);
    this.processed_commands[dedupKey] = wrapped;
    this.advance(now);
    return clone(wrapped);
  };

  Match.prototype._cmdAssign = function (player, payload, now) {
    var facility = String((payload && payload.facility) || "");
    var count = Number(payload && payload.count);
    if (!Number.isInteger(count)) throw new CommandError("派工人數無效。", "bad_request");
    if (facility === "duty") {
      if (count < 0 || count > C.DUTY_MAX) throw new CommandError("值守最多 1 人。", "limit");
      var dutyDelta = count - (player.duty_workers || 0);
      if (dutyDelta > 0 && player.standby < dutyDelta) {
        throw new CommandError("待命船員唔夠派。", "no_crew");
      }
      player.standby -= dutyDelta;
      player.duty_workers = count;
      this.log(now, player.display_name + "將指揮艙值守設為 " + count + " 人。", "assign");
      return { assigned: { facility: "duty", count: count } };
    }
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

  Match.prototype._cmdUpgrade = function (player, payload, now) {
    var facility = String((payload && payload.facility) || "");
    if (facility === "recycle") {
      if (player.recycle_upgraded) throw new CommandError("回收廠已經升級，不可拆除或退款。", "already_built");
      if (player.alloy < C.RECYCLE_UPGRADE_ALLOY_COST) {
        throw new CommandError("合金不足，深拆裝置要 " + C.RECYCLE_UPGRADE_ALLOY_COST + "。", "no_alloy");
      }
      player.alloy -= C.RECYCLE_UPGRADE_ALLOY_COST;
      player.recycle_upgraded = true;
      this.log(now, player.display_name + "升級回收廠「深拆裝置」，花費合金 " + C.RECYCLE_UPGRADE_ALLOY_COST + "。艙壓過高時只暫停加成。", "upgrade");
      return { upgraded: "recycle" };
    }
    if (facility === "supply") {
      if (!player.supply_built) throw new CommandError("補給棚未建成，唔能升級。", "not_built");
      if (player.supply_upgraded) throw new CommandError("補給棚已經升級，不可拆除或退款。", "already_built");
      if (player.alloy < C.SUPPLY_UPGRADE_ALLOY_COST) {
        throw new CommandError("合金不足，密植槽要 " + C.SUPPLY_UPGRADE_ALLOY_COST + "。", "no_alloy");
      }
      player.alloy -= C.SUPPLY_UPGRADE_ALLOY_COST;
      player.supply_upgraded = true;
      this.log(now, player.display_name + "升級補給棚「密植槽」，花費合金 " + C.SUPPLY_UPGRADE_ALLOY_COST + "。艙壓過高時只暫停加成。", "upgrade");
      return { upgraded: "supply" };
    }
    throw new CommandError("呢座設施唔能升級。", "bad_request");
  };

  Match.prototype._cmdTrain = function (player, payload, now) {
    var unit = normalizeUnit(payload && payload.unit);
    if (!unit) throw new CommandError("唔識呢種兵種。", "bad_request");
    var cost = trainCost(unit);
    if (!player.armory_built) throw new CommandError("未建造整備艙，唔能練兵。", "not_built");
    if (trainingActive(player)) {
      throw new CommandError("整備艙隊列最多 1 個，而家已經有訓練進行中。", "busy");
    }
    if (player.rations < cost.rations) {
      if (unit === C.UNIT_PATROL) {
        throw new CommandError("口糧不足（要 3），要搶到或產到口糧先可以再開新訓練。", "no_rations");
      }
      throw new CommandError("口糧不足，練守陣要 " + cost.rations + "。", "no_rations");
    }
    if (player.alloy < cost.alloy) {
      if (unit === C.UNIT_PATROL) {
        throw new CommandError("合金不足，練兵要合金 2。", "no_alloy");
      }
      throw new CommandError("合金不足，練守陣要合金 " + cost.alloy + "。", "no_alloy");
    }
    if (player.standby < 1) throw new CommandError("冇待命船員可以送去訓練。", "no_crew");
    player.rations -= cost.rations;
    player.alloy -= cost.alloy;
    player.standby -= 1;
    player.training_unit = unit;
    player.training_complete_at = now + C.TRAIN_SECONDS;
    this.log(
      now,
      player.display_name +
        "開始訓練" +
        cost.label +
        "，消耗口糧 " +
        cost.rations +
        "、合金 " +
        cost.alloy +
        "，" +
        String(C.TRAIN_SECONDS) +
        " 秒後完成。",
      "train"
    );
    return { training_complete_at: player.training_complete_at, unit: unit };
  };

  Match.prototype._cmdRecall = function (player, payload, now) {
    var count = Number(payload && payload.count);
    if (!Number.isInteger(count)) throw new CommandError("遣返人數無效。", "bad_request");
    if (count < 1) throw new CommandError("至少要遣返 1 名未被鎖定嘅巡衛。", "bad_request");
    if (!player.armory_built) throw new CommandError("未建造整備艙，唔能遣返。", "not_built");
    if (recallActive(player)) throw new CommandError("而家已有遣返進行中。", "busy");
    var unit = normalizeUnit((payload && payload.unit) || C.UNIT_PATROL);
    if (!unit) throw new CommandError("唔識呢種兵種。", "bad_request");
    if (idleOf(player, unit) < count) {
      throw new CommandError("可遣返嘅" + unitLabel(unit) + "唔夠。被鎖定嘅兵力不可遣返。", "locked_or_short");
    }
    setIdleOf(player, unit, idleOf(player, unit) - count);
    player.recalling = count;
    player.recalling_unit = unit;
    player.recall_complete_at = now + C.RECALL_SECONDS;
    this.log(
      now,
      player.display_name +
        "開始遣返 " +
        count +
        " 名" +
        unitLabel(unit) +
        "，" +
        String(C.RECALL_SECONDS) +
        " 秒後退回船員，不退回口糧或合金。",
      "recall"
    );
    return { recall_complete_at: player.recall_complete_at, count: count, unit: unit };
  };

  Match.prototype._parseRaidComp = function (player, payload) {
    if (payload && payload.comp && typeof payload.comp === "object") {
      var patrol = Number(payload.comp.patrol) || 0;
      var ward = Number(payload.comp.ward) || 0;
      if (!Number.isInteger(patrol) || !Number.isInteger(ward) || patrol < 0 || ward < 0) {
        throw new CommandError("出征構成無效。", "bad_request");
      }
      return { patrol: patrol, ward: ward };
    }
    var count = Number(payload && payload.count);
    if (!Number.isInteger(count)) throw new CommandError("出征人數無效。", "bad_request");
    if (count < 1) throw new CommandError("出征至少要 1 名巡衛。", "need_one");
    return { patrol: count, ward: 0 };
  };

  Match.prototype._cmdRaid = function (player, payload, now) {
    var atkComp = this._parseRaidComp(player, payload);
    var A = compHeads(atkComp);
    if (A < 1) throw new CommandError("出征至少要 1 名巡衛。", "need_one");
    if (attackPower(atkComp) < 1) {
      throw new CommandError("無攻勢唔能出征。守陣唔可以獨自或組成無攻勢隊伍去偷空城。", "no_attack");
    }
    var opp = this.opponent(player.player_id);
    if (!opp) throw new CommandError("仲未有對手。", "waiting");
    // 單機明確移除「對手在線」限制：電腦對手永遠在場。
    if (this.battle && !this.battle.resolved) {
      throw new CommandError("同一對玩家同時最多一場未結算戰鬥。", "battle_pending");
    }
    if (now + C.EPS < opp.protection_until) {
      var remain = Math.max(0, Math.round(opp.protection_until - now));
      throw new CommandError("對方受襲保護仲有 " + remain + " 秒，唔能再開戰。", "protected");
    }
    if (player.patrols < atkComp.patrol) {
      throw new CommandError("可出征巡衛唔夠。被鎖定或遣返中嘅巡衛不可再出征。", "locked_or_short");
    }
    if ((player.wards || 0) < atkComp.ward) {
      throw new CommandError("可出征守陣唔夠。被鎖定或遣返中嘅守陣不可再出征。", "locked_or_short");
    }
    var dfnComp = { patrol: opp.patrols || 0, ward: opp.wards || 0 };
    var D = compHeads(dfnComp);
    player.patrols -= atkComp.patrol;
    player.locked_patrols += atkComp.patrol;
    player.wards = (player.wards || 0) - atkComp.ward;
    player.locked_wards = (player.locked_wards || 0) + atkComp.ward;
    opp.patrols -= dfnComp.patrol;
    opp.locked_patrols += dfnComp.patrol;
    opp.wards = (opp.wards || 0) - dfnComp.ward;
    opp.locked_wards = (opp.locked_wards || 0) + dfnComp.ward;
    var battle = {
      battle_id: newId("b_"),
      attacker_id: player.player_id,
      defender_id: opp.player_id,
      attack_force: A,
      defense_force: D,
      attack_comp: atkComp,
      defense_comp: dfnComp,
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

  Match.prototype._cmdExplore = function (player, payload, now) {
    var reason = this.exploreBlockReason(player, now);
    if (reason) throw new CommandError(reason, "explore_blocked");
    if (player.rations < C.EXPLORE_RATIONS_COST) {
      throw new CommandError("口糧不足，出發要 " + C.EXPLORE_RATIONS_COST + "。", "no_rations");
    }
    if (player.standby < 1) throw new CommandError("冇待命船員可以外出探索。", "no_crew");
    player.rations -= C.EXPLORE_RATIONS_COST;
    player.standby -= 1;
    player.exploring = 1;
    player.explore_seq = (player.explore_seq || 0) + 1;
    player.explore_complete_at = now + C.EXPLORE_SECONDS;
    var forced = payload && payload.event_id;
    if (forced) {
      if (!Events.eventById(forced)) throw new CommandError("探索事件無效。", "bad_request");
      player._queued_event_id = forced;
    } else {
      player._queued_event_id = Events.hashPick(this.started_at, player.player_id, player.explore_seq);
    }
    this.log(
      now,
      player.display_name +
        "派出 1 名船員探索，消耗口糧 " +
        C.EXPLORE_RATIONS_COST +
        "，" +
        String(C.EXPLORE_SECONDS) +
        " 秒後到達。",
      "explore"
    );
    return { explore_complete_at: player.explore_complete_at, explore_seq: player.explore_seq };
  };

  Match.prototype._cmdChoose = function (player, payload, now) {
    if (this.phase !== "playing") throw new CommandError("對局已經結束，唔能再選擇。", "finished");
    if (!player.pending_choice) throw new CommandError("而家冇待抉擇嘅探索事件。", "no_choice");
    var option = payload && payload.option;
    if (option !== "A" && option !== "B") throw new CommandError("請選擇 A 或 B。", "bad_request");
    return this._resolveChoice(player, option, now, "chosen");
  };

  Match.prototype.exploreBlockReason = function (player, now) {
    if (this.phase === "waiting") return "對局未開始。";
    if (this.phase === "finished") return "對局已經結束。";
    if ((player.exploring || 0) > 0) return "已經有人外出探索。";
    if (player.pending_choice) return "先要處理到達嘅探索抉擇。";
    if ((player.recovering || 0) > 0) return "還有人喺歸途休養，唔能再出發。";
    if (player.standby < 1) return "冇待命船員可以外出探索。";
    if (player.rations < C.EXPLORE_RATIONS_COST) return "口糧不足，出發要 " + C.EXPLORE_RATIONS_COST + "。";
    return null;
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
    if (player.patrols < 1) {
      if ((player.wards || 0) > 0) return "無攻勢唔能出征。守陣唔可以獨自去偷空城。";
      return "至少要有 1 名可出征巡衛。";
    }
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
      recalling_unit: p.recalling_unit || null,
      recycle_workers: p.recycle_workers,
      supply_workers: p.supply_workers,
      duty_workers: p.duty_workers || 0,
      supply_built: p.supply_built,
      armory_built: p.armory_built,
      recycle_upgraded: !!p.recycle_upgraded,
      supply_upgraded: !!p.supply_upgraded,
      command_built: true,
      training: trainingActive(p),
      training_unit: p.training_unit || null,
      training_remaining: trainLeft,
      recalling_active: recallActive(p),
      recall_remaining: recallLeft,
      protection_remaining: prot,
      wards: p.wards || 0,
      locked_wards: p.locked_wards || 0,
      exploring: p.exploring || 0,
      explore_complete_at: p.explore_complete_at,
      explore_remaining: p.exploring && p.explore_complete_at != null && !p.pending_choice ? Math.max(0, p.explore_complete_at - now) : null,
      pending_choice: p.pending_choice ? Object.assign({}, p.pending_choice, {
        remain: Math.max(0, p.pending_choice.deadline_at - now),
        event: Events.eventById(p.pending_choice.event_id) || null,
        can_pick_b: Events.canPickB(Events.eventById(p.pending_choice.event_id), p)
      }) : null,
      recovering: p.recovering || 0,
      recover_remaining: p.recovering && p.recover_complete_at != null ? Math.max(0, p.recover_complete_at - now) : null,
      pressure_high: cabinPressureHigh(p),
      bonus_active: upgradeBonusActive(p) && hasAnyUpgrade(p),
      roster: roster(p),
    };
  };

  Match.prototype._cmdStoryChoice = function (player, payload, now) {
    if (player.player_id !== C.HUMAN_ID) {
      throw new CommandError("故事指令只限玩家。", "unauthorized");
    }
    var applied = StoryEngine.applyChoice({
      story: this.story,
      choice_id: payload && payload.choice_id,
      node_id: payload && payload.node_id,
      hero_id: payload && payload.hero_id,
      decode_mode: payload && payload.decode_mode,
      expected_story_revision: payload && payload.expected_story_revision,
      command_id: payload && payload.command_id,
      player_alloy: player.alloy,
      player_rations: player.rations,
      phase: this.phase,
      clock: this.clock,
      now: now
    });
    if (!applied.ok) {
      throw new CommandError(applied.reason || "唔能提交呢個故事選擇。", applied.code || "rejected");
    }
    if (applied.duplicate) {
      return { story: StoryEngine.view(this.story), duplicate: true };
    }
    if (applied.alloy_delta) player.alloy += applied.alloy_delta;
    if (applied.rations_delta) player.rations += applied.rations_delta;
    if (player.alloy < 0 || player.rations < 0) {
      throw new CommandError("資源不足，故事選擇未成立。", "no_resource");
    }
    this.story = applied.story;
    if (!invariantsOk(this)) {
      throw new CommandError("故事選擇後狀態不成立。", "invariant");
    }
    var label = (payload && payload.choice_id) || "故事選擇";
    this.log(now, player.display_name + "確認咗故事選擇：" + label + "。", "story");
    return {
      story: StoryEngine.view(this.story),
      alloy_spent: applied.alloy_delta ? -applied.alloy_delta : 0,
      rations_spent: applied.rations_delta ? -applied.rations_delta : 0
    };
  };

  Match.prototype._cmdCommsChoice = function (player, payload, now) {
    if (player.player_id !== C.HUMAN_ID || (this.campaign_mode && this.campaign_state.chapter !== 1)) throw new CommandError("第一章通訊僅限玩家。", "unauthorized");
    var next = clone(this.comms);
    var cost;
    try { cost = Comms.choice(next, payload && payload.choice_id, now, player.alloy); Comms.validate(next); }
    catch (err) { throw new CommandError(err.message || "通訊選擇無效。", "bad_request"); }
    player.alloy -= cost;
    this.comms = next;
    this.log(now, "向失聯隊傳送回覆。", "info");
    return {comms:Comms.view(this.comms, now), alloy_delta:-cost};
  };

  Match.prototype._cmdCampaignConfirmOne = function (player) {
    if (!this.campaign_mode || (player && player.player_id !== C.HUMAN_ID)) throw new CommandError("只可在旅程模式確認章節。", "unauthorized");
    try { return Campaign.confirmCh1(this); } catch(e) { throw new CommandError(e.message, "bad_request"); }
  };

  Match.prototype._cmdCampaignConfirmTwo = function (player) {
    if (!this.campaign_mode || player.player_id !== C.HUMAN_ID) throw new CommandError("只可在旅程模式確認章節。", "unauthorized");
    try { return Campaign.confirmCh2(this); } catch(e) { throw new CommandError(e.message, "bad_request"); }
  };

  Match.prototype._cmdEchoChoice = function (player, payload, now) {
    if (!this.campaign_mode || !this.campaign_state || this.campaign_state.chapter !== 2 || player.player_id !== C.HUMAN_ID) {
      throw new CommandError("回聲井只限第二章玩家。", "unauthorized");
    }
    var next = clone(this.campaign_echo), cost;
    try { cost = Campaign.echoChoice(next, payload && payload.choice_id, now, player.alloy); }
    catch(e) { throw new CommandError(e.message, e.code || "bad_request"); }
    player.alloy -= cost;
    this.campaign_echo = next;
    this.campaign_state.echo = clone(next);
    this.log(now, "回聲井：已傳送玩家選擇。", "story");
    return {echo:clone(next),alloy_delta:-cost};
  };

  Match.prototype._cmdGuideSkip = function (player, payload) {
    if (player.player_id !== C.HUMAN_ID) throw new CommandError("引導僅限玩家。", "unauthorized");
    var task = payload && payload.task;
    if (task !== 'all' && ['assign','build','explore'].indexOf(task) < 0) throw new CommandError("引導任務無效。", "bad_request");
    var list = task === 'all' ? ['assign','build','explore'] : [task];
    for (var i=0;i<list.length;i++) if (this.comms.guide[list[i]] === 'pending') this.comms.guide[list[i]]='skipped';
    return {guide:clone(this.comms.guide)};
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
        attack_comp: source.attack_comp ? normalizeComp(source.attack_comp) : null,
        defense_comp: source.defense_comp ? normalizeComp(source.defense_comp) : null,
      };
    }
    var reason = this.raidBlockReason(viewer, now);
    var exploreReason = this.exploreBlockReason(viewer, now);
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
      explore: { can: exploreReason == null, reason: exploreReason },
      paused: !!(this.clock && this.clock.paused),
      story: StoryEngine.view(this.story),
      comms: Comms.view(this.comms, now, this.story),
      campaign: this.campaign_mode ? {chapter:this.campaign_state.chapter,chapter1_confirmed:this.campaign_state.chapter1_confirmed,chapter1_resolution:this.campaign_state.chapter1_resolution,chapter2_confirmed:this.campaign_state.chapter2_confirmed,history_unknown:this.campaign_state.history_unknown,runs:clone(this.campaign_state.runs),run_id:this.campaign_state.run_id,echo:this.campaign_echo ? clone(this.campaign_echo):null} : null,
    };
  };

  Match.prototype.snapshot = function (extra) {
    extra = extra || {};
    return {
      version: 1,
      kind: "starfall-solo",
      expansion_schema: 1,
      story_schema: 1,
      story: this.story ? clone(this.story) : StoryEngine.createState(),
      comms_schema: 1,
      comms: clone(this.comms),
      ...(this.campaign_mode ? {campaign_run_schema:1} : {}),
      clock: this.clock.now(),
      paused: extra.paused != null ? !!extra.paused : !!(this.clock && this.clock.paused),
      ui_route: extra.ui_route != null ? clone(extra.ui_route) : null,
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
        campaign_mode: !!this.campaign_mode,
        campaign_echo: this.campaign_echo ? clone(this.campaign_echo) : null,
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
    m.campaign_mode = data.campaign_mode === true;
    m.campaign_echo = data.campaign_echo ? clone(data.campaign_echo) : null;
    m.comms = snap.comms ? clone(snap.comms) : Comms.createState(data.started_at || 0);
    if (snap.story) m.story = clone(snap.story);
    else m.story = StoryEngine.createState();
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
      if ((p.wards || 0) < 0 || (p.locked_wards || 0) < 0) return false;
      if (p.recycle_workers < 0 || p.supply_workers < 0) return false;
      if ((p.duty_workers || 0) < 0 || (p.exploring || 0) < 0 || (p.recovering || 0) < 0) return false;
      if ((p.duty_workers || 0) > C.DUTY_MAX) return false;
      if ((p.exploring || 0) > 1 || (p.recovering || 0) > 1) return false;
      if ((p.exploring || 0) > 0 && (p.recovering || 0) > 0) return false;
      if (p.recycle_workers > C.MAX_WORKERS_PER_FACILITY) return false;
      if (p.supply_workers > C.MAX_WORKERS_PER_FACILITY) return false;
      if (productionWorkers(p) > C.MAX_PRODUCTION_WORKERS) return false;
      if (roster(p) !== C.ROSTER_SIZE) return false;
    }
    return true;
  }

  var EXPANSION_DEFAULTS = {
    duty_workers: 0,
    recycle_upgraded: false,
    supply_upgraded: false,
    exploring: 0,
    explore_complete_at: null,
    explore_seq: 0,
    pending_choice: null,
    recovering: 0,
    recover_complete_at: null,
    wards: 0,
    locked_wards: 0,
    training_unit: null,
    recalling_unit: null,
  };

  function isMissing(v) {
    return v === undefined;
  }

  function assertPresentExpansionField(p, key, legacy) {
    if (legacy && isMissing(p[key])) return;
    if (isMissing(p[key])) throw new Error("新存檔缺欄：" + key);
  }

  function expandMigrate(data) {
    if (!data || typeof data !== "object") return data;
    var legacy = !Object.prototype.hasOwnProperty.call(data, "expansion_schema");
    if (!legacy && data.expansion_schema !== 1) {
      throw new Error("存檔擴充版本不支援。");
    }
    var out = Object.assign({}, data);
    if (!out.match || typeof out.match !== "object") return out;
    out.match = Object.assign({}, out.match);
    if (out.match.players) {
      out.match.players = Object.assign({}, out.match.players);
      Object.keys(out.match.players).forEach(function (id) {
        var src = out.match.players[id];
        if (!src || typeof src !== "object") return;
        var p = Object.assign({}, src);
        if (legacy) {
          if (isMissing(p.duty_workers)) p.duty_workers = 0;
          if (isMissing(p.recycle_upgraded)) p.recycle_upgraded = false;
          if (isMissing(p.supply_upgraded)) p.supply_upgraded = false;
          if (isMissing(p.exploring)) p.exploring = 0;
          if (isMissing(p.explore_complete_at)) p.explore_complete_at = null;
          if (isMissing(p.explore_seq)) p.explore_seq = 0;
          if (isMissing(p.pending_choice)) p.pending_choice = null;
          if (isMissing(p.recovering)) p.recovering = 0;
          if (isMissing(p.recover_complete_at)) p.recover_complete_at = null;
          if (isMissing(p.wards)) p.wards = 0;
          if (isMissing(p.locked_wards)) p.locked_wards = 0;
          if (isMissing(p.training_unit)) p.training_unit = p.training_complete_at != null ? C.UNIT_PATROL : null;
          if (isMissing(p.recalling_unit)) p.recalling_unit = p.recalling > 0 ? C.UNIT_PATROL : null;
        }
        out.match.players[id] = p;
      });
    }
    function fillBattle(b) {
      if (!b || typeof b !== "object") return b;
      var c = Object.assign({}, b);
      if (legacy) {
        if (!c.attack_comp) c.attack_comp = { patrol: c.attack_force || 0, ward: 0 };
        if (!c.defense_comp) c.defense_comp = { patrol: c.defense_force || 0, ward: 0 };
      }
      return c;
    }
    if (out.match.battle) out.match.battle = fillBattle(out.match.battle);
    if (out.match.last_battle) out.match.last_battle = fillBattle(out.match.last_battle);
    if (legacy) out.expansion_schema = 1;
    return out;
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
    expandMigrate: expandMigrate,
    trainCost: trainCost,
    attackPower: attackPower,
    defensePower: defensePower,
    cabinPressureHigh: cabinPressureHigh,
    upgradeBonusActive: upgradeBonusActive,
    Events: Events,
    EXPANSION_DEFAULTS: EXPANSION_DEFAULTS,
    StoryEngine: StoryEngine,
    Comms: Comms,
  };
});
