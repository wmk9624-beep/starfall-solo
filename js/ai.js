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

    if (
      me.armory_built &&
      !me.training_complete_at &&
      me.standby >= 1 &&
      me.rations >= C.TRAIN_RATIONS_COST &&
      me.alloy >= C.TRAIN_ALLOY_COST
    ) {
      did(this, "train");
      me = match.players[this.playerId];
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
    return { seq: this._seq, lastRaidAt: this._lastRaidAt };
  };

  SoloAI.prototype.restore = function (data) {
    if (!data) return this;
    if (typeof data.seq === "number") this._seq = data.seq;
    this._lastRaidAt = data.lastRaidAt != null ? data.lastRaidAt : null;
    return this;
  };

  return { SoloAI: SoloAI };
});
