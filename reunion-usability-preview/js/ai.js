/* 固定規則電腦對手。只用同一套 command API，不暗送資源，無難度檔。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./engine.js"));
  } else {
    root.StarfallSoloAI = factory(root.StarfallSoloEngine);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Engine) {
  "use strict";
  var C = Engine.CONST;
  var CommandError = Engine.CommandError;

  function SoloAI(opts) {
    opts = opts || {};
    this.playerId = opts.playerId || C.AI_ID;
    this._seq = 0;
    this._lastRaidAt = null;
    this._lastExploreAt = null;
  }

  SoloAI.prototype._cid = function () {
    this._seq += 1;
    return "ai-" + this._seq;
  };

  SoloAI.prototype.tryCommand = function (match, payload) {
    payload = Object.assign({ command_id: this._cid() }, payload);
    try {
      return { ok: true, result: match.command(this.playerId, payload) };
    } catch (err) {
      if (err instanceof CommandError || (err && err.name === "CommandError")) {
        return { ok: false, error: err };
      }
      throw err;
    }
  };

  SoloAI.prototype.consider = function (match, now) {
    if (now == null) now = match.clock.now();
    match.advance(now);
    if (match.phase !== "playing") return { actions: [] };
    var me = match.players[this.playerId];
    if (!me) return { actions: [] };
    var elapsed = match.started_at == null ? 0 : now - match.started_at;
    var actions = [];

    function did(self, typ, extra) {
      var r = self.tryCommand(match, Object.assign({ type: typ }, extra || {}));
      if (r.ok) actions.push(typ);
      return r;
    }

    if (!me.supply_built && me.alloy >= C.SUPPLY_ALLOY_COST) {
      did(this, "build", { facility: "supply" });
      me = match.players[this.playerId];
    }
    if (!me.armory_built && me.alloy >= C.ARMORY_ALLOY_COST) {
      did(this, "build", { facility: "armory" });
      me = match.players[this.playerId];
    }

    if (me.recycle_workers < 2) {
      var recTarget = Math.min(2, me.recycle_workers + me.standby);
      if (recTarget !== me.recycle_workers) {
        did(this, "assign", { facility: "recycle", count: recTarget });
        me = match.players[this.playerId];
      }
    }
    if (me.supply_built && me.supply_workers < 2) {
      var room = C.MAX_PRODUCTION_WORKERS - me.recycle_workers;
      var supTarget = Math.min(2, me.supply_workers + me.standby, room);
      if (supTarget < 0) supTarget = me.supply_workers;
      if (supTarget !== me.supply_workers) {
        did(this, "assign", { facility: "supply", count: supTarget });
        me = match.players[this.playerId];
      }
    }

    if (me.pending_choice) {
      did(this, "choose", { option: "A" });
      me = match.players[this.playerId];
    }

    if (
      me.armory_built &&
      !me.recycle_upgraded &&
      me.alloy >= C.RECYCLE_UPGRADE_ALLOY_COST + C.TRAIN_ALLOY_COST &&
      ((me.duty_workers || 0) >= 1 || me.standby >= 1)
    ) {
      did(this, "upgrade", { facility: "recycle" });
      me = match.players[this.playerId];
    }
    if (
      me.armory_built &&
      me.supply_built &&
      !me.supply_upgraded &&
      me.alloy >= C.SUPPLY_UPGRADE_ALLOY_COST + C.TRAIN_ALLOY_COST &&
      ((me.duty_workers || 0) >= 1 || me.standby >= 1)
    ) {
      did(this, "upgrade", { facility: "supply" });
      me = match.players[this.playerId];
    }
    if ((me.recycle_upgraded || me.supply_upgraded) && (me.duty_workers || 0) < 1 && me.standby >= 1) {
      did(this, "assign", { facility: "duty", count: 1 });
      me = match.players[this.playerId];
    }

    if (
      me.armory_built &&
      !me.training_complete_at &&
      me.standby >= 1
    ) {
      var wantWard = me.patrols >= 2 && (me.wards || 0) < 1 &&
        me.rations >= C.WARD_TRAIN_RATIONS_COST && me.alloy >= C.WARD_TRAIN_ALLOY_COST;
      if (wantWard) {
        did(this, "train", { unit: "ward" });
        me = match.players[this.playerId];
      } else if (me.rations >= C.TRAIN_RATIONS_COST && me.alloy >= C.TRAIN_ALLOY_COST) {
        did(this, "train");
        me = match.players[this.playerId];
      }
    }

    var exReason = match.exploreBlockReason(me, now);
    var sinceExplore = this._lastExploreAt == null ? Infinity : now - this._lastExploreAt;
    if (exReason == null && elapsed >= 180 && sinceExplore >= 90 && me.alloy < C.VICTORY_ALLOY) {
      var oppE = match.opponent(this.playerId);
      if (oppE && me.alloy <= oppE.alloy) {
        var ex = did(this, "explore");
        if (ex.ok) this._lastExploreAt = now;
        me = match.players[this.playerId];
      }
    }

    var reason = match.raidBlockReason(me, now);
    var sinceRaid = this._lastRaidAt == null ? Infinity : now - this._lastRaidAt;
    var wantRaid = false;
    if (reason == null && me.patrols >= 1) {
      if (me.patrols >= 2 && elapsed >= 90 && sinceRaid >= 90) wantRaid = true;
      if (elapsed >= C.VICTORY_ELIGIBLE_AT && me.patrols >= 1 && sinceRaid >= 90) {
        var opp = match.opponent(this.playerId);
        if (opp && me.alloy < C.VICTORY_ALLOY && opp.alloy >= me.alloy) wantRaid = true;
      }
    }
    if (wantRaid) {
      var force = me.patrols >= 3 ? Math.min(me.patrols, 3) : me.patrols;
      if (force >= 1) {
        var raid = did(this, "raid", { count: force });
        if (raid.ok) this._lastRaidAt = now;
      }
    }
    return { actions: actions };
  };

  SoloAI.prototype.toJSON = function () {
    return { seq: this._seq, lastRaidAt: this._lastRaidAt, lastExploreAt: this._lastExploreAt };
  };

  SoloAI.prototype.restore = function (data) {
    if (!data) return this;
    if (typeof data.seq === "number") this._seq = data.seq;
    this._lastRaidAt = data.lastRaidAt != null ? data.lastRaidAt : null;
    this._lastExploreAt = data.lastExploreAt != null ? data.lastExploreAt : null;
    return this;
  };

  return { SoloAI: SoloAI };
});
