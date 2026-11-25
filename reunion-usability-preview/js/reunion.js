/* 墜星前哨・重逢：獨立單快照模式。舊前哨引擎只在此模式內作數值核心。 */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./outpost.js'));
else root.StarfallReunion=factory(root.StarfallOutpost);})(typeof globalThis!=='undefined'?globalThis:this,function(O){
'use strict';
if(!O)throw new Error('缺少離線前哨規則。');
const KEY='starfall-solo.reunion.v1',KIND='starfall-reunion',SCHEMA=1,LEASE_MS=15000,MAX_OFFLINE_SECONDS=900;
const SOLDIERS=Object.freeze([['S1','沈礪','石針','整理拆卸工具，替下一班留刻度。'],['S2','唐澄','霧燈','夜間替人核對照明和撤退標示。'],['S3','穆騫','銅羽','逐項點算防具，從不把缺件當小事。'],['S4','秦汐','短弦','聽到短頻雜訊時先記來源而不是猜。'],['S5','邵雋','靜楔','每次交班都會再試一次門閂。'],['S6','蘇禾','微塵','記錄環境微小變化和補給秤重。']]);
const PEOPLE=Object.freeze({MED:{name:'俞霽',region:'熱交換斷管',hint:'醫療反光片與短促的求救燈碼',verify:'應急照明的舊識別碼',choices:[['lamp','攜應急燈核路（消耗1合金，直接協作）'],['path','先整理裂管通路（免費，等待30秒）']],projects:[['store','醫療物資分存（消耗1口糧）'],['light','照明交接（免費）']]},
SCR:{name:'祁嶼',region:'礫架材料倉',hint:'舊材料箱與維修刻印',verify:'共同使用的工具編號',choices:[['preserve','先固定刻印證據（消耗1合金）'],['materials','先查承重路線（免費，等待30秒）']],projects:[['evidence','設置刻印證據分區（消耗1合金）'],['sort','整理安全拆卸工單（免費）']]},
WAT:{name:'容葵',region:'冷凝水路',hint:'冷凝槽止回閥的壓力訊號',verify:'船上止回閥維修位置',choices:[['supply','用已建補給棚作隔離核驗（須真建棚，直接協作）'],['sealed','先封閉樣本（免費，等待30秒）']],projects:[['sample','補給棚樣本核驗（已建棚、消耗1口糧）'],['sealed','水罐旁樣本封存（免費）']]},
RAD:{name:'洛津',region:'高地觀測桅杆',hint:'原波形與獨立維修序號',verify:'兩份不同來源的相同校驗碼',choices:[['trace','保存原波形並核下降路（免費，直接協作）'],['private','維持短頻並延後接應（免費，等待30秒）']],projects:[['compare','雙來源證據台（消耗1合金）'],['private','私密原波形索引（免費）']]},
GATE:{name:'許徹',region:'高地隔離閘',hint:'封門指令與撤離點名簿',verify:'撤離清點名冊與閘牌序號',choices:[['secure','真整備艙保障安全路（須建整備艙）'],['manual','保留封鎖並驗手動退路（免費，等待30秒）']],projects:[['map','入口退路圖（消耗1合金）'],['check','手動封門點名表（免費）']]}});
// Optional paid-per-sortie engineering corridors: no free passive resource/attack
// bonuses. Each corridor works only for a different, verified rescue target and
// consumes real stock on departure. Ordinary 90s rescue always remains available.
const PROJECT_ROUTES=Object.freeze({
 MED:{target:'WAT',name:'醫療照明水路',options:{store:{seconds:60,cost:{rations:1}},light:{seconds:75,cost:{alloy:1}}}},
 SCR:{target:'RAD',name:'承重觀測坡道',options:{evidence:{seconds:60,cost:{alloy:1}},sort:{seconds:75,cost:{rations:1}}}},
 WAT:{target:'SCR',name:'冷凝排水通道',options:{sample:{seconds:65,cost:{rations:1}},sealed:{seconds:75,cost:{alloy:1}}}},
 RAD:{target:'GATE',name:'雙源定向上山路',options:{compare:{seconds:45,cost:{alloy:1}},private:{seconds:75,cost:{rations:1}}}},
 GATE:{target:'MED',name:'隔離閘安全走廊',options:{map:{seconds:50,cost:{alloy:1}},check:{seconds:75,cost:{rations:1}}}}
});
function availableRoutes(s,target){return Object.entries(PROJECT_ROUTES).filter(([id,route])=>route.target===target&&s.companions[id].phase==='returned'&&route.options[s.companions[id].project]).map(([id,route])=>({id,target:route.target,name:route.name,seconds:route.options[s.companions[id].project].seconds,cost:copy(route.options[s.companions[id].project].cost)}));}
const PROJECT_SOURCE=Object.freeze({MED:{store:'wat-medstore',light:'wat-medproject'},SCR:{evidence:'rad-scrproject',sort:'gate-scrsort'},WAT:{sample:'rad-watsample',sealed:'gate-watsealed'},RAD:{compare:'gate-radproject',private:'gate-radprivate'},GATE:{map:'rad-gatemap',check:'scr-gatecheck'}});
const SOURCES=Object.freeze({
 'med-plate':{who:'MED',label:'分揀應急醫療反光片',condition:'camp'},
 'med-pulse':{who:'MED',label:'複查獨立醫療短脈衝',condition:'time120'},
 'scr-stamp':{who:'SCR',label:'比對回收廠工具刻印',condition:'recycle'},
 'scr-cargo':{who:'SCR',label:'核對上一趟外拓材料箱號',condition:'report'},
 'wat-pulse':{who:'WAT',label:'校驗冷凝水路脈衝',condition:'time60'},
 'wat-med':{who:'WAT',label:'比對醫療管線壓力記錄',condition:'medcontact'},
 'rad-wave':{who:'RAD',label:'保存原始高地窄頻波形',condition:'time240'},
 'rad-maint':{who:'RAD',label:'檢查獨立維修序號牌',condition:'recycle'},
 'rad-plate':{who:'RAD',label:'以外拓箱號作第二來源',condition:'report'},
 'gate-plaque':{who:'GATE',label:'核對外拓找到的控制站閘牌',condition:'report'},
 'gate-evac':{who:'GATE',label:'校驗失事前的撤離圖副本',condition:'medcontact'},
 'gate-radio':{who:'GATE',label:'比對已驗的高地封門序號',condition:'radcontact'},
 'wat-medproject':{who:'WAT',label:'採用已完成的醫療照明交接紀錄',condition:'medproject'},
 'rad-scrproject':{who:'RAD',label:'使用祁嶼封存的獨立刻印',condition:'scrproject'},
 'gate-radproject':{who:'GATE',label:'核對洛津已完成的雙來源證據台',condition:'radproject'},
 'wat-medstore':{who:'WAT',label:'醫療分存單的容器壓力碼',condition:'medstore'},
 'gate-scrsort':{who:'GATE',label:'回收工單保存的隔離門零件序號',condition:'scrsort'},
 'rad-watsample':{who:'RAD',label:'核驗樣本內的獨立波形標記',condition:'watsample'},
 'gate-watsealed':{who:'GATE',label:'密封水路留下的封門副本',condition:'watsealed'},
 'gate-radprivate':{who:'GATE',label:'私密短頻記錄的閘機呼叫序號',condition:'radprivate'},
 'rad-gatemap':{who:'RAD',label:'退路圖上的桅杆維修索引',condition:'gatemap'},
 'scr-gatecheck':{who:'SCR',label:'點名表附帶的材料倉退路編號',condition:'gatecheck'}});
const copy=v=>JSON.parse(JSON.stringify(v));
function err(msg,code='invalid'){const e=new Error(msg);e.code=code;throw e;}
function int(n,a=0,b){return Number.isSafeInteger(n)&&n>=a&&(b===undefined||n<=b)}
function posNum(n){return typeof n==='number'&&Number.isFinite(n)&&n>=0}
function present(s){return 1+s.roster.filter(x=>x.alive&&x.slot!=='expedition').length+Object.values(s.companions).filter(x=>x.phase==='returned').length;}
function B(s){return s.roster.filter(x=>x.alive).length;}
function R(s){return Object.values(s.companions).filter(x=>x.phase==='returned').length;}
function targetSlots(op){const b=op.base,r={standby:b.standby,recycle:b.recycle_workers,supply:b.supply_workers,duty:b.duty_workers,patrol:b.patrols,ward:b.wards,training:b.training?1:0,recalling:b.recalling?b.recalling.count:0,expedition:op.expedition?op.expedition.crew:0};return r;}
function countSlots(roster){const r={standby:0,recycle:0,supply:0,duty:0,patrol:0,ward:0,training:0,recalling:0,expedition:0};for(const x of roster)if(x.alive){if(!(x.slot in r))err('兵員崗位非法');r[x.slot]++;}return r;}
function log(s,message,kind='story',ref=null){s.log.push({id:'log-'+(++s.serial),at:s.op.time,kind,ref,text:message});if(s.log.length>60)s.log.shift();}
function start(seed){const op=O.start(seed);const s={kind:KIND,schema:1,revision:0,transaction_id:'uncommitted',owner:null,wall_anchor_ms:0,manual_paused:false,
 op,roster:SOLDIERS.map(([id,name,call,daily])=>({id,name,call,daily,alive:true,slot:'standby',death_id:null})),
 companions:Object.fromEntries(Object.keys(PEOPLE).map(id=>[id,{phase:'unknown',source:null,decision:null,route_due_at:null,route_ready:false,refusal_reason:null,joined_id:null,project:null,project_choice:null}])),
 evidence:[],mission:null,milestone:null,once:[],processed_commands:{},log:[],serial:0};validate(s);return s;}
function sourceAllowed(s,key){const c=SOURCES[key].condition,b=s.op.base;
 if(c==='camp')return true;if(c==='time120')return s.op.time>=120;if(c==='time240')return s.op.time>=240;
 if(c==='time60')return s.op.time>=60;if(c==='recycle')return b.recycle_workers>=1;
 if(c==='report')return !!s.op.last_report;
 if(c==='medcontact')return !['unknown','lead'].includes(s.companions.MED.phase);
 if(c==='radcontact')return !['unknown','lead'].includes(s.companions.RAD.phase);
 if(c==='medproject')return s.companions.MED.project!==null;
 if(c==='scrproject')return s.companions.SCR.project==='evidence';
 if(c==='radproject')return s.companions.RAD.project==='compare';
 if(c==='medstore')return s.companions.MED.project==='store';
 if(c==='scrsort')return s.companions.SCR.project==='sort';
 if(c==='watsample')return s.companions.WAT.project==='sample';
 if(c==='watsealed')return s.companions.WAT.project==='sealed';
 if(c==='radprivate')return s.companions.RAD.project==='private';
 if(c==='gatemap')return s.companions.GATE.project==='map';
 if(c==='gatecheck')return s.companions.GATE.project==='check';
 return false;}
function hasEvidence(s,id){if(id==='RAD')return s.evidence.includes('rad-wave')&&(s.evidence.includes('rad-maint')||s.evidence.includes('rad-plate')||s.evidence.includes('rad-scrproject')||s.evidence.includes('rad-watsample')||s.evidence.includes('rad-gatemap'));
 return Object.keys(SOURCES).some(k=>SOURCES[k].who===id&&s.evidence.includes(k));}
// The numeric engine removes a casualty BEFORE it automatically reassigns surplus
// production workers. Preserve that causal order in the named roster, rather than
// guessing the victim from final aggregate counts (which include auto-reassignment).
function reconcile(s,previous){const oldLoss=previous.base.losses,newLoss=s.op.base.losses;
 const lost=newLoss-oldLoss;
 if(lost<0||lost>1)err('兵員傷亡的時間順序無法核對。');
 // O.doAt completes queued training/recall before settling the raid at this instant.
 // Apply those deterministic role transitions to the named roster first.
 if(previous.base.training&&previous.base.training.completes_at<=s.op.time){
  const trainee=s.roster.find(x=>x.alive&&x.slot==='training');
  if(!trainee)err('訓練兵員身份不存在。');
  trainee.slot=previous.base.training.unit==='ward'?'ward':'patrol';
 }
 if(previous.base.recalling&&previous.base.recalling.completes_at<=s.op.time){
  const n=previous.base.recalling.count;
  const returning=s.roster.filter(x=>x.alive&&x.slot==='recalling');
  if(returning.length!==n)err('遣返編制不一致。');
  for(const person of returning)person.slot='standby';
 }
 if(lost){const raid=s.op.last_raid;
  if(!raid||raid.loss_crew!==1||raid.settlement_id===previous.last_raid?.settlement_id)err('沒有對應傷亡結算。');
  // Matches outpost.js killFromBase priority, independent of the later production cap repair.
  const priority=raid.context==='expedition'?['expedition']:['standby','duty','recycle','supply','patrol','ward','training','recalling'];
  const killSlot=priority.find(k=>s.roster.some(x=>x.alive&&x.slot===k));
  if(!killSlot)err('無法核對實際傷亡崗位。');
  const dead=s.roster.find(x=>x.alive&&x.slot===killSlot);
  dead.alive=false;dead.slot='dead';dead.death_id=raid.settlement_id;
  log(s,`${dead.call}／${dead.name}在${raid.context==='expedition'?'外拓':'留守'}侵略中犧牲；已依永久傷亡入帳。`,'loss',raid.settlement_id);
 }
 const need=targetSlots(s.op),have=countSlots(s.roster),pool=[];
 for(const slot of Object.keys(need))while(have[slot]>need[slot]){
  const x=[...s.roster].reverse().find(p=>p.alive&&p.slot===slot);
  x.slot='unassigned';pool.push(x);have[slot]--;
 }
 for(const slot of Object.keys(need))while(have[slot]<need[slot]){
  const x=pool.shift();if(!x)err('名冊調配與引擎人數不一致。');x.slot=slot;have[slot]++;
 }
 if(pool.length)err('名冊存在未派遣的多餘兵員。');
}
function finishMission(s,prevExp,reason){if(!s.mission||!prevExp||s.mission.expedition_id!==prevExp.id)return;
 const c=s.companions[s.mission.target];const report=s.op.last_report;
 if(report?.id!==prevExp.id)return;
 const reached=s.mission.reached||s.op.time>=s.mission.arrival_at;
 if(reached&&report.returning_crew>=2&&c.phase!=='returned'){
 c.phase='returned';c.joined_id=report.settlement_id;c.route_due_at=null;c.route_ready=true;
 if(!s.once.includes('JOIN:'+s.mission.target))s.once.push('JOIN:'+s.mission.target);
 log(s,`${PEOPLE[s.mission.target].name}隨存活接應隊實際返抵岩谷；已歸隊但不成為派遣兵員。`,'join',report.settlement_id);
 }else if(c.phase!=='returned'){c.phase='delayed';c.route_ready=true;
 log(s,`${PEOPLE[s.mission.target].name}本趟未能安全抵營（${reason||'路線未完成'}）；可重新安排合規接應。`,'delay',report.settlement_id);}
 s.mission=null;}
function syncStep(s,to){const old=s.op;const oldExp=old.expedition;const updated=O.advance(old,to);s.op=updated;reconcile(s,old);
 if(s.mission&&oldExp&&s.mission.expedition_id===oldExp.id&&to>=s.mission.arrival_at){s.mission.reached=true;
 const c=s.companions[s.mission.target];if(c.phase==='cooperating')c.phase='in_transit';}
 if(oldExp&&!updated.expedition)finishMission(s,oldExp,'侵略後接應不足');
 for(const id of Object.keys(PEOPLE)){const c=s.companions[id];if(c.route_due_at!==null&&c.route_due_at<=to){c.route_due_at=null;c.route_ready=true;c.phase='cooperating';log(s,`${PEOPLE[id].name}的接應通路已核驗，仍須派兵完成實體外拓。`,'route',id);}}
 }
function advance(input,target){if(!posNum(target)||target<input.op.time)err('不能倒退遊戲時間。');const s=copy(input);
 while(s.op.time+1e-8<target){const op=s.op,raid=op.expedition?op.expedition.raid:op.shift.raid;
 let next=Math.min(target,op.time+30);
 if(raid.stage==='scheduled'&&raid.trigger_at>op.time)next=Math.min(next,raid.trigger_at);
 if(raid.stage==='battle'&&raid.resolves_at>op.time)next=Math.min(next,raid.resolves_at);
 if(s.mission&&s.mission.arrival_at>op.time)next=Math.min(next,s.mission.arrival_at);
 for(const c of Object.values(s.companions))if(c.route_due_at!==null&&c.route_due_at>op.time)next=Math.min(next,c.route_due_at);
 if(next<=op.time)err('事件時鐘沒有前進');syncStep(s,next);}
 validate(s);return s;}
function storyAction(s,p){const id=p.person,c=s.companions[id];
 switch(p.type){
 case 'inspect':{const src=SOURCES[p.source];if(!src)err('未知線索來源。');if(s.evidence.includes(p.source))err('此線索已記錄，請查閱來源。');if(!sourceAllowed(s,p.source))err('尚未取得可驗證的資料來源。');
 s.evidence.push(p.source);if(s.companions[src.who].phase==='unknown')s.companions[src.who].phase='lead';
 log(s,`找到線索：「${src.label}」。來源已登記，尚不代表確定失散者已歸隊。`,'evidence',p.source);return {evidence:p.source};}
 case 'verify':{if(!c)err('未知失散者。');if(c.phase!=='lead')err('需先取得真正線索，或此身分已核實。');if(!hasEvidence(s,id))err('身分驗證缺少獨立來源。');
 c.phase='contacted';c.source=s.evidence.filter(x=>SOURCES[x].who===id).join('+');
 log(s,`以「${PEOPLE[id].verify}」與${PEOPLE[id].name}核對身分；建立遠端聯絡，仍未歸隊。`,'contact',id);return {contact:id};}
 case 'challenge':{if(id!=='GATE'||!c||!['contacted','delayed'].includes(c.phase))err('不能在此階段要求開閘。');
 if(s.once.includes('REFUSAL:GATE'))err('此項拒絕已記錄，可補證再談，無需重演。');
 c.phase='refused';c.decision=null;c.route_ready=false;c.route_due_at=null;c.refusal_reason='返途點名與封門資料不足，需另一個獨立來源重新核對。';
 s.once.push('REFUSAL:GATE');log(s,'許徹拒絕沒有雙重核驗的開閘要求；這是可補證的延遲，不是死亡。','refusal','GATE');return {refused:'GATE'};}
 case 'recheck':{if(id!=='GATE'||!c||c.phase!=='refused')err('沒有需要補證的拒絕。');
 if(s.evidence.filter(k=>SOURCES[k].who==='GATE').length<2)err('請先補齊第二個獨立閘門來源。');
 c.phase='contacted';c.source=s.evidence.filter(k=>SOURCES[k].who==='GATE').join('+');c.refusal_reason=null;
 log(s,'許徹核對另一份獨立撤離／閘牌來源，願意重新討論真正的接應路線。','recheck','GATE');return {rechecked:'GATE'};}
 case 'decide':{if(!c||!['contacted','delayed'].includes(c.phase))err('此時不能協作或更改延遲方案。');const option=p.option;
 if(!PEOPLE[id].choices.some(x=>x[0]===option))err('未知選項。');
 if(id==='MED'&&option==='lamp'){if(s.op.base.alloy<1)err('合金不足；可選免費整理通路。');s.op.base.alloy--;}
 if(id==='SCR'&&option==='preserve'){if(s.op.base.alloy<1)err('合金不足；可先走免費承重核對。');s.op.base.alloy--;}
 if(id==='WAT'&&option==='supply'&&!s.op.base.supply_built)err('須先真實建造補給棚（合金5），或先封存。');
 if(id==='GATE'&&option==='secure'&&!s.op.base.armory_built)err('須先真實建造整備艙（合金8），或先遠端驗圖。');
 c.decision=option;const delay=['path','materials','sealed','private','manual'].includes(option);
 c.route_ready=!delay;c.route_due_at=delay?s.op.time+30:null;c.phase=delay?'delayed':'cooperating';
 log(s,`${PEOPLE[id].name}：${PEOPLE[id].choices.find(x=>x[0]===option)[1]}。${delay?'正整理實際路線，尚未可出發。':'可安排一趟合法的實體接應。'}`,'choice',id);
 return {person:id,option,route_ready:c.route_ready};}
 case 'milestone':{if(s.milestone!==null)err('本期里程碑已記錄。');const full=R(s)>=1&&Object.values(s.companions).some(p=>p.project!==null);
 if(!full&&!(B(s)<4&&s.evidence.length>0))err('請先真實重逢並完成合作，或在低兵員處境整理既有資料。');
 s.milestone=full?'joint-base':'known-shelter';s.once.push('MILESTONE:'+s.milestone);
 log(s,full?'第一期：有人真正歸隊，工位開始互相協作；事故真相留待共同核實。':'第一期：現存兵員不足以合規外拓；守住已知資訊，不假稱同伴已回營。','milestone',s.milestone);return {milestone:s.milestone};}
 case 'project':{if(!c||c.phase!=='returned')err('須先實體歸隊才能共建。');if(c.project!==null)err('此人已完成一次工程協作。');
 if(!PEOPLE[id].projects.some(x=>x[0]===p.option))err('無效工程方案。');
 const pay=id==='MED'&&p.option==='store'?{rations:1}:id==='SCR'&&p.option==='evidence'?{alloy:1}:
 id==='WAT'&&p.option==='sample'?{rations:1}:id==='RAD'&&p.option==='compare'?{alloy:1}:
 id==='GATE'&&p.option==='map'?{alloy:1}:{};
 if(id==='WAT'&&p.option==='sample'&&!s.op.base.supply_built)err('樣本核驗要有已建補給棚；可選免費封存。');
 for(const [k,n] of Object.entries(pay)){if(s.op.base[k]<n)err('工程物資不足；可採用另一免費方案。');}
 for(const [k,n] of Object.entries(pay))s.op.base[k]-=n;
 c.project=p.option;c.project_choice=PEOPLE[id].projects.find(x=>x[0]===p.option)[1];s.once.push('PROJECT:'+id);
 log(s,`${PEOPLE[id].name}與兵員完成「${c.project_choice}」；開放可選的「${PROJECT_ROUTES[id].name}」接應線，每趟另耗真實物資，建築基礎產量與兵力規則不變。`,'project',id);
 return {project:id,option:p.option,unlock:PROJECT_SOURCE[id][p.option]};}
 default:err('未知故事指令。');}}
function act(input,payload){if(input.manual_paused&&['inspect','verify','decide','challenge','recheck','project','milestone','depart'].includes(payload?.type))err('已手動暫停，請先繼續才作新探索或故事決定。');
 if(!payload||typeof payload.command_id!=='string'||!payload.command_id.trim()||payload.command_id.length>128)err('指令缺少唯一ID。');
 const key='command:'+payload.command_id;if(Object.prototype.hasOwnProperty.call(input.processed_commands,key))return {state:copy(input),result:copy(input.processed_commands[key]),duplicate:true};
 const s=copy(input);let result;
 if(['inspect','verify','decide','challenge','recheck','project','milestone'].includes(payload.type))result=storyAction(s,payload);
 else if(payload.type==='depart'){
 const target=payload.target||null;if(target){const c=s.companions[target];if(!c||c.phase!=='cooperating'||!c.route_ready)err('接應對象未同意，或路線尚未核驗。');}
 const routeId=payload.route||null;
 let route=null;
 if(routeId){if(!target)err('工程路線只用於已核實的實體接應。');
  route=availableRoutes(s,target).find(x=>x.id===routeId);
  if(!route)err('工程路線尚未由歸隊同伴完成，或並非此接應目標。');
  for(const [resource,amount] of Object.entries(route.cost)){
   if(s.op.base[resource]<amount)err('工程路線需要實際消耗物資；可選不加價的普通路線。');
   s.op.base[resource]-=amount;
  }
 }
 const e=O.act(s.op,{type:'depart',command_id:payload.command_id,crew:payload.crew,rations:payload.rations,alloy:payload.alloy});
 const before=s.op;s.op=e.state;reconcile(s,before);
 if(target){s.mission={expedition_id:s.op.expedition.id,target,arrival_at:s.op.time+(route?route.seconds:90),reached:false,route:routeId};
  if(route)log(s,`接應採用${route.name}，耗費${Object.entries(route.cost).map(([k,n])=>n+(k==='rations'?'口糧':'合金')).join('＋')}；實際走線${route.seconds}秒，侵略與900秒返航規則不變。`,'route',target);
 }
 result={expedition_id:s.op.expedition.id,target,route:routeId};
 }else{
 const o=O.act(s.op,payload),before=s.op,oldExp=before.expedition;s.op=o.state;reconcile(s,before);
 if(oldExp&&!s.op.expedition)finishMission(s,oldExp,'接應隊員受損');result=o.result;
 }
 s.processed_commands[key]=copy(result);validate(s);return {state:s,result,duplicate:false};}
function view(s){const v=O.view(s.op),r=copy(s);delete r.processed_commands;delete r.owner;
 r.base=v.base;r.expedition=v.expedition; if(r.expedition?.raid){delete r.expedition.raid.trigger_at;delete r.expedition.raid.offset;delete r.expedition.raid.resolves_at;} r.last_report=v.last_report;r.last_raid=v.last_raid;r.hero=v.hero;r.time=v.time;r.base_raid_stage=v.shift?.raid?.stage||null;
 r.B=B(s);r.C=1;r.R=R(s);r.N=1+r.B+r.R;r.T=s.op.expedition?s.op.expedition.crew:0;r.P=present(s);
 r.companion_views=Object.fromEntries(Object.keys(PEOPLE).filter(id=>s.companions[id].phase!=='unknown').map(id=>[id,{...s.companions[id],name:PEOPLE[id].name,region:PEOPLE[id].region}]));
 delete r.op;return r;}
function validate(s){if(!s||s.kind!==KIND||s.schema!==SCHEMA)err('重逢存檔kind/schema非法。');
 if(!int(s.revision)||typeof s.transaction_id!=='string'||!posNum(s.wall_anchor_ms)||typeof s.manual_paused!=='boolean'||!int(s.serial))err('版本或時計非法。');
 if(s.owner!=null&&(!s.owner||typeof s.owner.token!=='string'||!posNum(s.owner.expires_at)))err('租約非法。');
 if(s.revision>=1&&(!s.owner||s.transaction_id==='uncommitted'))err('已提交存檔缺少交易標記。');
 O.validate(s.op);if(s.op.manual_paused!==s.manual_paused)err('暫停狀態不同步。');
 if(!Array.isArray(s.roster)||s.roster.length!==6)err('六兵員名冊非法。');
 if(s.roster.some((x,i)=>!x||x.id!==SOLDIERS[i][0]||x.name!==SOLDIERS[i][1]||x.call!==SOLDIERS[i][2]||x.daily!==SOLDIERS[i][3]||typeof x.alive!=='boolean'||typeof x.slot!=='string'||(x.alive&&x.death_id!==null)||(!x.alive&&(x.slot!=='dead'||typeof x.death_id!=='string'||!s.op.settlement_ids.includes(x.death_id)))))err('具名兵員／永久傷亡非法。');
 if(B(s)!==O.population(s.op)||B(s)!==6-s.op.base.losses||B(s)<1)err('兵員與數值人口不守恆。');
 const expected=targetSlots(s.op),actual=countSlots(s.roster);for(const k of Object.keys(expected))if(expected[k]!==actual[k])err('具名編制與數值編制不符：'+k);
 if(!s.companions||Object.keys(s.companions).sort().join()!==Object.keys(PEOPLE).sort().join())err('失散者欄位非法。');
 const seen=new Set();for(const [id,c] of Object.entries(s.companions)){
 if(!c||!['unknown','lead','contacted','delayed','refused','cooperating','in_transit','returned'].includes(c.phase)||!(c.decision===null||PEOPLE[id].choices.some(x=>x[0]===c.decision))||typeof c.route_ready!=='boolean'||!(c.route_due_at===null||posNum(c.route_due_at))||!(c.joined_id===null||typeof c.joined_id==='string')||!(c.project===null||PEOPLE[id].projects.some(x=>x[0]===c.project))||!(c.refusal_reason===null||typeof c.refusal_reason==='string'))err('同伴進程非法：'+id);
 if(c.phase==='unknown'&&(c.source!==null||c.decision!==null||c.joined_id!==null||c.route_ready||c.route_due_at!==null))err('尚未接觸不應有選擇。');
 if(c.phase==='lead'&&(!s.evidence.some(k=>SOURCES[k].who===id)||c.source!==null||c.decision!==null||c.route_ready))err('線索不足或超前。');
 if(['contacted','delayed','refused','cooperating','in_transit','returned'].includes(c.phase)&&(!c.source||!hasEvidence(s,id)||c.source.split('+').some(k=>!SOURCES[k]||SOURCES[k].who!==id||!s.evidence.includes(k))))err('無驗證來源的接觸非法。');
 if(c.phase==='refused'&&(id!=='GATE'||!c.refusal_reason||!s.once.includes('REFUSAL:GATE')||c.route_ready))err('拒絕缺少可補證原因。');
 if(c.phase==='contacted'&&(c.decision!==null||c.route_ready||c.route_due_at!==null))err('接觸不等於路線已可使用。');
 if(['delayed','cooperating','in_transit','returned'].includes(c.phase)&&c.decision===null)err('同伴未作任何協作決定。');
 if(c.phase==='cooperating'&&!c.route_ready)err('路線未核驗不能接應。');
 if(c.phase==='in_transit'&&(!s.mission||s.mission.target!==id||!s.mission.reached))err('同伴不在真實接應路線。');
 if(c.route_due_at!==null&&(c.phase!=='delayed'||c.route_due_at<=s.op.time||c.route_ready||c.route_due_at>s.op.time+30))err('路線等待不合法。');
 if(c.phase==='returned'&&(!c.joined_id||!c.joined_id.endsWith(':return')||!s.op.settlement_ids.includes(c.joined_id)||!s.once.includes('JOIN:'+id)))err('歸隊沒有真正返航once。');
 if(c.phase!=='returned'&&(c.joined_id||c.project!==null))err('未歸隊已獲專業工程／人口。');
 if(c.project!==null&&!s.once.includes('PROJECT:'+id))err('工程沒有once。');
 if(c.joined_id){if(seen.has(c.joined_id))err('一趟結算不可憑空重領兩名同伴');seen.add(c.joined_id);}
 }
 if(!Array.isArray(s.evidence)||new Set(s.evidence).size!==s.evidence.length||!s.evidence.every(x=>SOURCES[x]))err('線索來源非法。');
 if(!(s.milestone===null||['joint-base','known-shelter'].includes(s.milestone)))err('里程碑非法。');
 if(s.milestone&&!s.once.includes('MILESTONE:'+s.milestone))err('里程碑缺少once。');
 if(!Array.isArray(s.once)||new Set(s.once).size!==s.once.length||!s.once.every(x=>typeof x==='string'&&(/^JOIN:(MED|SCR|WAT|RAD|GATE)$|^PROJECT:(MED|SCR|WAT|RAD|GATE)$|^MILESTONE:(joint-base|known-shelter)$|^REFUSAL:GATE$/).test(x)))err('once非法。');
 for(const id of Object.keys(PEOPLE)){const c=s.companions[id];if(s.once.includes('JOIN:'+id)!==(c.phase==='returned')||s.once.includes('PROJECT:'+id)!==(c.project!==null))err('once 與實際人物狀態不一致。');}
 if(s.milestone==='joint-base'&&!(R(s)>=1&&Object.values(s.companions).some(x=>x.project!==null)))err('未建立共同基地里程碑。');
 if(s.milestone==='known-shelter'&&!(B(s)<4&&s.evidence.length>0))err('低兵員部分收束缺少證據。');
 if(s.mission){if(!s.op.expedition||!PEOPLE[s.mission.target]||s.mission.expedition_id!==s.op.expedition.id||!posNum(s.mission.arrival_at)||s.mission.arrival_at!==s.op.expedition.started_at+(s.mission.route?availableRoutes(s,s.mission.target).find(x=>x.id===s.mission.route)?.seconds:90)||typeof s.mission.reached!=='boolean'||!['cooperating','in_transit'].includes(s.companions[s.mission.target].phase))err('接應隊伍資料非法。');}
 if(!s.processed_commands||typeof s.processed_commands!=='object'||Array.isArray(s.processed_commands))err('指令帳非法。');
 if(!Array.isArray(s.log)||s.log.length>60||s.log.some(x=>!x||!int(x.id?.startsWith('log-')?+x.id.slice(4):-1,1)||!posNum(x.at)||typeof x.text!=='string'))err('故事紀錄非法。');
 return true;}
function load(storage){let raw;try{raw=storage.getItem(KEY);}catch(e){return {ok:false,error:'無法讀取重逢存檔：'+e.message};}
 if(raw==null)return {ok:true,empty:true,raw:null};try{const data=JSON.parse(raw);validate(data);if(data.revision<1)err('未提交的快照');return {ok:true,empty:false,raw,data};}
 catch(e){return {ok:false,raw,error:'重逢存檔無效，原始資料保持不變：'+e.message};}}
function commit(storage,expectedRaw,next,token,nowMs,opts){try{
 if(typeof token!=='string'||!token||!posNum(nowMs))err('提交參數不合法。');
 const seen=storage.getItem(KEY);if(seen!==expectedRaw)return {ok:false,code:'conflict',error:'另一分頁已更新重逢存檔；停止覆寫，請重新載入。'};
 const old=seen===null?null:JSON.parse(seen);if(old)validate(old);
 if(!next||next.revision!==(old?old.revision:0))return {ok:false,code:'conflict',error:'存檔版本已變更，停止覆寫。'};
 if(old?.owner?.token!==token&&old?.owner?.expires_at>nowMs)return {ok:false,code:'locked',error:'另一分頁正在操作，請稍後再開。'};
 const n=copy(next);n.revision=old?old.revision+1:1;n.transaction_id=token+':'+n.revision;
 n.owner={token,expires_at:nowMs+(opts?.release?0:LEASE_MS)};n.wall_anchor_ms=nowMs;validate(n);
 const raw=JSON.stringify(n);storage.setItem(KEY,raw);return {ok:true,raw,data:n};
 }catch(e){return {ok:false,code:'write_failed',error:'本次變更沒有保存，上一份可用資料仍在：'+e.message};}}
function Controller(storage,clock,token,wall){this.storage=storage;this.clock=clock;this.token=token;this.wall=wall||(()=>Date.now());this.raw=null;this.state=null;this.conflict=false;this.error='';}
Controller.prototype._commit=function(n,opts){if(this.conflict)return {ok:false,code:'conflict',error:this.error};const r=commit(this.storage,this.raw,n,this.token,this.wall(),opts);
 if(r.ok){this.raw=r.raw;this.state=r.data;this.error='';}else{this.error=r.error;if(['conflict','locked'].includes(r.code))this.conflict=true;}return r;};
Controller.prototype.create=function(seed){if(this.state)return {ok:false,error:'已建立營地。'};const l=load(this.storage);if(!l.ok)return l;if(!l.empty)return {ok:false,error:'已有重逢存檔，請使用繼續。'};
 const r=this._commit(start(seed));if(r.ok){this.clock.set(0);this.clock.resume();}return r;};
Controller.prototype.continue=function(){const l=load(this.storage);if(!l.ok||l.empty)return l;this.raw=l.raw;this.state=l.data;this.clock.set(l.data.op.time);
 const delta=!l.data.manual_paused&&l.data.wall_anchor_ms>0?Math.min(MAX_OFFLINE_SECONDS,Math.max(0,Math.floor((this.wall()-l.data.wall_anchor_ms)/1000))):0;
 const r=this._commit(delta?advance(this.state,this.state.op.time+delta):copy(this.state));if(!r.ok)return r;
 this.clock.set(this.state.op.time);if(this.state.manual_paused)this.clock.pause();else this.clock.resume();return {ok:true,data:this.state};};
Controller.prototype.tick=function(){if(!this.state||this.state.manual_paused||this.conflict)return {ok:true,skipped:true};const t=Math.floor(this.clock.now());if(t<=this.state.op.time)return {ok:true,skipped:true};return this._commit(advance(this.state,t));};
Controller.prototype.act=function(payload){if(!this.state)return {ok:false,error:'營地未建立。'};
 const key='command:'+payload?.command_id;if(this.state.processed_commands[key]!==undefined)return {ok:true,duplicate:true,result:copy(this.state.processed_commands[key])};
 const t=this.tick();if(!t.ok)return t;
 try{const result=act(this.state,payload);if(result.duplicate)return {ok:true,duplicate:true,result:result.result};const r=this._commit(result.state);return r.ok?Object.assign(r,{result:result.result}):r;}
 catch(e){return {ok:false,code:e.code||'rejected',error:e.message};}};
Controller.prototype.setPaused=function(flag){if(!this.state)return {ok:false,error:'營地未建立。'};const t=this.tick();if(!t.ok)return t;const before=this.clock.paused;
 if(flag)this.clock.pause();else this.clock.resume();const n=copy(this.state);n.manual_paused=!!flag;n.op.manual_paused=!!flag;
 const r=this._commit(n);if(!r.ok){if(before)this.clock.pause();else this.clock.resume();}return r;};
Controller.prototype.detach=function(){if(!this.state)return {ok:true};const t=this.tick();if(!t.ok)return t;const old=this.clock.paused;this.clock.pause();const r=this._commit(copy(this.state),{release:true});if(!r.ok&&!old)this.clock.resume();return r;};
Controller.prototype.resumeVisible=function(){if(!this.state||this.state.manual_paused)return {ok:true};try{if(this.storage.getItem(KEY)!==this.raw){this.conflict=true;this.error='另一分頁已更新存檔。';return {ok:false,code:'conflict',error:this.error};}}
 catch(e){return {ok:false,error:'無法核對存檔：'+e.message};}
 const delta=Math.min(MAX_OFFLINE_SECONDS,Math.max(0,Math.floor((this.wall()-this.state.wall_anchor_ms)/1000)));
 const r=delta?this._commit(advance(this.state,this.state.op.time+delta)):{ok:true};if(r.ok){this.clock.set(this.state.op.time);this.clock.resume();}return r;};
return {KEY,KIND,SCHEMA,C:O.C,SOLDIERS,PEOPLE,SOURCES,PROJECT_SOURCE,PROJECT_ROUTES,availableRoutes,start,validate,load,commit,advance,act,view,hasEvidence,sourceAllowed,B,R,present,Controller};
});
