/* 《無聲的歸航》敘事資料：文字、地點、英雄、選項與結局。不含規則結算。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.StarfallSoloStoryData = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var STORY_ID = "silent-homecoming";
  var STORY_VERSION = 1;
  var ONCE_ACT2 = "ONCE-ACT2-ABILITY";
  var ONCE_ACT3 = "ONCE-ACT3-ENDING";

  var HEROES = {
    "HERO-01": {
      id: "HERO-01",
      name: "璃棱",
      relation_key: "liling",
      role: "航行與星圖分析專家",
      ability_id: "ABILITY-ROUTE",
      ability_name: "重建消失的航線",
      background: "遠燈號原本的航線計算官。墜毀前，她曾多次提出航道有異常，但被船長否決。她保存的最後一段記憶，是整艘船突然偏離原定航線。",
      personality: "冷靜、精確、討厭沒有證據的希望。",
    },
    "HERO-02": {
      id: "HERO-02",
      name: "秋纓",
      relation_key: "qiuying",
      role: "生態與殖民環境專家",
      ability_id: "ABILITY-HABITAT",
      ability_name: "還原失落的居住藍圖",
      background: "她負責遠燈號的封閉式食物循環設計。她發現訊號中存在不屬於求救通訊的生態數據，懷疑前人曾在這顆星球長期生活。",
      personality: "溫和但固執，習慣先考慮活下來的人，而不是歷史上的英雄。",
    },
    "HERO-03": {
      id: "HERO-03",
      name: "烏燼",
      relation_key: "wujin",
      role: "安全協定與情報封鎖專家",
      ability_id: "ABILITY-ARCHIVE",
      ability_name: "建立靜默封存程序",
      background: "船上原本負責處理異常通訊的安全人格。墜毀前最後一刻，他曾主張立即關閉全船通訊，但這項命令未被執行。",
      personality: "寡言、警覺，願意被誤解，也不願讓倖存者再冒一次險。",
    }
  };

  var LOCATIONS = [
    {
      id: "LOC-01",
      name: "折斷天線陣",
      node_id: "STORY-01",
      summary: "暗紅色的天空下，一座折斷的天線斜插進黑色沙地。第一幕在此展開。"
    },
    {
      id: "LOC-02",
      name: "沉睡花室",
      node_id: "STORY-02",
      summary: "地下密封花室裡，玻璃後方只剩一排排乾枯的根系。第二幕在此展開。"
    },
    {
      id: "LOC-03",
      name: "地底航圖室",
      node_id: "STORY-03",
      summary: "花室深處的艙門通往一面巨大星圖，以及一段尚未送出的通訊。第三幕在此展開。"
    }
  ];

  var NODES = {
    "STORY-01": {
      id: "STORY-01",
      act: 1,
      location_id: "LOC-01",
      title: "第一幕｜折斷天線陣",
      scene: [
        "暗紅色的天空下，一座折斷的天線斜插進黑色沙地。",
        "你在控制台重新接通電源，殘破的螢幕突然亮起。三個陌生而熟悉的聲音，同時從指揮艙的記憶核心傳出。",
        "「這不是偶然墜落。」璃棱投影出一條被人刪除的航線。",
        "「等等。」秋纓放大訊號中的細微波形，「這裡面有植物呼吸循環的記錄。有人曾經在這裡活下來。」",
        "烏燼沒有展示任何影像。",
        "他只是把訊號的最後八個字放大。",
        "「請不要回答我們。」",
        "三份人格檔案都等待你的命令。你只能選擇先相信其中一份情報。"
      ]
    },
    "STORY-02": {
      id: "STORY-02",
      act: 2,
      location_id: "LOC-02",
      title: "第二幕｜沉睡花室",
      scene: [
        "你沿著損毀的艙道，找到一座藏在地下的密封花室。",
        "玻璃後方沒有活著的植物，只有一排排乾枯的根系。牆上卻寫滿人類文字，每一行都是某人留下的照顧紀錄。",
        "最後一頁停在同一句話：",
        "「第七次嘗試，我們仍然相信明天會有人回來。」",
        "璃棱認為花室只是失蹤船艦的中轉站，真正的答案藏在更遠的航線。",
        "秋纓說，能在這裡種植七次的人，或許早已把這顆星球當成家。",
        "烏燼卻發現，所有資料的最後一頁都在同一天被刪除。",
        "你只能將完整的解碼權限交給一位專家，並選擇一次解讀方式。其餘方案將無法再執行。"
      ],
      stance_text: [
        "璃棱的影像沉默了一瞬。",
        "「你之前相信我的判斷。」",
        "你望向另一份人格檔案。",
        "「我知道。但現在，我有了不同的答案。」",
        "指揮艙提示：改變立場後，原英雄的專屬解析機會將永久放棄。"
      ],
      free_text: [
        "「我可以還原主要資料，但仍有一些無法確認的部分。」",
        "指揮艙提示：免費解讀不消耗資源，仍可進入完整結局。"
      ],
      verified_text: [
        "「如果要確認最後一段記錄，我需要消耗兩單位合金修復讀取核心。」",
        "你望向仍然等待建造的前哨設施。",
        "每一塊合金，本來都有其他用途。",
        "這次，你願意為更確定的答案付出代價嗎？"
      ]
    },
    "STORY-03": {
      id: "STORY-03",
      act: 3,
      location_id: "LOC-03",
      title: "第三幕｜地底航圖室",
      scene: [
        "花室深處的艙門終於打開。",
        "裡面沒有失蹤船員，也沒有等待救援的船艦。",
        "只有一面巨大的星圖，以及一段尚未送出的通訊。",
        "「如果你正在閱讀這段記錄，代表我們已經決定留下。」",
        "螢幕上，失蹤者留下了三種可能的未來：",
        "向遠方發送訊號，讓人類知道這裡存在另一個家園。",
        "利用留下的知識，在星球上重新開始。",
        "或是永遠封存座標，避免後來者重蹈他們的覆轍。",
        "天線仍然可以啟動。花室依然可以保存。封存程序也只差最後一道指令。",
        "但你知道，無論選擇哪條路，這六名倖存者都必須承擔後果。",
        "你要把甚麼留給下一個抵達的人？"
      ]
    }
  };

  var CHOICES = [
    {
      id: "S01-A", node_id: "STORY-01", label: "相信璃棱，先查被刪除的航線",
      rations: 0, alloy: 0, hero_id: "HERO-01", decode_mode: null, once_id: null
    },
    {
      id: "S01-B", node_id: "STORY-01", label: "相信秋纓，先查生命循環記錄",
      rations: 0, alloy: 0, hero_id: "HERO-02", decode_mode: null, once_id: null
    },
    {
      id: "S01-C", node_id: "STORY-01", label: "相信烏燼，先確認訊號是否危險",
      rations: 0, alloy: 0, hero_id: "HERO-03", decode_mode: null, once_id: null
    },
    {
      id: "S02-HERO-01-FREE", node_id: "STORY-02", label: "指派璃棱，免費解讀航線",
      rations: 0, alloy: 0, hero_id: "HERO-01", decode_mode: "free", once_id: ONCE_ACT2,
      ability_id: "ABILITY-ROUTE"
    },
    {
      id: "S02-HERO-01-VERIFIED", node_id: "STORY-02", label: "指派璃棱，深入解碼航線（消耗2合金）",
      rations: 0, alloy: 2, hero_id: "HERO-01", decode_mode: "verified", once_id: ONCE_ACT2,
      ability_id: "ABILITY-ROUTE"
    },
    {
      id: "S02-HERO-02-FREE", node_id: "STORY-02", label: "指派秋纓，免費解讀居住藍圖",
      rations: 0, alloy: 0, hero_id: "HERO-02", decode_mode: "free", once_id: ONCE_ACT2,
      ability_id: "ABILITY-HABITAT"
    },
    {
      id: "S02-HERO-02-VERIFIED", node_id: "STORY-02", label: "指派秋纓，深入解碼居住藍圖（消耗2合金）",
      rations: 0, alloy: 2, hero_id: "HERO-02", decode_mode: "verified", once_id: ONCE_ACT2,
      ability_id: "ABILITY-HABITAT"
    },
    {
      id: "S02-HERO-03-FREE", node_id: "STORY-02", label: "指派烏燼，免費解讀封存程序",
      rations: 0, alloy: 0, hero_id: "HERO-03", decode_mode: "free", once_id: ONCE_ACT2,
      ability_id: "ABILITY-ARCHIVE"
    },
    {
      id: "S02-HERO-03-VERIFIED", node_id: "STORY-02", label: "指派烏燼，深入解碼封存程序（消耗2合金）",
      rations: 0, alloy: 2, hero_id: "HERO-03", decode_mode: "verified", once_id: ONCE_ACT2,
      ability_id: "ABILITY-ARCHIVE"
    },
    {
      id: "S03-A", node_id: "STORY-03", label: "公開航線，送出求援訊號",
      rations: 0, alloy: 0, require_flag: "route_confirmed",
      ending_id: "END-SIGNAL", ending_variant: "base", final_decision: "signal", once_id: ONCE_ACT3
    },
    {
      id: "S03-A2", node_id: "STORY-03", label: "附上已核證航線與風險註記",
      rations: 0, alloy: 0, require_flag: "route_verified",
      ending_id: "END-SIGNAL", ending_variant: "verified", final_decision: "signal", once_id: ONCE_ACT3
    },
    {
      id: "S03-B", node_id: "STORY-03", label: "留在星球，保留前哨",
      rations: 0, alloy: 0, require_flag: null,
      ending_id: "END-HOME", ending_variant: "home_basic", final_decision: "home", once_id: ONCE_ACT3
    },
    {
      id: "S03-B2", node_id: "STORY-03", label: "按完整藍圖建立長期居所",
      rations: 0, alloy: 0, require_flag: "habitat_verified",
      ending_id: "END-HOME", ending_variant: "verified", final_decision: "home", once_id: ONCE_ACT3
    },
    {
      id: "S03-C", node_id: "STORY-03", label: "永久封存訊號",
      rations: 0, alloy: 0, require_flag: "archive_prepared",
      ending_id: "END-VAULT", ending_variant: "base", final_decision: "vault", once_id: ONCE_ACT3
    },
    {
      id: "S03-C2", node_id: "STORY-03", label: "永久封存並留可核證內部紀錄",
      rations: 0, alloy: 0, require_flag: "archive_verified",
      ending_id: "END-VAULT", ending_variant: "verified", final_decision: "vault", once_id: ONCE_ACT3
    }
  ];

  var ENDINGS = {
    "END-SIGNAL": {
      id: "END-SIGNAL",
      title: "有人會聽見",
      base: [
        "天線在晨光中重新抬起。",
        "沉睡多年的航線，終於再次出現在人類的通訊網絡。",
        "沒有人知道遠方是否會回答，也沒有人能保證到來的會是救援。",
        "璃棱望著那條曾經讓她失去一切的航線。",
        "「這次，至少是我們自己選擇出發。」",
        "訊號已經送出。",
        "在遙遠的宇宙裡，某個尚未抵達的明天，終於有了方向。"
      ],
      verified: [
        "天線在晨光中重新抬起。",
        "沉睡多年的航線，終於再次出現在人類的通訊網絡。",
        "沒有人知道遠方是否會回答，也沒有人能保證到來的會是救援。",
        "璃棱望著那條曾經讓她失去一切的航線。",
        "「這次，至少是我們自己選擇出發。」",
        "璃棱將完整的航線證據與風險註記一同送出。這一次，遠方收到的不只是一聲求救，還有理解這顆星球所需的真相。",
        "訊號已經送出。",
        "在遙遠的宇宙裡，某個尚未抵達的明天，終於有了方向。"
      ]
    },
    "END-HOME": {
      id: "END-HOME",
      title: "這裡有明天",
      planned: [
        "秋纓把最後一份居住藍圖投映在花室牆上。",
        "那些枯死的根系，並不是失敗的證明。",
        "它們是一群曾經努力活下來的人，留給後來者的答案。",
        "你關閉了遠航頻道，卻保留所有能幫助倖存者重建生活的資料。",
        "沒有人再說這裡只是臨時前哨。",
        "當第一道晨光照進艙門，六名倖存者終於有了一個可以稱為家的地方。"
      ],
      base: [
        "你沒有取得完整的居住藍圖，也沒有選擇將座標送向宇宙。",
        "前哨仍然殘破，未來仍充滿未知。",
        "但指揮艙的燈還亮著，六名倖存者仍有機會繼續嘗試。",
        "這裡尚未成為家，但至少，明天仍然可以從這裡開始。"
      ],
      verified: [
        "秋纓把最後一份居住藍圖投映在花室牆上。",
        "那些枯死的根系，並不是失敗的證明。",
        "它們是一群曾經努力活下來的人，留給後來者的答案。",
        "你關閉了遠航頻道，卻保留所有能幫助倖存者重建生活的資料。",
        "秋纓把完整核證的居住藍圖展開。前哨將按這份已驗證的規劃，在星球上建立長期居所。",
        "沒有人再說這裡只是臨時前哨。",
        "當第一道晨光照進艙門，六名倖存者終於有了一個可以稱為家的地方。"
      ],
      forced: [
        "故事未完成｜系統自動收束",
        "你的前哨戰局已經結束。由於尚未作出最終故事選擇，指揮艙暫時封存未完成的資料，將倖存者的去向記錄為留在星球。",
        "前哨的戰局已經塵埃落定。",
        "但神秘訊號的答案，還沒有來得及由你親自選擇。",
        "指揮艙自動保存了目前所有資料，關閉遠航通訊，將剩餘的希望留給這座星球。",
        "這不是你原本計劃的結局，卻是前哨在最後一刻留下的方向。",
        "這是系統收束，不是你親自選擇的故事結局。"
      ]
    },
    "END-VAULT": {
      id: "END-VAULT",
      title: "最後的守望者",
      base: [
        "最後一道資料閘門在你面前關閉。",
        "地底航圖室的星圖逐一熄滅，只留下前哨本身的位置。",
        "烏燼沒有表示勝利。",
        "他只是確認，所有能引來下一艘船的座標，都已經無法對外發送。",
        "「也許我們錯了。」他說。",
        "「但至少這一次，錯誤不會由不知道真相的人來承擔。」",
        "你走出地底，望向仍然陌生的天空。",
        "這座前哨將繼續活著，卻不再向宇宙要求任何答案。"
      ],
      verified: [
        "最後一道資料閘門在你面前關閉。",
        "地底航圖室的星圖逐一熄滅，只留下前哨本身的位置。",
        "烏燼沒有表示勝利。",
        "他只是確認，所有能引來下一艘船的座標，都已經無法對外發送。",
        "「也許我們錯了。」他說。",
        "「但至少這一次，錯誤不會由不知道真相的人來承擔。」",
        "烏燼在封存之外，留下一份僅供前哨內部核證的紀錄。座標不會再對外發送，但倖存者仍能核對這次決定的依據。",
        "你走出地底，望向仍然陌生的天空。",
        "這座前哨將繼續活著，卻不再向宇宙要求任何答案。"
      ]
    }
  };

  var LEGACY_UNAVAILABLE_TEXT = [
    "本局於故事功能加入前已經結束。",
    "故事章節在當局未啟用，不會補發結局或關係。"
  ];

  function choiceById(id) {
    for (var i = 0; i < CHOICES.length; i++) {
      if (CHOICES[i].id === id) return CHOICES[i];
    }
    return null;
  }

  function choicesForNode(nodeId) {
    return CHOICES.filter(function (c) { return c.node_id === nodeId; });
  }

  function heroList() {
    return [HEROES["HERO-01"], HEROES["HERO-02"], HEROES["HERO-03"]];
  }

  function endingText(endingId, variant) {
    var pack = ENDINGS[endingId];
    if (!pack) return [];
    if (variant === "forced") return (pack.forced || pack.base || []).slice();
    if (variant === "verified") return (pack.verified || pack.base || []).slice();
    if (variant === "planned") return (pack.planned || pack.base || []).slice();
    return (pack.base || []).slice();
  }

  return {
    STORY_ID: STORY_ID,
    STORY_VERSION: STORY_VERSION,
    ONCE_ACT2: ONCE_ACT2,
    ONCE_ACT3: ONCE_ACT3,
    HEROES: HEROES,
    LOCATIONS: LOCATIONS,
    NODES: NODES,
    CHOICES: CHOICES,
    ENDINGS: ENDINGS,
    LEGACY_UNAVAILABLE_TEXT: LEGACY_UNAVAILABLE_TEXT,
    choiceById: choiceById,
    choicesForNode: choicesForNode,
    heroList: heroList,
    endingText: endingText,
  };
});
