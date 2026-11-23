/* 單機探索事件表。四件固定事件，A/B 代價預先寫死，無隱藏擲骰，唔干擾受襲保護。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.StarfallSoloEvents = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var EVENTS = [
    {
      id: "quiet_wreck",
      title: "安靜殘骸",
      text: "探測到一截無人殘骸。",
      optionA: { label: "穩妥拆少量", detail: "合金 +2，船員即時返航。" },
      optionB: { label: "深入拆件", detail: "合金 +4，但船員要 30 秒歸途休養。" }
    },
    {
      id: "dry_crate",
      title: "乾涸補給箱",
      text: "發現一個還封住嘅口糧箱。",
      optionA: { label: "只取穩妥一份", detail: "口糧 +3，船員即時返航。" },
      optionB: { label: "整箱搬返", detail: "口糧 +6，但船員要 30 秒歸途休養。" }
    },
    {
      id: "edge_scrap",
      title: "邊緣碎件",
      text: "對頭前哨外圍有可回收碎件。唔會打醒或改動對方受襲保護。",
      optionA: { label: "快手檢一啲", detail: "合金 +1，船員即時返航。" },
      optionB: { label: "多拆一輪", detail: "合金 +3，但船員要 30 秒歸途休養。" }
    },
    {
      id: "signal_noise",
      title: "信號干擾",
      text: "干擾帶裡可能藏住合金，但要耗口糧維持通訊。",
      optionA: { label: "放棄，安全返航", detail: "空手即時返航。" },
      optionB: { label: "耗口糧搶合金", detail: "合金 +2、口糧 -2。口糧唔夠 2 就不能選。" },
      optionBReq: { rations: 2 }
    }
  ];

  var BY_ID = {};
  EVENTS.forEach(function (ev) { BY_ID[ev.id] = ev; });

  function eventById(id) {
    return BY_ID[id] || null;
  }

  function eventIds() {
    return EVENTS.map(function (ev) { return ev.id; });
  }

  function hashPick(startedAt, playerId, seq) {
    var s = String(startedAt) + ":" + String(playerId) + ":" + String(seq);
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    var ids = eventIds();
    return ids[(h >>> 0) % ids.length];
  }

  function canPickB(ev, player) {
    if (!ev || !ev.optionBReq) return true;
    if (ev.optionBReq.rations != null && player.rations < ev.optionBReq.rations) return false;
    if (ev.optionBReq.alloy != null && player.alloy < ev.optionBReq.alloy) return false;
    return true;
  }

  return {
    EVENTS: EVENTS,
    eventById: eventById,
    eventIds: eventIds,
    hashPick: hashPick,
    canPickB: canPickB
  };
});
