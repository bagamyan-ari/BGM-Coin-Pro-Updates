let data=[],selected=null,filter='all',period='1h',exchange=null,candles=[],query='',lastCandleUpdate=0,chartRequestId=0,scanInFlight=false,stateSort=0,tableSort={key:null,dir:-1},lastScanAt=0,nextScanAt=0,chartAbort=null;
const FAVORITES_KEY='bgm_favorites_v1';
const getFavorites=()=>{try{return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY)||'[]'))}catch(_){return new Set()}};
const isFavorite=c=>getFavorites().has(String(c||'').toUpperCase());
function toggleFavorite(c){const k=String(c||'').toUpperCase(),f=getFavorites();f.has(k)?f.delete(k):f.add(k);localStorage.setItem(FAVORITES_KEY,JSON.stringify([...f]));renderRows();renderFavorites();renderGainers();}
const $=id=>document.getElementById(id), compact=n=>{n=Number(n);if(n>=1e9)return (n/1e9).toFixed(2)+'B';if(n>=1e6)return (n/1e6).toFixed(2)+'M';if(n>=1e3)return (n/1e3).toFixed(2)+'K';return n.toFixed(2)}, priceDigits=n=>{n=Math.abs(Number(n));return n>=1000?2:n>=100?3:n>=10?4:n>=1?5:n>=.1?6:n>=.01?7:8}, fmt=n=>Number(n).toLocaleString('tr-TR',{maximumFractionDigits:n<.01?8:n<1?6:n<10?5:n<100?4:2}),money=n=>(exchange==='tr'?'₺':'$')+Number(n).toLocaleString('tr-TR',{minimumFractionDigits:0,maximumFractionDigits:priceDigits(n)});let usdTryRate=null;const miniUsd=n=>(exchange==='tr'&&Number(usdTryRate)>0&&Number(n)>=0)?'<small class=\"mini-usd\">≈ $'+(Number(n)/Number(usdTryRate)).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:priceDigits(Number(n)/Number(usdTryRate))})+'</small>':'';const moneyHtml=n=>money(n)+miniUsd(n);
function status(s){$('connection-text').textContent=s}
function rsiNote(v){v=Number(v);if(!Number.isFinite(v))return '';if(v>=75)return ' · 🟠 AŞIRI ISINMIŞ';if(v>=55)return ' · 🟢 SAĞLIKLI/GÜÇLÜ';if(v>=45)return ' · ⚪ NÖTR';if(v>=30)return ' · 🟡 ZAYIF';return ' · 🔴 AŞIRI ZAYIF';}
function macdNote(m){const h=Number(m.macd_hist),d=m.macd_direction;if(!Number.isFinite(h))return '';if(h>0&&d==='artıyor')return ' · 🟢 POZİTİF VE GÜÇLENİYOR';if(h>0&&d==='azalıyor')return ' · 🟡 POZİTİF AMA ZAYIFLIYOR';if(h<0&&d==='artıyor')return ' · 🟡 NEGATİF AMA TOPARLANIYOR';if(h<0&&d==='azalıyor')return ' · 🔴 NEGATİF VE ZAYIFLIYOR';return ' · ⚪ NÖTR';}
function volumeNote(r){r=Number(r);if(!Number.isFinite(r))return '';if(r>=2)return ' · 🟢 HACİM BELİRGİN YÜKSEK (YÖN FİYATLA TEYİT EDİLMELİ)';if(r>=1.2)return ' · 🟡 HACİM ORTALAMANIN ÜSTÜNDE';if(r>=.7)return ' · ⚪ HACİM NORMAL';return ' · 🔴 HACİM ZAYIF';}
function atrNote(a,p){a=Number(a);p=Number(p);if(!(a>0&&p>0))return '';const q=a/p*100;if(q<.35)return ` · 🔴 HAREKET ÇOK DÜŞÜK · ATR %${q.toFixed(2)}`;if(q<.8)return ` · 🟡 HAREKET DÜŞÜK · ATR %${q.toFixed(2)}`;if(q<3)return ` · 🟢 HAREKET YETERLİ · ATR %${q.toFixed(2)}`;return ` · 🟠 ÇOK HAREKETLİ/RİSKLİ · ATR %${q.toFixed(2)}`;}
function renderRows(){
// V0.6.65: Arama Radar filtresinden BAGIMSIZDIR. Tarama evreninde analiz edilen coin araninca her durumda gosterilir.
const searching=Boolean(query);
let rows=data.filter(x=>{
 const name=(String(x.coin||'')+' '+String(x.symbol||'')).toLowerCase();
 if(searching) return name.includes(query);
 return !x.dormant&&(filter==='all'||x.state===filter||(filter==='new'&&x.new));
});
rows=rows.map(x=>{const m=bgmRadarMovement(x);x._moveScore=m.score;x._moveLabel=m.label;return x;});
if(!searching) rows=rows.filter(x=>{
 const mv=Number(x._moveScore||0), vol=Number(x.volume||0), ch=Math.abs(Number(x.chg||0));
 const active=(mv>=40 && vol>=0.80 && ch>=0.75);
 const waking=(mv>=55 && vol>=1.20 && ch>=0.35);
 return active||waking;
});
if(!stateSort&&!tableSort.key)rows=[...rows].sort((a,b)=>{
 // V0.6.57: BGM Trader ana siralamasi = karar sinifi > firsat > guven > potansiyel > eski Radar.
 const ak=[Number(a.trader_rank||0),Number(a.opportunity_score||0),Number(a.confidence_score||0),Number(a.potential_score||0),Number(a.radar_score||0)];
 const bk=[Number(b.trader_rank||0),Number(b.opportunity_score||0),Number(b.confidence_score||0),Number(b.potential_score||0),Number(b.radar_score||0)];
 for(let i=0;i<ak.length;i++){if(bk[i]!==ak[i])return bk[i]-ak[i];}
 return 0;
});if(tableSort.key){const statusRank={confirmed:4,preparing:3,wait:2,unavailable:1};const val=(x,k)=>k==='coin'?String(x.coin||''):k==='movement'?Number(x._moveScore||0):k==='status'?Number(statusRank[x.state]||0):Number(x[k]??0);rows=[...rows].sort((a,b)=>{const av=val(a,tableSort.key),bv=val(b,tableSort.key);const d=tableSort.key==='coin'?av.localeCompare(bv,'tr'):(av-bv);return d*tableSort.dir;});}else if(stateSort){const rank={confirmed:0,preparing:1,wait:2,unavailable:3};rows=[...rows].sort((a,b)=>{const d=(rank[a.state]??9)-(rank[b.state]??9);return stateSort===1?(d||((b.radar_score??0)-(a.radar_score??0))):(-d||((b.radar_score??0)-(a.radar_score??0)))});}$('coin-rows').innerHTML=rows.map((x,i)=>`<tr data-coin="${x.coin}" class="${selected&&selected.coin===x.coin?'selected':''}"><td>${i+1}</td><td><button class="fav-star" data-fav="${x.coin}" title="Favori">${isFavorite(x.coin)?'★':'☆'}</button></td><td><b>${x.coin}</b><span style="color:#70889d"> / ${exchange==='tr'?'TRY':'USDT'}</span></td><td><div class="trader-cell"><b>${x.trader_label||'—'}</b><small>${x.trader_short||((x.trader_positive||[])[0]||'veri değerlendiriliyor')}</small></div></td><td><b>${Number(x.opportunity_score||0)}/100</b></td><td><b>${Number(x.confidence_score||0)}/100</b></td><td>${moneyHtml(x.price)}</td><td class="${x.chg>=0?'up':'down'}">${x.chg>=0?'+':''}${x.chg.toFixed(2)}%</td><td>${x.strength}/100</td><td>${x.entry}/100</td><td>${x.preparation}/100</td><td>${x.confirmation}/100</td><td>${(x.radar_score??0).toFixed(1)}</td><td><b>${Number(x.potential_score||0)}/100</b></td><td><b>${Number(x.jump_score||0)}/100</b></td><td><b>${exchange==='tr'?'₺':''}${compact(Number(x.quote_volume||0))}</b></td><td><div class="radar-ind"><b class="${x.volume_direction==='ALIM'?'up':x.volume_direction==='SATIS'?'down':''}">${x.volume_direction==='ALIM'?'🟢 ALIM':x.volume_direction==='SATIS'?'🔴 SATIŞ':'🟡 KARIŞIK'}</b><small>%${Number(x.buy_volume_share||50).toFixed(0)} yukarı mum hacmi</small></div></td><td><div class="radar-ind"><b>${x._moveScore}/100</b><small>${Math.abs(Number(x.chg||0))<0.35?'SIKIŞIK':(Number(x.chg||0)>0?'↑ ':'↓ ')+x._moveLabel} · 24S ${Math.abs(Number(x.chg||0)).toFixed(2)}%</small></div></td><td><div class="radar-ind"><b class="${Number(x.macd_hist)>=0?'up':'down'}">${x.macd_hist==null?'—':fmt(x.macd_hist)}</b><small>${x.macd_direction||'—'}</small></div></td><td><div class="radar-ind"><b>${Number(x.volume||0).toFixed(2)}×</b><small>${Number(x.volume||0)>=1.5?'GÜÇLÜ':Number(x.volume||0)>=1?'NORMAL+':'ZAYIF'}</small></div></td><td><div class="trader-wait">${x.trader_wait||'—'}</div></td></tr>`).join('')||'<tr><td colspan="13">Bu filtre için sonuç yok.</td></tr>' ;document.querySelectorAll('#coin-rows tr[data-coin]').forEach(tr=>tr.onclick=e=>{if(e.target.closest('.fav-star'))return;select(data.find(x=>x.coin===tr.dataset.coin))});document.querySelectorAll('#coin-rows .fav-star').forEach(b=>b.onclick=e=>{e.stopPropagation();toggleFavorite(b.dataset.fav)})}

