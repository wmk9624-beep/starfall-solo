/* 純本機長期前哨 UI；不讀取舊單局和旅程存檔。 */
(function (root, factory) {
  if (typeof module==='object'&&module.exports)module.exports=factory(require('./outpost.js'));
  else root.StarfallOutpostUi=factory(root.StarfallOutpost);
})(typeof globalThis!=='undefined'?globalThis:this,function (O) {
  'use strict';
  if(!O)throw Error('缺少長期前哨規則。');
  const INTRO=[
    '艦橋的燈光熄滅時，這顆陌生星球正從舷窗另一側升起。撞擊撕開了船身，六位倖存者將最後的物資拖進一塊尚能擋風的岩谷。',
    '求救訊號發了出去，沒有立即得到答覆。遠方偶爾有不明亮點掠過，通訊器只能撈起破碎雜音。你必須先令這裡成為一座能撐下去的前哨。',
    '現在只有20份口糧、8份合金、6名船員。回收廠仍可開工；補給棚、整備艙與升級要靠你安排。日後外出的人有可能回不來。',
    '這不是一場必須在15分鐘內拯救宇宙的故事。每次外拓只有15分鐘，前哨、人口與傷痕卻會留下。收到模糊呼號以前，你也不知道誰在向你求助。'
  ];
  function escapeHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function fmt(t){const n=Math.max(0,Math.floor(t||0));return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
  function nowMs(){return Date.now();}
  function WallClock(start,wall){this.t=start||0;this.anchor=0;this.running=false;this.wall=wall||(()=>typeof performance!=='undefined'&&performance.now?performance.now()/1000:Date.now()/1000);}
  WallClock.prototype.now=function(){return this.running?this.t+Math.max(0,this.wall()-this.anchor):this.t;};
  WallClock.prototype.set=function(n){this.t=n;if(this.running)this.anchor=this.wall();return n;};
  WallClock.prototype.pause=function(){if(this.running){this.t=this.now();this.running=false;}return this.t;};
  WallClock.prototype.resume=function(){if(!this.running){this.anchor=this.wall();this.running=true;}return this.t;};
  Object.defineProperty(WallClock.prototype,'paused',{get:function(){return !this.running;}});
  const state={screen:'boot',intro:0,tab:'base',controller:null,app:null,readOnly:false,
    pointerDown:false,error:'',signature:'',stageSignature:'',alertSignature:'',departDraft:null,bound:false,seed:0,
    readReport:null,readRaid:null,openCards:{},autoMailPending:false};
  function token(){const c=typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():null;
    return 'outpost-'+(c||String(nowMs())+'-'+Math.random().toString(36).slice(2));}
  function clock(){const opts=typeof window!=='undefined'?window.__OUTPOST_TEST_OPTS__:null;
    return opts&&typeof opts.createClock==='function'?opts.createClock():new WallClock(0);}
  function ctrl(){return new O.Controller(window.localStorage,clock(),token(),nowMs);}
  function link(){return '<a href="journey.html" class="outpost-text-link">返回其他遊戲模式</a>';}
  function error(){return state.error?'<p class="outpost-error" role="alert">'+escapeHtml(state.error)+'</p>':'';}
  function renderIntro(){state.app.innerHTML='<section class="outpost-intro"><div class="outpost-intro-card">'+
    '<span class="outpost-eyebrow">OUTPOST · PROLOGUE '+(state.intro+1)+'/4</span><h1>墜星前哨：最後的求救</h1>'+
    '<p class="outpost-intro-text">'+escapeHtml(INTRO[state.intro])+'</p>'+error()+
    (state.intro<INTRO.length-1?'<button class="btn" type="button" data-o-action="intro-next">繼續閱讀</button>':
      '<p class="outpost-first-step">開始後可先派回收廠工人，或合金足夠時建補給棚。設施、物資及人口缺口會跨外拓保留；切頁或離開不等於暫停，未暫停返回可能補算。</p><button class="btn" type="button" data-o-action="enter">進入前哨（建立獨立存檔）</button>')+
    '<p class="outpost-muted">背景閱讀期間不計時、不建立存檔、不自動派遣。</p>'+link()+'</div></section>';}
  function renderEntry(){const loaded=O.load(window.localStorage);
    if(!loaded.ok){state.screen='invalid';state.app.innerHTML='<div class="outpost-entry card"><h1>無法讀取前哨</h1><p role="alert">'+escapeHtml(loaded.error)+'</p><p>原始存檔未被刪除或修改。請先保留備份，再檢查資料。</p>'+link()+'</div>';return;}
    if(loaded.empty){state.screen='intro';renderIntro();return;}
    state.screen='entry';state.app.innerHTML='<section class="outpost-entry card"><span class="outpost-eyebrow">PERSISTENT OUTPOST</span><h1>長期前哨</h1>'+error()+
      '<p>已找到獨立前哨存檔。基地建築、人口損失及外拓結算都會延續。</p><button class="btn" data-o-action="continue" type="button">繼續前哨</button>'+link()+'</section>';}
  function stat(label,value,id){return '<div class="outpost-stat"><span>'+label+'</span><strong'+(id?' data-o-'+id:'')+'>'+escapeHtml(value)+'</strong></div>';}
  function currentNotice(v){
    const raid=v.expedition?v.expedition.raid:v.shift&&v.shift.raid;
    const threat=raid&&raid.stage==='battle'?
      (v.expedition?'外拓遭襲，交戰即將結算':'基地遭襲，交戰即將結算'):
      v.expedition&&raid&&raid.stage==='scheduled'?'外拓警戒：前路可能遇襲':'';
    const signal=v.hero.phase==='hint'?'來源未明的呼號':v.hero.phase==='ready'?'電台有待回覆訊息':'';
    return [threat,signal].filter(Boolean).join(' · ');
  }
  function noticeSignature(v){
    const raid=v.expedition?v.expedition.raid:v.shift&&v.shift.raid;
    return JSON.stringify([v.expedition?'expedition':'base',raid&&raid.stage,v.hero.phase,state.tab]);
  }
  function alertHtml(v){const text=currentNotice(v);if(!text)return '';
    const ready=v.hero.phase==='ready'&&state.tab!=='radio';
    return '<div class="outpost-alert" role="region" aria-label="進行中的警戒">'+
      '<span class="outpost-warning-symbol" aria-hidden="true">◆</span>'+
      '<span class="outpost-threat" data-o-threat aria-live="off">'+escapeHtml(text)+'</span>'+
      (ready?'<button class="outpost-alert-link" type="button" data-o-action="tab" data-o-tab="radio">前往電台回覆</button>':'')+'</div>';
  }
  function unreadMail(v){const r=v.last_report&&v.last_report.settlement_id;
    const raid=v.last_raid&&v.last_raid.settlement_id;
    return !!((r&&r!==state.readReport)||(raid&&raid!==state.readRaid));}
  function markMailRead(v){state.readReport=v.last_report&&v.last_report.settlement_id||null;
    state.readRaid=v.last_raid&&v.last_raid.settlement_id||null;}
  function shell(v){const b=v.base;const tabs=[['base','基地'],['expedition','外拓'],['radio','電台'],['mailbox','信箱']];
    return '<div class="outpost-shell">'+
      '<header class="outpost-hud"><div class="outpost-hud-head"><div><span class="outpost-eyebrow">持續基地 · 只存在本機</span><h1>墜星前哨</h1></div>'+
      '<button class="btn small" type="button" data-o-action="pause" aria-label="'+(v.manual_paused?'恢復':'暫停')+'遊戲時間">'+(v.manual_paused?'繼續':'暫停')+'</button></div>'+
      '<div class="outpost-stats" aria-label="基地資源與人口">'+stat('口糧',b.rations,'rations')+stat('合金',b.alloy,'alloy')+
        stat('總人口',v.population+'/6','population')+stat('留守',v.base_population,'base-population')+'</div>'+
      '<div class="outpost-state-line"><span data-o-clock>已經過 '+fmt(v.time)+'</span><span data-o-runclock>'+
      (v.expedition?'本趟餘 '+fmt(900-(v.time-v.expedition.started_at)):'長期基地')+'</span></div></header>'+
      '<div class="outpost-notice-slot" data-o-notice-slot>'+alertHtml(v)+'</div>'+
      '<div id="outpost-stage" class="outpost-stage" tabindex="-1">'+error()+page(v)+'</div>'+
      '<nav class="outpost-nav" aria-label="長期前哨主要頁面">'+tabs.map(([id,title])=>
        '<button id="outpost-nav-'+id+'" class="outpost-nav-btn'+(state.tab===id?' active':'')+'" data-o-action="tab" data-o-tab="'+id+'" type="button"'+
        (state.tab===id?' aria-current="page"':'')+' aria-label="'+(
          id==='radio'?(v.hero.phase==='ready'?'電台有待回覆':v.hero.phase==='hint'?'電台有來源未明的呼號':'電台'):
          id==='mailbox'?(unreadMail(v)?'信箱有新回報':'回報信箱'):title)+'"><span>'+title+'</span>'+
          (id==='radio'?'<span class="outpost-nav-badge" data-o-radio-badge hidden aria-hidden="true">●</span>':
           id==='mailbox'?'<span class="outpost-nav-badge" data-o-mail-badge hidden aria-hidden="true">●</span>':'')+
          '</button>').join('')+'</nav></div>';
  }
  // Original, local SVG artwork: the same facility gains details only when its actual state changes.
  function buildingArt(kind,mode){
    const frame='<rect x="5" y="63" width="150" height="13" rx="4" fill="#263d57"/>';
    let shapes='';
    if(kind==='recycle'){
      shapes='<path d="M19 62V37L42 24L62 37V62Z" fill="#477783" stroke="#a3e1d2" stroke-width="2"/>'+
        '<path d="M62 62V34H130V62Z" fill="#285162" stroke="#a3e1d2" stroke-width="2"/>'+
        '<rect x="72" y="41" width="21" height="13" rx="2" fill="#0d2638"/>'+
        '<rect x="100" y="41" width="19" height="13" rx="2" fill="#0d2638"/>'+
        '<path d="M35 24V11H45V25" fill="#628692" stroke="#a3e1d2"/>';
      if(mode==='upgraded')shapes+='<path d="M14 29L35 16L57 29M63 27L82 17L102 27L122 17L145 27" fill="none" stroke="#f8ca79" stroke-width="3"/>'+
        '<circle cx="83" cy="47" r="8" fill="#ffc977"/><path d="M75 47H91M83 39V55" stroke="#1b3650" stroke-width="2"/>'+
        '<rect x="110" y="31" width="30" height="5" fill="#ffdca0"/>';
    }else if(kind==='supply'){
      if(mode==='unbuilt')shapes='<path d="M21 62V46Q80 -4 139 46V62Z" fill="none" stroke="#7899ad" stroke-dasharray="6 6" stroke-width="2"/>'+
        '<path d="M35 63H124" stroke="#a5c1c7" stroke-width="3"/>';
      else{
        shapes='<path d="M19 63V42Q80 -4 141 42V63Z" fill="#285e56" stroke="#9edbd2" stroke-width="2"/>'+
          '<path d="M80 15V62M46 26V62M114 26V62" stroke="#9edbd2" stroke-width="2"/>'+
          '<path d="M36 62Q42 39 51 49Q60 37 68 62M85 62Q99 38 113 62" fill="#7bbc86"/>';
        if(mode==='upgraded')shapes+='<path d="M14 36Q80 -18 146 36" fill="none" stroke="#f7d792" stroke-width="4"/>'+
          '<path d="M30 61Q43 24 61 47Q72 22 88 61M95 61Q112 17 130 61" fill="#bbef92"/>'+
          '<circle cx="79" cy="20" r="7" fill="#f9d88a"/>'+
          '<path d="M48 33L80 8L112 33" stroke="#d2fba8" stroke-width="2" fill="none"/>';
      }
    }else if(kind==='armory'){
      if(mode==='unbuilt')shapes='<path d="M20 61V36L80 17L140 36V61Z" stroke="#7993ab" stroke-dasharray="7 6" fill="none" stroke-width="2"/>'+
        '<path d="M44 61V42H116V61" stroke="#7993ab" stroke-dasharray="6 5" fill="none"/>';
      else shapes='<path d="M13 62V33L80 13L147 33V62Z" fill="#3f566d" stroke="#cbd9ec" stroke-width="2"/>'+
        '<path d="M52 62V38H108V62" fill="#14273c" stroke="#d0e1f5" stroke-width="2"/>'+
        '<path d="M80 20L93 28L89 42Q80 51 71 42L67 28Z" fill="#f3bd75"/>'+
        '<path d="M24 44H43M117 44H136" stroke="#f6cc91" stroke-width="4"/>';
    }else{
      shapes='<path d="M42 62V24L80 9L118 24V62Z" fill="#2e5364" stroke="#c8e7e4" stroke-width="2"/>'+
        '<rect x="62" y="32" width="36" height="27" rx="3" fill="#112c3d"/>'+
        '<path d="M80 10V3M53 30L39 19M107 30L121 19" stroke="#9dc7d8" stroke-width="3"/>'+
        (mode==='staffed'?'<circle cx="80" cy="24" r="6" fill="#ffc978"/><path d="M65 44H95" stroke="#7be7d4" stroke-width="3"/>':
          '<circle cx="80" cy="24" r="6" fill="#607785"/>');
    }
    return '<svg class="outpost-building-art" viewBox="0 0 160 80" role="img" aria-label="'+escapeHtml(
      kind==='recycle'?(mode==='upgraded'?'已深拆回收廠':'回收廠'):
      kind==='supply'?(mode==='unbuilt'?'補給棚建築藍圖':mode==='upgraded'?'已密植補給棚':'已建補給棚'):
      kind==='armory'?(mode==='unbuilt'?'整備艙建築藍圖':'已建整備艙'):(mode==='staffed'?'值守中的指揮艙':'指揮艙'))+'" xmlns="http://www.w3.org/2000/svg">'+frame+shapes+'</svg>';
  }
  function cardButton(action,label,enabled,reason){const id='outpost-reason-'+action;
    return '<div class="outpost-control-wrap"><button class="btn small" id="outpost-btn-'+action+'" data-o-action="'+action+'" type="button"'+
      (enabled?'':' disabled title="'+escapeHtml(reason)+'" aria-describedby="'+id+'"')+'>'+label+'</button>'+
      '<span id="'+id+'" class="outpost-control-reason" data-o-reason-for="'+action+'">'+(enabled?'':escapeHtml(reason))+'</span></div>';
  }
  function assignmentReason(b,facility,pop){if(pop<=1&&facility!=='duty')return '目前僅1人，生產線不能再增派。';
    if(facility==='supply'&&!b.supply_built)return '請先建造補給棚。';
    if(facility==='duty'&&b.duty_workers>=1)return '指揮艙最多值守1人。';
    if(facility==='recycle'&&b.recycle_workers>=2||facility==='supply'&&b.supply_workers>=2)return '此設施最多2人。';
    if(b.standby<1)return '待命人手不足，請先調回船員。';
    if(facility!=='duty'&&b.recycle_workers+b.supply_workers>=Math.min(5,pop-1))return '至少保留1人不投入生產。';
    return '';
  }
  // Inline worker controls stay outside <details> and <summary>, so collapsed cards
  // remain actionable. Authoritative eligibility still comes from assignmentReason().
  function assignmentVisibleReason(reason,count){
    return reason?(count===0?reason+' 目前沒有可調回人員。':reason):(count===0?'目前沒有可調回人員。':'');
  }
  function assignRow(label,facility,count,b,pop){
    const reason=assignmentReason(b,facility,pop);
    const decReason=count===0?'目前沒有可調回人員。':'';
    const visibleReason=assignmentVisibleReason(reason,count);
    const why='outpost-assign-reason-'+facility;
    return '<div class="outpost-inline-assign outpost-assign-row" data-o-inline-assign="'+facility+'" aria-label="'+label+'派工">'+
      '<button class="btn small outpost-inline-step" id="outpost-assign-'+facility+'-minus" data-o-action="assign" data-o-facility="'+facility+'" data-o-count="'+(count-1)+'" data-o-direction="dec" type="button"'+
      (count===0?' disabled title="'+escapeHtml(decReason)+'" aria-describedby="'+why+'"':'')+' aria-label="'+label+'調回一人">−</button>'+
      '<span class="outpost-inline-amount" aria-live="off"><strong data-o-workers="'+facility+'">'+count+'</strong><span class="outpost-inline-unit">人</span></span>'+
      '<button class="btn small outpost-inline-step" id="outpost-assign-'+facility+'-plus" data-o-action="assign" data-o-facility="'+facility+'" data-o-count="'+(count+1)+'" data-o-direction="inc" type="button"'+
      (reason?' disabled title="'+escapeHtml(reason)+'" aria-describedby="'+why+'"':'')+' aria-label="'+label+'增派一人">＋</button>'+
      '<span class="outpost-control-reason outpost-inline-reason" id="'+why+'" data-o-assign-reason="'+facility+'">'+escapeHtml(visibleReason)+'</span></div>';
  }
  function buildingCard(kind,v){const b=v.base,pop=v.population;
    const mode=kind==='recycle'?(b.recycle_upgraded?'upgraded':'basic'):
      kind==='supply'?(!b.supply_built?'unbuilt':b.supply_upgraded?'upgraded':'built'):
      kind==='armory'?(b.armory_built?'built':'unbuilt'):(b.duty_workers?'staffed':'basic');
    let title='',status='',detail='',inline='';
    if(kind==='recycle'){
      title='回收廠';status=b.recycle_upgraded?'已深拆':'未深拆';
      inline=assignRow('回收廠','recycle',b.recycle_workers,b,pop);
      detail='<p>每30秒每名工人產出1合金；深拆升級合金6，須至少1名工人及1名值守船員才有額外產出。</p>'+
        (!b.recycle_upgraded?cardButton('upgrade-recycle','升級深拆 · 合金6',b.alloy>=6,'合金不足，升級需6合金。'):'<p class="outpost-owned">深拆裝置已完成</p>');
    }else if(kind==='supply'){
      title='補給棚';status=b.supply_built?(b.supply_upgraded?'已密植':'已建造 · 未密植'):'未建造';
      inline=assignRow('補給棚','supply',b.supply_workers,b,pop);
      detail=!b.supply_built?'<p>建造合金5，建成後方可安排工人產出口糧。</p>'+cardButton('build-supply','建造補給棚 · 合金5',b.alloy>=5,'合金不足，建造需5合金。'):
        '<p>每30秒每名工人產出2口糧；密植升級合金4，需至少1名工人及1名值守船員才有額外產出。</p>'+
        (!b.supply_upgraded?cardButton('upgrade-supply','升級密植 · 合金4',b.alloy>=4,'合金不足，升級需4合金。'):'<p class="outpost-owned">密植槽已完成</p>');
    }else if(kind==='armory'){
      title='整備艙';status=(b.armory_built?'':'未建造 · ')+'巡衛 '+b.patrols+' · 守陣 '+b.wards;
      detail=!b.armory_built?'<p>建造合金8後可訓練巡衛與守陣；此處沒有派駐工人。</p>'+cardButton('build-armory','建造整備艙 · 合金8',b.alloy>=8,'合金不足，建造需8合金。'):
        '<p>訓練與遣返各需30秒；訓練巡衛口糧3／合金2，守陣口糧4／合金1。</p><div class="outpost-armory-controls">'+
        cardButton('train-patrol','訓練巡衛 · 口糧3 合金2',!b.training&&b.standby>=1&&b.rations>=3&&b.alloy>=2,
          b.training?'已有訓練隊列。':b.standby<1?'待命船員不足。':'訓練巡衛需口糧3與合金2。')+
        cardButton('train-ward','訓練守陣 · 口糧4 合金1',!b.training&&b.standby>=1&&b.rations>=4&&b.alloy>=1,
          b.training?'已有訓練隊列。':b.standby<1?'待命船員不足。':'訓練守陣需口糧4與合金1。')+
        cardButton('recall-patrol','巡衛遣返1人',!b.recalling&&b.patrols>=1,
          b.recalling?'已有遣返隊列。':'目前沒有可遣返巡衛。')+
        cardButton('recall-ward','守陣遣返1人',!b.recalling&&b.wards>=1,
          b.recalling?'已有遣返隊列。':'目前沒有可遣返守陣。')+'</div>'+
        (b.training?'<p data-o-training-remaining>訓練中 · 尚餘 '+fmt(Math.max(0,b.training.completes_at-v.time))+'</p>':'')+
        (b.recalling?'<p data-o-recall-remaining>遣返中 · 尚餘 '+fmt(Math.max(0,b.recalling.completes_at-v.time))+'</p>':'');
    }else{
      title='指揮艙';status=b.duty_workers?'正在值守':'目前無人值守';
      inline=assignRow('指揮艙值守','duty',b.duty_workers,b,pop);
      detail='<p>開局已存在，不需建造或升級。值守1人可配合已升級且有工人的回收廠／補給棚提高產出。</p>';
    }
    return '<article class="outpost-building-card outpost-building-'+kind+' outpost-building-'+mode+'" data-o-building-card="'+kind+'" aria-label="'+title+'，'+status+'">'+
      '<div class="outpost-building-face">'+buildingArt(kind,mode)+
      '<span class="outpost-building-name">'+title+'</span><span class="outpost-building-status" data-o-card-status="'+kind+'">'+status+'</span></div>'+
      inline+
      '<details class="outpost-building-detail"><summary aria-label="'+title+'：查看操作與成本">查看操作與成本</summary>'+
      '<div class="outpost-building-controls">'+detail+'</div></details></article>';
  }
  function heroRecord(h){if(!h||h.phase!=='resolved'||!h.choice)return '';
    const label=h.choice==='HERO-SIGNAL-TRACE'?'TRACE｜記錄並追蹤訊號（免費）':
      h.choice==='HERO-SIGNAL-SHELTER'?'SHELTER｜優先守護訊號來源（免費）':'未記錄';
    return '<aside class="outpost-hero-record" aria-label="電台已回覆紀錄"><h3>電台已回覆</h3>'+ 
      '<p>選擇：'+escapeHtml(label)+'</p><p>'+escapeHtml(h.text||'未記錄')+'</p>'+ 
      '<p class="outpost-muted">這是通訊紀錄，沒有新增船員、永久資源加成或已驗證解鎖的能力。</p></aside>';
  }
  function basePage(v){const b=v.base;
    return '<section class="outpost-panel outpost-base-page"><h2>長期基地</h2>'+ 
      (v.population===1?'<p class="outpost-small-warning">目前僅剩1人，回收與補給生產線不可增派；外拓須至少2名出發及2名留守船員。</p>':'')+
      '<div class="outpost-building-grid" aria-label="基地四座建築">'+
      ['recycle','supply','armory','command'].map(kind=>buildingCard(kind,v)).join('')+'</div>'+ 
      '<details class="outpost-personnel"><summary>人員 · 即時編制與傷亡</summary>'+ 
      '<p>目前人口 <strong data-o-live-pop>'+v.population+'</strong>/6 · 留守 <strong data-o-personnel-base>'+v.base_population+'</strong> · 已外出 <strong data-o-live-away>'+
      (v.expedition?v.expedition.crew:0)+'</strong> · 累計永久傷亡 <strong data-o-live-losses>'+b.losses+'</strong></p>'+ 
      '<p>待命 <span data-o-personnel-standby>'+b.standby+'</span> · 巡衛 <span data-o-personnel-patrols>'+b.patrols+'</span> · 守陣 <span data-o-personnel-wards>'+b.wards+'</span> · 侵略失守 <span data-o-personnel-raids>'+b.raids_lost+'</span></p></details></section>';
  }
  function recordedNumber(obj,key){return obj&&Object.prototype.hasOwnProperty.call(obj,key)&&
    typeof obj[key]==='number'&&Number.isFinite(obj[key])?String(obj[key]):'未記錄';}
  function raidOutcome(raid){return !raid||!Object.prototype.hasOwnProperty.call(raid,'outcome')?'未記錄':
    raid.outcome==='attack_win'?'防守失敗':raid.outcome==='draw'?'打和':
    raid.outcome==='defense_win'?'防守成功':'未記錄';}
  function lastRaid(v){const r=v.last_raid;if(!r)return '<p>尚無已結算侵略紀錄。</p>';
    const where=r.context==='expedition'?'外拓':r.context==='base'?'留守':'未記錄';
    return '<p>侵略位置：'+where+' · '+raidOutcome(r)+' · 人口傷亡 '+recordedNumber(r,'loss_crew')+
      ' · 失去合金 '+recordedNumber(r,'loss_alloy')+' · 失去口糧 '+recordedNumber(r,'loss_rations')+'</p>';}
  function logs(v){return '<ul class="outpost-events">'+v.events.slice(-10).reverse().map(e=>'<li>'+fmt(e.at)+'　'+escapeHtml(e.text)+'</li>').join('')+'</ul>';}
  function select(label,id,min,max,initial){let a='';for(let n=min;n<=max;n++)a+='<option value="'+n+'"'+(n===initial?' selected':'')+'>'+n+'</option>';
    return '<label>'+label+'<select id="'+id+'" aria-label="'+label+'">'+a+'</select></label>';}
  function report(v){const r=v.last_report;if(!r)return '';
    const raid=r.raid;
    const cell=(name,val)=>'<div><dt>'+name+'</dt><dd>'+escapeHtml(val)+'</dd></div>';
    return '<section class="outpost-panel outpost-report" id="outpost-result" aria-labelledby="outpost-result-title">'+
      '<h2 id="outpost-result-title">上一趟外拓結算</h2><p>'+escapeHtml(r.reason||'未記錄')+'</p>'+
      '<h3>本趟侵略帳</h3><dl class="outpost-report-grid">'+
      cell('本趟侵略結果',raidOutcome(raid))+cell('本趟人口傷亡',recordedNumber(raid,'loss_crew'))+
      cell('本趟失去合金',recordedNumber(raid,'loss_alloy'))+cell('本趟失去口糧',recordedNumber(raid,'loss_rations'))+'</dl>'+
      '<h3>本趟實際返還</h3><dl class="outpost-report-grid">'+
      cell('返還船員',recordedNumber(r,'returning_crew'))+cell('返還口糧',recordedNumber(r,'rations'))+
      cell('返還合金',recordedNumber(r,'alloy'))+cell('在外採集',recordedNumber(r,'alloy_scavenged'))+
      cell('在外消耗口糧',recordedNumber(r,'rations_consumed'))+'</dl>'+
      '<p class="outpost-muted">本趟結算為歷史快照，不代表目前人口；即時編制請看本信箱或基地「人員」。</p></section>';}
  function expeditionPage(v){const b=v.base,e=v.expedition;let content='<section class="outpost-panel"><h2>15分鐘外拓</h2>';
    if(e){content+='<p data-o-expedition-progress>正在外拓 · 航程 '+fmt(v.time-e.started_at)+' / 15:00，15分鐘到期自動結算。</p>'+ 
      '<div class="outpost-stats in-run">'+stat('外拓船員',e.crew,'out-crew')+stat('口糧',e.rations,'out-rations')+stat('合金',e.alloy,'out-alloy')+stat('在外採集',e.alloy_scavenged,'out-scavenged')+'</div>'+ 
      '<p>侵略：'+(e.raid.stage==='resolved'?'已結算':e.raid.stage==='battle'?'正在交戰':'尚未發生')+'；出發前已固定遭遇時刻，不會中途重抽。</p>'+ 
      '<div class="outpost-return-control" aria-label="提前返航控制">'+
      (e.return_requested?'<p class="outpost-return-wait" role="status">返航請求已送出；本趟已排定侵略結算後會自動返回。無須再按。</p>':
        '<p class="outpost-return-rule">這是返航請求；必須等待本趟已排定侵略結算後才會返回，不會立即返航。</p>'+
        '<button class="btn secondary" type="button" data-o-action="return">要求提前返航</button>')+'</div>';
    }else{const can=b.standby>=2&&v.population>=4&&b.rations>=8;
      content+='<p>只由待命人員編組，基地最少留守2人；每30秒在外人手至少2人可取得1合金，每90秒消耗1口糧。</p>'+ 
        '<div class="outpost-depart-form" role="group" aria-label="外拓編制">'+select('帶出船員（2–4，留守≥2）','outpost-crew',2,4,2)+
          select('攜帶口糧（4–10，基地留≥4）','outpost-rations',4,10,4)+
          select('攜帶合金（0–3，基地留≥2）','outpost-alloy',0,3,0)+'</div>'+ 
        '<p data-o-prep-resources>基地目前待命 '+b.standby+' · 口糧 '+b.rations+' · 合金 '+b.alloy+'。可先在基地調回工作人員，再決定出發。</p>'+ 
        '<button class="btn" type="button" data-o-action="depart"'+(can?'':' disabled title="'+(v.population<4?'人口不足：外拓至少2人出發、2人留守。':b.standby<2?'待命船員不足。':'基地口糧不足以安全出發。')+'"')+'>確認編制並出發</button>'+ 
        '<p class="outpost-small-warning outpost-depart-reason" id="outpost-depart-reason" data-o-depart-reason>'+(can?'':(v.population<4?'目前人口不足4人：至少要2人外拓及2人留守，不能出發。':b.standby<2?'待命人手不足，請先回基地調回人員。':'口糧不足，請先於基地補給。'))+'</p>'+
        '<p class="outpost-muted">外拓會遇到一次真實侵略。失敗會永久減少人口與物資，不會刪除長期基地。</p>';
    }
    return content+'</section>';}
  function radioPage(v){const h=v.hero;let inner='';
    if(h.phase==='hidden')inner='<p>電台正在掃描，只聽到風聲與機械雜訊。目前沒有可辨認的來訊。</p>';
    if(h.phase==='hint')inner='<p>'+escapeHtml(h.hint)+'</p><p class="outpost-muted">訊號仍然模糊，暫時無法回覆。</p>';
    if(h.phase==='ready')inner='<h3>'+escapeHtml(h.title)+'</h3><p>'+escapeHtml(h.introduction)+'</p>'+h.options.map(o=>
      '<button class="btn secondary" type="button" data-o-action="hero-choice" data-o-choice="'+o.id+'">'+escapeHtml(o.label)+'</button>').join('');
    if(h.phase==='resolved')inner=heroRecord(h);
    return '<section class="outpost-panel"><h2>電台</h2>'+inner+'</section>';}
  function mailboxPage(v){const b=v.base;const e=v.expedition;
    return '<section class="outpost-panel outpost-mailbox" aria-label="回報信箱"><h2>回報信箱</h2>'+ 
      '<p class="outpost-muted">只顯示最新一趟外拓結算及最近一次已結算侵略。已讀標記只存在目前頁面，不會改寫存檔。</p>'+ 
      '<details class="outpost-mail-personnel"><summary>人員 · 即時帳</summary><dl class="outpost-report-grid">'+ 
      '<div><dt>目前人口</dt><dd data-o-mail-pop>'+v.population+'/6</dd></div>'+ 
      '<div><dt>留守</dt><dd data-o-mail-base>'+v.base_population+'</dd></div>'+ 
      '<div><dt>已外出</dt><dd data-o-mail-away>'+(e?e.crew:0)+'</dd></div>'+ 
      '<div><dt>累計永久傷亡</dt><dd data-o-mail-losses>'+b.losses+'</dd></div>'+ 
      '<div><dt>侵略失守次數</dt><dd data-o-mail-raids>'+b.raids_lost+'</dd></div>'+ 
      '<div><dt>待命／巡衛／守陣</dt><dd data-o-mail-units>'+b.standby+' / '+b.patrols+' / '+b.wards+'</dd></div></dl></details></section>'+ 
      (v.last_report?report(v):'<section class="outpost-panel"><h3>最新外拓結算</h3><p>尚無已完成的外拓結算。</p></section>')+ 
      '<section class="outpost-panel outpost-mail-raid"><h3>最近一次侵略</h3>'+lastRaid(v)+'</section>';
  }
  function page(v){return state.tab==='expedition'?expeditionPage(v):
    state.tab==='radio'?radioPage(v):state.tab==='mailbox'?mailboxPage(v):basePage(v);}
  function signature(v){const e=v.expedition,b=v.base;return JSON.stringify([state.tab,b.rations,b.alloy,b.standby,
    b.recycle_workers,b.supply_workers,b.duty_workers,b.patrols,b.wards,b.losses,b.supply_built,b.armory_built,
    b.recycle_upgraded,b.supply_upgraded,b.training,b.recalling,v.population,v.manual_paused,
    e&&e.id,e&&e.crew,e&&e.alloy,e&&e.rations,e&&e.raid.stage,e&&e.return_requested,
    v.shift&&v.shift.raid.stage,v.hero.phase,v.hero.choice,v.last_report&&v.last_report.settlement_id,
    v.last_raid&&v.last_raid.settlement_id,state.error]);}
  // Only a new expedition/return/report or an explicit action can replace a departure form.
  // Passive 30-second production and hero/raid ticks patch numbers without detaching selects.
  function stageSignature(v){const b=v.base,e=v.expedition;
    if(state.tab==='expedition'&&!e)
      return JSON.stringify(['departure',v.last_report&&v.last_report.settlement_id,state.error]);
    if(state.tab==='expedition'&&e)
      return JSON.stringify(['in-flight',e.id,e.raid.stage,e.return_requested,state.error]);
    if(state.tab==='radio')return JSON.stringify(['radio',v.hero.phase,v.hero.choice,state.error]);
    if(state.tab==='mailbox')return JSON.stringify(['mailbox',v.last_report&&v.last_report.settlement_id,
      v.last_raid&&v.last_raid.settlement_id,v.population,v.base_population,v.base.losses,v.base.raids_lost,state.error]);
    // Passive 30s stock production must never collapse details or detach assign/build buttons.
    return JSON.stringify(['base',b.standby,b.recycle_workers,b.supply_workers,b.duty_workers,
      b.patrols,b.wards,b.losses,b.supply_built,b.armory_built,b.recycle_upgraded,b.supply_upgraded,
      b.training,b.recalling,v.population,v.expedition&&v.expedition.id,
      v.last_report&&v.last_report.settlement_id,v.last_raid&&v.last_raid.settlement_id,state.error]);
  }
  const DEPART_FIELDS=['outpost-crew','outpost-rations','outpost-alloy'];
  function captureDepartDraft(){const form=state.app&&state.app.querySelector('.outpost-depart-form');if(!form)return;
    const draft=Object.assign({},state.departDraft||{});
    DEPART_FIELDS.forEach(id=>{const el=state.app.querySelector('#'+id);if(el&&el.value!=null&&String(el.value)!=='')draft[id]=String(el.value);});
    state.departDraft=draft;
  }
  function restoreDepartDraft(){if(!state.departDraft)return;
    DEPART_FIELDS.forEach(id=>{const el=state.app.querySelector('#'+id);if(el&&state.departDraft[id]!=null){
      const value=String(state.departDraft[id]);
      if(Array.from(el.querySelectorAll('option')).some(o=>o.getAttribute('value')===value))el.value=value;
    }});
  }
  function rememberDisclosure(){if(!state.app)return;
    state.app.querySelectorAll('[data-o-building-card]').forEach(el=>{
      const disclosure=el.querySelector('.outpost-building-detail');
      state.openCards[el.getAttribute('data-o-building-card')]=!!(disclosure&&disclosure.hasAttribute('open'));
    });
    const personnel=state.app.querySelector('.outpost-personnel');
    if(personnel)state.openCards.personnel=personnel.hasAttribute('open');
    const mail=state.app.querySelector('.outpost-mail-personnel');
    if(mail)state.openCards.mailPersonnel=mail.hasAttribute('open');
  }
  function restoreDisclosure(){state.app.querySelectorAll('[data-o-building-card]').forEach(el=>{
      const key=el.getAttribute('data-o-building-card');const disclosure=el.querySelector('.outpost-building-detail');
      if(disclosure&&state.openCards[key])disclosure.setAttribute('open','');
    });
    const personnel=state.app.querySelector('.outpost-personnel');if(personnel&&state.openCards.personnel)personnel.setAttribute('open','');
    const mail=state.app.querySelector('.outpost-mail-personnel');if(mail&&state.openCards.mailPersonnel)mail.setAttribute('open','');
  }
  function refreshButton(action,enabled,why){const btn=state.app.querySelector('[data-o-action="'+action+'"]');
    if(!btn||state.pointerDown)return;
    btn.disabled=!enabled;
    if(enabled){btn.removeAttribute('title');btn.removeAttribute('aria-describedby');}
    else{btn.setAttribute('title',why);btn.setAttribute('aria-describedby','outpost-reason-'+action);}
    const reason=state.app.querySelector('[data-o-reason-for="'+action+'"]');
    if(reason&&reason.textContent!==(enabled?'':why))reason.textContent=enabled?'':why;
  }
  function patchClock(v){
    function set(selector,value){const el=state.app.querySelector(selector);if(el&&el.textContent!==String(value))el.textContent=String(value);}
    set('[data-o-clock]','已經過 '+fmt(v.time));
    set('[data-o-runclock]',v.expedition?'本趟餘 '+fmt(900-(v.time-v.expedition.started_at)):'長期基地');
    const threat=state.app.querySelector('[data-o-threat]');
    if(threat&&threat.textContent!==currentNotice(v))threat.textContent=currentNotice(v);
    const b=v.base;
    const numbers={'rations':b.rations,'alloy':b.alloy,'population':v.population+'/6','base-population':v.base_population,
      'live-pop':v.population,'live-losses':b.losses,'live-away':v.expedition?v.expedition.crew:0,
      'personnel-base':v.base_population,'personnel-standby':b.standby,'personnel-patrols':b.patrols,
      'personnel-wards':b.wards,'personnel-raids':b.raids_lost,'mail-pop':v.population+'/6',
      'mail-base':v.base_population,'mail-away':v.expedition?v.expedition.crew:0,
      'mail-losses':b.losses,'mail-raids':b.raids_lost,'mail-units':b.standby+' / '+b.patrols+' / '+b.wards};
    if(v.expedition){const e=v.expedition;
      numbers['out-crew']=e.crew;numbers['out-rations']=e.rations;
      numbers['out-alloy']=e.alloy;numbers['out-scavenged']=e.alloy_scavenged;
      set('[data-o-expedition-progress]','正在外拓 · 航程 '+fmt(v.time-e.started_at)+' / 15:00，15分鐘到期自動結算。');
    }
    Object.keys(numbers).forEach(k=>set('[data-o-'+k+']',numbers[k]));
    if(state.tab==='base'){
      const can={
        'build-supply':[!b.supply_built&&b.alloy>=5,'合金不足，建造需5合金。'],
        'build-armory':[!b.armory_built&&b.alloy>=8,'合金不足，建造需8合金。'],
        'upgrade-recycle':[!b.recycle_upgraded&&b.alloy>=6,'合金不足，升級需6合金。'],
        'upgrade-supply':[b.supply_built&&!b.supply_upgraded&&b.alloy>=4,'合金不足，升級需4合金。'],
        'train-patrol':[b.armory_built&&!b.training&&b.standby>=1&&b.rations>=3&&b.alloy>=2,
          b.training?'已有訓練隊列。':b.standby<1?'待命船員不足。':'訓練巡衛需口糧3與合金2。'],
        'train-ward':[b.armory_built&&!b.training&&b.standby>=1&&b.rations>=4&&b.alloy>=1,
          b.training?'已有訓練隊列。':b.standby<1?'待命船員不足。':'訓練守陣需口糧4與合金1。'],
        'recall-patrol':[!b.recalling&&b.patrols>=1,b.recalling?'已有遣返隊列。':'目前沒有可遣返巡衛。'],
        'recall-ward':[!b.recalling&&b.wards>=1,b.recalling?'已有遣返隊列。':'目前沒有可遣返守陣。']
      };
      Object.keys(can).forEach(action=>refreshButton(action,can[action][0],can[action][1]));
      if(!state.pointerDown){['recycle','supply','duty'].forEach(facility=>{
        const key=facility==='recycle'?'recycle_workers':facility==='supply'?'supply_workers':'duty_workers';
        const count=b[key],reason=assignmentReason(b,facility,v.population);
        state.app.querySelectorAll('[data-o-action="assign"][data-o-facility="'+facility+'"]').forEach(btn=>{
          const dec=btn.getAttribute('data-o-direction')==='dec';btn.setAttribute('data-o-count',String(count+(dec?-1:1)));
          const disabled=dec?count===0:!!reason;btn.disabled=disabled;
          if(disabled){btn.setAttribute('title',dec?'目前沒有可調回人員。':reason);
            btn.setAttribute('aria-describedby','outpost-assign-reason-'+facility);}
          else{btn.removeAttribute('title');btn.removeAttribute('aria-describedby');}
        });
        set('[data-o-workers="'+facility+'"]',count);
        set('[data-o-assign-reason="'+facility+'"]',assignmentVisibleReason(reason,count));
      });}
      set('[data-o-card-status="recycle"]',b.recycle_upgraded?'已深拆':'未深拆');
      set('[data-o-card-status="supply"]',b.supply_built?(b.supply_upgraded?'已密植':'已建造 · 未密植'):'未建造');
      set('[data-o-card-status="armory"]',(b.armory_built?'':'未建造 · ')+'巡衛 '+b.patrols+' · 守陣 '+b.wards);
      set('[data-o-card-status="command"]',b.duty_workers?'正在值守':'目前無人值守');
      if(b.training)set('[data-o-training-remaining]','訓練中 · 尚餘 '+fmt(Math.max(0,b.training.completes_at-v.time)));
      if(b.recalling)set('[data-o-recall-remaining]','遣返中 · 尚餘 '+fmt(Math.max(0,b.recalling.completes_at-v.time)));
    }
    const prep=state.app.querySelector('[data-o-prep-resources]');
    if(prep){const line='基地目前待命 '+b.standby+' · 口糧 '+b.rations+' · 合金 '+b.alloy+'。可先在基地調回工作人員，再決定出發。';
      if(prep.textContent!==line)prep.textContent=line;
      const depart=state.app.querySelector('[data-o-action="depart"]');
      if(depart&&!state.pointerDown){const allowed=b.standby>=2&&v.population>=4&&b.rations>=8;
        const why=v.population<4?'目前人口不足4人：至少要2人外拓及2人留守，不能出發。':
          b.standby<2?'待命人手不足，請先回基地調回人員。':'口糧不足，請先於基地補給。';
        depart.disabled=!allowed;
        if(allowed){depart.removeAttribute('title');depart.removeAttribute('aria-describedby');}
        else{depart.setAttribute('title',why);depart.setAttribute('aria-describedby','outpost-depart-reason');}
        set('[data-o-depart-reason]',allowed?'':why);
      }
    }
    const radio=state.app.querySelector('[data-o-radio-badge]');
    if(radio){const attention=v.hero.phase==='hint'||v.hero.phase==='ready';
      if(attention)radio.removeAttribute('hidden');else radio.setAttribute('hidden','');
      const badge=v.hero.phase==='ready'?'● 待回覆':v.hero.phase==='hint'?'● 呼號':'●';
      if(radio.textContent!==badge)radio.textContent=badge;
    }
    const radioTab=state.app.querySelector('[data-o-tab="radio"].outpost-nav-btn');
    if(radioTab){const label=v.hero.phase==='ready'?'電台有待回覆':v.hero.phase==='hint'?'電台有來源未明的呼號':'電台';
      if(radioTab.getAttribute('aria-label')!==label)radioTab.setAttribute('aria-label',label);
    }
    const mailBadge=state.app.querySelector('[data-o-mail-badge]');const unread=unreadMail(v);
    if(mailBadge){if(unread)mailBadge.removeAttribute('hidden');else mailBadge.setAttribute('hidden','');}
    const mailTab=state.app.querySelector('[data-o-tab="mailbox"].outpost-nav-btn');
    if(mailTab)mailTab.setAttribute('aria-label',unread?'信箱有新回報':'回報信箱');
  }
  function renderGame(force){if(!state.controller||!state.controller.state)return;
    const v=O.view(state.controller.state),sig=signature(v),stageSig=stageSignature(v);
    if(force||!state.app.querySelector('.outpost-shell')){
      captureDepartDraft();rememberDisclosure();
      const scroll=state.app.querySelector('#outpost-stage'),oldTop=scroll?scroll.scrollTop:0;
      const focus=document.activeElement,focusId=focus&&focus.id;
      state.app.innerHTML=shell(v);state.signature=sig;state.stageSignature=stageSig;
      state.alertSignature=noticeSignature(v);
      const stage=state.app.querySelector('#outpost-stage');if(stage)stage.scrollTop=oldTop;
      restoreDepartDraft();restoreDisclosure();
      if(focusId){const next=state.app.querySelector('#'+focusId);if(next&&next.focus)next.focus();}
      patchClock(v);return;
    }
    patchClock(v);
    const nextNotice=noticeSignature(v);
    if(state.alertSignature!==nextNotice&&!state.pointerDown){
      const slot=state.app.querySelector('[data-o-notice-slot]');
      if(slot)slot.innerHTML=alertHtml(v);state.alertSignature=nextNotice;
    }
    const stage=state.app.querySelector('#outpost-stage');
    const focus=document.activeElement;
    const activeInput=!!(stage&&focus&&stage.contains(focus)&&/^(BUTTON|SELECT|INPUT|TEXTAREA|SUMMARY)$/.test(focus.tagName||''));
    if(state.stageSignature!==stageSig&&!state.pointerDown&&!activeInput&&stage){
      captureDepartDraft();rememberDisclosure();const oldTop=stage.scrollTop;
      stage.innerHTML=error()+page(v);stage.scrollTop=oldTop;
      restoreDepartDraft();restoreDisclosure();state.stageSignature=stageSig;
    }
    state.signature=sig;
  }
  function respond(r){if(!r||!r.ok){state.error=r&&r.error?r.error:'操作失敗。';renderGame(true);return false;}
    state.error='';renderGame(true);return true;}
  function openMailboxAfterReturn(beforeReport,wasExpedition){const s=state.controller&&state.controller.state;
    if(!s||!wasExpedition||s.expedition||!s.last_report||s.last_report.settlement_id===beforeReport)return false;
    if(state.tab==='expedition'){state.tab='mailbox';markMailRead(O.view(s));state.autoMailPending=false;return true;}
    return false;
  }
  function handle(action,btn){if(action==='intro-next'){state.intro=Math.min(INTRO.length-1,state.intro+1);renderIntro();return;}
    if(action==='enter'){if(state.intro<INTRO.length-1)return;
      const s=ctrl();const r=s.create((typeof window!=='undefined'&&window.__OUTPOST_TEST_OPTS__&&window.__OUTPOST_TEST_OPTS__.seed)||undefined);
      if(r.ok){state.controller=s;state.screen='game';state.tab='base';state.departDraft=null;state.openCards={};renderGame(true);}else{state.error=r.error;renderIntro();}return;}
    if(action==='continue'){const s=ctrl();const r=s.continue();if(r.ok&&!r.empty){state.controller=s;state.screen='game';state.tab='base';state.departDraft=null;state.openCards={};renderGame(true);}
      else{state.error=r&&r.error?r.error:'未找到可用存檔。';renderEntry();}return;}
    if(state.screen!=='game'||!state.controller)return;
    if(action==='tab'){captureDepartDraft();state.tab=btn.dataset.oTab;state.autoMailPending=false;
      if(state.tab==='mailbox')markMailRead(O.view(state.controller.state));
      state.signature='';renderGame(true);const stage=state.app.querySelector('#outpost-stage');if(stage)stage.scrollTop=0;return;}
    if(action==='pause'){respond(state.controller.setPaused(!state.controller.state.manual_paused));return;}
    const payload={command_id:'ui-'+token()};
    if(action==='assign'){payload.type='assign';payload.facility=btn.dataset.oFacility;payload.count=Number(btn.dataset.oCount);}
    else if(action.startsWith('build-')){payload.type='build';payload.facility=action.slice(6);}
    else if(action.startsWith('upgrade-')){payload.type='upgrade';payload.facility=action.slice(8);}
    else if(action.startsWith('train-')){payload.type='train';payload.unit=action.slice(6);}
    else if(action.startsWith('recall-')){payload.type='recall';payload.unit=action.slice(7);payload.count=1;}
    else if(action==='depart'){payload.type='depart';const read=id=>{const el=state.app.querySelector('#'+id);
      if(!el)return NaN;const selected=el.querySelector('option[selected]');const val=(el.value!=null&&String(el.value)!=='')?el.value:(selected?selected.getAttribute('value'):el.getAttribute('value'));return Number(val);};
      payload.crew=read('outpost-crew');payload.rations=read('outpost-rations');payload.alloy=read('outpost-alloy');}
    else if(action==='return')payload.type='return';
    else if(action==='hero-choice'){payload.type='hero_choice';payload.choice_id=btn.dataset.oChoice;}
    else return;
    const previousReport=state.controller.state.last_report&&state.controller.state.last_report.settlement_id;
    const hadExpedition=!!state.controller.state.expedition;
    const result=state.controller.act(payload);
    if(result&&result.ok){openMailboxAfterReturn(previousReport,hadExpedition);
      if(action==='depart')state.departDraft=null;}
    respond(result);
    if(result&&result.ok&&state.tab==='mailbox'){const stage=state.app.querySelector('#outpost-stage');if(stage)stage.scrollTop=0;}
  }
  function tick(){if(state.screen!=='game'||!state.controller)return {ok:true,skipped:true};
    const tabBefore=state.tab;const hadExpedition=!!state.controller.state.expedition;
    const previousReport=state.controller.state.last_report&&state.controller.state.last_report.settlement_id;
    const r=state.controller.tick();if(!r.ok)state.error=r.error;
    if(r.ok){
      if(hadExpedition&&!state.controller.state.expedition&&state.tab==='expedition'&&state.pointerDown)state.autoMailPending=true;
      else if(!state.pointerDown&&state.autoMailPending&&state.tab==='expedition'&&!state.controller.state.expedition){
        state.tab='mailbox';markMailRead(O.view(state.controller.state));state.autoMailPending=false;
      }else if(!state.pointerDown&&hadExpedition)openMailboxAfterReturn(previousReport,hadExpedition);
      if(state.tab==='mailbox')markMailRead(O.view(state.controller.state));}
    renderGame(tabBefore!==state.tab);
    return r;
  }
  function boot(){state.app=document.getElementById('outpost-app');if(!state.app)return;
    if(!state.bound){state.bound=true;
      state.app.addEventListener('change',function(e){if(e.target&&DEPART_FIELDS.includes(e.target.id))captureDepartDraft();});
      state.app.addEventListener('input',function(e){if(e.target&&DEPART_FIELDS.includes(e.target.id))captureDepartDraft();});
      state.app.addEventListener('click',function(e){const btn=e.target.closest('button');if(!btn||!state.app.contains(btn))return;
        const action=btn.dataset.oAction;if(action)handle(action,btn);});
      document.addEventListener('pointerdown',function(){state.pointerDown=true;},true);
      document.addEventListener('pointerup',function(){state.pointerDown=false;},true);
      document.addEventListener('pointercancel',function(){state.pointerDown=false;},true);
      if(typeof window!=='undefined'){
        window.addEventListener('storage',function(e){if(e.key===O.KEY&&state.controller){
          state.controller.conflict=true;state.error='另一分頁已修改前哨。本頁已停止寫入，請重新載入。';renderGame(true);}});
        window.addEventListener('pagehide',function(){if(state.controller&&state.screen==='game')state.controller.detach();});
        document.addEventListener('visibilitychange',function(){if(!state.controller||state.screen!=='game')return;
          const wasExpedition=!!state.controller.state.expedition;
          const beforeReport=state.controller.state.last_report&&state.controller.state.last_report.settlement_id;
          const r=document.visibilityState==='hidden'?state.controller.detach():state.controller.resumeVisible();
          if(!r.ok)state.error=r.error;else openMailboxAfterReturn(beforeReport,wasExpedition);renderGame(true);});
      }
    }
    renderEntry();}
  const api={boot,tick,state,WallClock,handle};
  if(typeof window!=='undefined'&&!window.__STARFALL_TEST__&&!window.__OUTPOST_TEST__) {
    boot();setInterval(tick,250);
  }
  return api;
});
