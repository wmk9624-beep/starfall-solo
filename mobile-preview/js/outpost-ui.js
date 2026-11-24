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
    pointerDown:false,error:'',signature:'',stageSignature:'',alertSignature:'',departDraft:null,bound:false,seed:0};
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
  function status(v){if(v.expedition){const r=v.expedition.raid;
      return r.stage==='battle'?'敵影交戰中，約'+Math.ceil(Math.max(0,r.resolves_at-v.time))+'秒結算':
      r.stage==='resolved'?'已完成本趟侵略結算':'外拓警戒：前路可能有侵略';}
    const r=v.shift.raid;return r.stage==='battle'?'基地遭襲！戰鬥即將結算':
      r.stage==='resolved'?'本班次已抵住／結算侵略':'留守警戒：巡查仍在繼續';}
  function noticeSignature(v){return JSON.stringify([v.hero.phase==='hint',v.hero.phase==='ready',
    !!v.last_report,state.tab]);}
  function alertHtml(v){
    const ready=v.hero.phase==='ready'&&state.tab!=='radio';
    const report=!!v.last_report&&state.tab!=='expedition';
    const hint=v.hero.phase==='hint';
    const radio=ready?'<button class="outpost-alert-link" type="button" data-o-action="tab" data-o-tab="radio">電台回覆</button>':'';
    const result=report?'<button class="outpost-alert-link" type="button" data-o-action="tab" data-o-tab="expedition">外拓結算</button>':'';
    const message=status(v)+(hint?' · 來源未明的呼號':ready?' · 電台待回覆':'');
    return '<div class="outpost-alert" role="region" aria-label="警戒與通知">'+
      '<span class="outpost-warning-symbol" aria-hidden="true">◆</span>'+
      '<span class="outpost-threat" data-o-threat aria-live="off">'+escapeHtml(message)+'</span>'+radio+result+'</div>';
  }
  function currentNotice(v){return status(v)+(v.hero.phase==='hint'?' · 來源未明的呼號':
    v.hero.phase==='ready'?' · 電台待回覆':'');}
  function shell(v){const b=v.base;return '<div class="outpost-shell">'+
    '<header class="outpost-hud"><div class="outpost-hud-head"><div><span class="outpost-eyebrow">持續基地 · 只存在本機</span><h1>墜星前哨</h1></div>'+
      '<button class="btn small" type="button" data-o-action="pause" aria-label="'+(v.manual_paused?'恢復':'暫停')+'遊戲時間">'+(v.manual_paused?'繼續':'暫停')+'</button></div>'+
    '<div class="outpost-stats" aria-label="基地資源與人口">'+stat('口糧',b.rations,'rations')+stat('合金',b.alloy,'alloy')+
      stat('總人口',v.population+'/6','population')+stat('留守',v.base_population,'base-population')+'</div>'+
    '<div class="outpost-state-line"><span data-o-clock>已經過 '+fmt(v.time)+'</span><span data-o-runclock>'+(v.expedition?'本趟餘 '+fmt(900-(v.time-v.expedition.started_at)):'長期基地')+'</span></div></header>'+
    alertHtml(v)+
    '<div id="outpost-stage" class="outpost-stage" tabindex="-1">'+error()+page(v)+'</div>'+
    '<nav class="outpost-nav" aria-label="長期前哨主要頁面">'+['base','expedition','radio'].map((id,i)=>
      '<button class="outpost-nav-btn'+(state.tab===id?' active':'')+'" data-o-action="tab" data-o-tab="'+id+'" type="button"'+(state.tab===id?' aria-current="page"':'')+' aria-label="'+(id==='radio'?(v.hero.phase==='ready'?'電台有待回覆':v.hero.phase==='hint'?'電台有來源未明的呼號':'電台'):id==='expedition'&&v.last_report?'外拓有結算紀錄':id==='base'?'基地':'外拓')+'"><span>'+
      ['基地','外拓','電台'][i]+'</span>'+(id==='radio'?'<span class="outpost-nav-badge" data-o-radio-badge hidden aria-hidden="true">●</span>':id==='expedition'?'<span class="outpost-nav-badge" data-o-result-badge hidden aria-hidden="true">●</span>':'')+'</button>').join('')+'</nav></div>';}
  function facility(label,desc,owned,action,cost,enabled){return '<div class="outpost-facility"><div><h3>'+label+'</h3><p>'+desc+'</p></div>'+
    (owned?'<span class="outpost-owned">已完成</span>':'<button class="btn small" type="button" data-o-action="'+action+'"'+(enabled?'':' disabled')+'>合金 '+cost+' · '+(action.startsWith('build')?'建造':'升級')+'</button>')+'</div>';}
  function assignRow(label,facility,count,enabled){return '<div class="outpost-assign-row"><span>'+label+'：<strong>'+count+'</strong> 人</span><div class="outpost-action-pair">'+
    '<button class="btn small" data-o-action="assign" data-o-facility="'+facility+'" data-o-count="'+(count-1)+'" type="button"'+(count===0?' disabled':'')+' aria-label="'+label+'調回一人">−</button>'+
    '<button class="btn small" data-o-action="assign" data-o-facility="'+facility+'" data-o-count="'+(count+1)+'" type="button"'+(enabled?'':' disabled')+' aria-label="'+label+'增派一人">＋</button></div></div>';}
  function heroRecord(h){if(!h||h.phase!=='resolved'||!h.choice)return '';
    const label=h.choice==='HERO-SIGNAL-TRACE'?'TRACE｜記錄並追蹤訊號（免費）':
      h.choice==='HERO-SIGNAL-SHELTER'?'SHELTER｜優先守護訊號來源（免費）':'未記錄';
    return '<aside class="outpost-hero-record" aria-label="電台已回覆紀錄"><h3>電台已回覆</h3>'+
      '<p>選擇：'+escapeHtml(label)+'</p><p>'+escapeHtml(h.text||'未記錄')+'</p>'+
      '<p class="outpost-muted">這是通訊紀錄，沒有新增船員、永久資源加成或已驗證解鎖的能力。</p></aside>';
  }
  function basePage(v){const b=v.base;const pop=v.population;return '<section class="outpost-panel"><h2>長期基地</h2>'+
    '<p class="outpost-first-step">可先在回收廠派工；合金足夠時也可建補給棚。<button class="outpost-jump" type="button" data-o-action="jump-labor" aria-controls="outpost-labor">跳至派工與防守</button></p>'+
    '<p class="outpost-muted">設施、物資與人口缺口跨外拓保存；切分頁或離開不等於暫停，未暫停返回可能補算。</p>'+
    '<div class="outpost-crew" aria-label="基地即時人口與編制"><p>目前人口 <strong data-o-live-pop>'+pop+'</strong>/6 · 累計永久傷亡 <strong data-o-live-losses>'+b.losses+'</strong> · 已外出 <strong data-o-live-away>'+(v.expedition?v.expedition.crew:0)+'</strong></p><p>待命 '+b.standby+' · 巡衛 '+b.patrols+' · 守陣 '+b.wards+' · 侵略失守 '+b.raids_lost+'</p></div>'+heroRecord(v.hero)+
    '<h3>建築與升級</h3>'+facility('補給棚','產出口糧；工人每30秒每人＋2',b.supply_built,'build-supply',5,b.alloy>=5)+
    facility('整備艙','訓練巡衛或守陣',b.armory_built,'build-armory',8,b.alloy>=8)+
    facility('回收廠 · 深拆裝置','有值守船員時提升合金產出',b.recycle_upgraded,'upgrade-recycle',6,b.alloy>=6)+
    facility('補給棚 · 密植槽','已建補給棚且有人值守時增加口糧',b.supply_upgraded,'upgrade-supply',4,b.supply_built&&b.alloy>=4)+
    '<h3 id="outpost-labor" class="outpost-labor-anchor" tabindex="-1">派工與防守</h3>'+assignRow('回收廠','recycle',b.recycle_workers,b.standby>0&&b.recycle_workers<2&&b.recycle_workers+b.supply_workers<Math.min(5,pop-1))+
    assignRow('補給棚','supply',b.supply_workers,b.supply_built&&b.standby>0&&b.supply_workers<2&&b.recycle_workers+b.supply_workers<Math.min(5,pop-1))+
    assignRow('指揮艙值守','duty',b.duty_workers,b.standby>0&&b.duty_workers<1)+
    '<p class="outpost-muted">每30秒按既有產出規則結算；深拆／密植加成需有人值守。外拓期間留守派工仍會產出。</p>'+ 
    (b.armory_built?'<h3>兵力與遣返</h3><div class="outpost-button-row">'+
      '<button class="btn small" data-o-action="train-patrol" type="button"'+(b.training||b.standby<1||b.rations<3||b.alloy<2?' disabled':'')+'>訓練巡衛 · 口糧3 合金2</button>'+ 
      '<button class="btn small" data-o-action="train-ward" type="button"'+(b.training||b.standby<1||b.rations<4||b.alloy<1?' disabled':'')+'>訓練守陣 · 口糧4 合金1</button>'+ 
      '<button class="btn small" data-o-action="recall-patrol" type="button"'+(b.recalling||!b.patrols?' disabled':'')+'>巡衛遣返1人</button>'+ 
      '<button class="btn small" data-o-action="recall-ward" type="button"'+(b.recalling||!b.wards?' disabled':'')+'>守陣遣返1人</button></div>':'' )+
    (b.training?'<p class="outpost-muted">訓練中，完成時間 '+fmt(Math.max(0,b.training.completes_at-v.time))+'</p>':'')+
    (b.recalling?'<p class="outpost-muted">遣返中，尚餘 '+fmt(Math.max(0,b.recalling.completes_at-v.time))+'</p>':'')+
    '<details class="outpost-detail"><summary>最近一次侵略與記錄</summary>'+lastRaid(v)+logs(v)+'</details></section>'+report(v);}
  function recordedNumber(obj,key){return obj&&Object.prototype.hasOwnProperty.call(obj,key)&&
    typeof obj[key]==='number'&&Number.isFinite(obj[key])?String(obj[key]):'未記錄';}
  function raidOutcome(raid){return !raid||!Object.prototype.hasOwnProperty.call(raid,'outcome')?'未記錄':
    raid.outcome==='attack_win'?'防守失敗':raid.outcome==='draw'?'打和':
    raid.outcome==='defense_win'?'防守成功':'未記錄';}
  function lastRaid(v){const r=v.last_raid;if(!r)return '<p>最近一次侵略：尚無已結算紀錄。</p>';
    const where=r.context==='expedition'?'外拓':r.context==='base'?'留守':'未記錄';
    return '<p>最近一次侵略（'+where+'）：'+raidOutcome(r)+' · 人口傷亡 '+recordedNumber(r,'loss_crew')+
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
      '<p class="outpost-muted">以上只屬本趟結算；目前人口與累計傷亡請看基地即時帳。</p></section>';}
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
        '<button class="btn" type="button" data-o-action="depart"'+(can?'':' disabled')+'>確認編制並出發</button>'+ 
        '<p class="outpost-muted">外拓會遇到一次真實侵略。失敗會永久減少人口與物資，不會刪除長期基地。</p>';
    }
    return content+'</section>'+report(v);}
  function radioPage(v){const h=v.hero;let inner='';
    if(h.phase==='hidden')inner='<p>電台正在掃描，只聽到風聲與機械雜訊。目前沒有可辨認的來訊。</p>';
    if(h.phase==='hint')inner='<p>'+escapeHtml(h.hint)+'</p><p class="outpost-muted">訊號仍然模糊，暫時無法回覆。</p>';
    if(h.phase==='ready')inner='<h3>'+escapeHtml(h.title)+'</h3><p>'+escapeHtml(h.introduction)+'</p>'+h.options.map(o=>
      '<button class="btn secondary" type="button" data-o-action="hero-choice" data-o-choice="'+o.id+'">'+escapeHtml(o.label)+'</button>').join('');
    if(h.phase==='resolved')inner=heroRecord(h);
    return '<section class="outpost-panel"><h2>電台</h2>'+inner+'</section>';}
  function page(v){return state.tab==='expedition'?expeditionPage(v):state.tab==='radio'?radioPage(v):basePage(v);}
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
      // Do not inject new option values if the original choices are no longer present.
      const hasChoice=Array.from(el.querySelectorAll('option')).some(o=>o.getAttribute('value')===value);
      if(hasChoice)el.value=value;
    }});
  }
  function patchClock(v){const a=state.app.querySelector('[data-o-clock]');if(a)a.textContent='已經過 '+fmt(v.time);
    const b=state.app.querySelector('[data-o-runclock]');if(b)b.textContent=v.expedition?'本趟餘 '+fmt(900-(v.time-v.expedition.started_at)):'長期基地';
    const w=state.app.querySelector('[data-o-threat]');const message=currentNotice(v);
    if(w&&w.textContent!==message)w.textContent=message;
    const statValues={'rations':v.base.rations,'alloy':v.base.alloy,'population':v.population+'/6','base-population':v.base_population,
      'live-pop':v.population,'live-losses':v.base.losses,'live-away':v.expedition?v.expedition.crew:0};
    if(v.expedition){const e=v.expedition;
      statValues['out-crew']=e.crew;statValues['out-rations']=e.rations;
      statValues['out-alloy']=e.alloy;statValues['out-scavenged']=e.alloy_scavenged;
      const progress=state.app.querySelector('[data-o-expedition-progress]');
      if(progress)progress.textContent='正在外拓 · 航程 '+fmt(v.time-e.started_at)+' / 15:00，15分鐘到期自動結算。';
    }
    Object.keys(statValues).forEach(k=>{const e=state.app.querySelector('[data-o-'+k+']');if(e&&e.textContent!==String(statValues[k]))e.textContent=String(statValues[k]);});
    if(state.tab==='base'){
      const b=v.base;
      const can={
        'build-supply':!b.supply_built&&b.alloy>=5,
        'build-armory':!b.armory_built&&b.alloy>=8,
        'upgrade-recycle':!b.recycle_upgraded&&b.alloy>=6,
        'upgrade-supply':b.supply_built&&!b.supply_upgraded&&b.alloy>=4,
        'train-patrol':b.armory_built&&!b.training&&b.standby>=1&&b.rations>=3&&b.alloy>=2,
        'train-ward':b.armory_built&&!b.training&&b.standby>=1&&b.rations>=4&&b.alloy>=1
      };
      Object.keys(can).forEach(action=>{const btn=state.app.querySelector('[data-o-action="'+action+'"]');if(btn)btn.disabled=!can[action];});
    }
    const prep=state.app.querySelector('[data-o-prep-resources]');if(prep){const text='基地目前待命 '+v.base.standby+' · 口糧 '+v.base.rations+' · 合金 '+v.base.alloy+'。可先在基地調回工作人員，再決定出發。';
      if(prep.textContent!==text)prep.textContent=text;
      const depart=state.app.querySelector('[data-o-action="depart"]');if(depart)depart.disabled=!(v.base.standby>=2&&v.population>=4&&v.base.rations>=8);
    }
    const radio=state.app.querySelector('[data-o-radio-badge]');if(radio){
      const attention=v.hero.phase==='hint'||v.hero.phase==='ready';
      if(attention)radio.removeAttribute('hidden');else radio.setAttribute('hidden','');
      const badgeText=v.hero.phase==='ready'?'● 待回覆':v.hero.phase==='hint'?'● 呼號':'●';
      if(radio.textContent!==badgeText)radio.textContent=badgeText;
    }
    const radioTab=state.app.querySelector('[data-o-tab="radio"].outpost-nav-btn');if(radioTab){
      const label=v.hero.phase==='ready'?'電台有待回覆':v.hero.phase==='hint'?'電台有來源未明的呼號':'電台';
      if(radioTab.getAttribute('aria-label')!==label)radioTab.setAttribute('aria-label',label);
    }
    const result=state.app.querySelector('[data-o-result-badge]');if(result){
      if(v.last_report)result.removeAttribute('hidden');else result.setAttribute('hidden','');
      if(result.textContent!==(v.last_report?'● 結算':'●'))result.textContent=v.last_report?'● 結算':'●';
    }
    const expeditionTab=state.app.querySelector('[data-o-tab="expedition"].outpost-nav-btn');if(expeditionTab){
      const label=v.last_report?'外拓有結算紀錄':'外拓';
      if(expeditionTab.getAttribute('aria-label')!==label)expeditionTab.setAttribute('aria-label',label);
    }
  }
  function renderGame(force){if(!state.controller||!state.controller.state)return;
    const v=O.view(state.controller.state),sig=signature(v),stageSig=stageSignature(v);
    // Explicit button actions may replace controls; preserve an unsent form draft across tabs.
    if(force||!state.app.querySelector('.outpost-shell')){
      captureDepartDraft();
      const scroll=state.app.querySelector('#outpost-stage'),oldTop=scroll?scroll.scrollTop:0;
      const focus=document.activeElement,focusId=focus&&focus.id;
      state.app.innerHTML=shell(v);state.signature=sig;state.stageSignature=stageSig;
      state.alertSignature=noticeSignature(v);
      const stage=state.app.querySelector('#outpost-stage');if(stage)stage.scrollTop=oldTop;
      restoreDepartDraft();
      if(focusId){const newFocus=state.app.querySelector('#'+focusId);if(newFocus&&newFocus.focus)newFocus.focus();}
      patchClock(v);return;
    }
    // During ticks never rebuild the HUD/nav or the shell; keep focus and touch targets stable.
    patchClock(v);
    const nextNotice=noticeSignature(v);
    if(state.alertSignature!==nextNotice&&!state.pointerDown){
      const old=state.app.querySelector('.outpost-alert');if(old){
        // Set the whole content only on a structural event (not every 250ms).
        const content=alertHtml(v);old.innerHTML=content.slice(content.indexOf('>')+1,content.lastIndexOf('</div>'));
      }
      state.alertSignature=nextNotice;
    }
    const stage=state.app.querySelector('#outpost-stage');
    const focus=document.activeElement;
    const activeInput=!!(stage&&focus&&stage.contains(focus)&&
      /^(BUTTON|SELECT|INPUT|TEXTAREA)$/.test(focus.tagName||''));
    if(state.stageSignature!==stageSig&&!state.pointerDown&&!activeInput&&stage){
      captureDepartDraft();
      const oldTop=stage.scrollTop;
      stage.innerHTML=error()+page(v);stage.scrollTop=oldTop;
      restoreDepartDraft();state.stageSignature=stageSig;
    }
    state.signature=sig;
  }
  function respond(r){if(!r||!r.ok){state.error=r&&r.error?r.error:'操作失敗。';renderGame(true);return false;}
    state.error='';renderGame(true);return true;}
  function handle(action,btn){if(action==='intro-next'){state.intro=Math.min(INTRO.length-1,state.intro+1);renderIntro();return;}
    if(action==='enter'){if(state.intro<INTRO.length-1)return;
      const s=ctrl();const r=s.create((typeof window!=='undefined'&&window.__OUTPOST_TEST_OPTS__&&window.__OUTPOST_TEST_OPTS__.seed)||undefined);
      if(r.ok){state.controller=s;state.screen='game';state.tab='base';state.departDraft=null;renderGame(true);}else{state.error=r.error;renderIntro();}return;}
    if(action==='continue'){const s=ctrl();const r=s.continue();if(r.ok&&!r.empty){state.controller=s;state.screen='game';state.tab='base';state.departDraft=null;renderGame(true);}
      else{state.error=r&&r.error?r.error:'未找到可用存檔。';renderEntry();}return;}
    if(state.screen!=='game'||!state.controller)return;
    if(action==='tab'){captureDepartDraft();state.tab=btn.dataset.oTab;state.signature='';renderGame(true);const stage=state.app.querySelector('#outpost-stage');if(stage)stage.scrollTop=0;return;}
    if(action==='jump-labor'){const anchor=state.app.querySelector('#outpost-labor');
      if(anchor){if(typeof anchor.scrollIntoView==='function')anchor.scrollIntoView({block:'start',behavior:'auto'});
        if(typeof anchor.focus==='function')anchor.focus();}return;}
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
    const success=respond(state.controller.act(payload));if(success&&action==='depart')state.departDraft=null;}
  function tick(){if(state.screen!=='game'||!state.controller)return {ok:true,skipped:true};
    const r=state.controller.tick();if(!r.ok)state.error=r.error;
    renderGame(false);return r;}
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
          const r=document.visibilityState==='hidden'?state.controller.detach():state.controller.resumeVisible();
          if(!r.ok)state.error=r.error;renderGame(true);});
      }
    }
    renderEntry();}
  const api={boot,tick,state,WallClock,handle};
  if(typeof window!=='undefined'&&!window.__STARFALL_TEST__&&!window.__OUTPOST_TEST__) {
    boot();setInterval(tick,250);
  }
  return api;
});