function renderFavorites(){const body=$('favorite-rows');if(!body)return;const f=getFavorites();const rows=data.filter(x=>f.has(String(x.coin||'').toUpperCase()));body.innerHTML=rows.map(x=>`<tr data-symbol="${x.symbol}"><td><button class="fav-star" data-fav="${x.coin}">★</button></td><td><b>${x.coin}</b></td><td>${moneyHtml(x.price)}</td><td class="${Number(x.chg)>=0?'up':'down'}">${Number(x.chg)>=0?'+':''}${Number(x.chg||0).toFixed(2)}%</td><td>${x.trader_label||'—'}</td><td>${Number(x.opportunity_score||0)}/100</td><td>${Number(x.confidence_score||0)}/100</td></tr>`).join('')||'<tr><td colspan="7">Henüz favori coin yok.</td></tr>';body.querySelectorAll('.fav-star').forEach(b=>b.onclick=e=>{e.stopPropagation();toggleFavorite(b.dataset.fav)});body.querySelectorAll('tr[data-symbol]').forEach(tr=>tr.onclick=e=>{if(e.target.closest('.fav-star'))return;const x=data.find(v=>v.symbol===tr.dataset.symbol);if(x)select(x)})}
function renderGainers(){const body=$('gainer-rows');if(!body)return;let rows=data.filter(x=>x.analyzed&&Number(x.chg)>0);rows.sort((a,b)=>{const aq=Number(a.opportunity_score||0)+Number(a.confidence_score||0)-Number(a.jump_score||0)*.35,bq=Number(b.opportunity_score||0)+Number(b.confidence_score||0)-Number(b.jump_score||0)*.35;return bq-aq||Number(b.chg)-Number(a.chg)});rows=rows.slice(0,30);body.innerHTML=rows.map((x,i)=>`<tr data-symbol="${x.symbol}"><td>${i+1}</td><td><button class="fav-star" data-fav="${x.coin}">${isFavorite(x.coin)?'★':'☆'}</button></td><td><b>${x.coin}</b></td><td>${moneyHtml(x.price)}</td><td class="up">+${Number(x.chg||0).toFixed(2)}%</td><td>${Number(x.opportunity_score||0)}/100</td><td>${Number(x.confidence_score||0)}/100</td><td>${x.volume_direction||'—'} · %${Number(x.buy_volume_share||50).toFixed(0)}</td><td>${Number(x.volume||0).toFixed(2)}×</td><td>${Number(x.jump_score||0)>=70?'🟠 KOVALAMA':(x.trader_label||'—')}</td></tr>`).join('')||'<tr><td colspan="10">Yükselen coin bulunamadı.</td></tr>';body.querySelectorAll('.fav-star').forEach(b=>b.onclick=e=>{e.stopPropagation();toggleFavorite(b.dataset.fav)});body.querySelectorAll('tr[data-symbol]').forEach(tr=>tr.onclick=e=>{if(e.target.closest('.fav-star'))return;const x=data.find(v=>v.symbol===tr.dataset.symbol);if(x)select(x)})}
function reactionProfile(x){
 const ch=Number(x.chg||0), rsi=Number(x.rsi||0), vol=Number(x.volume||0), move=Number(x.movement_score||0), qv=Number(x.quote_volume||0);
 const hist=Number(x.macd_hist||0), prev=Number(x.macd_hist_previous||0), rising=(x.macd_direction==='artıyor'||hist>prev);
 const price=Number(x.price||0), ma7=Number(x.ma7||0), shortTurn=(price>0&&ma7>0&&price>=ma7);
 const vdir=x.volume_direction||'KARISIK', buyShare=Number(x.buy_volume_share||50);
 const oversold=rsi<30, healthyTurn=rsi>=32&&rsi<=52;
 const rsiScore=healthyTurn?Math.max(35,100-Math.abs(rsi-40)*4):(oversold?25:16);
 const relVolScore=Math.min(100,Math.max(0,(vol-.65)/1.85*100));
 const liqScore=exchange==='tr'?Math.min(100,Math.max(0,(Math.log10(Math.max(qv,1))-6.3)/1.7*100)):Math.min(100,Math.max(0,(Math.log10(Math.max(qv,1))-6)/2.5*100));
 const macdScore=rising?(hist>=0?88:64):(hist>=0?36:8), stabilizeScore=shortTurn?90:24;
 const dirScore=vdir==='ALIM'?92:vdir==='SATIS'?18:Math.max(35,Math.min(68,35+(buyShare-40)*1.4));
 let base=.17*rsiScore+.21*macdScore+.12*relVolScore+.14*liqScore+.18*stabilizeScore+.12*dirScore+.06*Math.min(100,Math.max(0,move));
 if(ch<=-8)base-=8;if(vol<.80)base-=9;if(!rising&&!shortTurn)base-=13;if(vdir==='SATIS')base-=15;if(buyShare<48)base-=9;
 if(exchange==='tr'&&qv<5_000_000)base=Math.min(base,55);else if(exchange==='tr'&&qv<10_000_000)base=Math.min(base,67);
 const opportunity=Math.round(Math.max(0,Math.min(100,base + (Math.abs(ch)>=2&&Math.abs(ch)<=6?5:0) + (oversold?2:0))));
 let confidence=.26*macdScore+.24*dirScore+.20*liqScore+.16*stabilizeScore+.14*relVolScore;
 if(!rising)confidence-=8;if(buyShare<50)confidence-=8;if(vdir==='SATIS')confidence-=12;
 confidence=Math.round(Math.max(0,Math.min(100,confidence)));
 let state,label,rank;
 const near=opportunity>=72&&confidence>=65&&rising&&shortTurn&&vol>=1&&rsi>=32&&rsi<=55&&buyShare>=58&&vdir!=='SATIS';
 const early=opportunity>=64&&confidence>=55&&rising&&vol>=1&&buyShare>=55&&vdir!=='SATIS';
 if(near){state='confirmed';label='🟢 TEPKİYE EN YAKIN';rank=5;}
 else if(early){state='confirmed';label='🔥 ERKEN DÖNÜŞ';rank=4;}
 else if(opportunity>=48&&(rising||shortTurn)&&vol>=.80){state='preparing';label='🟡 SATIŞ ZAYIFLIYOR';rank=3;}
 else if(oversold||opportunity>=38){state='dipwatch';label='🔵 DİP İZLE';rank=2;}
 else {state='wait';label='🔴 DÜŞÜŞ SÜRÜYOR';rank=1;}
 const risks=[];
 if(buyShare<50)risks.push(`alım hacmi zayıf (%${buyShare.toFixed(0)})`);
 if(!rising)risks.push('MACD ivmesi zayıflıyor');
 if(vol<1)risks.push(`VOL düşük (${vol.toFixed(2)}x)`);
 if(exchange==='tr'&&qv<10_000_000)risks.push('TRY likiditesi düşük');
 let wait='';
 const needs=[];
 if(buyShare<58)needs.push(`alım hacmi %${Math.max(58,Math.ceil(buyShare+3))}+`);
 if(!rising)needs.push('MACD yukarı dönmeli');
 if(!shortTurn)needs.push('kısa vade fiyat dönüşü');
 if(vol<1)needs.push('VOL 1.00x+');
 wait=needs.length?needs.slice(0,2).join(' + '):'dönüş yapısı korunmalı';
 return {score:opportunity,opportunity,confidence,state,label,rank,wait,risk:risks.slice(0,2).join(' · ')};
}
function renderLosers(){
 const body=$('loser-rows'); if(!body)return;
 let rows=data.filter(x=>x.analyzed&&Number(x.chg)<0).map(x=>({...x,_reaction:reactionProfile(x)}));
 rows.sort((a,b)=>b._reaction.rank-a._reaction.rank||b._reaction.opportunity-a._reaction.opportunity||b._reaction.confidence-a._reaction.confidence||a.chg-b.chg); rows=rows.slice(0,30);
 body.innerHTML=rows.map((x,i)=>`<tr data-symbol="${x.symbol}"><td>${i+1}</td><td><b>${x.coin}</b><span style="color:#70889d"> / ${exchange==='tr'?'TRY':'USDT'}</span></td><td>${moneyHtml(x.price)}</td><td class="down">${Number(x.chg).toFixed(2)}%</td><td><b>${x._reaction.opportunity}/100</b></td><td><b>${x._reaction.confidence}/100</b></td><td>${Number(x.rsi||0).toFixed(1)}</td><td><div class="radar-ind"><b class="${Number(x.macd_hist)>=0?'up':'down'}">${x.macd_hist==null?'—':fmt(x.macd_hist)}</b><small>${x.macd_direction||'—'}</small></div></td><td>${Number(x.volume||0).toFixed(2)}×</td><td><b>${exchange==='tr'?'₺':''}${compact(Number(x.quote_volume||0))}</b></td><td><div class="radar-ind"><b class="${x.volume_direction==='ALIM'?'up':x.volume_direction==='SATIS'?'down':''}">${x.volume_direction==='ALIM'?'🟢 ALIM':x.volume_direction==='SATIS'?'🔴 SATIŞ':'🟡 KARIŞIK'}</b><small>%${Number(x.buy_volume_share||50).toFixed(0)}</small></div></td><td><div class="radar-ind"><span class="tag ${x._reaction.state}">${x._reaction.label}</span><small>${x._reaction.risk||'veriler uyumlu'}</small></div></td><td><div class="trader-wait">${x._reaction.wait}</div></td></tr>`).join('')||'<tr><td colspan="13">Şu anda düşüşte analiz edilebilir coin bulunamadı.</td></tr>';
 body.querySelectorAll('tr[data-symbol]').forEach(tr=>tr.onclick=()=>{const x=data.find(v=>v.symbol===tr.dataset.symbol);if(x){select(x);$('chart').scrollIntoView({behavior:'smooth',block:'center'});}});
 const c={near:rows.filter(x=>x._reaction.label.includes('EN YAKIN')).length,early:rows.filter(x=>x._reaction.label.includes('ERKEN')).length,weak:rows.filter(x=>x._reaction.state==='preparing').length,dip:rows.filter(x=>x._reaction.state==='dipwatch').length,fall:rows.filter(x=>x._reaction.state==='wait').length};
 $('loser-foot').textContent=`İlk ${rows.length} negatif coin · Tepkiye en yakın: ${c.near} · Erken dönüş: ${c.early} · Satış zayıflıyor: ${c.weak} · Dip izle: ${c.dip} · Düşüş sürüyor: ${c.fall} · Trader Tepki Kararı alım emri değildir.`;
}

