/* 墜星前哨：長期前哨預覽。與舊單局／Campaign 完全獨立的單鍵權威狀態。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StarfallOutpost = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KEY = 'starfall-solo.outpost.v1';
  const C = Object.freeze({START_RATIONS:20,START_ALLOY:8,ROSTER_SIZE:6,CYCLE_SECONDS:30,
    SUPPLY_ALLOY_COST:5,ARMORY_ALLOY_COST:8,RECYCLE_UPGRADE_ALLOY_COST:6,SUPPLY_UPGRADE_ALLOY_COST:4,
    TRAIN_SECONDS:30,RECALL_SECONDS:30,TRAIN_RATIONS_COST:3,TRAIN_ALLOY_COST:2,
    WARD_TRAIN_RATIONS_COST:4,WARD_TRAIN_ALLOY_COST:1,TIME_LIMIT:900,BATTLE_SECONDS:30,
    EXPEDITION_MIN_CREW:2,EXPEDITION_MAX_CREW:4,EXPEDITION_MIN_RATIONS:4,EXPEDITION_MAX_RATIONS:10,
    EXPEDITION_MAX_ALLOY:3,RAID_MIN:180,RAID_MAX:540,RAID_ATTACK:3,HERO_HINT_AT:120,HERO_READY_AT:240,
    LEASE_MS:15000,MAX_OFFLINE_SECONDS:900});
  function copy(x){return JSON.parse(JSON.stringify(x));}
  function fail(message, code) {const e=new Error(message);e.code=code||'invalid';throw e;}
  function int(n,min,max){return Number.isSafeInteger(n)&&n>=min&&(max==null||n<=max);}
  function finite(n){return typeof n==='number'&&Number.isFinite(n)&&n>=0;}
  function freshBase(){return {rations:C.START_RATIONS,alloy:C.START_ALLOY,standby:6,recycle_workers:0,
    supply_workers:0,duty_workers:0,patrols:0,wards:0,training:null,recalling:null,
    supply_built:false,armory_built:false,recycle_upgraded:false,supply_upgraded:false,
    losses:0,raids_lost:0};}
  function baseCrew(b){return b.standby+b.recycle_workers+b.supply_workers+b.duty_workers+b.patrols+b.wards+
    (b.training?1:0)+(b.recalling?b.recalling.count:0);}
  function population(s){return baseCrew(s.base)+(s.expedition?s.expedition.crew:0);}
  function nextRandom(s){let x=s.rng|0; x^=x<<13;x^=x>>>17;x^=x<<5;
    s.rng=x>>>0;return (s.rng>>>0)/4294967296;}
  function raidFor(s,id,start){const offset=C.RAID_MIN+Math.floor(nextRandom(s)*(C.RAID_MAX-C.RAID_MIN+1));
    return {id:id,trigger_at:start+offset,offset:offset,stage:'scheduled',started_at:null,
      resolves_at:null,settlement_id:id+':settlement',outcome:null,loss_crew:0,loss_alloy:0,loss_rations:0};}
  function shiftFor(s,start){const id='shift-'+(++s.next_id);return {id:id,start_at:start,raid:raidFor(s,id+':raid',start)};}
  function start(seed){
    if(seed==null){const cryptoObj=typeof globalThis!=='undefined'?globalThis.crypto:null;
      if(cryptoObj&&typeof cryptoObj.getRandomValues==='function'){const bytes=new Uint32Array(1);cryptoObj.getRandomValues(bytes);seed=bytes[0];}
      else seed=((Date.now()>>>0) ^ Math.floor(Math.random()*4294967296))>>>0;
    }
    seed=(Number(seed)>>>0)||0x5e3a2107;
    let s={kind:'starfall-outpost',schema:1,revision:0,transaction_id:'uncommitted',
      time:0,manual_paused:false,wall_anchor_ms:0,owner:null,rng:seed,next_id:0,
      base:freshBase(),expedition:null,shift:null,hero:{choice:null},
      settlement_ids:[],processed_commands:{},last_raid:null,last_report:null,events:[]};
    s.shift=shiftFor(s,0);validate(s);return s;}
  function event(s,message){s.events.push({at:s.time,text:message});if(s.events.length>50)s.events.shift();}
  function defend(s,context){const b=s.base;
    return context==='expedition'?s.expedition.crew:(b.standby+b.duty_workers+b.patrols+b.wards*2);
  }
  function killFromBase(b){const keys=['standby','duty_workers','recycle_workers','supply_workers','patrols','wards'];
    for(const k of keys){if(b[k]>0){b[k]--;return true;}}
    if(b.training){b.training=null;return true;}
    if(b.recalling&&b.recalling.count){b.recalling.count--;
      if(!b.recalling.count)b.recalling=null;return true;}
    return false;
  }
  function settleRaid(s,raid,context){if(s.settlement_ids.includes(raid.settlement_id))return false;
    const defense=defend(s,context);const loss=defense<C.RAID_ATTACK;
    const account=context==='expedition'?s.expedition:s.base;
    if(!account)fail('侵略帳本已失效。');
    const canDie=loss&&population(s)>1&&(context==='expedition'?account.crew>0:baseCrew(s.base)>1);
    const crewLoss=canDie?1:0;
    if(crewLoss){if(context==='expedition')account.crew--;else if(!killFromBase(s.base))fail('守備人口帳不一致。');s.base.losses++;}
    const lostAlloy=loss?Math.min(3,account.alloy):0;
    const lostRations=loss?Math.min(4,account.rations):0;
    account.alloy-=lostAlloy;account.rations-=lostRations;
    if(context==='expedition')account.raid_losses={crew:crewLoss,alloy:lostAlloy,rations:lostRations};
    if(loss)s.base.raids_lost++;
    while(s.base.recycle_workers+s.base.supply_workers>Math.max(0,population(s)-1)) {
      if(s.base.supply_workers>0)s.base.supply_workers--;else s.base.recycle_workers--;s.base.standby++;
    }
    raid.stage='resolved';raid.outcome=defense<C.RAID_ATTACK?'attack_win':(defense===C.RAID_ATTACK?'draw':'defense_win');
    raid.loss_crew=crewLoss;raid.loss_alloy=lostAlloy;raid.loss_rations=lostRations;
    s.settlement_ids.push(raid.settlement_id);
    s.last_raid={context:context,id:raid.id,settlement_id:raid.settlement_id,outcome:raid.outcome,
      defense:defense,loss_crew:crewLoss,loss_alloy:lostAlloy,loss_rations:lostRations,at:s.time};
    event(s,(context==='expedition'?'外拓隊':'基地')+'遭到侵略：'+(loss?'防守失利，傷亡與物資損失已入帳。':'成功抵住攻勢，沒有永久傷亡。'));
    return true;
  }
  function settleReturn(s,reason){const e=s.expedition;if(!e)return false;
    const sid=e.id+':return';if(s.settlement_ids.includes(sid))return false;
    if(e.raid.stage!=='resolved')fail('外拓侵略尚未結算，不可重複或提前結帳。','pending_raid');
    const b=s.base;b.standby+=e.crew;b.rations+=e.rations;b.alloy+=e.alloy;
    s.last_report={settlement_id:sid,id:e.id,reason:reason,elapsed:s.time-e.started_at,
      returning_crew:e.crew,rations:e.rations,alloy:e.alloy,alloy_scavenged:e.alloy_scavenged,
      rations_consumed:e.rations_consumed,raid:copy(e.raid),population:population(s)-e.crew};
    s.settlement_ids.push(sid);s.expedition=null;s.shift=shiftFor(s,s.time);
    event(s,'外拓已結算：剩餘船員與物資回到長期基地，損失不補回。');return true;
  }
  function doCycle(s){const b=s.base;
    let alloy=b.recycle_workers,rations=b.supply_built?b.supply_workers*2:0;
    if(b.duty_workers>=1){if(b.recycle_upgraded&&b.recycle_workers>=1)alloy++;
      if(b.supply_upgraded&&b.supply_workers>=1)rations++;}
    b.alloy+=alloy;b.rations+=rations;
  }
  function doAt(s,t){s.time=t;
    if(t>0&&t%30===0)doCycle(s);
    const expedition=s.expedition;
    if(expedition){const elapsed=t-expedition.started_at;
      if(elapsed>0&&Math.abs(elapsed/30-Math.round(elapsed/30))<1e-8&&expedition.crew>=2){expedition.alloy++;expedition.alloy_scavenged++;}
      if(elapsed>0&&Math.abs(elapsed/90-Math.round(elapsed/90))<1e-8&&expedition.rations>0){expedition.rations--;expedition.rations_consumed++;}
    }
    const b=s.base;
    if(b.training&&b.training.completes_at<=t){b[b.training.unit==='ward'?'wards':'patrols']++;b.training=null;}
    if(b.recalling&&b.recalling.completes_at<=t){b.standby+=b.recalling.count;b.recalling=null;}
    const raid=s.expedition?s.expedition.raid:s.shift.raid;
    if(raid.stage==='scheduled'&&raid.trigger_at<=t){raid.stage='battle';raid.started_at=raid.trigger_at;raid.resolves_at=raid.trigger_at+C.BATTLE_SECONDS;
      event(s,'警報：不明敵影靠近，30秒後結算侵略！');}
    if(raid.stage==='battle'&&raid.resolves_at<=t)settleRaid(s,raid,s.expedition?'expedition':'base');
    if(s.expedition&&s.expedition.return_requested&&s.expedition.raid.stage==='resolved')
      settleReturn(s,'玩家要求提前返航，遭遇結算後安全返回');
    if(s.expedition&&t>=s.expedition.started_at+C.TIME_LIMIT){settleReturn(s,'900秒外拓到期');}
    if(!s.expedition&&s.shift&&t>=s.shift.start_at+C.TIME_LIMIT){s.shift=shiftFor(s,t);}
  }
  function advance(input,target){if(!finite(target)||target<input.time)fail('不能倒退遊戲時鐘。');
    const s=copy(input);
    let iterations=0;
    while(s.time+1e-8<target){if(++iterations>200000)fail('一次補算時間過長。');
      const t=s.time,raid=s.expedition?s.expedition.raid:s.shift.raid;
      let next=Math.min(target,(Math.floor(t/30)+1)*30);
      if(raid.stage==='scheduled'&&raid.trigger_at>t)next=Math.min(next,raid.trigger_at);
      if(raid.stage==='battle'&&raid.resolves_at>t)next=Math.min(next,raid.resolves_at);
      if(s.expedition){const elapsed=t-s.expedition.started_at;
        next=Math.min(next,s.expedition.started_at+(Math.floor(elapsed/30)+1)*30);
        next=Math.min(next,s.expedition.started_at+(Math.floor(elapsed/90)+1)*90);
        next=Math.min(next,s.expedition.started_at+C.TIME_LIMIT);
      }
      else next=Math.min(next,s.shift.start_at+C.TIME_LIMIT);
      if(s.base.training&&s.base.training.completes_at>t)next=Math.min(next,s.base.training.completes_at);
      if(s.base.recalling&&s.base.recalling.completes_at>t)next=Math.min(next,s.base.recalling.completes_at);
      if(next<=t+1e-8)fail('事件時間倒退或停滯。');doAt(s,next);
    }
    validate(s);return s;
  }
  function act(input,payload){if(!payload||typeof payload.command_id!=='string'||!payload.command_id.trim()||payload.command_id.length>128)fail('指令缺少合法唯一ID。');
    const commandKey='command:'+payload.command_id;
    if(Object.prototype.hasOwnProperty.call(input.processed_commands,commandKey))
      return {state:copy(input),result:copy(input.processed_commands[commandKey]),duplicate:true};
    const s=copy(input),b=s.base;let result={ok:true};
    switch(payload.type){
      case 'build': {const f=payload.facility;if(f!=='supply'&&f!=='armory')fail('未知建築。');
        const key=f+'_built',cost=f==='supply'?C.SUPPLY_ALLOY_COST:C.ARMORY_ALLOY_COST;
        if(b[key])fail('建築已建成。');if(b.alloy<cost)fail('合金不足。');b.alloy-=cost;b[key]=true;
        result={built:f,cost_alloy:cost};break;}
      case 'upgrade':{const f=payload.facility;if(f!=='recycle'&&f!=='supply')fail('未知升級。');
        if(f==='supply'&&!b.supply_built)fail('請先建造補給棚。');const key=f+'_upgraded';
        const cost=f==='recycle'?C.RECYCLE_UPGRADE_ALLOY_COST:C.SUPPLY_UPGRADE_ALLOY_COST;
        if(b[key])fail('已升級。');if(b.alloy<cost)fail('合金不足。');b.alloy-=cost;b[key]=true;
        result={upgraded:f,cost_alloy:cost};break;}
      case 'assign':{const f=payload.facility,k=f==='recycle'?'recycle_workers':f==='supply'?'supply_workers':f==='duty'?'duty_workers':null;
        if(!k||!int(payload.count,0,f==='duty'?1:2))fail('派工超出上限。');
        if(f==='supply'&&!b.supply_built)fail('補給棚尚未建造。');const delta=payload.count-b[k];
        if(delta>0&&b.standby<delta)fail('待命人手不足。');
        const rec=f==='recycle'?payload.count:b.recycle_workers;
        const sup=f==='supply'?payload.count:b.supply_workers;
        if(rec+sup>Math.min(5,population(s)-1))fail('至少留一人不生產。');
        b.standby-=delta;b[k]=payload.count;result={assigned:f,count:payload.count};break;}
      case 'train':{if(!b.armory_built)fail('整備艙未建造。');if(b.training)fail('已有訓練隊列。');
        const unit=payload.unit==='ward'?'ward':payload.unit==='patrol'?'patrol':null;if(!unit)fail('兵種無效。');
        const rc=unit==='ward'?C.WARD_TRAIN_RATIONS_COST:C.TRAIN_RATIONS_COST;
        const ac=unit==='ward'?C.WARD_TRAIN_ALLOY_COST:C.TRAIN_ALLOY_COST;
        if(!b.standby||b.rations<rc||b.alloy<ac)fail('訓練資源或待命人手不足。');
        b.standby--;b.rations-=rc;b.alloy-=ac;b.training={unit:unit,completes_at:s.time+C.TRAIN_SECONDS};
        result={training:unit,completes_at:b.training.completes_at};break;}
      case 'recall':{const unit=payload.unit==='ward'?'ward':payload.unit==='patrol'?'patrol':null;
        if(!unit||!int(payload.count,1)||b.recalling||b[unit+'s']<payload.count)fail('可遣返兵力不足。');
        b[unit+'s']-=payload.count;b.recalling={unit:unit,count:payload.count,completes_at:s.time+C.RECALL_SECONDS};
        result={recalling:unit,count:payload.count};break;}
      case 'depart':{if(s.expedition)fail('外拓尚未返回。');
        if(s.shift&&s.shift.raid.stage==='battle')fail('基地侵略仍在交戰，請先完成結算。');
        if(b.training||b.recalling)fail('請先完成訓練或遣返隊列。');
        const crew=payload.crew,rations=payload.rations,alloy=payload.alloy;
        if(!int(crew,2,4)||crew>population(s)-2||crew>b.standby)fail('出發人手必須2至4且基地至少留2人，須由待命人員出發。');
        if(!int(rations,4,10)||rations>b.rations-4)fail('口糧需帶4至10且基地至少留4。');
        if(!int(alloy,0,3)||alloy>b.alloy|| (b.alloy>=2&&b.alloy-alloy<2) ||(b.alloy<2&&alloy!==0))
          fail('合金最多帶3，基地須留至少2（原存量不足2則不可帶走）。');
        b.standby-=crew;b.rations-=rations;b.alloy-=alloy;
        const id='exp-'+(++s.next_id);s.expedition={id:id,started_at:s.time,crew:crew,rations:rations,alloy:alloy,
          alloy_scavenged:0,rations_consumed:0,return_requested:false,raid_losses:null,raid:raidFor(s,id+':raid',s.time)};
        s.shift=null;result={expedition_id:id,raid_at:s.expedition.raid.trigger_at};break;}
      case 'return':{if(!s.expedition)fail('現在沒有外拓隊。');
        if(s.expedition.return_requested)fail('返航命令已送出，請等待完成。');
        s.expedition.return_requested=true;
        if(s.expedition.raid.stage==='resolved'){settleReturn(s,'玩家提前返回');result={settlement_id:s.last_report.settlement_id};}
        else result={return_requested:true,message:'已要求返航；預定風險航段的侵略結算後自動返回。'};
        break;}
      case 'hero_choice':{if(s.time<C.HERO_READY_AT)fail('訊號尚未解鎖。');if(s.hero.choice)fail('此事件已回覆。');
        if(payload.choice_id!=='HERO-SIGNAL-TRACE'&&payload.choice_id!=='HERO-SIGNAL-SHELTER')fail('無效回覆。');
        s.hero.choice=payload.choice_id;event(s,'已回覆殘響訊號，結果記入紀錄；沒有新增船員或資源。');
        result={choice_id:s.hero.choice};break;}
      default:fail('未知指令：'+String(payload.type));
    }
    s.processed_commands[commandKey]=copy(result);
    validate(s);return {state:s,result:result,duplicate:false};
  }
  function heroView(s){if(s.hero.choice)return {phase:'resolved',choice:s.hero.choice,
    text:s.hero.choice==='HERO-SIGNAL-TRACE'?'璃棱將未知波形封存為待核對星圖，提醒你先記下可靠證據。':'秋纓建議保護訊號來源，先讓失聯者找到安全落腳處。'};
    if(s.time<C.HERO_HINT_AT)return {phase:'hidden'};
    if(s.time<C.HERO_READY_AT)return {phase:'hint',hint:'收到一段不完整的呼號，來源未明。'};
    return {phase:'ready',id:'EVENT-OUTPOST-SIGNAL-1',title:'殘響的求救訊號',
      introduction:'舊式通訊器終於辨認出求救訊號。璃棱指出可追蹤波形，秋纓提醒先保護訊號來源。這不是可招募人口。',
      options:[{id:'HERO-SIGNAL-TRACE',label:'記錄並追蹤訊號（免費）'},
        {id:'HERO-SIGNAL-SHELTER',label:'優先守護訊號來源（免費）'}]};
  }
  function view(s){const r=copy(s);delete r.processed_commands;delete r.rng;delete r.owner;
    r.population=population(s);r.base_population=baseCrew(s.base);r.hero=heroView(s);
    r.hero_ready=r.hero.phase==='ready';return r;}
  function checkRaid(r,label,time,start){if(!r||typeof r!=='object'||typeof r.id!=='string'||typeof r.settlement_id!=='string')fail(label+'缺失。');
    if(!int(r.offset,180,540)||r.trigger_at!==start+r.offset)fail(label+'侵略時間非法。');
    if(!['scheduled','battle','resolved'].includes(r.stage))fail(label+'階段非法。');
    if(r.stage==='scheduled'&&(r.started_at!==null||r.resolves_at!==null))fail(label+'未開始但已有時間。');
    if(r.stage!=='scheduled'&&(r.started_at!==r.trigger_at||r.resolves_at!==r.trigger_at+30))fail(label+'時間矛盾。');
    if(r.stage==='resolved'&&(!['attack_win','draw','defense_win'].includes(r.outcome)))fail(label+'結果無效。');
    if(r.stage!=='resolved'&&(r.outcome!==null||r.loss_crew||r.loss_alloy||r.loss_rations))fail(label+'未結算卻已記錄傷亡。');
    if(r.stage==='resolved'&&r.outcome!=='attack_win'&&(r.loss_crew||r.loss_alloy||r.loss_rations))fail(label+'守備成功卻扣傷亡。');
    if((r.stage==='scheduled'&&time>=r.trigger_at)||(r.stage==='battle'&&(time<r.trigger_at||time>=r.resolves_at))||
       (r.stage==='resolved'&&time<r.resolves_at))fail(label+'時間與階段矛盾。');
    for(const k of ['loss_crew','loss_alloy','loss_rations'])if(!int(r[k],0))fail(label+'損失非法。');
  }
  function validate(s){if(!s||s.kind!=='starfall-outpost'||s.schema!==1)fail('不支援的前哨存檔格式。');
    if(!int(s.revision,0)||typeof s.transaction_id!=='string'||!finite(s.time)||typeof s.manual_paused!=='boolean'||!finite(s.wall_anchor_ms)||!int(s.rng,1,4294967295)||!int(s.next_id,1))
      fail('前哨版本、時鐘或交易資料無效。');
    if(s.owner!=null&&(!s.owner||typeof s.owner.token!=='string'||!finite(s.owner.expires_at)))fail('寫入擁有者標記無效。');
    if(s.revision>=1&&(!s.owner||s.transaction_id==='uncommitted'))fail('已提交快照缺少權威交易標記。');
    const b=s.base;if(!b||typeof b!=='object')fail('缺少長期基地。');
    for(const k of ['rations','alloy','standby','recycle_workers','supply_workers','duty_workers','patrols','wards','losses','raids_lost'])
      if(!int(b[k],0))fail('基地數值不合法：'+k);
    for(const k of ['supply_built','armory_built','recycle_upgraded','supply_upgraded'])if(typeof b[k]!=='boolean')fail('建築標記無效。');
    if(b.recycle_workers>2||b.supply_workers>2||b.duty_workers>1||b.recycle_workers+b.supply_workers>5)fail('派工上限超出。');
    if((b.supply_workers||b.supply_upgraded)&&!b.supply_built)fail('未建成補給棚。');
    if((b.patrols||b.wards||b.training||b.recalling)&&!b.armory_built)fail('兵力與整備艙不一致。');
    if(b.training&&(!['patrol','ward'].includes(b.training.unit)||!finite(b.training.completes_at)||b.training.completes_at<s.time-30))
      fail('訓練佇列無效。');
    if(b.recalling&&(!['patrol','ward'].includes(b.recalling.unit)||!int(b.recalling.count,1)||!finite(b.recalling.completes_at)||b.recalling.completes_at<s.time-30))
      fail('遣返隊列無效。');
    if(!int(b.losses,0,5)||population(s)!==6-b.losses||population(s)<1)fail('人口帳本與永久傷亡不符。');
    if(b.recycle_workers+b.supply_workers>Math.max(0,population(s)-1))fail('生產工人與現有人口不符。');
    if(!s.hero||!(s.hero.choice===null||['HERO-SIGNAL-TRACE','HERO-SIGNAL-SHELTER'].includes(s.hero.choice)))fail('英雄事件非法。');
    if(s.hero.choice&&s.time<240)fail('英雄過早解鎖。');
    if(!int(s.next_id,1)||!Array.isArray(s.settlement_ids)||new Set(s.settlement_ids).size!==s.settlement_ids.length||
       !s.settlement_ids.every(x=>typeof x==='string'))fail('結算ID不合法。');
    if(!s.processed_commands||typeof s.processed_commands!=='object'||Array.isArray(s.processed_commands))fail('處理過的指令資料非法。');
    if(!Array.isArray(s.events)||s.events.some(e=>!e||!finite(e.at)||typeof e.text!=='string'))fail('紀錄資料無效。');
    if(s.expedition){const e=s.expedition;if(s.shift!==null||!int(e.crew,0,4)||!int(e.rations,0)||!int(e.alloy,0)||
      !finite(e.started_at)||e.started_at>s.time||s.time>e.started_at+900+1e-7||!int(e.alloy_scavenged,0)||!int(e.rations_consumed,0))fail('外拓帳本非法。');
      if(typeof e.return_requested!=='boolean')fail('返航標記非法。');
      checkRaid(e.raid,'外拓侵略',s.time,e.started_at);
    }else{if(!s.shift||!finite(s.shift.start_at)||s.shift.start_at>s.time||s.time>=s.shift.start_at+900+1e-7)
      fail('留守值班資料不一致。');checkRaid(s.shift.raid,'留守侵略',s.time,s.shift.start_at);}
    const activeRaid=s.expedition?s.expedition.raid:s.shift.raid;
    if((activeRaid.stage==='resolved')!==s.settlement_ids.includes(activeRaid.settlement_id))fail('侵略階段與結算ID不一致。');
    if(s.last_raid!=null&&(!s.last_raid.settlement_id||!s.settlement_ids.includes(s.last_raid.settlement_id)))fail('侵略紀錄與結算ID不符。');
    if(s.last_report!=null&&(!s.last_report.settlement_id||!s.settlement_ids.includes(s.last_report.settlement_id)))fail('外拓紀錄與結算ID不符。');
    return true;
  }
  function load(storage){let raw;
    try{raw=storage.getItem(KEY);}catch(e){return {ok:false,error:'無法讀取前哨存檔：'+e.message};}
    if(raw==null)return {ok:true,empty:true,raw:null};
    try{const data=JSON.parse(raw);validate(data);if(data.revision<1)fail('未提交的前哨快照。');
      return {ok:true,empty:false,raw:raw,data:data};
    }catch(e){return {ok:false,raw:raw,error:'前哨存檔無效，原始內容已保留：'+e.message};}
  }
  function commit(storage,expectedRaw,next,token,nowMs,options){try{
      if(typeof token!=='string'||!token)fail('缺少分頁識別。');if(!finite(nowMs))fail('租約時間無效。');
      const seen=storage.getItem(KEY);
      if(seen!==expectedRaw)return {ok:false,code:'conflict',error:'另一分頁已更新前哨。已停止覆寫，請重新載入。'};
      const old=seen==null?null:JSON.parse(seen);if(old)validate(old);
      if(!next||next.revision!==(old?old.revision:0))
        return {ok:false,code:'conflict',error:'快照版本不相符，停止覆寫。'};
      if(old&&old.owner&&old.owner.token!==token&&old.owner.expires_at>nowMs)
        return {ok:false,code:'locked',error:'另一分頁正在使用前哨，請稍後重新載入。'};
      const candidate=copy(next);candidate.revision=old?old.revision+1:1;
      candidate.transaction_id=token+':'+candidate.revision;candidate.owner={token:token,expires_at:nowMs+(options&&options.release?0:C.LEASE_MS)};
      candidate.wall_anchor_ms=nowMs;validate(candidate);
      const raw=JSON.stringify(candidate);storage.setItem(KEY,raw);
      return {ok:true,raw:raw,data:candidate};
    }catch(e){return {ok:false,code:'write_failed',error:'儲存失敗，上一份可用存檔未覆寫：'+e.message};}}
  function Controller(storage,clock,token,wall){this.storage=storage;this.clock=clock;this.token=token;
    this.wall=wall||(()=>Date.now());this.raw=null;this.state=null;this.conflict=false;this.error='';}
  Controller.prototype._commit=function(next,options){if(this.conflict)return {ok:false,code:'conflict',error:this.error||'此分頁已停止寫入。'};
    const r=commit(this.storage,this.raw,next,this.token,this.wall(),options);
    if(r.ok){this.raw=r.raw;this.state=r.data;this.error='';}
    else{this.error=r.error;if(r.code==='conflict'||r.code==='locked')this.conflict=true;}
    return r;};
  Controller.prototype.create=function(seed){if(this.state)return {ok:false,error:'前哨已建立。'};
    const loaded=load(this.storage);if(!loaded.ok)return loaded;if(!loaded.empty)return {ok:false,error:'已有前哨主檔，請使用繼續。'};
    const r=this._commit(start(seed));if(r.ok){this.clock.set(0);this.clock.resume();}return r;};
  Controller.prototype.continue=function(){const l=load(this.storage);if(!l.ok||l.empty)return l;
    this.raw=l.raw;this.state=l.data;this.clock.set(l.data.time);
    const elapsed=!l.data.manual_paused&&l.data.wall_anchor_ms>0?
      Math.min(C.MAX_OFFLINE_SECONDS,Math.max(0,Math.floor((this.wall()-l.data.wall_anchor_ms)/1000))):0;
    // 即使沒有離線補算，繼續前也要取得單一權威快照的寫入租約。
    const claimed=this._commit(elapsed?advance(this.state,this.state.time+elapsed):copy(this.state));
    if(!claimed.ok)return claimed;
    this.clock.set(this.state.time);
    if(!this.state.manual_paused)this.clock.resume();else this.clock.pause();
    return {ok:true,data:this.state};};
  Controller.prototype.tick=function(){if(!this.state||this.state.manual_paused||this.conflict)return {ok:true,skipped:true};
    const t=Math.floor(this.clock.now());if(t<=this.state.time)return {ok:true,skipped:true};
    return this._commit(advance(this.state,t));};
  Controller.prototype.act=function(payload){if(!this.state)return {ok:false,error:'前哨未建立。'};
    const step=this.tick();if(!step.ok)return step;
    try{const result=act(this.state,payload);if(result.duplicate)return {ok:true,duplicate:true,result:result.result};
      const r=this._commit(result.state);return r.ok?Object.assign(r,{result:result.result}):r;
    }catch(e){return {ok:false,code:e.code||'rejected',error:e.message};}};
  Controller.prototype.setPaused=function(value){if(!this.state)return {ok:false,error:'未進入基地。'};
    const stepped=this.tick();if(!stepped.ok)return stepped;
    const beforePaused=this.clock.paused;if(value)this.clock.pause();else this.clock.resume();
    const next=copy(this.state);next.manual_paused=!!value;const r=this._commit(next);
    if(!r.ok){if(beforePaused)this.clock.pause();else this.clock.resume();}return r;};
  Controller.prototype.detach=function(){if(!this.state)return {ok:true};
    const r=this.tick();if(!r.ok)return r;const paused=this.clock.paused;this.clock.pause();
    const n=copy(this.state),c=this._commit(n,{release:true});if(!c.ok&&!paused)this.clock.resume();return c;};
  Controller.prototype.resumeVisible=function(){if(!this.state||this.state.manual_paused)return {ok:true};
    try{if(this.storage.getItem(KEY)!==this.raw){this.conflict=true;this.error='另一分頁已更新前哨，請重新載入。';return {ok:false,code:'conflict',error:this.error};}}
    catch(e){return {ok:false,code:'read_failed',error:'儲存狀態無法核對：'+e.message};}
    const delta=Math.min(C.MAX_OFFLINE_SECONDS,Math.max(0,Math.floor((this.wall()-this.state.wall_anchor_ms)/1000)));
    const r=delta?this._commit(advance(this.state,this.state.time+delta)):{ok:true};
    if(r.ok){this.clock.set(this.state.time);this.clock.resume();}return r;};
  return {KEY,C,start,validate,load,commit,advance,act,view,population,baseCrew,heroView,Controller};
});
