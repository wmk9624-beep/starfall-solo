/* 故事分層介面：路由／返回、選項確認、HUD 簽名。不暫停、不重建對局。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./story-engine.js"), require("./story-data.js"));
  } else {
    root.StarfallSoloStoryUi = factory(root.StarfallSoloStoryEngine, root.StarfallSoloStoryData);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (StoryEngine, Data) {
  "use strict";
  if (!StoryEngine || !Data) throw new Error("缺少故事模組。");

  var TABS = { base: 1, map: 1, log: 1 };
  var PAGES = { base: 1, map: 1, log: 1, location: 1, story: 1, hero: 1 };

  function defaultRoute() {
    return { tab: "base", page: "base", locId: null, nodeId: null, heroId: null, stack: [] };
  }

  function cloneRoute(route) {
    route = route || defaultRoute();
    return {
      tab: route.tab || "base",
      page: route.page || "base",
      locId: route.locId || null,
      nodeId: route.nodeId || null,
      heroId: route.heroId || null,
      stack: Array.isArray(route.stack) ? route.stack.map(function (s) { return Object.assign({}, s); }) : []
    };
  }

  function normalizeRoute(route) {
    var r = cloneRoute(route);
    if (!TABS[r.tab]) return defaultRoute();
    if (!PAGES[r.page]) return defaultRoute();
    if (r.page === "location" && !Data.LOCATIONS.some(function (l) { return l.id === r.locId; })) return defaultRoute();
    if (r.page === "story" && !Data.NODES[r.nodeId]) return defaultRoute();
    if (r.page === "hero" && !Data.HEROES[r.heroId]) return defaultRoute();
    if (r.page === "base") r.tab = "base";
    if (r.page === "map" || r.page === "location" || r.page === "story") r.tab = "map";
    if (r.page === "log") r.tab = "log";
    if (r.page === "hero" && r.tab !== "map" && r.tab !== "log") r.tab = "map";
    return r;
  }

  function pushStack(route, entry) {
    var next = cloneRoute(route);
    next.stack = (next.stack || []).concat([entry]);
    return next;
  }

  function navigate(route, action) {
    var cur = normalizeRoute(route);
    action = action || {};
    var type = action.type;
    if (type === "tab") {
      if (action.tab === "base") return defaultRoute();
      if (action.tab === "map") return { tab: "map", page: "map", locId: null, nodeId: null, heroId: null, stack: [] };
      if (action.tab === "log") return { tab: "log", page: "log", locId: null, nodeId: null, heroId: null, stack: [] };
      return cur;
    }
    if (type === "open-location") {
      var loc = Data.LOCATIONS.filter(function (l) { return l.id === action.locId; })[0];
      if (!loc) return cur;
      return { tab: "map", page: "location", locId: loc.id, nodeId: loc.node_id, heroId: null, stack: [{ page: "map" }] };
    }
    if (type === "open-story") {
      if (!Data.NODES[action.nodeId]) return cur;
      var node = Data.NODES[action.nodeId];
      return {
        tab: "map",
        page: "story",
        locId: node.location_id,
        nodeId: node.id,
        heroId: null,
        stack: [{ page: "map" }, { page: "location", locId: node.location_id, nodeId: node.id }]
      };
    }
    if (type === "open-hero") {
      if (!Data.HEROES[action.heroId]) return cur;
      var stack = (cur.stack || []).concat([{
        page: cur.page, locId: cur.locId, nodeId: cur.nodeId, heroId: null
      }]);
      return { tab: cur.tab === "log" ? "log" : "map", page: "hero", locId: cur.locId, nodeId: cur.nodeId, heroId: action.heroId, stack: stack };
    }
    if (type === "return-base") return defaultRoute();
    if (type === "back") {
      if (cur.stack && cur.stack.length) {
        var prev = cur.stack[cur.stack.length - 1];
        var rest = cur.stack.slice(0, -1);
        var back = {
          tab: prev.page === "log" ? "log" : (prev.page === "base" ? "base" : "map"),
          page: prev.page || "map",
          locId: prev.locId || null,
          nodeId: prev.nodeId || null,
          heroId: prev.heroId || null,
          stack: rest
        };
        return normalizeRoute(back);
      }
      if (cur.page === "map" || cur.page === "log") return defaultRoute();
      return { tab: "map", page: "map", locId: null, nodeId: null, heroId: null, stack: [] };
    }
    return cur;
  }

  function routeKey(route) {
    var r = normalizeRoute(route);
    return [r.tab, r.page, r.locId || "", r.nodeId || "", r.heroId || ""].join("/");
  }

  function nodeUnlocked(story, nodeId) {
    if (!story || story.chapter_status === "unavailable") return nodeId === "STORY-01";
    if (nodeId === "STORY-01") return true;
    if (nodeId === "STORY-02") return (story.resolved_nodes || []).indexOf("STORY-01") !== -1 || story.act === 2 || story.act === 3 || story.act === "ended";
    if (nodeId === "STORY-03") return (story.resolved_nodes || []).indexOf("STORY-02") !== -1 || story.act === 3 || story.act === "ended";
    return false;
  }

  function locationState(story, loc) {
    var unlocked = nodeUnlocked(story, loc.node_id);
    var resolved = !!(story && (story.resolved_nodes || []).indexOf(loc.node_id) !== -1);
    var current = !!(story && story.current_node === loc.node_id);
    return { unlocked: unlocked, resolved: resolved, current: current };
  }

  function exploreEntry(state, route) {
    var pending = state && state.you && state.you.pending_choice;
    if (!pending) return { visible: false };
    var onBase = !route || route.page === "base";
    return {
      visible: true,
      on_base: onBase,
      remain: pending.remain,
      title: (pending.event && pending.event.title) || "探索事件",
      open_choice: !!onBase,
      return_and_open: !onBase
    };
  }

  function finishVisible(state) {
    return !!(state && state.phase === "finished" && state.result);
  }

  function pageSignature(route, state) {
    var story = state && state.story;
    return [
      routeKey(route),
      story && story.story_revision,
      story && story.chapter_status,
      story && story.current_node,
      story && story.ending_id,
      story && story.ending_variant,
      state && state.phase
    ].join("|");
  }

  function hudSignature(state, flags) {
    flags = flags || {};
    var you = (state && state.you) || {};
    var pending = you.pending_choice;
    var battle = state && state.battle;
    return [
      state && state.match_time,
      you.rations, you.alloy, you.standby, you.patrols, you.wards,
      you.locked_patrols, you.locked_wards,
      flags.paused ? 1 : 0,
      state && state.phase,
      pending ? pending.remain : "",
      battle && !battle.resolved ? battle.remaining : "",
      battle && battle.resolved ? (battle.resolution && battle.resolution.outcome) : "",
      state && state.result && state.result.kind
    ].join("|");
  }

  function chromeStructureSignature(state, flags, route) {
    flags = flags || {};
    var you = (state && state.you) || {};
    var entry = exploreEntry(state, route);
    var battle = state && state.battle;
    var story = state && state.story;
    return [
      flags.paused ? 1 : 0,
      state && state.phase,
      you.pending_choice ? "pending" : (you.exploring ? "exploring" : (you.recovering ? "recovering" : "idle")),
      entry.visible ? 1 : 0,
      entry.return_and_open ? 1 : 0,
      entry.on_base ? 1 : 0,
      battle && !battle.resolved ? "battle" : (state && state.result ? "result" : "none"),
      state && state.result && state.result.kind,
      story && story.ending_id,
      story && story.ending_variant,
      route && route.tab,
      flags.hasError ? 1 : 0
    ].join("|");
  }

  function shouldReplaceInteractiveChrome(prevStruct, nextStruct, flags) {
    flags = flags || {};
    if (flags.pointerDown) return false;
    if (flags.forceChrome) return true;
    return prevStruct !== nextStruct;
  }

  function shouldRebuildPage(prevSig, route, state) {
    return prevSig !== pageSignature(route, state);
  }

  function navSignature(route) {
    route = route || {};
    return String(route.tab || "base");
  }

  function hudControlSignature(state, flags) {
    flags = flags || {};
    return [
      flags.paused ? 1 : 0,
      state && state.phase,
      flags.finished || (state && state.phase === "finished") ? 1 : 0
    ].join("|");
  }

  function alertStructureSignature(state, flags, route) {
    flags = flags || {};
    var you = (state && state.you) || {};
    var entry = exploreEntry(state, route);
    var battle = state && state.battle;
    var story = state && state.story;
    return [
      flags.paused ? 1 : 0,
      state && state.phase,
      you.pending_choice ? "pending" : (you.exploring ? "exploring" : (you.recovering ? "recovering" : "idle")),
      entry.visible ? 1 : 0,
      entry.return_and_open ? 1 : 0,
      entry.on_base ? 1 : 0,
      battle && !battle.resolved ? "battle" : (state && state.result ? "result" : "none"),
      state && state.result && state.result.kind,
      story && story.ending_id,
      story && story.ending_variant,
      flags.hasError ? 1 : 0
    ].join("|");
  }

  function pageControlSignature(state, route, flags) {
    flags = flags || {};
    var you = (state && state.you) || {};
    var raid = (state && state.raid) || {};
    var story = state && state.story;
    return [
      routeKey(route),
      state && state.phase,
      flags.paused ? 1 : 0,
      you.supply_built ? 1 : 0,
      you.armory_built ? 1 : 0,
      you.recycle_upgraded ? 1 : 0,
      you.supply_upgraded ? 1 : 0,
      you.recycle_workers || 0,
      you.supply_workers || 0,
      you.duty_workers || 0,
      you.standby,
      you.rations,
      you.alloy,
      you.patrols,
      you.wards || 0,
      you.pending_choice ? 1 : 0,
      you.exploring ? 1 : 0,
      you.recovering ? 1 : 0,
      you.training ? 1 : 0,
      you.recalling_active ? 1 : 0,
      raid.can ? 1 : 0,
      story && story.story_revision,
      story && story.current_node,
      story && story.ending_id
    ].join("|");
  }

  function planChromePageUpdate(opts) {
    opts = opts || {};
    var flags = opts.flags || {};
    var pointerDown = !!flags.pointerDown;
    function changed(prev, next) { return prev !== next; }
    // 使用者已觸發的 force*（切頁、暫停）要立即生效；interval tick 唔帶 force，先避開 pointerDown。
    return {
      replaceNav: !!(opts.forceNav || (!pointerDown && changed(opts.prevNavSig, opts.nextNavSig))),
      replaceHud: !!(opts.forceHud || (!pointerDown && changed(opts.prevHudCtrlSig, opts.nextHudCtrlSig))),
      replaceAlerts: !!(opts.forceAlerts || (!pointerDown && changed(opts.prevAlertSig, opts.nextAlertSig))),
      rebuildPage: !!(opts.forcePage || (!pointerDown && changed(opts.prevPageCtrlSig, opts.nextPageCtrlSig))),
      patchText: true,
      preserveScroll: !!(opts.sameRoute && !opts.resetScroll)
    };
  }

  function openStoryConfirm(choice, story, flags, alloy) {
    flags = flags || {};
    if (!choice) return { ok: false, reason: "沒有可確認的選項。" };
    if (flags.paused) return { ok: false, reason: "計時已暫停，請先按繼續。" };
    if (flags.finished) return { ok: false, reason: "對局已經結束，唔能再作故事選擇。" };
    if (!choice.enabled) return { ok: false, reason: choice.reason || "這個選項暫時不能選。" };
    if ((choice.cost_alloy || 0) > 0 && alloy < choice.cost_alloy) {
      return { ok: false, reason: "合金不足，可以改用免費解讀" };
    }
    return {
      ok: true,
      sheet: {
        kind: "story",
        choice_id: choice.id,
        node_id: choice.node_id,
        hero_id: choice.hero_id,
        decode_mode: choice.decode_mode,
        expected_story_revision: story ? story.story_revision : 1,
        cost_alloy: choice.cost_alloy || 0,
        cost_rations: choice.cost_rations || 0,
        label: choice.label,
        irreversible: true,
        stance_change: !!choice.stance_change,
        submitEnabled: true
      }
    };
  }

  function storySubmit(sheet, state, flags) {
    flags = flags || {};
    if (!sheet || sheet.kind !== "story") return { ok: false, reason: "沒有待確認的故事選擇。" };
    if (!state || state.phase === "finished" || flags.finished) {
      return { ok: false, reason: "對局已經結束，唔能再作故事選擇。", close: true, finished: true };
    }
    if (flags.paused) return { ok: false, reason: "計時已暫停，請先按繼續。" };
    var story = state.story;
    var alloy = state.you ? state.you.alloy : 0;
    var listed = StoryEngine.listChoices(storyToEngine(story), alloy);
    var live = null;
    for (var i = 0; i < listed.length; i++) {
      if (listed[i].id === sheet.choice_id) live = listed[i];
    }
    if (!live || !live.enabled) {
      return { ok: false, reason: (live && live.reason) || "這個選項已經不能選。", close: !live };
    }
    if ((live.cost_alloy || 0) > 0 && alloy < live.cost_alloy) {
      return { ok: false, reason: "合金不足，可以改用免費解讀" };
    }
    if (story && sheet.expected_story_revision != null && sheet.expected_story_revision !== story.story_revision) {
      return { ok: false, reason: "故事狀態已更新，請重新確認。", close: true };
    }
    return {
      ok: true,
      payload: {
        type: "story_choice",
        node_id: live.node_id,
        choice_id: live.id,
        hero_id: live.hero_id,
        decode_mode: live.decode_mode,
        expected_story_revision: story ? story.story_revision : 1
      }
    };
  }

  function storyToEngine(view) {
    if (!view) return StoryEngine.createState();
    // publicView already returns a view; listChoices needs flags/act/node/relations.
    // Engine view is sufficient if it includes those fields.
    if (view.flags && view.relation && view.current_node !== undefined) {
      return {
        chapter_status: view.chapter_status,
        act: view.act,
        current_node: view.current_node,
        flags: view.flags,
        relation: view.relation,
        assigned_hero: view.assigned_hero,
        ending_id: view.ending_id,
        resolved_nodes: view.choice_history ? undefined : view.resolved_nodes,
        used_story_once_ids: view.used_story_once_ids || []
      };
    }
    return view;
  }

  function choiceModels(state) {
    if (!state || !state.story) return [];
    var alloy = state.you ? state.you.alloy : 0;
    return StoryEngine.listChoices(storyToEngine(state.story), alloy);
  }

  return {
    defaultRoute: defaultRoute,
    normalizeRoute: normalizeRoute,
    navigate: navigate,
    routeKey: routeKey,
    nodeUnlocked: nodeUnlocked,
    locationState: locationState,
    exploreEntry: exploreEntry,
    finishVisible: finishVisible,
    pageSignature: pageSignature,
    hudSignature: hudSignature,
    chromeStructureSignature: chromeStructureSignature,
    shouldReplaceInteractiveChrome: shouldReplaceInteractiveChrome,
    shouldRebuildPage: shouldRebuildPage,
    navSignature: navSignature,
    hudControlSignature: hudControlSignature,
    alertStructureSignature: alertStructureSignature,
    pageControlSignature: pageControlSignature,
    planChromePageUpdate: planChromePageUpdate,
    openStoryConfirm: openStoryConfirm,
    storySubmit: storySubmit,
    choiceModels: choiceModels,
    Data: Data,
  };
});