function renderPlan(x,livePrice=null){
 const current=Number.isFinite(Number(livePrice))&&Number(livePrice)>0?Number(livePrice):Number(x.price);
 const breakout=Number(x.breakout_level), support=Number(x.support_level), atr=Number(x.atr)||0;
 const hasBreakout0=Number.isFinite(breakout)&&breakout>0, hasSupport0=Number.isFinite(support)&&support>0;
 const refEntry=(hasSupport0&&support<current) ? Math.max(support,current-Math.max(atr*.35,current*.004)) : current; // V1.0.3: referans alım canlı fiyattan kopmaz; kırılım seviyesi ayrı senaryo olarak kalır
 const valid=!!x.plan_valid, hasBreakout=Number.isFinite(breakout)&&breakout>0, hasSupport=Number.isFinite(support)&&support>0;
 const belowBreakout=hasBreakout&&current<breakout, aboveBreakout=hasBreakout&&current>=breakout;
 const nearSupport=hasSupport&&Math.abs(current-support)<=Math.max(atr*.75,current*.012);
 const nearBreakout=hasBreakout&&Math.abs(current-breakout)<=Math.max(atr*.75,current*.008);
 const chased=valid&&aboveBreakout&&current>breakout+Math.max(atr*1.15,breakout*.018);
 let strategy='HENÜZ YOK', decision='🟡 BEKLE', reason='Şu anda giriş koşulları tamamlanmadı.', next='Uygun kurulum bekleniyor', planActive=false;
 if(x.dormant){decision='⚫ HAREKETSİZ · İŞLEM YOK';reason='Fiyat hareketi yetersiz. MACD/puan iyi görünse bile gerçek fiyat hareketi oluşmadan Radar bunu fırsat saymaz.';next='Fiyat aralığı + hacim birlikte canlanmalı';x.radar_label='HAREKETSİZ · RADAR DIŞI';}
 else if(!valid){decision='🟡 BEKLE';reason=x.plan_note||reason;next=hasBreakout?money(breakout)+' üzeri teyit veya destek dönüşü':'Uygun kurulum bekleniyor';x.radar_label=(x.strategy_type==='RETEST'?'RETEST BEKLE':x.strategy_type==='KIRILIM'?'KIRILIM BEKLE':x.strategy_type==='DESTEK'?'DESTEK · DÖNÜŞ BEKLE':'BEKLE · KURULUM YOK');}
 else if(chased){strategy='RETEST';decision='🔴 ŞİMDİ ALMA · FİYATI KOVALAMA';reason='Fiyat giriş bölgesinden uzaklaştı; mevcut risk/getiri zayıfladı.';next=money(breakout)+' civarında retest + tutunma';x.radar_label='KOVALAMA · RETEST BEKLE';}
 else if(x.state==='confirmed'&&belowBreakout){strategy='RETEST';decision='🟡 RETEST BEKLE · TEYİT KAYBOLDU';reason='Canlı fiyat kırılım seviyesinin altına döndü. Radar teyidi canlıda artık aktif giriş değildir.';next=money(breakout)+' üzeri yeniden tutunma/teyit';x.radar_label='RETEST BEKLE · TEYİT KAYBOLDU';}
 else if(aboveBreakout&&x.state==='confirmed'&&nearBreakout){strategy='RETEST';decision='🟢 RETEST GİRİŞİ UYGUN';reason='Kırılım korunuyor ve fiyat kırılan seviyeye yakın; retest senaryosu aktif.';next='Kırılım seviyesi altına kalıcı sarkma olmamalı';planActive=true;x.radar_label='RETEST GİRİŞİ UYGUN';}
 else if(aboveBreakout&&x.state==='confirmed'){strategy='KIRILIM';decision='🟢 KIRILIM GİRİŞİ UYGUN';reason='Canlı fiyat kırılım üzerinde ve teyit korunuyor.';next='Kırılım üzeri korunmalı';planActive=true;x.radar_label='KIRILIM GİRİŞİ UYGUN';}
 else if(nearSupport&&x.macd_direction==='artıyor'&&Number(x.rsi)>=42&&Number(x.rsi)<=64){strategy='DESTEK';decision='🟡 DESTEK DÖNÜŞÜ BEKLE';reason='Fiyat desteğe yakın; ucuz olması tek başına yeterli değil.';next='Destekte tutunma + 15m momentum dönüşü';x.radar_label='DESTEK · DÖNÜŞ BEKLE';}
 else {next=hasBreakout?money(breakout)+' kırılımını veya destek dönüşünü bekle':'Uygun kurulum bekleniyor';x.radar_label='BEKLE · KURULUM YOK';}
 $('entry-live-state').textContent=decision;
 $('live-price-line').innerHTML='Canlı: '+moneyHtml(current)+(strategy!=='HENÜZ YOK'?' · Senaryo: '+strategy:'');
 $('decision-reason').textContent='Neden? '+reason;
 $('next-action').textContent=next;
 const activeEntry=Number(x.plan_buy)>0?Number(x.plan_buy):refEntry;
 const planMode=localStorage.getItem('bgm_plan_mode')||'auto';
 const manualStop=Math.max(.1,Number(localStorage.getItem('bgm_stop_pct')||3)), manualT1=Math.max(.1,Number(localStorage.getItem('bgm_t1_pct')||5)), manualT2=Math.max(manualT1,Number(localStorage.getItem('bgm_t2_pct')||9));
 const positionAmount=Math.max(1,Number(localStorage.getItem('bgm_plan_position_amount')||30000));
 const stopAmount=Math.max(0,Number(localStorage.getItem('bgm_stop_amount')||1000)), t1Amount=Math.max(0,Number(localStorage.getItem('bgm_t1_amount')||1500)), t2Amount=Math.max(t1Amount,Number(localStorage.getItem('bgm_t2_amount')||3000));
 const amountStopPct=Math.min(99,stopAmount/positionAmount*100), amountT1Pct=t1Amount/positionAmount*100, amountT2Pct=t2Amount/positionAmount*100;
 const refRisk=Math.max(atr>0?atr*1.15:refEntry*.018,refEntry*.012);
 const refStop=(hasSupport&&support<refEntry)?Math.min(refEntry-refRisk*.65,support-Math.max(atr*.15,refEntry*.002)):refEntry-refRisk;
 const riskDist=Math.max(refEntry-refStop,refEntry*.008);
 const refT1=refEntry+riskDist*2;
 const refT2=refEntry+riskDist*3;
 $('active-entry-simple').innerHTML=moneyHtml(planActive?activeEntry:refEntry);
 const shownEntry=planActive?activeEntry:refEntry;
 const shownStop=planMode==='manual'?shownEntry*(1-manualStop/100):planMode==='manual_amount'?shownEntry*(1-amountStopPct/100):(planActive&&x.plan_stop!=null?Number(x.plan_stop):refStop);
 const shownT1=planMode==='manual'?shownEntry*(1+manualT1/100):planMode==='manual_amount'?shownEntry*(1+amountT1Pct/100):(planActive&&x.plan_target!=null?Number(x.plan_target):refT1);
 const shownT2=planMode==='manual'?shownEntry*(1+manualT2/100):planMode==='manual_amount'?shownEntry*(1+amountT2Pct/100):(planActive&&x.plan_target2!=null?Number(x.plan_target2):refT2);
 $('simple-stop').innerHTML=moneyHtml(shownStop);
 $('simple-target1').innerHTML=moneyHtml(shownT1);
 $('simple-target2').innerHTML=moneyHtml(shownT2);
 $('simple-plan-note').textContent=planMode==='manual'?`MANUEL % · Stop %${manualStop} · H1 %${manualT1} · H2 %${manualT2}.`:(planMode==='manual_amount'?`MANUEL RAKAM · Pozisyon ${money(positionAmount)} · Maks zarar ${money(stopAmount)} = %${amountStopPct.toFixed(2)} → Stop ${money(shownStop)} · H1 kâr ${money(t1Amount)} = %${amountT1Pct.toFixed(2)} → Emir ${money(shownT1)} · H2 kâr ${money(t2Amount)} = %${amountT2Pct.toFixed(2)} → Emir ${money(shownT2)}.`:(planActive?'AKTİF PLAN · Giriş/stop/hedef mevcut kurulumdan.':'REFERANS PLAN · Şimdi al sinyali değildir; güncel fiyat, destek ve ATR ile hesaplandı.'));
 $('signal').textContent=planActive?strategy+' · AKTİF':'CANLI KARAR';
}
async function loadChart(){
 if(!selected)return;
 const id=++chartRequestId,coin=selected.coin,symbol=selected.symbol,market=exchange,tf=period;
 if(chartAbort)try{chartAbort.abort()}catch(_e){}
 chartAbort=new AbortController();
 const controller=chartAbort;
 try{
  const r=await fetch('/api/candles?exchange='+encodeURIComponent(market)+'&symbol='+encodeURIComponent(symbol)+'&period='+encodeURIComponent(tf)+'&_='+Date.now(),{cache:'no-store',signal:controller.signal});
  if(!r.ok)throw Error('Grafik verisi alınamadı: HTTP '+r.status);
  const j=await r.json();
  if(id!==chartRequestId||!selected||selected.coin!==coin||selected.symbol!==symbol||exchange!==market||period!==tf)return;
  if(!Array.isArray(j.candles)||!j.candles.length)throw Error('Boş mum verisi');
  candles=j.candles;lastCandleUpdate=j.updated_at;drawChart();
  if(j.metrics){const m=j.metrics;$('rsi').textContent=m.rsi+rsiNote(m.rsi);$('macd').textContent='CANLI · DIF '+fmt(m.macd)+' · DEA '+fmt(m.macd_signal)+' · HIST '+fmt(m.macd_hist)+' · '+m.macd_direction+macdNote(m);$('atr').textContent=fmt(m.atr)+atrNote(m.atr,j.price);$('volume').textContent='Canlı: '+compact(m.volume_live)+' · Son kapanan: '+compact(m.volume_last)+' · Ort20: '+compact(m.volume_avg20)+' · Kapanan/Ort20: '+m.volume_ratio.toFixed(2)+'×'+volumeNote(m.volume_ratio);}
  if(Number.isFinite(j.price)&&j.price>0){selected.price=j.price;$('price').innerHTML=moneyHtml(j.price);renderPlan(selected,j.price);renderRows();}
  $('chart-updated').dataset.priceSource=j.price_source||'mum';
  $('chart-updated').textContent='Mum verisi: '+new Date(lastCandleUpdate).toLocaleTimeString('tr-TR')+' · '+(j.price_source||'mum fiyatı')+' · Son mum açık · Alt göstergeler CANLI/AÇIK MUM';
 }catch(e){if(e&&e.name==='AbortError')return;if(id===chartRequestId)$('chart-updated').textContent='Grafik güncellenemedi: '+e.message}
 finally{if(chartAbort===controller)chartAbort=null}
}
async function select(x){
 selected=x;chartRequestId++;
 candles=[];lastCandleUpdate=null;
 try{drawChart();}catch(_e){}
 $('selected-coin').textContent=x.coin;$('price').innerHTML=moneyHtml(x.price);
 $('change').textContent=(x.chg>=0?'+':'')+x.chg.toFixed(2)+'% · 24s';$('change').className=x.chg>=0?'up':'down';
 $('macd').textContent=x.macd_hist==null?'—':('DIF '+fmt(x.macd)+' · DEA '+fmt(x.macd_signal)+' · HIST '+fmt(x.macd_hist)+' · '+(x.macd_direction||'—'));$('rsi').textContent=x.rsi;$('volume').textContent=x.volume.toFixed(2)+'×';$('atr').textContent=x.atr>0?fmt(x.atr):'—';
 $('strength').innerHTML=x.strength+'<span>/100</span>';$('entry').innerHTML=x.entry+'<span>/100</span>';
 $('preparation').innerHTML=(x.preparation||0)+'<span>/100</span>';$('confirmation').innerHTML=(x.confirmation||0)+'<span>/100</span>';$('preparation-bar').style.width=(x.preparation||0)+'%';$('confirmation-bar').style.width=(x.confirmation||0)+'%';$('strength-bar').style.width=x.strength+'%';$('entry-bar').style.width=x.entry+'%';
 $('signal').textContent=x.trader_label||x.label;
 const positives=(x.trader_positive||[]).slice(0,4), conflicts=(x.trader_conflicts||[]).slice(0,2), risks=(x.trader_risks||[]).slice(0,2);
 const riskItems=conflicts.length?conflicts:risks;
 const obsHtml=`<div class="trader-observation">
  <div class="obs-block obs-positive"><b>🟢 OLUMLU</b><span>${positives.length?positives.join(' · '):'Belirgin pozitif teyit henüz yok'}</span></div>
  <div class="obs-block obs-risk"><b>⚠️ RİSK / ÇELİŞKİ</b><span>${riskItems.length?riskItems.join(' · '):'Belirgin çelişki yok'}</span></div>
  <div class="obs-block obs-decision"><b>${x.trader_label||x.label||'TRADER KARARI'}</b><span>Fırsat ${x.opportunity_score??'—'}/100 · Güven ${x.confidence_score??'—'}/100</span></div>
  <div class="obs-block obs-wait"><b>🎯 NE BEKLİYOR?</b><span>${x.trader_wait||'Kurulumun güçlenmesi bekleniyor'}</span></div>
 </div>`;
 $('comment').innerHTML=obsHtml;
 renderPlan(x,x.price);
 if(!x.analyzed){$('chart-updated').textContent='Teknik analiz eksik; mumlar ayrıca deneniyor.';}
 $('chart-updated').textContent='Grafik yükleniyor…';await loadChart();
}




