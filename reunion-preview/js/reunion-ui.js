/* 重逢MVP獨立介面。所有寫入經 Reunion.Controller；原有模式不掛載本介面。 */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;
else factory(root.StarfallReunion,root.document,root);})(typeof globalThis!=='undefined'?globalThis:this,function(R,document,global){
'use strict';if(!R||!document)return null;
const el=document.getElementById('reunion-root');if(!el)return null;
const COPY=['遠燈號在陌生星球的夜側偏航，艦橋燈光先於撞擊熄滅。你只記得五位同伴被分散進不同的艙段。',
'你是岑曜，帶著六名有名字的兵員找到岩谷避風點。此處還不是完整基地；要先整理工具與口糧。',
'剩下20份口糧、8份合金。六名兵員可派往回收、補給、值守或外拓；你與失散的五位同伴不能冒充工人。',
'線索不等於接觸，電台不會把人送回來。只有真正接應、走完路線並返營，才算一次重逢。每趟外拓最長15分鐘，長期營地不會重置。'];
const people=R.PEOPLE,sources=R.SOURCES;let introIndex=0,tab='base',stageSig='',pendingRender=false,pointerDown=false,pointerSequencePending=false;
let error='',selected={crew:3,rations:6,alloy:0,target:'',route:''},readReport=null,readRaid=null;
const token='reunion-'+((global.crypto&&global.crypto.randomUUID)?global.crypto.randomUUID():String(Date.now())+'-'+String(Math.random()).slice(2));
const storage=global.localStorage;
function clockMaker(){let t=0,stamp=Date.now(),paused=true;return {get paused(){return paused;},now(){return t+(paused?0:(Date.now()-stamp)/1000);},set(x){t=x;stamp=Date.now();},pause(){if(!paused){t=this.now();paused=true;}},resume(){if(paused){stamp=Date.now();paused=false;}}};}
const controller=new R.Controller(storage,clockMaker(),token,()=>Date.now());
function esc(a){return String(a==null?'':a).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function fmt(t){const n=Math.max(0,Math.floor(t||0));return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
function btn(action,label,enabled=true,attrs='',why=''){return '<button type="button" class="r-btn" data-r-action="'+action+'" '+attrs+(enabled?'':' disabled title="'+esc(why)+'"')+'>'+esc(label)+'</button>';}
function msg(x){return x?'<p class="r-error" role="alert">'+esc(x)+'</p>':'';}
function getView(){return controller.state?R.view(controller.state):null;}
function intro(){let loaded=R.load(storage);let has=loaded.ok&&!loaded.empty;
 el.innerHTML='<section class="r-intro"><h1>墜星前哨：尋回失散的人</h1><div class="r-card"><p class="r-step">序章 '+(introIndex+1)+'／4</p><p>'+esc(COPY[introIndex])+'</p></div>'+msg(loaded.ok?'':loaded.error)+msg(error)+
 (introIndex<3?btn('intro-next','閱讀下一段'):btn('enter','進入岩谷，建立全新重逢存檔',loaded.ok&&loaded.empty))+
 (has?btn('continue','繼續目前重逢營地'):'')+'<p class="r-note"><a href="outpost.html">原長期前哨模式</a>　·　<a href="index.html">其他遊戲模式</a></p></section>';}
function workers(b,f){return f==='recycle'?b.recycle_workers:f==='supply'?b.supply_workers:b.duty_workers;}
function assignmentReason(v,f){const b=v.base,cur=workers(b,f);if(f==='supply'&&!b.supply_built)return '請先建造補給棚';
 if(f!=='duty'&&v.B<=1)return '只剩1名兵員，生產線不可增派';if(f==='duty'&&cur>=1)return '指揮艙最多值守1人';
 if(f!=='duty'&&cur>=2)return '此設施最多2名工人';if(b.standby<1)return '沒有待命兵員';
 if(f!=='duty'&&b.recycle_workers+b.supply_workers>=Math.min(5,v.B-1))return '至少留1名兵員不進生產線';return '';}
function assignFace(v,f,label){const count=workers(v.base,f),why=assignmentReason(v,f),low='目前無可調回人員';return '<div class="r-assign" data-r-assign="'+f+'"><button type="button" class="r-step-btn" data-r-action="assign" data-r-facility="'+f+'" data-r-count="'+(count-1)+'" data-r-direction="minus" aria-label="'+label+'調回一人"'+(count?'':' disabled title="'+low+'"')+'>−</button>'+ 
 '<span class="r-count" data-r-workers="'+f+'" aria-live="off">'+count+'人</span><button type="button" class="r-step-btn" data-r-action="assign" data-r-facility="'+f+'" data-r-count="'+(count+1)+'" data-r-direction="plus" aria-label="'+label+'增派一人"'+(why?' disabled title="'+esc(why)+'"':'')+'>＋</button><span class="r-assign-reason" data-r-assign-reason="'+f+'">'+esc(why||(!count?low:''))+'</span></div>';}
function art(kind,mode,engineering){const decoration=kind==='recycle'?'<path d="M20 70V40L42 22L65 38V70ZM68 70V35H137V70Z" fill="#245263" stroke="#82dcca" stroke-width="3"/><path d="M32 35V12H46V26" stroke="#bde7e0" stroke-width="4"/>':
 kind==='supply'?mode==='unbuilt'?'<path d="M18 70Q80 0 142 70" fill="none" stroke="#8aa8ac" stroke-width="3" stroke-dasharray="7 6"/>':'<path d="M18 70Q80 2 142 70Z" fill="#28594c" stroke="#8ad0a4" stroke-width="3"/><path d="M55 68Q47 41 68 39Q85 35 92 64Q111 35 130 68" fill="#7fbf8e"/>':
 kind==='armory'?mode==='unbuilt'?'<path d="M17 70V38L80 15L143 38V70" fill="none" stroke="#7899ba" stroke-width="3" stroke-dasharray="7 6"/>':'<path d="M17 70V38L80 15L143 38V70Z" fill="#42566f" stroke="#c3def1" stroke-width="3"/><path d="M60 70V40H100V70" fill="#12283b"/>':
 '<path d="M35 70V23L80 7L125 23V70Z" fill="#244b63" stroke="#a4e2dd" stroke-width="3"/><rect x="62" y="35" width="36" height="31" fill="#0a2336"/>';
 const engineeringMark=engineering?'<path d="M15 14H52M109 14H145M15 18H39M121 18H145" fill="none" stroke="#b5b1ff" stroke-width="3"/><rect x="73" y="9" width="14" height="10" rx="2" fill="#b5b1ff"/>':'';
 const upgrade=mode==='upgraded'?'<path d="M17 31L45 13L70 30L104 13L143 30" fill="none" stroke="#ffd581" stroke-width="4"/><circle cx="92" cy="50" r="8" fill="#ffd581"/>':'';
 return '<svg viewBox="0 0 160 82" role="img" aria-label="'+esc(mode==='unbuilt'?'未建造藍圖':mode==='upgraded'?'已升級設施':'營地設施')+'" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="70" width="152" height="8" rx="3" fill="#38526b"/>'+decoration+upgrade+engineeringMark+'</svg>';}
function card(v,kind){const b=v.base,m=kind==='recycle'?(b.recycle_upgraded?'upgraded':'basic'):kind==='supply'?(b.supply_built?(b.supply_upgraded?'upgraded':'built'):'unbuilt'):kind==='armory'?(b.armory_built?'built':'unbuilt'):(b.duty_workers?'staffed':'basic');
 const name=({recycle:'回收工具台',supply:'補給棚',armory:'整備艙',command:'指揮記錄桌'})[kind];let face='',detail='';
 if(kind==='recycle'){face=assignFace(v,'recycle','回收廠');detail='<p>每30秒每位回收工人＋1合金。深拆成本6合金，仍須有工人及值守才會額外產出。</p>'+(b.recycle_upgraded?'已完成深拆':btn('upgrade','深拆升級 · 合金6',b.alloy>=6,'data-r-facility="recycle"','合金不足'));}
 if(kind==='supply'){face=assignFace(v,'supply','補給棚');detail='<p>建造成本5合金。建成後工人每30秒各＋2口糧；密植需4合金並有工人和值守。</p>'+(!b.supply_built?btn('build','建造補給棚 · 合金5',b.alloy>=5,'data-r-facility="supply"','合金不足'):b.supply_upgraded?'已完成密植':btn('upgrade','密植升級 · 合金4',b.alloy>=4,'data-r-facility="supply"','合金不足'));}
 if(kind==='armory'){face='<div class="r-army">巡衛 '+b.patrols+' · 守陣 '+b.wards+'</div>';detail=!b.armory_built?btn('build','建造整備艙 · 合金8',b.alloy>=8,'data-r-facility="armory"','合金不足'):'<p>裝備整理及30秒訓練／遣返，不增加兵員名額。</p>'+[
 ['train','patrol','訓練巡衛 · 糧3 金2',b.standby>=1&&b.rations>=3&&b.alloy>=2&&!b.training],['train','ward','訓練守陣 · 糧4 金1',b.standby>=1&&b.rations>=4&&b.alloy>=1&&!b.training],['recall','patrol','巡衛遣返1人',b.patrols>=1&&!b.recalling],['recall','ward','守陣遣返1人',b.wards>=1&&!b.recalling]
 ].map(([a,u,t,ok])=>btn(a,t,ok,'data-r-unit="'+u+'"','需足夠兵員／資源及空閒隊列')).join('');}
 if(kind==='command'){face=assignFace(v,'duty','指揮艙值守');detail='<p>指揮桌開局已有。值守兵員0／1；符合深拆或密植條件才有原有產出加成。</p>';}
 const state=kind==='armory'?b.armory_built?'已建':'未建':kind==='supply'?b.supply_built?b.supply_upgraded?'密植完成':'已建':'未建':kind==='recycle'?b.recycle_upgraded?'深拆完成':'可升級':b.duty_workers?'正在值守':'目前無值守';
 const project=Object.keys(v.companions).filter(id=>v.companions[id].project!==null).map(id=>({id,name:people[id].name}));
 const associated={recycle:['SCR'],supply:['WAT'],armory:['GATE'],command:['MED','RAD']}[kind];
 const matched=project.filter(p=>associated.includes(p.id));
 const label=matched.map(p=>p.name+'已開放工程接應線').join(' · ');
 return '<article class="r-building r-'+kind+' r-'+m+(matched.length?' r-engineered':'')+'" data-r-building="'+kind+'">'+art(kind,m,matched.length>0)+'<div class="r-building-title">'+name+'</div><p class="r-state">'+state+(label?' · '+label:'')+'</p>'+face+
 '<details class="r-building-detail"><summary>操作／成本</summary><div class="r-building-controls">'+detail+'</div></details></article>';}
function personnel(v){return '<details class="r-panel"><summary>六名兵員名冊／交班與永久傷亡</summary><ul class="r-names">'+v.roster.map(x=>'<li><strong>'+x.call+'／'+x.name+'</strong> · '+(x.alive?(x.slot==='expedition'?'外拓途中':x.slot==='standby'?'待命':x.slot==='dead'?'已犧牲':x.slot==='recycle'?'回收':x.slot==='supply'?'補給':x.slot==='duty'?'值守':x.slot==='training'?'訓練中':x.slot==='recalling'?'遣返中':x.slot==='patrol'?'巡衛':'守陣'):'永久犧牲')+'<small>'+esc(x.alive?x.daily:'此後沒有新的回覆，僅保留舊交班紀錄。')+'</small></li>').join('')+'</ul></details>';}
function base(v){return '<section><h2>岩谷臨時營地</h2><p class="r-muted">已歸隊 '+v.R+'／5 · 指揮官1人 · 兵員 '+v.B+'／6；實際在營 '+v.P+'。專業同伴不占派工格。</p><div class="r-grid">'+['recycle','supply','armory','command'].map(x=>card(v,x)).join('')+'</div>'+personnel(v)+(v.B<4?'<p class="r-warning">兵員少於4，原外拓至少出2、留2，不能由指揮官或專業同伴補位；仍可閱讀已知情報。</p>':'')+'</section>';}
function expedition(v){const e=v.expedition,b=v.base; if(e){const target=v.mission?.target,who=target?people[target]?.name:null;
 return '<section><h2>正在外拓</h2><p>已行進 '+fmt(v.time-e.started_at)+'／15:00 · 兵員 '+e.crew+'，隊上糧 '+e.rations+'、合金 '+e.alloy+'</p>'+
 '<p>本趟主要任務：'+esc(who?'接應 '+who:'採集並檢視補給線')+'</p>'+
 '<p>'+(!v.mission?'一般採集，沒有接應目標。':v.mission.reached?'已抵達核驗路線，護送途中；尚未歸隊。':'隊伍正在接近核驗路線；接觸不等於抵達。')+'</p>'+
 '<p class="r-warning">'+(e.raid.stage==='battle'?'侵略交戰中，將按真實防守人數結算。':e.raid.stage==='resolved'?'本趟侵略已結算。':'前路可能有侵略，不會提前顯示時間。')+'</p>'+
 '<p class="r-note">返航只是請求，必須等當趟排定侵略結算後才返回。</p>'+
 (e.return_requested?'<p class="r-wait">返航請求已送出；等待遭遇結算，自動返回。</p>':btn('return','要求提前返航'))+'</section>';}
 const ids=Object.keys(v.companion_views).filter(id=>v.companions[id].phase==='cooperating'&&v.companions[id].route_ready);
 return '<section><h2>準備15分鐘外拓</h2><p>出發2–4名待命兵員，基地至少留2名兵員。帶口糧4–10且基地保留4，合金最多3並遵守原留存規則。</p>'+msg(v.B<4?'目前兵員少於4，無法派遣合規外拓。':'')+
 '<div class="r-form"><label>帶出兵員<select id="reunion-crew" data-r-draft="crew">'+options(2,4,selected.crew)+'</select></label><label>攜帶口糧<select id="reunion-rations" data-r-draft="rations">'+options(4,10,selected.rations)+'</select></label><label>攜帶合金<select id="reunion-alloy" data-r-draft="alloy">'+options(0,3,selected.alloy)+'</select></label><label>主要接應目標<select id="reunion-target" data-r-draft="target"><option value="">一般外拓採集</option>'+ids.map(id=>'<option value="'+id+'"'+(id===selected.target?' selected':'')+'>'+esc(people[id].name)+' · 已核驗路線</option>').join('')+'</select></label><label class="r-route-label">可選工程接應線<select id="reunion-route" data-r-draft="route">'+routeOptions(selected.target,selected.route)+'</select></label></div><p class="r-note" data-r-route-preview>'+esc(routeBudgetText(v))+'</p>'+btn('depart','確認外拓編制並出發',!v.manual_paused&&v.B>=4&&b.standby>=2&&!b.training&&!b.recalling,'','暫停／待命／訓練條件不足')+'</section>';}
function routeOptions(target,chosen){
 const list=target?R.availableRoutes(controller.state,target):[];
 return '<option value="">普通接應路線 · 90秒 · 不額外扣費</option>'+list.map(x=>
  '<option value="'+x.id+'"'+(chosen===x.id?' selected':'')+'>'+esc(x.name)+' · '+x.seconds+'秒 · 每趟'+Object.entries(x.cost).map(([k,n])=>n+(k==='rations'?'口糧':'合金')).join('＋')+'</option>').join('');
}
function routeBudgetText(v){
 const chosen=selected.target&&selected.route?R.availableRoutes(controller.state,selected.target).find(x=>x.id===selected.route):null;
 const rc=chosen?chosen.cost:{};
 const r=v.base.rations-selected.rations-(rc.rations||0),a=v.base.alloy-selected.alloy-(rc.alloy||0);
 return '按目前編制出發後，基地口糧 '+v.base.rations+' → '+r+'，合金 '+v.base.alloy+' → '+a+(chosen?'（已含工程接應線的額外費用）':'')+(r<4||a<0?'；物資不足，請調整編制':'');
}
function refreshRouteBudget(){const node=el.querySelector('[data-r-route-preview]');if(node)node.textContent=routeBudgetText(getView());}
function refreshRouteSelection(){const node=el.querySelector('[data-r-draft="route"]');if(!node)return;
 const choices=selected.target?R.availableRoutes(controller.state,selected.target):[];
 if(selected.route&&!choices.some(x=>x.id===selected.route))selected.route='';
 node.innerHTML=routeOptions(selected.target,selected.route);node.value=selected.route;refreshRouteBudget();
}
function options(a,b,chosen){let res='';for(let i=a;i<=b;i++)res+='<option value="'+i+'"'+(i===chosen?' selected':'')+'>'+i+'</option>';return res;}
// Primary leads appear gradually. Project-specific answers are not shown until
// the supporting real evidence/project has been acquired; disabled is NOT secrecy.
function visibleLead(v,id,x){
 if(v.evidence.includes(id))return false;
 if(id==='med-plate'||id==='wat-pulse')return true; // honest starter opportunities
 if(R.sourceAllowed(controller.state,id))return true;
 return false;
}
function sourcePanel(v){return '<section><h2>岩谷採集與線索台</h2><p class="r-muted">先在工具、材料箱或水路留下來源，才可以核實失散者身分。尚未得到的工程證據不會提前展示。</p><div class="r-source-list">'+Object.entries(sources).filter(([id,x])=>visibleLead(v,id,x)).map(([id,x])=>{
 const ok=R.sourceAllowed(controller.state,id);return btn('inspect',x.label,ok,'data-r-source="'+id+'"', '需要實際來源／時間／派工或上一趟外拓紀錄');}).join('')+'</div><details><summary>已保存的來源（'+v.evidence.length+'）</summary><ul>'+v.evidence.map(id=>'<li>'+esc(sources[id].label)+'</li>').join('')+'</ul></details></section>';}
function peoplePanel(v){const list=Object.entries(v.companion_views);return '<section><h2>失聯者核實與接應</h2>'+(list.length?'':'<p>尚未找到可辨認的同伴來源。請先整理營地線索。</p>')+list.map(([id,c])=>{
 const name=c.phase==='lead'?'疑似失散同事 · '+people[id].hint:people[id].name+' · '+people[id].region;
 const phase=({lead:'待驗身分',contacted:'已聯絡，未歸隊',delayed:'協作延期／待路線核驗',refused:'需要補證後重新聯絡',cooperating:'路線已確認，等待外拓',in_transit:'護送途中，不計歸隊',returned:'真正歸隊'})[c.phase];
 let controls='';if(c.phase==='lead')controls=btn('verify','用可靠來源核實身分',true,'data-r-person="'+id+'"');
 if(c.phase==='refused'){controls+='<p class="r-warning">'+esc(c.refusal_reason)+'</p>'+btn('recheck','提交第二來源，重新與許徹談判',!v.manual_paused,'data-r-person="'+id+'"');}
 if(['contacted','delayed'].includes(c.phase)&&c.route_due_at===null){if(id==='GATE'&&c.phase==='contacted')controls+=btn('challenge','在未雙重核對前要求開閘（可能被拒絕）',!v.manual_paused,'data-r-person="'+id+'"');controls+=people[id].choices.map(([o,label])=>btn('decide',label,!v.manual_paused,'data-r-person="'+id+'" data-r-option="'+o+'"','請先恢復遊戲時間')).join('');}
 if(c.route_due_at!==null)controls+='<p>實體通路正在核查，完成後可派隊。尚未歸隊。</p>';
 if(c.phase==='cooperating')controls+='<p>已同意接應。到「外拓」選此人，走真實路線，返營才算歸隊。</p>';
 if(c.phase==='in_transit')controls+='<p>接應隊正在護送；如隊伍傷亡導致無法安全返營，需重試。</p>';
 if(c.phase==='returned'){controls+='<p>已在營地與兵員交接，仍非第七名工人。</p>'+(c.project?'<p class="r-success">工程已完成：'+esc(c.project_choice)+'</p>':people[id].projects.map(([o,label])=>btn('project',label,!v.manual_paused,'data-r-person="'+id+'" data-r-option="'+o+'"','請先恢復遊戲時間')).join(''));}
 return '<article class="r-person"><h3>'+esc(name)+'</h3><p>'+esc(phase)+'</p>'+(c.source?'<p class="r-muted">來源：'+esc(c.source.split('+').map(k=>sources[k]?.label||k).join('＋'))+'</p>':'')+controls+'</article>';}).join('')+'</section>';}
function signal(v){const h=v.hero;const hero=h.phase==='hidden'?'<p>電台只有風聲，未知來訊尚不可辨認。</p>':h.phase==='hint'?'<p>收到一段不完整的呼號，來源未明。</p>':h.phase==='ready'?'<h3>殘響的求救訊號（非招募）</h3><p>'+esc(h.introduction)+'</p>'+h.options.map(x=>btn('hero-choice',x.label,!v.manual_paused,'data-r-option="'+x.id+'"')).join(''):'<p class="r-success">已回覆 '+esc(h.choice)+'：'+esc(h.text)+'</p><p>不增加兵員、人口或資源，也不能當作尋人接應。</p>';
 return '<section>'+sourcePanel(v)+'<details class="r-panel r-hero-detail" data-r-hero-detail><summary>人格檔案／歷史訊號（可選閱讀）'+(h.phase==='ready'?' · 有可回覆訊號':'')+'</summary><div>'+hero+'</div></details>'+peoplePanel(v)+'<div class="r-panel"><h3>本期營地里程碑</h3>'+(v.milestone?'<p class="r-success">'+(v.milestone==='joint-base'?'共同基地第一期已完成；事故資料仍須互證。':'守住已知：兵員不足以出發，尚未聯絡或歸隊者仍保留真實狀態。')+'</p>':btn('milestone','記錄本期里程碑',!v.manual_paused&&((v.R>=1&&Object.values(v.companions).some(c=>c.project!==null))||(v.B<4&&v.evidence.length>0)), '', '須先重逢並完成合作，或低兵員時已保有線索'))+'</div></section>';}
function number(x,key){return x&&Object.prototype.hasOwnProperty.call(x,key)&&typeof x[key]==='number'?x[key]:'未記錄';}
function outcome(x){return x==='draw'?'打和':x==='defense_win'?'防守成功':x==='attack_win'?'防守失敗':'未記錄';}
function mail(v){const rr=v.last_report,raid=v.last_raid;const cell=(k,val)=>'<div><dt>'+k+'</dt><dd>'+esc(val)+'</dd></div>';
 const report=rr?'<section id="reunion-result" class="r-panel"><h2>最新外拓結算</h2><p>'+esc(rr.reason||'未記錄')+'</p><dl class="r-ledger">'+cell('本趟侵略結果',outcome(rr.raid?.outcome))+cell('本趟人口傷亡',number(rr.raid,'loss_crew'))+cell('本趟失去合金',number(rr.raid,'loss_alloy'))+cell('本趟失去口糧',number(rr.raid,'loss_rations'))+cell('實際返回兵員',number(rr,'returning_crew'))+cell('實際返回口糧',number(rr,'rations'))+cell('實際返回合金',number(rr,'alloy'))+cell('在外採集',number(rr,'alloy_scavenged'))+cell('途中耗糧',number(rr,'rations_consumed'))+'</dl><p class="r-muted">結算快照不等於當前人口。接應結果見下方經ID保存的故事紀錄。</p></section>':'<p>尚未有外拓結算；不會憑空展示報告。</p>';
 return '<section><h2>回報信箱</h2>'+report+'<div class="r-panel"><h3>最近一次侵略</h3>'+(raid?'<p>'+(raid.context==='base'?'留守':'外拓')+' · '+outcome(raid.outcome)+'</p><p>死亡 '+number(raid,'loss_crew')+'，損失合金 '+number(raid,'loss_alloy')+'，口糧 '+number(raid,'loss_rations')+'</p>':'尚未記錄侵略。')+'</div><details class="r-panel"><summary>營地真實事件紀錄（最新'+v.log.length+'筆）</summary><ul>'+v.log.slice(-25).reverse().map(x=>'<li>['+fmt(x.at)+'] '+esc(x.text)+'</li>').join('')+'</ul></details></section>';}
function page(v){return tab==='base'?base(v):tab==='expedition'?expedition(v):tab==='signals'?signal(v):mail(v);}
function signature(v){return [tab,v.expedition?.id||'',v.expedition?.raid.stage||'',v.base_raid_stage||'',v.last_report?.settlement_id||'',v.last_raid?.settlement_id||'',v.hero.phase,
 ...['supply_built','armory_built','recycle_upgraded','supply_upgraded'].map(k=>v.base[k]),v.base.training?'training':'',v.base.recalling?'recall':'',...Object.keys(people).map(id=>{
 const x=v.companions[id];return x.phase+':'+x.project+':'+x.route_ready;}),...Object.keys(sources).map(id=>R.sourceAllowed(controller.state,id)?'1':'0')].join('|');}
function unreadReport(v){const id=v.last_report&&v.last_report.settlement_id;return typeof id==='string'&&!!id&&id!==readReport;}
function unreadRaid(v){const id=v.last_raid&&v.last_raid.settlement_id;return typeof id==='string'&&!!id&&id!==readRaid;}
function risk(v){return v.expedition?.raid.stage==='battle'?'外拓遭襲，交戰即將結算':v.base_raid_stage==='battle'?'留守基地遭襲，交戰即將結算':v.expedition?'外拓在途，請留意侵略風險':v.hero.phase==='hint'?'來源未明的呼號':v.hero.phase==='ready'?'電台有可選回覆':unreadReport(v)?'有新的外拓結算，請看信箱':v.B<4?'兵員不足4，無法再外拓':'';}
function shell(v){const b=v.base,warning=risk(v);
 return '<div class="r-shell"><header class="r-hud"><div class="r-top"><div><small>原創離線單機 · 重逢模式</small><h1>岩谷營地</h1></div>'+btn('pause',v.manual_paused?'繼續':'暫停')+'</div><div class="r-stats" aria-label="基地資源與真實人數">'+[
 ['口糧',b.rations,'rations'],['合金',b.alloy,'alloy'],['兵員 B',v.B+'/6','B'],['實際在營 P',v.P,'P'],['指揮官 C',v.C,'C'],['已歸隊 R',v.R+'/5','R'],['編制 N',v.N,'N'],['外拓兵員 T',v.T,'T']].map(([label,n,key])=>'<div class="r-stat"><span>'+label+'</span><strong data-r-stat="'+key+'">'+esc(n)+'</strong></div>').join('')+'</div><div class="r-clock"><span data-r-time>已經過 '+fmt(v.time)+'</span><span data-r-run>'+(v.expedition?'本趟餘 '+fmt(900-(v.time-v.expedition.started_at)):'長期營地')+'</span></div><div class="r-risk" data-r-risk>'+esc(warning)+'</div></header><div id="reunion-stage" class="r-stage" tabindex="-1">'+msg(error)+page(v)+'</div><nav class="r-nav" aria-label="重逢營地四個主要頁面">'+[['base','基地'],['expedition','外拓'],['signals','電台'],['mail','信箱']].map(([id,name])=>btn('tab',name+(id==='signals'&&v.hero.phase==='ready'?' · 待回覆':id==='mail'&&unreadReport(v)?' · 新結算':unreadRaid(v)?' · 新侵略紀錄':''),true,'data-r-tab="'+id+'"'+(id===tab?' aria-current="page"':''))).join('')+'</nav></div>';}
function patchHud(v){const currentRisk=el.querySelector('[data-r-risk]');if(currentRisk)currentRisk.textContent=risk(v);const b=v.base,map={rations:b.rations,alloy:b.alloy,B:v.B+'/6',P:v.P,C:v.C,R:v.R+'/5',N:v.N,T:v.T};
 for(const [k,n]of Object.entries(map)){const x=el.querySelector('[data-r-stat="'+k+'"]');if(x)x.textContent=n;}
 const t=el.querySelector('[data-r-time]'),run=el.querySelector('[data-r-run]');if(t)t.textContent='已經過 '+fmt(v.time);if(run)run.textContent=v.expedition?'本趟餘 '+fmt(900-(v.time-v.expedition.started_at)):'長期營地';
 // 無需替換按鈕節點；只更新人數與可負擔狀態，避免移除鍵盤／觸控焦點。
  if(tab==='expedition')refreshRouteBudget();
  if(tab==='signals'){
   const list=el.querySelector('.r-source-list');
   if(list){for(const [id,source] of Object.entries(sources)){
    const node=list.querySelector('[data-r-source="'+id+'"]');
    if(node){const enabled=R.sourceAllowed(controller.state,id);node.disabled=!enabled;node.title=enabled?'':'需要實際來源／時間／派工或上一趟外拓紀錄';}
    else if(visibleLead(v,id,source)){
     const holder=document.createElement('div');
     holder.innerHTML=btn('inspect',source.label,true,'data-r-source="'+id+'"');
     const fresh=holder.querySelector('button');if(fresh)list.appendChild(fresh);
    }
   }}
  }
 if(tab==='base'){for(const f of ['recycle','supply','duty']){const n=workers(b,f),reason=assignmentReason(v,f),row=el.querySelector('[data-r-assign="'+f+'"]');if(!row)continue;
 const num=row.querySelector('[data-r-workers]'),minus=row.querySelector('[data-r-direction="minus"]'),plus=row.querySelector('[data-r-direction="plus"]'),why=row.querySelector('[data-r-assign-reason]');
 if(num)num.textContent=n+'人';if(minus){minus.disabled=n<=0;minus.dataset.rCount=String(n-1);}if(plus){plus.disabled=!!reason;plus.title=reason;plus.dataset.rCount=String(n+1);}if(why)why.textContent=reason||(!n?'目前無可調回人員':'');}
 for(const node of el.querySelectorAll('[data-r-action="build"],[data-r-action="upgrade"]')){
 const f=node.getAttribute('data-r-facility'),isBuild=node.dataset.rAction==='build';const cost=isBuild?(f==='supply'?5:8):(f==='supply'?4:6);node.disabled=b.alloy<cost;}
 }}
function captureDraft(){for(const x of el.querySelectorAll('[data-r-draft]'))selected[x.dataset.rDraft]=['target','route'].includes(x.dataset.rDraft)?x.value:Number(x.value);}
function render(full=true){if(!controller.state){intro();return;}const v=getView();if(tab==='mail'){readReport=v.last_report?.settlement_id||null;readRaid=v.last_raid?.settlement_id||null;}if(full){const sc=el.querySelector('#reunion-stage'),top=sc?sc.scrollTop:0;const heroOpen=!!el.querySelector('[data-r-hero-detail][open]');const opens={};for(const card of el.querySelectorAll('[data-r-building]')){const detail=card.querySelector('details');opens[card.getAttribute('data-r-building')]=!!(detail&&detail.hasAttribute('open'));}captureDraft();el.innerHTML=shell(v);for(const card of el.querySelectorAll('[data-r-building]'))if(opens[card.getAttribute('data-r-building')]){const detail=card.querySelector('details');if(detail)detail.setAttribute('open','');}if(heroOpen){const hd=el.querySelector('[data-r-hero-detail]');if(hd)hd.setAttribute('open','');}const stage=el.querySelector('#reunion-stage');if(stage)stage.scrollTop=top;stageSig=signature(v);}else{patchHud(v);}if(tab==='mail'){readReport=v.last_report?.settlement_id||null;readRaid=v.last_raid?.settlement_id||null;}}
function runAct(payload){const p=Object.assign({command_id:'r-'+((global.crypto&&global.crypto.randomUUID)?global.crypto.randomUUID():Date.now()+'-'+Math.random())},payload);
 const oldReport=controller.state?.op?.last_report?.settlement_id;const r=controller.act(p);if(!r.ok){error=r.error||'命令無法完成';render(true);return r;}error='';if(controller.state?.op?.last_report?.settlement_id!==oldReport&&controller.state?.op?.last_report){tab='mail';}render(true);return r;}
function handleClick(x){const action=x.getAttribute('data-r-action');if(!action)return;if(x.disabled)return;
 if(action==='intro-next'){introIndex=Math.min(3,introIndex+1);intro();return;}
 if(action==='enter'||action==='continue'){const r=action==='enter'?controller.create():controller.continue();if(!r.ok){error=r.error;intro();return;}error='';tab='base';render(true);return;}
 if(action==='tab'){tab=x.getAttribute('data-r-tab');render(true);const y=el.querySelector('#reunion-stage');if(y)y.scrollTop=0;return;}
 if(action==='pause'){const r=controller.setPaused(!controller.state.manual_paused);if(!r.ok)error=r.error;else error='';render(true);return;}
 if(action==='assign')return runAct({type:'assign',facility:x.getAttribute('data-r-facility'),count:Number(x.getAttribute('data-r-count'))});
 if(action==='build'||action==='upgrade')return runAct({type:action,facility:x.getAttribute('data-r-facility')});
 if(action==='train'||action==='recall')return runAct({type:action,unit:x.getAttribute('data-r-unit'),...(action==='recall'?{count:1}:{})});
 if(action==='depart'){captureDraft();return runAct({type:'depart',crew:selected.crew,rations:selected.rations,alloy:selected.alloy,target:selected.target||null,route:selected.route||null});}
 if(action==='return')return runAct({type:'return'});
 if(action==='milestone')return runAct({type:'milestone'});
 if(action==='inspect')return runAct({type:'inspect',source:x.getAttribute('data-r-source')});
 if(action==='verify'||action==='decide'||action==='project'||action==='challenge'||action==='recheck')return runAct({type:action,person:x.getAttribute('data-r-person'),option:x.getAttribute('data-r-option')});
 if(action==='hero-choice')return runAct({type:'hero_choice',choice_id:x.getAttribute('data-r-option')});}
el.addEventListener('click',ev=>{const b=ev.target.closest('[data-r-action]');pointerSequencePending=false;if(!b){if(pendingRender&&!pointerDown){pendingRender=false;render(true);}return;}ev.preventDefault();pendingRender=false;handleClick(b);});
el.addEventListener('change',ev=>{if(ev.target.hasAttribute('data-r-draft')){captureDraft();if(ev.target.dataset.rDraft==='target')refreshRouteSelection();else refreshRouteBudget();}});
el.addEventListener('pointerdown',()=>{pointerDown=true;pointerSequencePending=false;});
// pointerup is followed by a native click. Preserve the target even on touch
// devices that do not focus the button on pointerdown. The click commits first.
// For a canceled/outside tap with no click, an animation frame + short timeout
// eventually releases a stale structural refresh; never flush synchronously.
function release(){if(!pointerDown)return;pointerDown=false;pointerSequencePending=true;
 if(typeof global.requestAnimationFrame==='function')global.requestAnimationFrame(()=>{
  if(typeof global.setTimeout==='function')global.setTimeout(()=>{
   if(pointerSequencePending){pointerSequencePending=false;if(pendingRender){pendingRender=false;render(true);}}
  },100);
 });
}
function cancelPointer(){pointerDown=false;pointerSequencePending=false;if(pendingRender){pendingRender=false;render(true);}}
el.addEventListener('pointerup',release);el.addEventListener('pointercancel',cancelPointer);
if(typeof document.addEventListener==='function')document.addEventListener('pointerup',release);
el.addEventListener('focusout',()=>{if(pendingRender)global.setTimeout(()=>{if(!el.contains(document.activeElement)){pendingRender=false;render(true);}},0);});
function tick(){if(!controller.state||document.hidden)return;const r=controller.tick();if(!r.ok){error=r.error;render(true);return;}
 const v=getView(),sig=signature(v);if(sig!==stageSig){const focus=document.activeElement;
 if(pointerDown||pointerSequencePending||(focus&&el.contains(focus)&&['BUTTON','SELECT','INPUT'].includes(focus.tagName))){pendingRender=true;patchHud(v);return;}render(true);return;}
 patchHud(v);}
if(typeof global.setInterval==='function')global.setInterval(tick,250);
if(typeof document.addEventListener==='function')document.addEventListener('visibilitychange',()=>{if(!controller.state)return;
 if(document.hidden){const r=controller.detach();if(!r.ok)error=r.error;}else{const r=controller.resumeVisible();if(!r.ok)error=r.error;render(true);}});
if(typeof global.addEventListener==='function')global.addEventListener('pagehide',()=>{if(controller.state)controller.detach();});
intro();const api={controller,render,tick,handleClick,getView,selected};if(global.__REUNION_TEST__===true)global.__TEST_REUNION_UI__=api;return api;
});
