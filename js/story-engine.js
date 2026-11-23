/* 《無聲的歸航》故事規則：旗標、關係、一次性能力、結局與收束。不改人口或戰局勝負公式。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./story-data.js"));
  else root.StarfallSoloStoryEngine = factory(root.StarfallSoloStoryData);
})(typeof globalThis !== "undefined" ? globalThis : this, function (Data) {
  "use strict";
  if (!Data) throw new Error("缺少故事資料模組。");

  var HERO_FLAGS = {
    "HERO-01": { trust: "trust_navigation", confirmed: "route_confirmed", verified: "route_verified" },
    "HERO-02": { trust: "trust_biology", confirmed: "habitat_confirmed", verified: "habitat_verified" },
    "HERO-03": { trust: "trust_security", confirmed: "archive_prepared", verified: "archive_verified" }
  };

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function isIntIn(n, lo, hi) {
    return Number.isInteger(n) && n >= lo && n <= hi;
  }

  function defaultFlags() {
    return {
      trust_navigation: false,
      trust_biology: false,
      trust_security: false,
      initial_trust: null,
      stance_changed: false,
      route_confirmed: false,
      habitat_confirmed: false,
      archive_prepared: false,
      route_verified: false,
      habitat_verified: false,
      archive_verified: false,
      hero_ability_used: false,
      hero_ability_id: null,
      decode_mode: null,
      final_decision: null
    };
  }

  function createState() {
    return {
      story_id: Data.STORY_ID,
      story_version: Data.STORY_VERSION,
      story_revision: 1,
      chapter_status: "not_started",
      act: 1,
      current_node: "STORY-01",
      choice_history: [],
      flags: defaultFlags(),
      relation: { liling: 0, qiuying: 0, wujin: 0 },
      assigned_hero: null,
      ending_id: null,
      ending_variant: null,
      completed_by_player: null,
      ending_source: null,
      resolved_nodes: [],
      resolved_story_choices: [],
      used_story_once_ids: [],
      story_transaction_ids: [],
      closed_at_game_time: null,
      legacy_finished_unstarted: false
    };
  }

  function unavailableState() {
    var s = createState();
    s.chapter_status = "unavailable";
    s.legacy_finished_unstarted = true;
    s.current_node = "STORY-01";
    return s;
  }

  function relationKey(heroId) {
    return Data.HEROES[heroId] && Data.HEROES[heroId].relation_key;
  }

  function clampRelation(n) {
    if (n < 0) return 0;
    if (n > 3) return 3;
    return n;
  }

  function homeVariant(story) {
    var flags = story.flags || {};
    var rel = story.relation || {};
    if (flags.habitat_confirmed && (rel.qiuying || 0) >= 2) return "planned";
    return "base";
  }

  function reject(reason, code) {
    return { ok: false, reason: reason, code: code || "rejected" };
  }

  function isForegroundPaused(clock) {
    return !!(clock && Object.prototype.hasOwnProperty.call(clock, "_running") && clock._running === false);
  }

  function listChoices(story, alloy) {
    alloy = alloy == null ? 0 : alloy;
    if (!story || story.chapter_status === "unavailable" || story.chapter_status === "completed" || story.chapter_status === "forced_closed") {
      return [];
    }
    var nodeId = story.current_node;
    if (!nodeId) return [];
    return Data.choicesForNode(nodeId).map(function (choice) {
      var item = {
        id: choice.id,
        label: choice.label,
        node_id: choice.node_id,
        hero_id: choice.hero_id || null,
        decode_mode: choice.decode_mode || null,
        cost_alloy: choice.alloy || 0,
        cost_rations: choice.rations || 0,
        irreversible: true,
        enabled: true,
        reason: "",
        stance_change: false
      };
      if (choice.require_flag && !story.flags[choice.require_flag]) {
        item.enabled = false;
        if (choice.require_flag === "route_confirmed") item.reason = "需要先取得已確認航線。";
        else if (choice.require_flag === "route_verified") item.reason = "需要已驗證的航線證據。";
        else if (choice.require_flag === "habitat_verified") item.reason = "需要已驗證的居住藍圖。";
        else if (choice.require_flag === "archive_prepared") item.reason = "需要先完成封存程序。";
        else if (choice.require_flag === "archive_verified") item.reason = "需要已驗證的封存紀錄。";
        else item.reason = "尚未滿足此選項的條件。";
      }
      if (item.enabled && item.cost_alloy > 0 && alloy < item.cost_alloy) {
        item.enabled = false;
        item.reason = "合金不足，可以改用免費解讀";
      }
      if (item.enabled && story.act === 2 && choice.hero_id && story.flags.initial_trust && choice.hero_id !== story.flags.initial_trust) {
        item.stance_change = true;
      }
      return item;
    });
  }

  function applyChoice(opts) {
    opts = opts || {};
    var story = opts.story;
    if (!story) return reject("故事尚未初始化。", "bad_request");
    if (story.chapter_status === "unavailable") return reject("本局故事功能未啟用。", "unavailable");
    if (opts.phase && opts.phase !== "playing") return reject("對局已經結束，唔能再作故事選擇。", "finished");
    if (isForegroundPaused(opts.clock)) return reject("計時已暫停，請先按繼續。", "paused");
    if (story.chapter_status === "completed" || story.chapter_status === "forced_closed" || story.ending_id) {
      return reject("故事已經結束，唔能再選擇。", "closed");
    }

    var commandId = String(opts.command_id || "").trim();
    if (commandId && story.story_transaction_ids.indexOf(commandId) !== -1) {
      return { ok: true, duplicate: true, story: clone(story), alloy_delta: 0, rations_delta: 0 };
    }

    var expected = opts.expected_story_revision;
    if (expected != null && Number(expected) !== story.story_revision) {
      return reject("故事狀態已更新，請重新確認。", "revision");
    }

    var choice = Data.choiceById(opts.choice_id);
    if (!choice) return reject("唔識呢個故事選項。", "bad_request");
    if (opts.node_id && opts.node_id !== choice.node_id) {
      return reject("節點與選項唔符。", "bad_request");
    }
    if (choice.hero_id && opts.hero_id && opts.hero_id !== choice.hero_id) {
      return reject("英雄與選項唔符。", "bad_request");
    }
    if (choice.decode_mode && opts.decode_mode && opts.decode_mode !== choice.decode_mode) {
      return reject("解讀方式與選項唔符。", "bad_request");
    }

    if (story.current_node !== choice.node_id) {
      return reject("而家唔係呢個故事節點。", "wrong_node");
    }
    if (story.resolved_nodes.indexOf(choice.node_id) !== -1) {
      return reject("呢一幕已經決定過。", "already");
    }
    if (story.resolved_story_choices.indexOf(choice.id) !== -1) {
      return reject("呢個選項已經提交過。", "already");
    }
    if (choice.once_id && story.used_story_once_ids.indexOf(choice.once_id) !== -1) {
      return reject("呢項一次性決定已經用過。", "once");
    }

    if (choice.node_id === "STORY-02") {
      if (story.act !== 2 || story.assigned_hero != null || story.flags.hero_ability_used) {
        return reject("已經正式指派過英雄。", "once");
      }
    }
    if (choice.node_id === "STORY-01" && story.act !== 1) {
      return reject("第一幕已經完成。", "already");
    }
    if (choice.node_id === "STORY-03" && story.act !== 3) {
      return reject("仲未去到第三幕。", "wrong_node");
    }
    if (choice.require_flag && !story.flags[choice.require_flag]) {
      return reject("尚未滿足此選項的條件。", "locked");
    }

    var costAlloy = choice.alloy || 0;
    var costRations = choice.rations || 0;
    var alloy = opts.player_alloy == null ? 0 : opts.player_alloy;
    var rations = opts.player_rations == null ? 0 : opts.player_rations;
    if (alloy < costAlloy) return reject("合金不足，可以改用免費解讀", "no_alloy");
    if (rations < costRations) return reject("口糧不足。", "no_rations");

    var next = clone(story);
    if (next.chapter_status === "not_started") next.chapter_status = "active";
    next.choice_history.push(choice.id);
    next.resolved_story_choices.push(choice.id);
    next.resolved_nodes.push(choice.node_id);
    if (commandId) next.story_transaction_ids.push(commandId);
    if (choice.once_id && next.used_story_once_ids.indexOf(choice.once_id) === -1) {
      next.used_story_once_ids.push(choice.once_id);
    }

    if (choice.node_id === "STORY-01") {
      var trustHero = choice.hero_id;
      var trustMeta = HERO_FLAGS[trustHero];
      var trustKey = relationKey(trustHero);
      next.flags.initial_trust = trustHero;
      if (trustMeta) next.flags[trustMeta.trust] = true;
      next.relation[trustKey] = clampRelation((next.relation[trustKey] || 0) + 1);
      next.act = 2;
      next.current_node = "STORY-02";
    } else if (choice.node_id === "STORY-02") {
      var heroId = choice.hero_id;
      var meta = HERO_FLAGS[heroId];
      var key = relationKey(heroId);
      var initial = next.flags.initial_trust;
      if (initial && initial !== heroId) {
        next.flags.stance_changed = true;
        var oldKey = relationKey(initial);
        if (oldKey) next.relation[oldKey] = 0;
        next.relation[key] = 1;
      } else {
        next.flags.stance_changed = false;
        next.relation[key] = clampRelation((next.relation[key] || 0) + 1);
      }
      next.assigned_hero = heroId;
      next.flags.hero_ability_used = true;
      next.flags.hero_ability_id = choice.ability_id || (Data.HEROES[heroId] && Data.HEROES[heroId].ability_id);
      next.flags.decode_mode = choice.decode_mode;
      if (meta) next.flags[meta.confirmed] = true;
      if (choice.decode_mode === "verified") {
        if (meta) next.flags[meta.verified] = true;
        next.relation[key] = clampRelation((next.relation[key] || 0) + 1);
      }
      next.act = 3;
      next.current_node = "STORY-03";
    } else if (choice.node_id === "STORY-03") {
      next.flags.final_decision = choice.final_decision;
      next.ending_id = choice.ending_id;
      if (choice.id === "S03-B") next.ending_variant = homeVariant(next);
      else next.ending_variant = choice.ending_variant;
      next.completed_by_player = true;
      next.ending_source = "player";
      next.chapter_status = "completed";
      next.act = "ended";
      next.current_node = null;
      next.closed_at_game_time = opts.now == null ? null : opts.now;
    }

    next.story_revision = (next.story_revision || 1) + 1;
    try {
      assertConsistent(next);
    } catch (err) {
      return reject(err.message || "故事狀態不一致。", "invariant");
    }
    return {
      ok: true,
      duplicate: false,
      story: next,
      alloy_delta: -costAlloy,
      rations_delta: -costRations
    };
  }

  function closeIfUnfinished(story, now) {
    if (!story) return unavailableState();
    var next = clone(story);
    if (next.legacy_finished_unstarted || next.chapter_status === "unavailable") return next;
    if (next.ending_id && (next.chapter_status === "completed" || next.chapter_status === "forced_closed")) {
      return next;
    }
    next.ending_id = "END-HOME";
    next.ending_variant = "forced";
    next.completed_by_player = false;
    next.ending_source = "system";
    next.chapter_status = "forced_closed";
    next.act = "ended";
    next.current_node = null;
    next.closed_at_game_time = now == null ? next.closed_at_game_time : now;
    next.story_revision = (next.story_revision || 1) + 1;
    return next;
  }

  var REQUIRED_FLAGS = {
    trust_navigation: "boolean",
    trust_biology: "boolean",
    trust_security: "boolean",
    initial_trust: "hero",
    stance_changed: "boolean",
    route_confirmed: "boolean",
    habitat_confirmed: "boolean",
    archive_prepared: "boolean",
    route_verified: "boolean",
    habitat_verified: "boolean",
    archive_verified: "boolean",
    hero_ability_used: "boolean",
    hero_ability_id: "ability",
    decode_mode: "decode",
    final_decision: "decision"
  };
  var ABILITY_IDS = { "ABILITY-ROUTE": 1, "ABILITY-HABITAT": 1, "ABILITY-ARCHIVE": 1 };
  var ACT3_ENDING = {
    "S03-A": { ending_id: "END-SIGNAL", ending_variant: "base", final_decision: "signal" },
    "S03-A2": { ending_id: "END-SIGNAL", ending_variant: "verified", final_decision: "signal" },
    "S03-B": { ending_id: "END-HOME", ending_variant: "home_basic", final_decision: "home" },
    "S03-B2": { ending_id: "END-HOME", ending_variant: "verified", final_decision: "home" },
    "S03-C": { ending_id: "END-VAULT", ending_variant: "base", final_decision: "vault" },
    "S03-C2": { ending_id: "END-VAULT", ending_variant: "verified", final_decision: "vault" }
  };
  var ACT1_TRUST = {
    "S01-A": { hero: "HERO-01", flag: "trust_navigation" },
    "S01-B": { hero: "HERO-02", flag: "trust_biology" },
    "S01-C": { hero: "HERO-03", flag: "trust_security" }
  };

  function assertRequiredFlags(flags) {
    Object.keys(REQUIRED_FLAGS).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(flags, key)) {
        throw new Error("新存檔缺必要故事旗標：" + key);
      }
      var kind = REQUIRED_FLAGS[key];
      var val = flags[key];
      if (kind === "boolean") {
        if (typeof val !== "boolean") throw new Error("故事旗標型別無效：" + key);
      } else if (kind === "hero") {
        if (val != null && !Data.HEROES[val]) throw new Error("初步信任目標無效。");
      } else if (kind === "ability") {
        if (val != null && !ABILITY_IDS[val]) throw new Error("英雄能力編號無效。");
      } else if (kind === "decode") {
        if (val != null && val !== "free" && val !== "verified") throw new Error("解讀方式無效。");
      } else if (kind === "decision") {
        if (val != null && val !== "signal" && val !== "home" && val !== "vault") throw new Error("最終方向標記無效。");
      }
    });
  }

  function lastHistory(story, prefix) {
    var list = story.choice_history || [];
    var found = null;
    for (var i = 0; i < list.length; i++) {
      if (String(list[i]).indexOf(prefix) === 0) found = list[i];
    }
    return found;
  }

  function assertChoiceHistoryConsistency(story) {
    if (story.legacy_finished_unstarted || story.chapter_status === "unavailable") return;
    var s01 = lastHistory(story, "S01-");
    if (s01) {
      var trust = ACT1_TRUST[s01];
      if (!trust) throw new Error("第一幕選項無效。");
      if (story.flags.initial_trust !== trust.hero) throw new Error("初步信任與第一幕選擇不一致。");
      if (story.flags[trust.flag] !== true) throw new Error("第一幕信任旗標與選擇不一致。");
    }
    var s02 = lastHistory(story, "S02-");
    if (s02) {
      var act2 = Data.choiceById(s02);
      if (!act2 || act2.node_id !== "STORY-02") throw new Error("第二幕選項無效。");
      if (story.assigned_hero !== act2.hero_id) throw new Error("正式指派與第二幕選擇不一致。");
      if (story.flags.decode_mode !== act2.decode_mode) throw new Error("解讀方式與第二幕選擇不一致。");
      if (story.flags.hero_ability_id !== act2.ability_id) throw new Error("能力編號與第二幕選擇不一致。");
      var expectStance = !!(story.flags.initial_trust && act2.hero_id !== story.flags.initial_trust);
      if (!!story.flags.stance_changed !== expectStance) throw new Error("立場改變標記與指派矛盾。");
    }
    var s03 = lastHistory(story, "S03-");
    if (story.chapter_status === "forced_closed" || story.ending_variant === "forced") {
      if (s03) throw new Error("系統收束不應帶有第三幕玩家選擇。");
      if (story.ending_id !== "END-HOME" || story.ending_variant !== "forced") {
        throw new Error("系統收束結局標記矛盾。");
      }
      if (story.flags.final_decision != null) throw new Error("系統收束不應冒充玩家最終方向。");
      return;
    }
    if (story.chapter_status === "completed" && story.completed_by_player) {
      if (!s03 || !ACT3_ENDING[s03]) throw new Error("玩家結局缺少合法第三幕選擇。");
      var expect = ACT3_ENDING[s03];
      if (story.ending_id !== expect.ending_id) throw new Error("結局與第三幕選擇歷史矛盾。");
      if (story.flags.final_decision !== expect.final_decision) throw new Error("最終方向與第三幕選擇矛盾。");
      var variant = expect.ending_variant;
      if (s03 === "S03-B") variant = homeVariant(story);
      if (story.ending_variant !== variant) throw new Error("結局版本與第三幕選擇矛盾。");
    }
  }

  function assertConsistent(story) {

    if (!story || typeof story !== "object") throw new Error("缺故事資料。");
    if (story.story_id !== Data.STORY_ID) throw new Error("故事編號無效。");
    if (story.story_version !== Data.STORY_VERSION) throw new Error("故事版本不支援。");
    if (!Number.isInteger(story.story_revision) || story.story_revision < 1) throw new Error("故事修訂號無效。");
    var statuses = { not_started: 1, active: 1, completed: 1, forced_closed: 1, unavailable: 1 };
    if (!statuses[story.chapter_status]) throw new Error("章節狀態無效。");
    if (!(story.act === 1 || story.act === 2 || story.act === 3 || story.act === "ended")) {
      throw new Error("幕次無效。");
    }
    if (story.current_node != null && !Data.NODES[story.current_node]) {
      throw new Error("非法故事節點。");
    }
    if (!story.flags || typeof story.flags !== "object") throw new Error("缺故事旗標。");
    assertRequiredFlags(story.flags);
    if (!story.relation || typeof story.relation !== "object") throw new Error("缺英雄關係。");
    ["liling", "qiuying", "wujin"].forEach(function (k) {
      if (!isIntIn(story.relation[k], 0, 3)) throw new Error("英雄關係值無效。");
    });
    var trust = story.flags.initial_trust;
    if (trust != null && !Data.HEROES[trust]) throw new Error("初步信任目標無效。");
    if (story.assigned_hero != null && !Data.HEROES[story.assigned_hero]) throw new Error("指派英雄無效。");
    var endings = { "END-SIGNAL": 1, "END-HOME": 1, "END-VAULT": 1 };
    if (story.ending_id != null && !endings[story.ending_id]) throw new Error("結局編號無效。");
    var variants = { base: 1, planned: 1, verified: 1, forced: 1 };
    if (story.ending_variant != null && !variants[story.ending_variant]) throw new Error("結局版本無效。");
    if (!Array.isArray(story.choice_history) || !Array.isArray(story.resolved_nodes) || !Array.isArray(story.resolved_story_choices) || !Array.isArray(story.used_story_once_ids) || !Array.isArray(story.story_transaction_ids)) {
      throw new Error("故事紀錄欄位無效。");
    }

    if (story.legacy_finished_unstarted || story.chapter_status === "unavailable") {
      if (story.ending_id != null) throw new Error("未啟用故事不應有結局。");
      if (story.choice_history.length) throw new Error("未啟用故事不應有選擇紀錄。");
      if ((story.relation.liling + story.relation.qiuying + story.relation.wujin) !== 0) {
        throw new Error("未啟用故事不應有關係。");
      }
      return;
    }

    if (story.flags.hero_ability_used) {
      if (story.used_story_once_ids.indexOf(Data.ONCE_ACT2) === -1) throw new Error("已用能力但缺一次性標記。");
      if (!story.assigned_hero) throw new Error("已用能力但未指派英雄。");
    } else if (story.used_story_once_ids.indexOf(Data.ONCE_ACT2) !== -1) {
      throw new Error("一次性能力標記與使用狀態矛盾。");
    }
    if (story.assigned_hero && !story.flags.hero_ability_used) {
      throw new Error("已指派英雄但能力未標記使用。");
    }
    if (story.flags.stance_changed && story.assigned_hero && story.flags.initial_trust && story.assigned_hero === story.flags.initial_trust) {
      throw new Error("立場改變標記與指派矛盾。");
    }

    assertChoiceHistoryConsistency(story);

    if (story.ending_id) {
      if (story.used_story_once_ids.indexOf(Data.ONCE_ACT3) === -1 && story.ending_variant !== "forced") {
        throw new Error("已有結局但缺第三幕鎖定。");
      }
      if (story.chapter_status !== "completed" && story.chapter_status !== "forced_closed") {
        throw new Error("已有結局但章節狀態不符。");
      }
      if (story.act !== "ended") throw new Error("已有結局但幕次未結束。");
      if (story.ending_id === "END-SIGNAL") {
        if (story.ending_variant === "forced") throw new Error("公開訊號結局不能是系統收束。");
        if (!story.flags.route_confirmed) throw new Error("訊號結局與航線旗標矛盾。");
        if (story.ending_variant === "verified" && !story.flags.route_verified) throw new Error("驗證版訊號結局缺少驗證旗標。");
        if (story.completed_by_player !== true || story.ending_source !== "player") throw new Error("玩家結局標記矛盾。");
      } else if (story.ending_id === "END-VAULT") {
        if (story.ending_variant === "forced") throw new Error("封存結局不能是系統收束。");
        if (!story.flags.archive_prepared) throw new Error("封存結局與程序旗標矛盾。");
        if (story.ending_variant === "verified" && !story.flags.archive_verified) throw new Error("驗證版封存結局缺少驗證旗標。");
        if (story.completed_by_player !== true || story.ending_source !== "player") throw new Error("玩家結局標記矛盾。");
      } else if (story.ending_id === "END-HOME") {
        if (story.ending_variant === "forced") {
          if (story.completed_by_player !== false || story.ending_source !== "system") {
            throw new Error("系統收束標記矛盾。");
          }
          if (story.chapter_status !== "forced_closed") throw new Error("系統收束章節狀態矛盾。");
        } else {
          if (story.completed_by_player !== true || story.ending_source !== "player") throw new Error("家園結局標記矛盾。");
          if (story.ending_variant === "verified" && !story.flags.habitat_verified) throw new Error("驗證版家園結局缺少驗證旗標。");
          if (story.ending_variant === "planned" && !(story.flags.habitat_confirmed && (story.relation.qiuying || 0) >= 2)) {
            throw new Error("規劃版家園結局與關係或藍圖矛盾。");
          }
        }
      }
    } else if (story.chapter_status === "completed" || story.chapter_status === "forced_closed") {
      throw new Error("章節已結束但缺結局。");
    }
  }

  function validateStoryState(story) {
    assertConsistent(story);
    return story;
  }

  function hasStoryPayload(data) {
    if (!data || typeof data !== "object") return false;
    return Object.prototype.hasOwnProperty.call(data, "story_schema") || Object.prototype.hasOwnProperty.call(data, "story");
  }

  function migrateSnapshot(data, opts) {
    opts = opts || {};
    if (!data || typeof data !== "object") return data;
    if (hasStoryPayload(data)) return data;
    var out = Object.assign({}, data);
    var finished = !!(out.match && out.match.phase === "finished");
    out.story_schema = 1;
    out.story = finished ? unavailableState() : createState();
    return out;
  }

  function view(story) {
    if (!story) return null;
    var endingLines = [];
    if (story.legacy_finished_unstarted || story.chapter_status === "unavailable") {
      endingLines = Data.LEGACY_UNAVAILABLE_TEXT.slice();
    } else if (story.ending_id) {
      endingLines = Data.endingText(story.ending_id, story.ending_variant);
    }
    return {
      story_id: story.story_id,
      story_revision: story.story_revision,
      chapter_status: story.chapter_status,
      act: story.act,
      current_node: story.current_node,
      flags: clone(story.flags || {}),
      relation: clone(story.relation || {}),
      assigned_hero: story.assigned_hero,
      ending_id: story.ending_id,
      ending_variant: story.ending_variant,
      completed_by_player: story.completed_by_player,
      ending_source: story.ending_source,
      choice_history: (story.choice_history || []).slice(),
      resolved_nodes: (story.resolved_nodes || []).slice(),
      used_story_once_ids: (story.used_story_once_ids || []).slice(),
      legacy_finished_unstarted: !!story.legacy_finished_unstarted,
      ending_title: story.ending_id && Data.ENDINGS[story.ending_id] ? Data.ENDINGS[story.ending_id].title : null,
      ending_text: endingLines,
      forced: story.ending_variant === "forced",
    };
  }

  function freeEndingPaths() {
    return [
      { name: "signal-free", choices: ["S01-A", "S02-HERO-01-FREE", "S03-A"], ending_id: "END-SIGNAL", ending_variant: "base" },
      { name: "home-planned", choices: ["S01-B", "S02-HERO-02-FREE", "S03-B"], ending_id: "END-HOME", ending_variant: "planned" },
      { name: "vault-stance", choices: ["S01-A", "S02-HERO-03-FREE", "S03-C"], ending_id: "END-VAULT", ending_variant: "base" }
    ];
  }

  return {
    createState: createState,
    unavailableState: unavailableState,
    listChoices: listChoices,
    applyChoice: applyChoice,
    closeIfUnfinished: closeIfUnfinished,
    validateStoryState: validateStoryState,
    migrateSnapshot: migrateSnapshot,
    hasStoryPayload: hasStoryPayload,
    view: view,
    isForegroundPaused: isForegroundPaused,
    freeEndingPaths: freeEndingPaths,
    homeVariant: homeVariant,
    Data: Data,
  };
});