function bgmTimeframeBadge(tf){
 const el=document.getElementById('bgm-tf-badge');
 if(el) el.textContent=(tf||'').toUpperCase()+' VERİSİ';
}

function bgmRadarMovement(x){
 const score=Math.round(Math.max(0,Math.min(100,Number(x.movement_score||0))));
 let label=score<20?'ÇOK SAKİN':score<35?'SAKİN':score<52?'UYANIYOR':score<72?'HAREKET BAŞLIYOR':'ÇOK HAREKETLİ';
 return {score,label};
}
function bgmEmaSeries(a,n){if(!a.length)return[];let k=2/(n+1),o=[+a[0]];for(let i=1;i<a.length;i++)o.push((+a[i])*k+o[i-1]*(1-k));return o}
function ensureMacdVisual(){
 let el=document.getElementById('macd-visual');
 if(!el)return null;
 const card=el.closest('.macd-visual-card');
 const macdText=[...document.querySelectorAll('body *')].find(x=>x.children.length===0&&/MACD/i.test(x.textContent||''));
 if(card&&macdText){
   let host=macdText.closest('.metric,.stat,.card,.indicator-card,.signal-card')||macdText.parentElement;
   if(host&&host.parentElement&&card.previousElementSibling!==host) host.insertAdjacentElement('afterend',card);
 }
 return el;
}
function drawVolumeVisual(){
 const el=$('volume-visual'); if(!el)return;
 if(!candles||candles.length<2){el.innerHTML='<div style="height:85px;display:flex;align-items:center;justify-content:center;color:#8097aa;font-size:11px">Hacim verisi yükleniyor</div>';return;}
 const a=candles.slice(-60),W=720,H=85,dx=W/a.length;
 const vols=a.map(v=>Number(v[5]||0)),mx=Math.max(1,...vols);
 let q='<svg viewBox="0 0 720 85" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">';
 a.forEach((v,i)=>{const vv=Number(v[5]||0),bh=Math.max(1,(vv/mx)*78),up=Number(v[4])>=Number(v[1]);q+=`<rect x="${(i*dx+dx*.15).toFixed(1)}" y="${(82-bh).toFixed(1)}" width="${Math.max(1,dx*.7).toFixed(1)}" height="${bh.toFixed(1)}" fill="${up?'#50dba2':'#ed818b'}" opacity=".75"/>`;});
 q+='</svg>';el.innerHTML=q;
}
function drawMacdVisual(){
 const el=ensureMacdVisual(); if(!el)return;
 if(!candles||candles.length<2){
   el.innerHTML='<div style="height:105px;display:flex;align-items:center;justify-content:center;color:#8097aa;font-size:11px">MACD görseli mum verisi yüklenince çizilecek</div>'; return;
 }
 const c=candles.map(v=>+v[4]), e12=bgmEmaSeries(c,12), e26=bgmEmaSeries(c,26);
 const d=e12.map((v,i)=>v-e26[i]), s=bgmEmaSeries(d,9), h=d.map((v,i)=>v-s[i]);
 const n=Math.min(60,c.length),D=d.slice(-n),S=s.slice(-n),H=h.slice(-n),W=720,HH=105,dx=W/n;
 const m=Math.max(1e-12,...D.map(Math.abs),...S.map(Math.abs),...H.map(Math.abs)),y=v=>HH/2-(v/m)*(HH*.42);
 let q='<svg viewBox="0 0 720 105" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="52.5" x2="720" y2="52.5" stroke="#34495d" stroke-width="1"/>';
 for(let i=0;i<n;i++){let yy=y(H[i]),x=i*dx+dx*.2;q+=`<rect x="${x}" y="${Math.min(HH/2,yy)}" width="${Math.max(1,dx*.6)}" height="${Math.max(.7,Math.abs(HH/2-yy))}" fill="${H[i]>=0?'#50dba2':'#ed818b'}" opacity=".78"/>`}
 function path(a,col){let p='';a.forEach((v,i)=>p+=(i?' L':'M')+(i*dx+dx/2).toFixed(1)+' '+y(v).toFixed(1));return `<path d="${p}" fill="none" stroke="${col}" stroke-width="1.8"/>`}
 q+=path(D,'#62a9ee')+path(S,'#e4bd66')+'</svg>';el.innerHTML=q;
}

function drawChart(){if(!candles.length){$('chart').textContent='Grafik verisi bekleniyor';return}let vals=candles.slice(-60).map(v=>({o:+v[1],h:+v[2],l:+v[3],c:+v[4]}));let all=vals.flatMap(v=>[v.h,v.l]),lo=Math.min(...all),hi=Math.max(...all),pad=(hi-lo)*.07||Math.max(hi*.01,.000001);lo-=pad;hi+=pad;const plotRight=650,axisX=658,W=720;let y=v=>245-(v-lo)/(hi-lo)*215,dx=(plotRight-12)/vals.length;const decimals=hi>=1000?2:hi>=1?4:hi>=.01?5:7;const pf=v=>Number(v).toLocaleString('tr-TR',{minimumFractionDigits:decimals,maximumFractionDigits:decimals});let svg='<svg viewBox="0 0 720 290" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">';for(let k=0;k<6;k++){let yy=25+k*44,val=hi-(hi-lo)*(yy-25)/220;svg+=`<line x1="0" y1="${yy}" x2="${plotRight}" y2="${yy}" stroke="#243448" stroke-dasharray="3 6"/><text x="${axisX}" y="${yy+4}" fill="#8da1b5" font-size="11" font-family="Arial,sans-serif">${pf(val)}</text>`}svg+=`<line x1="${plotRight}" y1="20" x2="${plotRight}" y2="250" stroke="#40536a"/>`;for(let i=0;i<vals.length;i++){let v=vals[i],x=10+i*dx,col=v.c>=v.o?'#50dba2':'#ed818b';svg+=`<line x1="${x}" x2="${x}" y1="${y(v.h)}" y2="${y(v.l)}" stroke="${col}" stroke-width="1.5"/><rect x="${x-dx*.24}" y="${Math.min(y(v.o),y(v.c))}" width="${Math.max(1.8,dx*.48)}" height="${Math.max(1.4,Math.abs(y(v.o)-y(v.c)))}" fill="${col}" rx=".6"/>`}for(let [n,col] of [[7,'#e8bb64'],[25,'#d287dc'],[99,'#63a5ee']]){let d='';const closes=candles.map(v=>Number(v[4]));const start=closes.length-vals.length;for(let i=0;i<vals.length;i++){const end=start+i+1;if(end<n)continue;const avg=closes.slice(end-n,end).reduce((sum,c)=>sum+c,0)/n;d+=(d?' L':'M')+(10+i*dx).toFixed(1)+' '+y(avg).toFixed(1)}svg+=`<path d="${d}" fill="none" stroke="${col}" stroke-width="${n===99?2.3:1.6}"/>`}let last=vals[vals.length-1].c,ly=Math.max(20,Math.min(250,y(last)));svg+=`<line x1="0" y1="${ly}" x2="${plotRight}" y2="${ly}" stroke="#50dba2" stroke-width="1" stroke-dasharray="5 4"/><rect x="${plotRight}" y="${ly-11}" width="68" height="22" rx="4" fill="#16a878"/><text x="${plotRight+5}" y="${ly+4}" fill="white" font-size="11" font-weight="700" font-family="Arial,sans-serif">${pf(last)}</text>`;svg+='</svg>';$('chart').innerHTML=svg;drawMacdVisual();drawVolumeVisual()}

async function scan(force=false){if(scanInFlight)return;scanInFlight=true;const current=exchange;status('Gerçek '+(exchange==='tr'?'TRY':'USDT')+' pariteleri taranıyor… İlk tarama birkaç dakika sürebilir.');$('scan').disabled=true;const rr=$('radar-refresh');if(rr){rr.disabled=true;rr.textContent='↻ RADAR TARANIYOR…'}try{let r=await fetch('/api/scan?exchange='+encodeURIComponent(current)+(force?'&force=1':'')+'&_='+Date.now(),{cache:'no-store'});let j=await r.json();if(!r.ok)throw Error(j.error||'Bağlantı hatası');if(j.version!=='0.6.65')throw Error('Eski sunucu çalışıyor: '+(j.version||'sürüm yok')+'. Önce eski BAT penceresini kapatın.');if(current!==exchange)return;usdTryRate=(current==='tr'&&Number(j.usd_try)>0)?Number(j.usd_try):null;data=j.rows;renderLosers();renderGainers();renderFavorites();const rg=j.market_regime||{};const lab=rg.label;$('advantage-label').textContent=(lab==='ALTCOIN'?'🟢 ALTCOIN':lab==='MAJORS'?'🟠 BTC + ETH':lab==='NÖTR'?'⚪ NÖTR':'⏳ VERİ BEKLENİYOR');$('btc-power').innerHTML=(rg.btc_power??'—')+'<em>/100</em>';$('alt-power').innerHTML=(rg.alt_power??'—')+'<em>/100</em>';$('btc-power-bar').style.width=(rg.btc_power==null?0:Number(rg.btc_power))+'%';$('alt-power-bar').style.width=(rg.alt_power==null?0:Number(rg.alt_power))+'%';$('advantage-reason').textContent=rg.reason||'Piyasa karşılaştırması bekleniyor.';if($('alt-breadth'))$('alt-breadth').textContent=rg.alt_positive_pct==null?'Piyasa genişliği bekleniyor':'Pozitif altcoin %'+Number(rg.alt_positive_pct).toFixed(0)+' · '+(rg.alt_count||0)+' coin';const q=j.quote||'';const usdFp=(v)=>v==null?'—':'$'+Number(v).toLocaleString('en-US',{maximumFractionDigits:2});$('btc-market-price').textContent=usdFp(rg.btc_price);$('eth-market-price').textContent=usdFp(rg.eth_price);if($('usdt-try-rate'))$('usdt-try-rate').textContent=(Number(j.usd_try)>0?'₺'+Number(j.usd_try).toLocaleString('tr-TR',{maximumFractionDigits:4}):'—');if($('bull-scenario'))$('bull-scenario').textContent=rg.btc_breakout?'BTC $'+Number(rg.btc_breakout).toLocaleString('en-US',{maximumFractionDigits:0})+' üzeri + güç teyidi':'BTC kırılımı + piyasa teyidi bekleniyor';if($('bear-scenario'))$('bear-scenario').textContent=rg.btc_support?'BTC $'+Number(rg.btc_support).toLocaleString('en-US',{maximumFractionDigits:0})+' altı risk artar':'BTC destek kırılımı izleniyor';$('btc-market-change').textContent=rg.btc_chg==null?'24s —':'24s '+Number(rg.btc_chg).toFixed(2)+'%';$('eth-market-change').textContent=rg.eth_chg==null?'24s —':'24s '+Number(rg.eth_chg).toFixed(2)+'%';lastScanAt=j.timestamp||Date.now();nextScanAt=Date.now()+300000;const counts=data.reduce((a,x)=>(a[x.state]=(a[x.state]||0)+1,a),{});status('CANLI '+j.quote+' · '+j.analyzed+'/'+j.attempted+' analiz edildi · '+j.error_count+' hata');$('market-caption').textContent=j.note;$('radar-status').textContent=`Son radar taraması: ${new Date(lastScanAt).toLocaleTimeString('tr-TR')} · Teyitli: ${counts.confirmed||0} · Hazırlık: ${counts.preparing||0} · Bekle: ${counts.wait||0} · Veri eksik: ${counts.unavailable||0} · Otomatik: 5 dk · Manuel yenileme aktif`;$('radar-foot').textContent=`${j.universe} aktif ${j.quote} spot parite · ${j.attempted} denendi · ${j.analyzed} analiz edildi · ${j.error_count} veri hatası (${Object.entries(j.error_types||{}).map(([k,v])=>k+': '+v).join(', ')||'yok'}) · ${j.new_count} yeni görülen. Son güncelleme: ${new Date(j.timestamp).toLocaleString('tr-TR')}. ${j.error_details?.length?'Hatalar: '+j.error_details.map(e=>e.symbol+' ['+e.category+']: '+e.message).join(' | '):''}`;if(data.length)await select(data.find(x=>selected&&x.symbol===selected.symbol)||data.find(x=>x.analyzed)||data[0]);else{$('coin-rows').innerHTML='<tr><td colspan="11">Veri bulunamadı.</td></tr>'}}catch(e){if(current!==exchange)return;status('VERİ HATASI');$('radar-foot').textContent='Canlı veri alınamadı: '+e.message+(current==='tr'?' · TR bağlantı kontrolü: http://127.0.0.1:8537/api/tr-check':'');$('coin-rows').innerHTML='<tr><td colspan="11">Veri alınamadı. İnternet bağlantısını kontrol edin.</td></tr>'}finally{$('scan').disabled=false;const rr=$('radar-refresh');if(rr){rr.disabled=false;rr.textContent='↻ RADARI ŞİMDİ YENİLE'}scanInFlight=false}}
$('global').onclick=()=>{exchange='global';$('global').classList.add('selected');$('tr').classList.remove('selected');$('quote').textContent='/ USDT';$('market').textContent='USDT Spot';$('market-caption').textContent='Binance Global · herkese açık veri';$('quote').textContent='/ USDT';data=[];selected=null;renderRows();$('chart').textContent='Global taraması bekleniyor';scan()};$('tr').onclick=()=>{exchange='tr';$('tr').classList.add('selected');$('global').classList.remove('selected');data=[];selected=null;renderRows();$('quote').textContent='/ TRY';$('market').textContent='TRY Spot';$('market-caption').textContent='Binance TR · herkese açık veri';$('chart').textContent='Binance TR taraması bekleniyor';$('comment').textContent='Binance TR verisi bekleniyor';scan()};document.querySelectorAll('#periods button').forEach(b=>b.onclick=()=>{period=b.textContent==='1D'?'1d':b.textContent;document.querySelectorAll('#periods button').forEach(z=>z.classList.toggle('on',z===b));if(selected)select(selected)});document.querySelectorAll('.filters button').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('.filters button').forEach(z=>z.classList.toggle('active',z===b));renderRows()});const titles={dashboard:'Genel Bakış',radar:'Fırsat Radarı',losers:'Düşenler & Tepki',analysis:'Coin Analizi',gainers:'En Çok Çıkanlar',favorites:'Favoriler'};document.querySelectorAll('#nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('#nav button').forEach(z=>z.classList.toggle('active',z===b));$('page-title').textContent=titles[b.dataset.page];$('heading').textContent=titles[b.dataset.page];let target=b.dataset.page==='radar'?'radar-panel':b.dataset.page==='losers'?'losers-panel':b.dataset.page==='analysis'?'chart':b.dataset.page==='gainers'?'gainers-panel':b.dataset.page==='favorites'?'favorites-panel':null;if(target){if(b.dataset.page==='radar'||b.dataset.page==='losers'||b.dataset.page==='gainers'||b.dataset.page==='favorites'){const sc=$(target).querySelector('.table-scroll');if(sc)sc.scrollTop=0;$(target).scrollIntoView({behavior:'smooth',block:'start'});}else $(target).scrollIntoView({behavior:'smooth',block:'center'});}});$('scan').onclick=()=>{if(!exchange){status('ÖNCE BİNANCE TR VEYA GLOBAL SEÇİN');$('radar-foot').textContent='Tarama başlamadı. Üstte Binance TR veya Binance Global düğmesine basın.';return}scan(true)};const radarRefresh=$('radar-refresh');if(radarRefresh)radarRefresh.onclick=()=>{if(!exchange){status('ÖNCE BİNANCE TR VEYA GLOBAL SEÇİN');return}scan(true)};$('refresh-chart').onclick=()=>loadChart();const stateHead=$('state-sort');if(stateHead)stateHead.onclick=()=>{stateSort=stateSort===1?-1:1;stateHead.textContent='HAREKET DURUMU '+(stateSort===1?'▲':'▼');renderRows();};const defaultSort=$('default-radar-sort');if(defaultSort){defaultSort.style.cursor='pointer';defaultSort.onclick=()=>{tableSort={key:null,dir:-1};stateSort=0;document.querySelectorAll('#radar-panel thead th[data-sort]').forEach(h=>h.textContent=h.textContent.replace(/ [▲▼]$/,''));renderRows();status('BGM TRADER ANA SIRALAMASI');};}document.querySelectorAll('#radar-panel thead th[data-sort]').forEach(th=>{th.style.cursor='pointer';th.style.userSelect='none';th.title='Sıralamak için tıkla';th.onclick=()=>{const key=th.dataset.sort;tableSort=(tableSort.key===key)?{key,dir:-tableSort.dir}:{key,dir:-1};stateSort=0;document.querySelectorAll('#radar-panel thead th[data-sort]').forEach(h=>{const base=h.textContent.replace(/ [▲▼]$/,'');h.textContent=base+(h===th?(tableSort.dir===-1?' ▼':' ▲'):'');});renderRows();};});const planModeIn=$('plan-mode'),stopPctIn=$('stop-pct'),t1PctIn=$('t1-pct'),t2PctIn=$('t2-pct'),positionAmountIn=$('plan-position-amount'),stopAmountIn=$('stop-amount'),t1AmountIn=$('t1-amount'),t2AmountIn=$('t2-amount');function syncPlanSettings(){if(!planModeIn)return;localStorage.setItem('bgm_plan_mode',planModeIn.value);localStorage.setItem('bgm_stop_pct',stopPctIn.value);localStorage.setItem('bgm_t1_pct',t1PctIn.value);localStorage.setItem('bgm_t2_pct',t2PctIn.value);localStorage.setItem('bgm_plan_position_amount',positionAmountIn.value);localStorage.setItem('bgm_stop_amount',stopAmountIn.value);localStorage.setItem('bgm_t1_amount',t1AmountIn.value);localStorage.setItem('bgm_t2_amount',t2AmountIn.value);const manual=planModeIn.value==='manual',amount=planModeIn.value==='manual_amount';$('pct-plan-inputs').style.display=manual?'flex':'none';$('amount-plan-inputs').style.display=amount?'flex':'none';[stopPctIn,t1PctIn,t2PctIn].forEach(e=>e.disabled=!manual);[positionAmountIn,stopAmountIn,t1AmountIn,t2AmountIn].forEach(e=>e.disabled=!amount);$('plan-settings-note').textContent=amount?'Kâr/zarar rakamını girin; gerekli yüzde ve emir fiyatı otomatik hesaplanır.':manual?'Yüzdeyi girin; hedef fiyatlar anında hesaplanır.':'ATR/destek tabanlı teknik plan.';if(selected)renderPlan(selected,selected.price)}if(planModeIn){planModeIn.value=localStorage.getItem('bgm_plan_mode')||'auto';stopPctIn.value=localStorage.getItem('bgm_stop_pct')||'3';t1PctIn.value=localStorage.getItem('bgm_t1_pct')||'5';t2PctIn.value=localStorage.getItem('bgm_t2_pct')||'9';positionAmountIn.value=localStorage.getItem('bgm_plan_position_amount')||'30000';stopAmountIn.value=localStorage.getItem('bgm_stop_amount')||'1000';t1AmountIn.value=localStorage.getItem('bgm_t1_amount')||'1500';t2AmountIn.value=localStorage.getItem('bgm_t2_amount')||'3000';[planModeIn,stopPctIn,t1PctIn,t2PctIn,positionAmountIn,stopAmountIn,t1AmountIn,t2AmountIn].forEach(e=>e.addEventListener('input',syncPlanSettings));syncPlanSettings();}
status('PİYASA SEÇİMİ BEKLENİYOR');$('coin-rows').innerHTML='<tr><td colspan="11">Taramak istediğiniz piyasayı üstten seçin: Binance TR veya Binance Global.</td></tr>';setInterval(()=>{if(selected)loadChart()},20000);setInterval(()=>{if(exchange&&!scanInFlight&&data.length)scan(true)},300000);setInterval(()=>{if(nextScanAt&&$('radar-status')&&!scanInFlight){const left=Math.max(0,Math.ceil((nextScanAt-Date.now())/1000));const base=$('radar-status').textContent.replace(/ · Sonraki tarama:.*$/,'');$('radar-status').textContent=base+' · Sonraki tarama: '+Math.floor(left/60)+':'+String(left%60).padStart(2,'0')}},1000);

$('coin-search').addEventListener('input',e=>{query=e.target.value.trim().toLowerCase();renderRows()});

// V0.6.65: independent sentiment; provider is always visible, never mislabeled.
async function loadSentiment(){
 const label=$('risk-label'),scoreEl=$('risk-appetite'),src=$('risk-source');
 if(label)label.textContent='YÜKLENİYOR';
 try{const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),12000);let response;try{response=await fetch('/api/sentiment?_='+Date.now(),{cache:'no-store',signal:ctl.signal});}finally{clearTimeout(timer)}
  if(!response.ok)throw Error('HTTP '+response.status);const j=await response.json();
  if(j.score==null)throw Error('İki kaynak da erişilemiyor');
  if(scoreEl)scoreEl.textContent=j.score+'/100';if(label)label.textContent=j.label||'—';
  if(src)src.textContent='Kaynak: '+j.source+(j.source.startsWith('Alternative')?' · Binance verisi alınamadı':'');
  if($('risk-pointer'))$('risk-pointer').style.left=j.score+'%';
 }catch(e){if(scoreEl)scoreEl.textContent='—/100';if(label)label.textContent='VERİ YOK';if(src)src.textContent='Binance / alternatif kaynak erişilemiyor';}
}
setTimeout(loadSentiment,500);setInterval(loadSentiment,15*60*1000);


// Desktop V1 updater: the badge appears only when a signed-by-hash newer installer is published.
async function bgmCheckUpdate(){
 const b=$('update-pill'); if(!b)return;
 try{
  const r=await fetch('/api/update-info?_='+Date.now(),{cache:'no-store'}); if(!r.ok)return;
  const j=await r.json();
  if(j.available){b.hidden=false;b.textContent='⬇ GÜNCELLEME '+j.latest;b.title='Yeni sürümü indirip kurulumu başlat';}
  else b.hidden=true;
 }catch(e){b.hidden=true;}
}
async function bgmInstallUpdate(){
 const b=$('update-pill'); if(!b)return;
 b.disabled=true;b.textContent='GÜNCELLEME İNDİRİLİYOR…';
 try{
  const r=await fetch('/api/update-download',{method:'POST'}); const j=await r.json();
  if(!r.ok||!j.ok)throw Error(j.error||'Güncelleme başlatılamadı');
  b.textContent='PROGRAM KAPANIYOR…';
 }catch(e){alert('Güncelleme hatası: '+e.message);b.disabled=false;bgmCheckUpdate();}
}
const bgmUpdateButton=$('update-pill');if(bgmUpdateButton)bgmUpdateButton.onclick=bgmInstallUpdate;
setTimeout(bgmCheckUpdate,1800);setInterval(bgmCheckUpdate,30*60*1000);

async function bgmLoadVersion(){try{const r=await fetch('/api/version?_='+Date.now(),{cache:'no-store'});const j=await r.json();const v='V'+j.version+' Desktop';if($('sidebar-version'))$('sidebar-version').textContent=v;if($('header-version'))$('header-version').textContent=v;}catch(_){}}setTimeout(bgmLoadVersion,250);
