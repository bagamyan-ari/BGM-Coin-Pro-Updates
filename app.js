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
 if(!bgmEligible(x)) return false;
 const name=(String(x.coin||'')+' '+String(x.symbol||'')).toLowerCase();
 if(searching) return name.includes(query);
 return !x.dormant&&(filter==='all'||x.state===filter||(filter==='new'&&x.new));
});
rows=rows.map(x=>{const m=bgmRadarMovement(x);x._moveScore=m.score;x._moveLabel=m.label;x._gate=bgmEligible(x)?bgmTraderGate(x,'radar'):null;return x;});
if(!searching) rows=rows.filter(x=>{
 const mv=Number(x._moveScore||0), vol=Number(x.volume||0), ch=Math.abs(Number(x.chg||0));
 const active=(mv>=40 && vol>=0.80 && ch>=0.75);
 const waking=(mv>=55 && vol>=1.20 && ch>=0.35);
 return active||waking;
});
if(!stateSort&&!tableSort.key)rows=[...rows].sort((a,b)=>{
 // V0.6.57: BGM Trader ana siralamasi = karar sinifi > firsat > guven > potansiyel > eski Radar.
 const ak=[Number(a._gate?.traderRank||0),Number(a._gate?.traderScore||0),Number(a.opportunity_score||0),Number(a.confidence_score||0),Number(a.potential_score||0),Number(a.radar_score||0)];
 const bk=[Number(b._gate?.traderRank||0),Number(b._gate?.traderScore||0),Number(b.opportunity_score||0),Number(b.confidence_score||0),Number(b.potential_score||0),Number(b.radar_score||0)];
 for(let i=0;i<ak.length;i++){if(bk[i]!==ak[i])return bk[i]-ak[i];}
 return 0;
});if(tableSort.key){const statusRank={confirmed:4,preparing:3,wait:2,unavailable:1};const val=(x,k)=>k==='coin'?String(x.coin||''):k==='movement'?Number(x._moveScore||0):k==='status'?Number(statusRank[x.state]||0):Number(x[k]??0);rows=[...rows].sort((a,b)=>{const av=val(a,tableSort.key),bv=val(b,tableSort.key);const d=tableSort.key==='coin'?av.localeCompare(bv,'tr'):(av-bv);return d*tableSort.dir;});}else if(stateSort){const rank={confirmed:0,preparing:1,wait:2,unavailable:3};rows=[...rows].sort((a,b)=>{const d=(rank[a.state]??9)-(rank[b.state]??9);return stateSort===1?(d||((b.radar_score??0)-(a.radar_score??0))):(-d||((b.radar_score??0)-(a.radar_score??0)))});}$('coin-rows').innerHTML=rows.map((x,i)=>`<tr data-coin="${x.coin}" class="${selected&&selected.coin===x.coin?'selected':''}"><td>${i+1}</td><td><button class="fav-star" data-fav="${x.coin}" title="Favori">${isFavorite(x.coin)?'★':'☆'}</button></td><td><b>${x.coin}</b><span style="color:#70889d"> / ${exchange==='tr'?'TRY':'USDT'}</span></td><td><div class="trader-cell"><b>${x._gate?.traderGradeLabel||x._gate?.traderLabel||x.trader_label||'—'}</b><small>${x._gate?`${x._gate.passed}/${x._gate.total} kontrol · ${x._gate.veto.length} veto`:(x.trader_short||'veri değerlendiriliyor')}</small></div></td><td><b>${Number(x.opportunity_score||0)}/100</b></td><td><b>${Number(x.confidence_score||0)}/100</b></td><td>${moneyHtml(x.price)}</td><td class="${x.chg>=0?'up':'down'}">${x.chg>=0?'+':''}${x.chg.toFixed(2)}%</td><td>${x.strength}/100</td><td>${x.entry}/100</td><td>${x.preparation}/100</td><td>${x.confirmation}/100</td><td>${(x.radar_score??0).toFixed(1)}</td><td><b>${Number(x.potential_score||0)}/100</b></td><td><b>${Number(x.jump_score||0)}/100</b></td><td><b>${exchange==='tr'?'₺':''}${compact(Number(x.quote_volume||0))}</b></td><td><div class="radar-ind"><b class="${x.volume_direction==='ALIM'?'up':x.volume_direction==='SATIS'?'down':''}">${x.volume_direction==='ALIM'?'🟢 ALIM':x.volume_direction==='SATIS'?'🔴 SATIŞ':'🟡 KARIŞIK'}</b><small>%${Number(x.buy_volume_share||50).toFixed(0)} yukarı mum hacmi</small></div></td><td><div class="radar-ind"><b>${x._moveScore}/100</b><small>${Math.abs(Number(x.chg||0))<0.35?'SIKIŞIK':(Number(x.chg||0)>0?'↑ ':'↓ ')+x._moveLabel} · 24S ${Math.abs(Number(x.chg||0)).toFixed(2)}%</small></div></td><td><div class="radar-ind"><b class="${Number(x.macd_hist)>=0?'up':'down'}">${x.macd_hist==null?'—':fmt(x.macd_hist)}</b><small>${x.macd_direction||'—'}</small></div></td><td><div class="radar-ind"><b>${Number(x.volume||0).toFixed(2)}×</b><small>${Number(x.volume||0)>=1.5?'GÜÇLÜ':Number(x.volume||0)>=1?'NORMAL+':'ZAYIF'}</small></div></td><td><div class="trader-wait">${x._gate?.wait||x.trader_wait||'—'}</div></td></tr>`).join('')||'<tr><td colspan="13">Bu filtre için sonuç yok.</td></tr>' ;document.querySelectorAll('#coin-rows tr[data-coin]').forEach(tr=>tr.onclick=e=>{if(e.target.closest('.fav-star'))return;select(data.find(x=>x.coin===tr.dataset.coin))});document.querySelectorAll('#coin-rows .fav-star').forEach(b=>b.onclick=e=>{e.stopPropagation();toggleFavorite(b.dataset.fav)})}

function renderFavorites(){const body=$('favorite-rows');if(!body)return;const f=getFavorites();let rows=data.filter(x=>f.has(String(x.coin||'').toUpperCase())&&bgmEligible(x)).map(x=>({...x,_gate:bgmTraderGate(x,'radar')}));rows.sort((a,b)=>b._gate.traderGradeRank-a._gate.traderGradeRank||b._gate.traderScore-a._gate.traderScore);const st=bgmSortState.favorites;if(st)rows=bgmSortRows(rows,st.key,st.dir,'_gate');body.innerHTML=rows.map(x=>`<tr data-symbol="${x.symbol}"><td><button class="fav-star" data-fav="${x.coin}">★</button></td><td><b>${x.coin}</b></td><td>${moneyHtml(x.price)}</td><td class="${Number(x.chg)>=0?'up':'down'}">${Number(x.chg)>=0?'+':''}${Number(x.chg||0).toFixed(2)}%</td><td><div class="trader-cell"><b>${x._gate.traderGradeLabel}</b><small>${x._gate.passed}/${x._gate.total} · ${x._gate.veto.length} veto</small></div></td><td>${Number(x.opportunity_score||0)}/100</td><td>${Number(x.confidence_score||0)}/100</td></tr>`).join('')||'<tr><td colspan="7">Henüz favori coin yok.</td></tr>';bindSpecialRows(body)}
function renderGainers(){const body=$('gainer-rows');if(!body)return;let rows=data.filter(x=>bgmEligible(x)&&Number(x.chg)>0).map(x=>({...x,_gate:bgmTraderGate(x,'radar')}));rows.sort((a,b)=>b._gate.traderGradeRank-a._gate.traderGradeRank||b._gate.traderScore-a._gate.traderScore||Number(b.chg)-Number(a.chg));const st=bgmSortState.gainers;if(st)rows=bgmSortRows(rows,st.key,st.dir,'_gate');rows=rows.slice(0,30);body.innerHTML=rows.map((x,i)=>`<tr data-symbol="${x.symbol}"><td>${i+1}</td><td><button class="fav-star" data-fav="${x.coin}">${isFavorite(x.coin)?'★':'☆'}</button></td><td><b>${x.coin}</b></td><td>${moneyHtml(x.price)}</td><td class="up">+${Number(x.chg||0).toFixed(2)}%</td><td>${Number(x.opportunity_score||0)}/100</td><td>${Number(x.confidence_score||0)}/100</td><td>${x.volume_direction||'—'} · %${Number(x.buy_volume_share||50).toFixed(0)}</td><td>${Number(x.volume||0).toFixed(2)}×</td><td><div class="trader-cell"><b>${x._gate.traderGradeLabel}</b><small>${x._gate.passed}/${x._gate.total} · ${x._gate.veto.length} veto</small></div></td></tr>`).join('')||'<tr><td colspan="10">Yükselen coin bulunamadı.</td></tr>';bindSpecialRows(body)}
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
function renderLosers(){const body=$('loser-rows');if(!body)return;let rows=data.filter(x=>bgmEligible(x)&&Number(x.chg)<0).map(x=>({...x,_reaction:reactionProfile(x),_gate:bgmTraderGate(x,'radar')}));rows.sort((a,b)=>b._gate.traderGradeRank-a._gate.traderGradeRank||b._reaction.rank-a._reaction.rank||b._reaction.opportunity-a._reaction.opportunity);const st=bgmSortState.losers;if(st)rows=bgmSortRows(rows,st.key,st.dir,st.key.startsWith('reaction')?'_reaction':'_gate');rows=rows.slice(0,30);body.innerHTML=rows.map((x,i)=>`<tr data-symbol="${x.symbol}"><td>${i+1}</td><td><b>${x.coin}</b></td><td>${moneyHtml(x.price)}</td><td class="down">${Number(x.chg).toFixed(2)}%</td><td><b>${x._reaction.opportunity}/100</b></td><td><b>${x._reaction.confidence}/100</b></td><td>${Number(x.rsi||0).toFixed(1)}</td><td>${x.macd_hist==null?'—':fmt(x.macd_hist)} <small>${x.macd_direction||'—'}</small></td><td>${Number(x.volume||0).toFixed(2)}×</td><td><b>${exchange==='tr'?'₺':''}${compact(Number(x.quote_volume||0))}</b></td><td>${x.volume_direction||'—'} · %${Number(x.buy_volume_share||50).toFixed(0)}</td><td><div class="trader-cell"><b>${x._gate.traderGradeLabel}</b><small>${x._reaction.label} · ${x._gate.passed}/${x._gate.total}</small></div></td><td><div class="trader-wait">${x._gate.wait||x._reaction.wait}</div></td></tr>`).join('')||'<tr><td colspan="13">Şu anda düşüşte analiz edilebilir coin bulunamadı.</td></tr>';bindSpecialRows(body);$('loser-foot').textContent=`İlk ${rows.length} negatif coin · Ortak 30+ Trader filtresi + Tepki Motoru · Başlıklara tıklayarak sırala.`}

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
 const savedEntry=bgmPlanEntryForCoin(x), amountEntry=savedEntry>0?savedEntry:(planActive?activeEntry:refEntry), amountPlan=bgmAmountPlan(amountEntry);
 const amountStopPct=amountPlan.stoppct, amountT1Pct=amountPlan.t1pct, amountT2Pct=amountPlan.t2pct;
 const refRisk=Math.max(atr>0?atr*1.15:refEntry*.018,refEntry*.012);
 const refStop=(hasSupport&&support<refEntry)?Math.min(refEntry-refRisk*.65,support-Math.max(atr*.15,refEntry*.002)):refEntry-refRisk;
 const riskDist=Math.max(refEntry-refStop,refEntry*.008);
 const refT1=refEntry+riskDist*2;
 const refT2=refEntry+riskDist*3;
 $('active-entry-simple').innerHTML=moneyHtml(planMode==='manual_amount'?amountEntry:(planActive?activeEntry:refEntry));
 const shownEntry=planMode==='manual_amount'?amountEntry:(planActive?activeEntry:refEntry);
 const shownStop=planMode==='manual'?shownEntry*(1-manualStop/100):planMode==='manual_amount'?amountPlan.stop:(planActive&&x.plan_stop!=null?Number(x.plan_stop):refStop);
 const shownT1=planMode==='manual'?shownEntry*(1+manualT1/100):planMode==='manual_amount'?amountPlan.t1:(planActive&&x.plan_target!=null?Number(x.plan_target):refT1);
 const shownT2=planMode==='manual'?shownEntry*(1+manualT2/100):planMode==='manual_amount'?amountPlan.t2:(planActive&&x.plan_target2!=null?Number(x.plan_target2):refT2);
 $('simple-stop').innerHTML=moneyHtml(shownStop);
 // Separate user-defined net profit target and existing technical target; never invent a resistance.
 const technicalH1=bgmNum(x.plan_target,0)>shownEntry?bgmNum(x.plan_target,0):refT1>shownEntry?refT1:NaN;
 const userH1=amountPlan.t1>amountEntry?amountPlan.t1:NaN;
 const h1UserNode=$('bgm-user-h1'),h1TechnicalNode=$('bgm-technical-h1');
 if(h1UserNode)h1UserNode.innerHTML=planMode==='manual_amount'&&Number.isFinite(userH1)?moneyHtml(userH1):'Manuel Rakam modunda';
 if(h1TechnicalNode)h1TechnicalNode.innerHTML=Number.isFinite(technicalH1)?moneyHtml(technicalH1):'Veri yok';
 $('simple-target1').innerHTML=moneyHtml(shownT1);
 $('simple-target2').innerHTML=moneyHtml(shownT2);
 const comparison=$('bgm-h1-comparison');
 if(comparison){
  if(planMode!=='manual_amount')comparison.textContent='Manuel Rakam modunda net kâr hedefiniz teknik hedefle karşılaştırılır.';
  else if(!Number.isFinite(userH1)||!Number.isFinite(technicalH1))comparison.textContent='H1 karşılaştırması için geçerli alış, kâr ve teknik hedef verisi gerekli.';
  else if(userH1>technicalH1)comparison.textContent='⚠ İstenen net kâr satış fiyatı teknik H1 üzerinde. Direnç ve risk kontrolü yapmadan bu fiyatı kesin hedef saymayın.';
  else comparison.textContent='✓ İstenen net kâr satış fiyatı teknik H1 altında veya eşit. Hedefler ayrı gösterilir; otomatik satış yapılmaz.';
 }
 const live=bgmNum(livePrice,bgmNum(x.price)),dist=(shownEntry>0&&live>0)?(live-shownEntry)/shownEntry*100:NaN,validAmount=shownEntry>0&&shownStop<shownEntry&&shownT1>shownEntry&&shownT2>shownT1; $('simple-plan-note').textContent=planMode==='manual'?`MANUEL % · Stop %${manualStop} · H1 %${manualT1} · H2 %${manualT2}.`:(planMode==='manual_amount'?(validAmount?`MANUEL RAKAM · Referans alış ${money(shownEntry)} · Canlı ${money(live)} (${Number.isFinite(dist)?(dist>=0?'+':'')+dist.toFixed(2)+'%':'—'}) · Pozisyon ${money(positionAmount)} · Komisyon %${(amountPlan.f*100).toFixed(2)}/yön · Net maks zarar ${money(stopAmount)} → Stop ${money(shownStop)} · Net H1 ${money(t1Amount)} → Satış ${money(shownT1)} (%${amountT1Pct.toFixed(2)}) · Net H2 ${money(t2Amount)} → Satış ${money(shownT2)} (%${amountT2Pct.toFixed(2)}).`:'HESAP HATASI / PLAN GEÇERSİZ · H1 alışın üstünde, H2 H1 üstünde ve stop alışın altında olmalı.'):(planActive?'AKTİF PLAN · Giriş/stop/hedef mevcut kurulumdan.':'REFERANS PLAN · Şimdi al sinyali değildir; güncel fiyat, destek ve ATR ile hesaplandı.'));
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
 const pe=$('plan-entry-price');if(pe){const coinKey=bgmPlanEntryKey(x),savedCoin=bgmNum(localStorage.getItem(coinKey),0),autoEntry=bgmNum(x.plan_buy)>0?bgmNum(x.plan_buy):bgmNum(x.price),chosen=savedCoin>0?savedCoin:autoEntry;pe.value=chosen>0?chosen:'';pe.dataset.coin=String(x.coin);pe.dataset.manual=savedCoin>0?'1':'';}
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

async function scan(force=false){if(scanInFlight)return;scanInFlight=true;bgmRadarLastAttempt=Date.now();const current=exchange;status('Gerçek '+(exchange==='tr'?'TRY':'USDT')+' pariteleri taranıyor… İlk tarama birkaç dakika sürebilir.');$('scan').disabled=true;const rr=$('radar-refresh');if(rr){rr.disabled=true;rr.textContent='↻ RADAR TARANIYOR…'}try{let r=await fetch('/api/scan?exchange='+encodeURIComponent(current)+(force?'&force=1':'')+'&_='+Date.now(),{cache:'no-store'});let j=await r.json();if(!r.ok)throw Error(j.error||'Bağlantı hatası');if(j.version!=='0.6.65')throw Error('Eski sunucu çalışıyor: '+(j.version||'sürüm yok')+'. Önce eski BAT penceresini kapatın.');if(current!==exchange)return;usdTryRate=(current==='tr'&&Number(j.usd_try)>0)?Number(j.usd_try):null;data=j.rows;renderLosers();renderGainers();renderFavorites();bgmOpportunityAlarm();const rg=j.market_regime||{};const lab=rg.label;$('advantage-label').textContent=(lab==='ALTCOIN'?'🟢 ALTCOIN':lab==='MAJORS'?'🟠 BTC + ETH':lab==='NÖTR'?'⚪ NÖTR':'⏳ VERİ BEKLENİYOR');$('btc-power').innerHTML=(rg.btc_power??'—')+'<em>/100</em>';$('alt-power').innerHTML=(rg.alt_power??'—')+'<em>/100</em>';$('btc-power-bar').style.width=(rg.btc_power==null?0:Number(rg.btc_power))+'%';$('alt-power-bar').style.width=(rg.alt_power==null?0:Number(rg.alt_power))+'%';$('advantage-reason').textContent=rg.reason||'Piyasa karşılaştırması bekleniyor.';if($('alt-breadth'))$('alt-breadth').textContent=rg.alt_positive_pct==null?'Piyasa genişliği bekleniyor':'Pozitif altcoin %'+Number(rg.alt_positive_pct).toFixed(0)+' · '+(rg.alt_count||0)+' coin';const q=j.quote||'';const usdFp=(v)=>v==null?'—':'$'+Number(v).toLocaleString('en-US',{maximumFractionDigits:2});$('btc-market-price').textContent=usdFp(rg.btc_price);$('eth-market-price').textContent=usdFp(rg.eth_price);if($('usdt-try-rate'))$('usdt-try-rate').textContent=(Number(j.usd_try)>0?'₺'+Number(j.usd_try).toLocaleString('tr-TR',{maximumFractionDigits:4}):'—');if($('bull-scenario'))$('bull-scenario').textContent=rg.btc_breakout?'BTC $'+Number(rg.btc_breakout).toLocaleString('en-US',{maximumFractionDigits:0})+' üzeri + güç teyidi':'BTC kırılımı + piyasa teyidi bekleniyor';if($('bear-scenario'))$('bear-scenario').textContent=rg.btc_support?'BTC $'+Number(rg.btc_support).toLocaleString('en-US',{maximumFractionDigits:0})+' altı risk artar':'BTC destek kırılımı izleniyor';$('btc-market-change').textContent=rg.btc_chg==null?'24s —':'24s '+Number(rg.btc_chg).toFixed(2)+'%';$('eth-market-change').textContent=rg.eth_chg==null?'24s —':'24s '+Number(rg.eth_chg).toFixed(2)+'%';lastScanAt=j.timestamp||Date.now();nextScanAt=0;bgmRadarLastSuccess=Date.now();bgmRadarLastMarket=current;bgmRadarLastFailure=false;bgmRadarStamp();const counts=data.reduce((a,x)=>(a[x.state]=(a[x.state]||0)+1,a),{});status('CANLI '+j.quote+' · '+j.analyzed+'/'+j.attempted+' analiz edildi · '+j.error_count+' hata');$('market-caption').textContent=j.note;$('radar-status').textContent=`Son radar taraması: ${new Date(lastScanAt).toLocaleTimeString('tr-TR')} · Teyitli: ${counts.confirmed||0} · Hazırlık: ${counts.preparing||0} · Bekle: ${counts.wait||0} · Veri eksik: ${counts.unavailable||0} · Yenileme: MANUEL`;$('radar-foot').textContent=`${j.universe} aktif ${j.quote} spot parite · ${j.attempted} denendi · ${j.analyzed} analiz edildi · ${j.error_count} veri hatası (${Object.entries(j.error_types||{}).map(([k,v])=>k+': '+v).join(', ')||'yok'}) · ${j.new_count} yeni görülen. Son güncelleme: ${new Date(j.timestamp).toLocaleString('tr-TR')}. ${j.error_details?.length?'Hatalar: '+j.error_details.map(e=>e.symbol+' ['+e.category+']: '+e.message).join(' | '):''}`;if(data.length)await select(data.find(x=>selected&&x.symbol===selected.symbol)||data.find(x=>x.analyzed)||data[0]);else{$('coin-rows').innerHTML='<tr><td colspan="11">Veri bulunamadı.</td></tr>'}}catch(e){if(current!==exchange)return;bgmRadarLastFailure=true;bgmRadarStamp();status('VERİ HATASI');$('radar-foot').textContent='Canlı veri alınamadı: '+e.message+(current==='tr'?' · TR bağlantı kontrolü: http://127.0.0.1:8537/api/tr-check':'');$('coin-rows').innerHTML='<tr><td colspan="11">Veri alınamadı. İnternet bağlantısını kontrol edin.</td></tr>'}finally{$('scan').disabled=false;const rr=$('radar-refresh');if(rr){rr.disabled=false;rr.textContent='↻ RADARI ŞİMDİ YENİLE'}scanInFlight=false}}
$('global').onclick=()=>{exchange='global';bgmRadarStamp();$('global').classList.add('selected');$('tr').classList.remove('selected');$('quote').textContent='/ USDT';$('market').textContent='USDT Spot';$('market-caption').textContent='Binance Global · herkese açık veri';$('quote').textContent='/ USDT';data=[];selected=null;renderRows();$('chart').textContent='Global taraması bekleniyor';scan()};$('tr').onclick=()=>{exchange='tr';bgmRadarStamp();$('tr').classList.add('selected');$('global').classList.remove('selected');data=[];selected=null;renderRows();$('quote').textContent='/ TRY';$('market').textContent='TRY Spot';$('market-caption').textContent='Binance TR · herkese açık veri';$('chart').textContent='Binance TR taraması bekleniyor';$('comment').textContent='Binance TR verisi bekleniyor';scan()};document.querySelectorAll('#periods button').forEach(b=>b.onclick=()=>{period=b.textContent==='1D'?'1d':b.textContent;document.querySelectorAll('#periods button').forEach(z=>z.classList.toggle('on',z===b));if(selected)select(selected)});document.querySelectorAll('.filters button').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('.filters button').forEach(z=>z.classList.toggle('active',z===b));renderRows()});const titles={dashboard:'Genel Bakış',radar:'Fırsat Radarı',losers:'Düşenler & Tepki',analysis:'Coin Analizi',gainers:'En Çok Çıkanlar',favorites:'Favoriler'};document.querySelectorAll('#nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('#nav button').forEach(z=>z.classList.toggle('active',z===b));$('page-title').textContent=titles[b.dataset.page];$('heading').textContent=titles[b.dataset.page];let target=b.dataset.page==='radar'?'radar-panel':b.dataset.page==='losers'?'losers-panel':b.dataset.page==='analysis'?'chart':b.dataset.page==='gainers'?'gainers-panel':b.dataset.page==='favorites'?'favorites-panel':null;if(target){if(b.dataset.page==='radar'||b.dataset.page==='losers'||b.dataset.page==='gainers'||b.dataset.page==='favorites'){const sc=$(target).querySelector('.table-scroll');if(sc)sc.scrollTop=0;$(target).scrollIntoView({behavior:'smooth',block:'start'});}else $(target).scrollIntoView({behavior:'smooth',block:'center'});}});$('scan').onclick=()=>{if(!exchange){status('ÖNCE BİNANCE TR VEYA GLOBAL SEÇİN');$('radar-foot').textContent='Tarama başlamadı. Üstte Binance TR veya Binance Global düğmesine basın.';return}scan(true)};const radarRefresh=$('radar-refresh');if(radarRefresh)radarRefresh.onclick=()=>{if(!exchange){status('ÖNCE BİNANCE TR VEYA GLOBAL SEÇİN');return}scan(true)};$('refresh-chart').onclick=()=>loadChart();const stateHead=$('state-sort');if(stateHead)stateHead.onclick=()=>{stateSort=stateSort===1?-1:1;stateHead.textContent='HAREKET DURUMU '+(stateSort===1?'▲':'▼');renderRows();};const defaultSort=$('default-radar-sort');if(defaultSort){defaultSort.style.cursor='pointer';defaultSort.onclick=()=>{tableSort={key:null,dir:-1};stateSort=0;document.querySelectorAll('#radar-panel thead th[data-sort]').forEach(h=>h.textContent=h.textContent.replace(/ [▲▼]$/,''));renderRows();status('BGM TRADER ANA SIRALAMASI');};}document.querySelectorAll('#radar-panel thead th[data-sort]').forEach(th=>{th.style.cursor='pointer';th.style.userSelect='none';th.title='Sıralamak için tıkla';th.onclick=()=>{const key=th.dataset.sort;tableSort=(tableSort.key===key)?{key,dir:-tableSort.dir}:{key,dir:-1};stateSort=0;document.querySelectorAll('#radar-panel thead th[data-sort]').forEach(h=>{const base=h.textContent.replace(/ [▲▼]$/,'');h.textContent=base+(h===th?(tableSort.dir===-1?' ▼':' ▲'):'');});renderRows();};});const planModeIn=$('plan-mode'),stopPctIn=$('stop-pct'),t1PctIn=$('t1-pct'),t2PctIn=$('t2-pct'),positionAmountIn=$('plan-position-amount'),planEntryIn=$('plan-entry-price'),planFeeIn=$('plan-fee-pct'),stopAmountIn=$('stop-amount'),t1AmountIn=$('t1-amount'),t2AmountIn=$('t2-amount');function syncPlanSettings(){if(!planModeIn)return;localStorage.setItem('bgm_plan_mode',planModeIn.value);localStorage.setItem('bgm_stop_pct',stopPctIn.value);localStorage.setItem('bgm_t1_pct',t1PctIn.value);localStorage.setItem('bgm_t2_pct',t2PctIn.value);localStorage.setItem('bgm_plan_position_amount',positionAmountIn.value);if(selected&&planEntryIn.value)localStorage.setItem(bgmPlanEntryKey(selected),planEntryIn.value);localStorage.setItem('bgm_plan_fee_pct',planFeeIn.value);localStorage.setItem('bgm_stop_amount',stopAmountIn.value);localStorage.setItem('bgm_t1_amount',t1AmountIn.value);localStorage.setItem('bgm_t2_amount',t2AmountIn.value);const manual=planModeIn.value==='manual',amount=planModeIn.value==='manual_amount';$('pct-plan-inputs').style.display=manual?'flex':'none';$('amount-plan-inputs').style.display=amount?'flex':'none';[stopPctIn,t1PctIn,t2PctIn].forEach(e=>e.disabled=!manual);[positionAmountIn,planEntryIn,planFeeIn,stopAmountIn,t1AmountIn,t2AmountIn].forEach(e=>e.disabled=!amount);$('plan-settings-note').textContent=amount?'Net hedefi girin; planlanan alış fiyatı ve iki yön komisyonla gerçek hedef/stop hesaplanır.':manual?'Yüzdeyi girin; hedef fiyatlar anında hesaplanır.':'ATR/destek tabanlı teknik plan.';if(selected)renderPlan(selected,selected.price)}if(planEntryIn)planEntryIn.addEventListener('input',()=>{planEntryIn.dataset.manual='1';if(selected){planEntryIn.dataset.coin=String(selected.coin);localStorage.setItem(bgmPlanEntryKey(selected),planEntryIn.value)}});
if(planModeIn){planModeIn.value=localStorage.getItem('bgm_plan_mode')||'auto';stopPctIn.value=localStorage.getItem('bgm_stop_pct')||'3';t1PctIn.value=localStorage.getItem('bgm_t1_pct')||'5';t2PctIn.value=localStorage.getItem('bgm_t2_pct')||'9';positionAmountIn.value=localStorage.getItem('bgm_plan_position_amount')||'30000';planEntryIn.value='';planFeeIn.value=localStorage.getItem('bgm_plan_fee_pct')||'0.10';stopAmountIn.value=localStorage.getItem('bgm_stop_amount')||'1000';t1AmountIn.value=localStorage.getItem('bgm_t1_amount')||'1500';t2AmountIn.value=localStorage.getItem('bgm_t2_amount')||'3000';[planModeIn,stopPctIn,t1PctIn,t2PctIn,positionAmountIn,planEntryIn,planFeeIn,stopAmountIn,t1AmountIn,t2AmountIn].forEach(e=>e.addEventListener('input',syncPlanSettings));syncPlanSettings();}
status('PİYASA SEÇİMİ BEKLENİYOR');$('coin-rows').innerHTML='<tr><td colspan="11">Taramak istediğiniz piyasayı üstten seçin: Binance TR veya Binance Global.</td></tr>';setInterval(()=>{if(selected)loadChart()},20000);// V1.0.14: ağır radar taraması varsayılan olarak MANUEL; otomatik yeniden tarama kapalı.

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

/* ===== BGM COIN PRO V1.0.18 · REFERANS ALIS SENKRON + NET TL HEDEF + KOMISYON ===== */
const bgmSortState={losers:null,gainers:null,favorites:null,burst:null,quick:null};
let bgmAlarmEnabled=localStorage.getItem('bgm_opportunity_alarm')!=='0',bgmAlarmPrimed=false,bgmPrevOpportunity=new Set();
function bgmGrade(g){if(!g)return {code:'—',label:'—',rank:0};if(g.traderRank===4&&!(g.veto||[]).length&&g.traderScore>=88&&g.criticalOk>=g.criticalTotal-1)return {code:'A+',label:'🔥 A+ GÜÇLÜ ADAY',rank:6};if(g.traderRank===4)return {code:'A',label:'🟢 A İŞLEME UYGUN',rank:5};if(g.traderRank===3)return {code:'B',label:'🟡 B TEYİDE ÇOK YAKIN',rank:4};if(g.traderRank===2)return {code:'C',label:'🔵 C İZLE',rank:3};if(g.traderRank===1)return {code:'K',label:'🟠 KOVALAMA',rank:1};return {code:'X',label:'🔴 İŞLEM YOK',rank:0}}
function bgmBeep(){if(!bgmAlarmEnabled)return;try{const C=window.AudioContext||window.webkitAudioContext,ctx=new C(),o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.value=880;g.gain.setValueAtTime(.0001,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.16,ctx.currentTime+.02);g.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.45);o.start();o.stop(ctx.currentTime+.46)}catch(_){}}
function bgmOpportunityAlarm(){const now=new Set(data.filter(bgmEligible).map(x=>({x,g:bgmTraderGate(x,'radar')})).filter(z=>{const q=bgmGrade(z.g);return q.code==='A+'||q.code==='A'}).map(z=>String(z.x.symbol)));if(bgmAlarmPrimed){const fresh=[...now].filter(k=>!bgmPrevOpportunity.has(k));if(fresh.length){bgmBeep();const names=fresh.slice(0,4).map(k=>data.find(x=>String(x.symbol)===k)?.coin||k).join(', ');status('🔔 YENİ İŞLEME UYGUN: '+names)}}bgmPrevOpportunity=now;bgmAlarmPrimed=true}

function bgmNum(v,d=0){v=Number(v);return Number.isFinite(v)?v:d}
function bgmPlanEntryKey(x){return 'bgm_plan_entry_'+String(exchange||'market')+'_'+String((x&&x.coin)||'').toUpperCase()}
function bgmPlanEntryForCoin(x){return Math.max(0,bgmNum(localStorage.getItem(bgmPlanEntryKey(x)),0))}
function bgmReferenceEntry(x){const saved=bgmPlanEntryForCoin(x);if(saved>0)return saved;const p=bgmNum(x&&x.plan_buy);return p>0?p:bgmNum(x&&x.price)}
function bgmFeeRate(){return Math.max(0,bgmNum(localStorage.getItem('bgm_plan_fee_pct'),0.10))/100}
function bgmNetTargetPct(gain,pos){const f=bgmFeeRate();pos=Math.max(1,bgmNum(pos,1));gain=Math.max(0,bgmNum(gain,0));return ((1+f+gain/pos)/(1-f)-1)*100}
function bgmNetStopPct(loss,pos){const f=bgmFeeRate();pos=Math.max(1,bgmNum(pos,1));loss=Math.max(0,bgmNum(loss,0));const mult=(1+f-loss/pos)/(1-f);return Math.max(.01,(1-mult)*100)}
function bgmAmountPlan(entry){const pos=Math.max(1,bgmNum(localStorage.getItem('bgm_plan_position_amount'),30000)),loss=Math.max(0,bgmNum(localStorage.getItem('bgm_stop_amount'),1000)),g1=Math.max(0,bgmNum(localStorage.getItem('bgm_t1_amount'),1500)),g2=Math.max(g1,bgmNum(localStorage.getItem('bgm_t2_amount'),3000)),f=bgmFeeRate();entry=Math.max(.0000000001,bgmNum(entry,1));const t1pct=bgmNetTargetPct(g1,pos),t2pct=bgmNetTargetPct(g2,pos),stoppct=bgmNetStopPct(loss,pos);return {pos,loss,g1,g2,f,t1pct,t2pct,stoppct,t1:entry*(1+t1pct/100),t2:entry*(1+t2pct/100),stop:entry*(1-stoppct/100)}}
function quickTargetPct(){const mode=localStorage.getItem('bgm_plan_mode')||'auto';if(mode==='manual_amount'){const pos=bgmNum(localStorage.getItem('bgm_plan_position_amount'),30000),gain=bgmNum(localStorage.getItem('bgm_t1_amount'),1500);return bgmNetTargetPct(gain,pos)}if(mode==='manual')return Math.max(.1,bgmNum(localStorage.getItem('bgm_t1_pct'),5));return 2}
function quickStopPct(x){const mode=localStorage.getItem('bgm_plan_mode')||'auto';if(mode==='manual_amount'){const pos=bgmNum(localStorage.getItem('bgm_plan_position_amount'),30000),loss=bgmNum(localStorage.getItem('bgm_stop_amount'),1000);return bgmNetStopPct(loss,pos)}if(mode==='manual')return Math.max(.1,bgmNum(localStorage.getItem('bgm_stop_pct'),3));if(bgmNum(x.plan_stop)>0&&bgmNum(x.price)>bgmNum(x.plan_stop))return (bgmNum(x.price)-bgmNum(x.plan_stop))/bgmNum(x.price)*100;return Math.max(.5,bgmNum(x.atr_pct,1.5)*1.5)}
/* V1.0.12 independent 12+ factor risk-first trader gate; 1h CLOSED candle data */
const BGM_STABLE=new Set(['USDT','USDC','FDUSD','TUSD','USDD','DAI','USDP','PYUSD','EURC','AEUR','USD1','RLUSD','EURI','BUSD','USTC','UST','LUSD','GUSD','FRAX','USDE','USD0','SUSDE']);
function bgmEligible(x){const coin=String(x.coin||'').toUpperCase(),symbol=String(x.symbol||'').toUpperCase();return !!x.analyzed&&!BGM_STABLE.has(coin)&&!/^\d*(USDT|USDC|FDUSD|TUSD|USDD|USDP|PYUSD|EURC|BUSD|DAI)$/.test(coin)&&bgmNum(x.price)>0&&!!symbol;}
function bgmTraderGate(x,kind){
 const n=(k,d=NaN)=>{const v=Number(x[k]);return x[k]===null||x[k]===undefined||x[k]===''?d:(Number.isFinite(v)?v:d)};
 const px=n('price'),vol=n('volume'),acc=n('volume_acceleration'),buy=n('buy_volume_share'),rsi=n('rsi'),rsiPrev=n('rsi_previous'),hist=n('macd_hist'),prev=n('macd_hist_previous'),ma7=n('ma7'),ma21=n('ma21'),ma50=n('ma50'),atr=n('atr_pct'),range=n('last_range_pct'),wick=n('upper_wick_pct'),lowerWick=n('lower_wick_pct'),body=n('candle_body_pct'),compression=n('compression_ratio'),response=n('price_response_pct'),down=n('recent_down_candles'),jump=n('jump_score'),chg=n('chg'),liq=n('quote_volume'),breakout=n('breakout_level'),high=n('high24'),low=n('low24'),support=n('support_level'),entry=n('entry'),confirm=n('confirmation'),prep=n('preparation'),strength=n('strength'),potential=n('potential_score'),confidence=n('confidence_score');
 const factors=[],positives=[],risks=[],veto=[];
 const add=(name,good,bad,ok,detail,critical=false)=>{factors.push({name,ok:!!ok,detail,critical});if(ok&&good)positives.push(good);if(!ok&&bad)risks.push(bad)};
 const required=['price','volume','volume_acceleration','buy_volume_share','rsi','rsi_previous','macd_hist','macd_hist_previous','ma7','ma21','ma50','atr_pct','last_range_pct','upper_wick_pct','lower_wick_pct','candle_body_pct','compression_ratio','price_response_pct','recent_down_candles','jump_score','quote_volume','breakout_level','support_level','high24','low24','entry','confirmation','preparation','strength'];
 const missing=required.filter(k=>!Number.isFinite(n(k)));if(missing.length)veto.push('Kritik veri eksik: '+missing.slice(0,5).join(', '));
 const macdDelta=hist-prev, rsiDelta=rsi-rsiPrev, supportDist=(px-support)/px*100, breakoutDist=(breakout-px)/px*100;
 const dayPos=(Number.isFinite(high)&&Number.isFinite(low)&&high>low)?(px-low)/(high-low)*100:NaN;
 // 30 bağımsız ortak trader kontrolü. Üç ana radar aynı kapıdan geçer.
 add('01 VOL yeterliliği','VOL yeterli','Hacim teyidi zayıf',vol>=1.10,`VOL ${vol.toFixed(2)}x`,true);
 add('02 Hacim ivmesi','Hacim ivmesi artıyor','Hacim ivmesi zayıf',acc>=1.08,`İvme ${acc.toFixed(2)}x`,true);
 add('03 Alım payı','Alım baskısı destekliyor','Satış baskısı yüksek',buy>=53,`Alım %${buy.toFixed(0)}`,true);
 add('04 Hacim yönü','Hacim yönü satış değil','Hacim yönü satış',String(x.volume_direction||'')!=='SATIS',String(x.volume_direction||'—'),true);
 add('05 Fiyat-hacim tepkisi','Fiyat hacme cevap veriyor','Hacim fiyatla doğrulanmıyor',response>0.10,`Tepki %${response.toFixed(2)}`,true);
 add('06 Yüksek hacim doğrulaması','Yüksek hacim boşa gitmiyor','Yüksek hacim var fiyat ilerlemiyor',!(vol>=2.0&&response<=0.05),`VOL ${vol.toFixed(2)}x / tepki %${response.toFixed(2)}`,true);
 add('07 MACD ivmesi','MACD ivmesi olumlu','MACD histogramı zayıflıyor',macdDelta>0,`Δ ${macdDelta.toPrecision(3)}`,true);
 add('08 MACD seviyesi','MACD pozitif','MACD negatif bölgede',hist>0,`Hist ${hist.toPrecision(3)}`);
 add('09 MACD dönüşü','MACD dönüş/kuvvet teyidi','MACD dönüş teyidi yok',hist>0||macdDelta>Math.abs(prev)*.08,`Önceki ${prev.toPrecision(3)}`);
 add('10 RSI bölgesi','RSI sağlıklı bölgede','RSI bölgesi uygun değil',rsi>=45&&rsi<=68,`RSI ${rsi.toFixed(1)}`,true);
 add('11 RSI eğimi','RSI güçleniyor','RSI geriliyor',rsiDelta>0,`Δ ${rsiDelta.toFixed(1)}`,true);
 add('12 RSI hareket alanı','RSI için yukarı alan var','RSI fazla ısınmış',rsi<70,`RSI ${rsi.toFixed(1)}`,true);
 add('13 MA7/21 dizilimi','Kısa trend olumlu','MA7/21 zayıf',ma7>ma21,'MA7 > MA21',true);
 add('14 MA21/50 dizilimi','Orta trend olumlu','MA21/50 zayıf',ma21>ma50,'MA21 > MA50');
 add('15 Fiyat MA7','Fiyat MA7 üstünde','Fiyat MA7 altında',px>=ma7,'Fiyat/MA7',true);
 add('16 Fiyat MA21','Fiyat MA21 üstünde','Fiyat MA21 altında',px>=ma21,'Fiyat/MA21');
 add('17 MA7 uzaklığı','MA7 aşırı uzak değil','Fiyat MA7’den fazla uzak',px<ma7*1.045,'MA7 kovalamama');
 add('18 Mum gövdesi','Mum gövdesi yeterli','Mum gövdesi zayıf',body>=35,`Gövde %${body.toFixed(0)}`);
 add('19 Üst fitil','Üst fitil sınırlı','Uzun üst fitil satış baskısı',wick<=38,`Üst fitil %${wick.toFixed(0)}`,true);
 add('20 Alt fitil dengesi','Alt fitil kabul edilebilir','Alt fitil aşırı/kararsızlık',lowerWick<=55,`Alt fitil %${lowerWick.toFixed(0)}`);
 add('21 Sıkışma','Sıkışma/birikim uygun','Sıkışma avantajı yok',compression<=1.0,`Sıkışma ${compression.toFixed(2)}x`);
 add('22 Satış mumları','Ardışık satış baskısı düşük','Son mumlarda satış baskısı',down<=1,`${down}/4 satış mumu`,true);
 add('23 ATR kontrolü','ATR kontrol altında','ATR yüksek riskli',atr>0&&atr<=3.8,`ATR %${atr.toFixed(2)}`,true);
 add('24 Son mum volatilitesi','Son mum normal aralıkta','Ani mum genişlemesi',range<=Math.max(2.8,atr*2.15),`Aralık %${range.toFixed(2)}`,true);
 add('25 Likidite','Likidite yeterli','Likidite düşük',liq>=(exchange==='tr'?10000000:1500000),`24s ${Math.round(liq)}`,true);
 add('26 Sıçrama riski','Henüz aşırı sıçramamış','Sıçrama/kovalama riski',jump<60,`Sıçrama ${jump.toFixed(0)}`,true);
 add('27 24s uzama','24s hareketi aşırı değil','24s hareketi fazla uzamış',chg<6.0,`24s %${chg.toFixed(2)}`,true);
 add('28 Giriş kalitesi','Giriş kalitesi yeterli','Giriş kalitesi düşük',entry>=60,`Giriş ${entry}/100`,true);
 add('29 Hareket teyidi','Hareket teyidi yeterli','Hareket teyidi düşük',confirm>=55,`Teyit ${confirm}/100`,true);
 add('30 Hazırlık/teknik yapı','Hazırlık ve teknik yapı yeterli','Kurulum henüz zayıf',prep>=50&&strength>=55,`Hazırlık ${prep} / teknik ${strength}`,true);
 // Ek bağlamsal kontroller toplamı 30'un üstüne çıkarabilir; radar amacına göre kullanılır.
 add('31 Destekten uzaklık','Destek mesafesi makul','Destekten fazla uzak',supportDist>=0&&supportDist<=Math.max(6,atr*3),`Destek mesafe %${supportDist.toFixed(2)}`);
 add('32 Gün içi konum','24s konumu kovalama bölgesinde değil','24s tepesine fazla yakın',Number.isFinite(dayPos)&&dayPos<=88,`24s konum ${Number.isFinite(dayPos)?dayPos.toFixed(0):'—'}%`);
 if(vol>=2.3&&response<=0.05)veto.push('Yüksek hacim var fakat fiyat ilerlemiyor');
 if(hist<prev&&buy<50)veto.push('MACD ve hacim yönü birlikte zayıflıyor');
 if(rsi>=74)veto.push('RSI aşırı alım');
 // Kovalama yalnızca gerçekten uzamış harekette sert veto olur; orta sıçrama B/C adayını öldürmez.
 const hardChase=(jump>=85&&((Number.isFinite(dayPos)&&dayPos>=90)||chg>=6||rsi>=72))||chg>=10;
 if(hardChase)veto.push('Sıçrama/kovalama riski yüksek');
 else if(jump>=60||chg>=6)risks.push('Hareket ilerlemiş; giriş için retest/teyit gerekli');
 if(wick>=55&&vol>=1.4)veto.push('Yüksek hacimde uzun üst fitil');
 if(atr>=5||range>=Math.max(4,atr*2.6))veto.push('Ani volatilite ve stop riski');
 if(liq<(exchange==='tr'?5000000:750000))veto.push('Likidite alt sınırın altında');
 if(entry<50||confirm<45)veto.push('Giriş/teyit yetersiz');
 if(ma7<=ma21&&hist<prev)veto.push('Kısa trend ve MACD birlikte zayıf');
 let room=NaN,rr=NaN,target=NaN,stop=NaN;
 if(kind==='quick'){
  target=quickTargetPct();
  // V1.0.18: Hızlı Trade hesabının tek tabanı coin'in REFERANS ALIŞ fiyatıdır; canlı fiyat ayrı izlenir.
  const qEntry=bgmReferenceEntry(x)>0?bgmReferenceEntry(x):px;
  const qPlan=bgmAmountPlan(qEntry), qTarget=qEntry*(1+target/100);
  const manualStop=quickStopPct(x);
  const technicalStop=(Number.isFinite(support)&&support>0&&support<qEntry)?(qEntry-support)/qEntry*100:NaN;
  const planStop=(bgmNum(x.plan_stop)>0&&bgmNum(x.plan_stop)<qEntry)?(qEntry-bgmNum(x.plan_stop))/qEntry*100:NaN;
  const amountStop=(qPlan.stop>0&&qPlan.stop<qEntry)?(qEntry-qPlan.stop)/qEntry*100:NaN;
  const stopCandidates=[technicalStop,planStop,amountStop].filter(v=>Number.isFinite(v)&&v>=.25&&v<=12);
  stop=stopCandidates.length?Math.min(...stopCandidates):manualStop;
  if(!(stop>0&&stop<25))stop=Math.max(.5,Math.min(8,atr*1.5));
  rr=target/Math.max(stop,0.0001);
  const candidates=[breakout,high].filter(v=>Number.isFinite(v)&&v>qEntry);room=candidates.length?(Math.min(...candidates)-qEntry)/qEntry*100:NaN;
  const liveDistance=(px-qEntry)/qEntry*100;
  if(liveDistance>Math.max(1.25,target*.55))risks.push(`Canlı fiyat referans girişten %${liveDistance.toFixed(2)} yukarıda; kovalama riski`);
  if(px>=qTarget)veto.push('Canlı fiyat H1 hedefini geçmiş; bu giriş planı artık geçerli değil');
  add('33 Hedefe temiz alan','Hedefe direnç boşluğu var','Hedefe temiz alan doğrulanmadı',Number.isFinite(room)&&room>=target*1.2,`Hedef %${target.toFixed(2)}, alan ${Number.isFinite(room)?'%'+room.toFixed(2):'bilinmiyor'}`,true);
  add('34 Risk/getiri','Risk/getiri yeterli','Risk/getiri yetersiz',rr>=1.5,`R:R ${rr.toFixed(2)}`,true);
  if(!Number.isFinite(room)||room<target*1.2)veto.push('Hedefe kadar doğrulanmış temiz alan yok');
  if(rr<1.5)veto.push('R:R 1.5 altında');
  if(stop<Math.max(.25,atr*.5))veto.push('Stop normal oynaklığa göre çok dar');
 }else{
  add('33 Kırılım konumu','Kırılım mesafesi makul','Kırılım seviyesi uygun değil',breakoutDist>=-.3&&breakoutDist<=3,`Kırılıma %${breakoutDist.toFixed(2)}`,true);
  if(breakoutDist < -2)veto.push('Kırılımın üzerinde fazla uzamış');
 }
 const ok=factors.filter(f=>f.ok).length,total=factors.length,score=Math.round(ok/total*100);
 const critical=factors.filter(f=>f.critical),criticalOk=critical.filter(f=>f.ok).length,criticalTotal=critical.length;
 // Kademeli karar: KOVALAMA sadece gerçek uzama; diğer eksikler B/C/İŞLEM YOK olarak ayrılır.
 let traderRank=0,label='🔴 İŞLEM YOK';
 const chaseVeto=veto.some(v=>v.includes('Sıçrama/kovalama')||v.includes('Kırılımın üzerinde'));
 const hardBlock=veto.some(v=>v.includes('Kritik veri eksik')||v.includes('Likidite alt')||v.includes('Ani volatilite')||v.includes('RSI aşırı')||v.includes('Hedefe kadar')||v.includes('R:R 1.5')||v.includes('Stop normal'));
 if(chaseVeto){traderRank=1;label='🟠 KOVALAMA'}
 else if(!veto.length&&criticalOk>=criticalTotal-1&&score>=82){traderRank=4;label='🟢 İŞLEME UYGUN'}
 else if(!hardBlock&&score>=68&&criticalOk>=criticalTotal-5){traderRank=3;label='🟡 TEYİDE ÇOK YAKIN'}
 else if(!hardBlock&&score>=52){traderRank=2;label='🔵 İZLE'}
 else {traderRank=0;label='🔴 İŞLEM YOK'}
 const grade=bgmGrade({traderRank,traderScore:score,criticalOk,criticalTotal,veto});
 return {traderRank,traderLabel:label,traderGrade:grade.code,traderGradeLabel:grade.label,traderGradeRank:grade.rank,traderScore:score,passed:ok,total,criticalOk,criticalTotal,veto,positives,risks,factors,room,rr,target,stop,wait:veto[0]||risks[0]||'Hacim, momentum ve fiyat teyidinin birlikte güçlenmesi bekleniyor'};
}
function burstProfile(x){
 const g=bgmTraderGate(x,'burst'),jump=bgmNum(x.jump_score),prep=bgmNum(x.preparation),conf=bgmNum(x.confidence_score),vol=bgmNum(x.volume),acc=bgmNum(x.volume_acceleration);
 const score=Math.max(0,Math.min(100,Math.round(prep*.30+conf*.20+Math.min(vol*35,100)*.15+Math.min(acc*45,100)*.15+g.traderScore*.20-jump*.30)));
 let burstRank=0,label='🔴 UYGUN DEĞİL';if(jump>=70){burstRank=1;label='🟠 GEÇ KALINDI / SIÇRAMIŞ'}else if(g.traderRank===4&&score>=72){burstRank=4;label='🔥 PATLAMA YAKIN'}else if(g.traderRank>=3&&score>=60){burstRank=3;label='🟢 ERKEN SİNYAL'}else if(score>=42){burstRank=2;label='🟡 İZLE / TEYİT BEKLE'};
 return {...g,burstScore:score,burstRank,label,positive:g.positives,risks:g.veto.concat(g.risks),wait:g.wait};
}
function quickProfile(x){
 const g=bgmTraderGate(x,'quick'),entry=bgmNum(x.entry),conf=bgmNum(x.confidence_score),confirm=bgmNum(x.confirmation);
 const score=Math.max(0,Math.min(100,Math.round(entry*.30+conf*.20+confirm*.20+g.traderScore*.30)));
 let quickRank=0,label='🔴 İŞLEM YOK / UZAK DUR';if(g.traderRank===4&&score>=76){quickRank=4;label='🟢 TRADE UYGUN'}else if(g.traderRank===4&&score>=66){quickRank=3;label='🔥 ERKEN GÜÇLENME'}else if(g.traderRank===3){quickRank=2;label='🟡 TEYİT BEKLE'}else if(g.traderRank===2){quickRank=1;label='🔵 İZLE'}else if(g.traderRank===1){quickRank=0;label='🟠 KOVALAMA'};
 return {...g,quickTarget:g.target,quickStop:g.stop,quickRoom:g.room,quickRR:g.rr,quickScore:score,quickRank,label,positive:g.positives,risks:g.veto.concat(g.risks),wait:g.wait};
}

function bgmSortRows(rows,key,dir,profileKey){const aliases={trader_rank:'traderGradeRank',traderRank:'traderGradeRank',reactionOpportunity:'opportunity',reactionConfidence:'confidence'};const val=x=>{const k=aliases[key]||key;if(profileKey&&x[profileKey]&&k in x[profileKey])return x[profileKey][k];if(x._gate&&k in x._gate)return x._gate[k];if(x._reaction&&k in x._reaction)return x._reaction[k];return x[key]};return [...rows].sort((a,b)=>{const av=val(a),bv=val(b);if(key==='coin')return String(av||'').localeCompare(String(bv||''),'tr')*dir;return (bgmNum(av)-bgmNum(bv))*dir})}
function renderBurst(){const body=$('burst-rows');if(!body)return;let rows=data.filter(bgmEligible).map(x=>({...x,_burst:burstProfile(x)}));rows.sort((a,b)=>b._burst.traderRank-a._burst.traderRank||b._burst.burstRank-a._burst.burstRank||b._burst.traderScore-a._burst.traderScore||b._burst.burstScore-a._burst.burstScore||bgmNum(b.confidence_score)-bgmNum(a.confidence_score));const st=bgmSortState.burst;if(st)rows=bgmSortRows(rows,st.key,st.dir,'_burst');rows=rows.slice(0,40);body.innerHTML=rows.map((x,i)=>`<tr data-symbol="${x.symbol}"><td>${i+1}</td><td><button class="fav-star" data-fav="${x.coin}">${isFavorite(x.coin)?'★':'☆'}</button></td><td><b>${x.coin}</b></td><td><div class="trader-cell"><b>${x._burst.label}</b><small>${x._burst.risks[0]||x._burst.positive[0]||'çoklu veri kontrolü'}</small></div></td><td><div class="trader-cell"><b>${x._burst.traderGradeLabel}</b><small>${x._burst.passed}/${x._burst.total} kontrol · ${x._burst.veto.length} veto</small></div></td><td><b>${x._burst.burstScore}/100</b></td><td>${bgmNum(x.confidence_score)}/100</td><td>${bgmNum(x.preparation)}/100</td><td>${bgmNum(x.volume).toFixed(2)}×</td><td>${x.volume_direction||'—'} · %${bgmNum(x.buy_volume_share,50).toFixed(0)}</td><td>${bgmNum(x.rsi).toFixed(1)}</td><td>${bgmNum(x.jump_score)}/100</td><td><div class="trader-wait">${x._burst.wait}</div></td></tr>`).join('')||'<tr><td colspan="13">Analiz edilebilir coin yok.</td></tr>';bindSpecialRows(body);bgmStageCheckAlarm('burst',rows);$('burst-foot').textContent=`İlk ${rows.length} coin · Trader Kararı: 30+ kapanmış mum/teknik/risk kontrolü · Sıralama önce Trader Kararı · Yatırım tavsiyesi değildir.`}
function renderQuick(){const body=$('quick-rows');if(!body)return;let rows=data.filter(bgmEligible).map(x=>({...x,_quick:quickProfile(x)}));rows.sort((a,b)=>b._quick.traderRank-a._quick.traderRank||b._quick.quickRank-a._quick.quickRank||b._quick.traderScore-a._quick.traderScore||b._quick.quickScore-a._quick.quickScore);const st=bgmSortState.quick;if(st)rows=bgmSortRows(rows,st.key,st.dir,'_quick');rows=rows.slice(0,40);const target=quickTargetPct();body.innerHTML=rows.map((x,i)=>`<tr data-symbol="${x.symbol}"><td>${i+1}</td><td><button class="fav-star" data-fav="${x.coin}">${isFavorite(x.coin)?'★':'☆'}</button></td><td><b>${x.coin}</b></td><td><div class="trader-cell"><b>${x._quick.label}</b><small>${x._quick.risks[0]||x._quick.positive[0]||'hedef/risk kontrolü'}</small></div></td><td><div class="trader-cell"><b>${x._quick.traderGradeLabel}</b><small>${x._quick.passed}/${x._quick.total} kontrol · ${x._quick.veto.length} veto</small></div></td><td><b>${x._quick.quickScore}/100</b></td><td>%${x._quick.quickTarget.toFixed(2)}</td><td>%${(Number.isFinite(x._quick.quickRoom)?x._quick.quickRoom.toFixed(2):'—')}</td><td>${(Number.isFinite(x._quick.quickRR)?x._quick.quickRR.toFixed(2):'—')}</td><td>${bgmNum(x.volume).toFixed(2)}×</td><td>${bgmNum(x.jump_score)}/100</td><td><div class="trader-wait">${x._quick.wait}</div></td></tr>`).join('')||'<tr><td colspan="12">Analiz edilebilir coin yok.</td></tr>';bindSpecialRows(body);bgmStageCheckAlarm('quick',rows);$('quick-foot').textContent=`H1 net hedefi: %${target.toFixed(2)} · Her coin kendi referans alışından hesaplanır · Trader filtresi + direnç + R:R · Direnç verisi yoksa İŞLEM YOK · Yatırım tavsiyesi değildir.`}
function bindSpecialRows(body){body.querySelectorAll('.fav-star').forEach(b=>b.onclick=e=>{e.stopPropagation();toggleFavorite(b.dataset.fav)});body.querySelectorAll('tr[data-symbol]').forEach(tr=>tr.onclick=e=>{if(e.target.closest('.fav-star'))return;const x=data.find(v=>v.symbol===tr.dataset.symbol);if(x)openCoinAnalysis(x)})}
const bgmOldRenderRows=renderRows;renderRows=function(){bgmOldRenderRows();renderBurst();renderQuick()};
function openCoinAnalysis(x){if(!x)return;select(x);showView('analysis')}
const viewMap={dashboard:['intro-block','market-advantage','metrics-block','workspace-block'],burst:['burst-panel'],quick:['metrics-block','quick-panel'],radar:['radar-panel'],losers:['losers-panel'],analysis:['metrics-block','workspace-block'],gainers:['gainers-panel'],favorites:['favorites-panel']};
const viewTitles={dashboard:'Genel Bakış',burst:'Patlama Radarı',quick:'Hızlı Trade',radar:'Fırsat Radarı',losers:'Düşenler & Tepki',analysis:'Coin Analizi',gainers:'En Çok Çıkanlar',favorites:'Favoriler'};
function showView(name){document.querySelectorAll('[data-view-block]').forEach(el=>el.classList.add('view-hidden'));(viewMap[name]||viewMap.dashboard).forEach(id=>{const el=$(id);if(el)el.classList.remove('view-hidden')});document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===name));if($('page-title'))$('page-title').textContent=viewTitles[name]||name;if($('heading'))$('heading').textContent=name==='dashboard'?'Piyasa Genel Bakış':(viewTitles[name]||name);window.scrollTo({top:0,behavior:'instant'});const panel=$(name+'-panel');if(panel){const sc=panel.querySelector('.table-scroll');if(sc){sc.scrollTop=0;sc.scrollLeft=0}}}
document.querySelectorAll('#nav button').forEach(b=>b.onclick=()=>showView(b.dataset.page));
['coin-rows','loser-rows','gainer-rows','favorite-rows'].forEach(id=>{const body=$(id);if(body)body.addEventListener('click',e=>{if(e.target.closest('.fav-star'))return;const tr=e.target.closest('tr[data-symbol],tr[data-coin]');if(!tr)return;const x=data.find(v=>v.symbol===tr.dataset.symbol||v.coin===tr.dataset.coin);if(x)setTimeout(()=>openCoinAnalysis(x),0)})});
function initGenericSort(panelId,stateKey,rerender){const panel=$(panelId);if(!panel)return;panel.querySelectorAll('th[data-sort]').forEach(th=>{th.title='Sıralamak için tıkla';th.onclick=()=>{const key=th.dataset.sort,cur=bgmSortState[stateKey];bgmSortState[stateKey]=cur&&cur.key===key?{key,dir:-cur.dir}:{key,dir:-1};panel.querySelectorAll('th[data-sort]').forEach(h=>h.textContent=h.textContent.replace(/ [▲▼]$/,''));th.textContent=th.textContent.replace(/ [▲▼]$/,'')+(bgmSortState[stateKey].dir===-1?' ▼':' ▲');rerender()}});const d=panel.querySelector('th[data-default]');if(d)d.onclick=()=>{bgmSortState[stateKey]=null;panel.querySelectorAll('th[data-sort]').forEach(h=>h.textContent=h.textContent.replace(/ [▲▼]$/,''));rerender()}}
function sortExistingTable(panelId,col,dir){const panel=$(panelId),body=panel&&panel.querySelector('tbody');if(!body)return;const rows=[...body.querySelectorAll('tr')].filter(r=>r.cells.length>col);rows.sort((a,b)=>{const at=a.cells[col].innerText.trim().replace(/[₺$%,×+]/g,''),bt=b.cells[col].innerText.trim().replace(/[₺$%,×+]/g,'');const an=parseFloat(at.replace(/\./g,'').replace(',','.')),bn=parseFloat(bt.replace(/\./g,'').replace(',','.'));return (Number.isFinite(an)&&Number.isFinite(bn)?an-bn:at.localeCompare(bt,'tr'))*dir});rows.forEach(r=>body.appendChild(r))}
initGenericSort('burst-panel','burst',renderBurst);initGenericSort('quick-panel','quick',renderQuick);initGenericSort('losers-panel','losers',renderLosers);initGenericSort('gainers-panel','gainers',renderGainers);initGenericSort('favorites-panel','favorites',renderFavorites);
const alarmBtn=$('opportunity-alarm');if(alarmBtn){const paint=()=>alarmBtn.textContent=bgmAlarmEnabled?'🔊 ALARM AÇIK':'🔇 ALARM KAPALI';paint();alarmBtn.onclick=()=>{bgmAlarmEnabled=!bgmAlarmEnabled;localStorage.setItem('bgm_opportunity_alarm',bgmAlarmEnabled?'1':'0');paint();if(bgmAlarmEnabled)bgmBeep()}};

const scrollTopBtn=$('scroll-top');if(scrollTopBtn){scrollTopBtn.onclick=()=>window.scrollTo({top:0,behavior:'smooth'});window.addEventListener('scroll',()=>scrollTopBtn.classList.toggle('show',window.scrollY>420))}
if(planModeIn)[planModeIn,stopPctIn,t1PctIn,t2PctIn,positionAmountIn,stopAmountIn,t1AmountIn,t2AmountIn].forEach(e=>e&&e.addEventListener('input',()=>{renderQuick()}));

['burst-refresh','quick-refresh'].forEach(id=>{const b=$(id);if(b)b.onclick=()=>{if(!exchange){status('ÖNCE BİNANCE TR VEYA GLOBAL SEÇİN');return}scan(true)}});
showView('dashboard');

/* V1.0.21 radar auto-refresh: same Binance scan for both panels, no overlapping scans. */
const BGM_RADAR_REFRESH_MS=5*60*1000;
let bgmRadarLastSuccess=0;
let bgmRadarLastMarket='';
let bgmRadarLastFailure=false;
let bgmRadarLastAttempt=0;
function bgmRadarStamp(){
 const stale=bgmRadarLastSuccess&&Date.now()-bgmRadarLastSuccess>2*BGM_RADAR_REFRESH_MS;
 for(const kind of ['burst','quick']){
  const el=document.getElementById('bgm-'+kind+'-scan-time');if(!el)continue;
  if(!exchange){el.textContent='Son tarama: piyasa seçilmedi';continue;}
  if(bgmRadarLastMarket!==exchange||!bgmRadarLastSuccess){el.textContent='Son tarama: bekleniyor';continue;}
  const time=new Date(bgmRadarLastSuccess).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  el.textContent='Son tarama: '+time+(stale?' · GECİKMİŞ':bgmRadarLastFailure?' · YENİLEME HATASI':' · Otomatik 5 dk');
  el.title='Son başarılı tarama: '+new Date(bgmRadarLastSuccess).toLocaleString('tr-TR');
 }
}
setInterval(()=>{bgmRadarStamp();if(!exchange||scanInFlight||document.hidden)return;
 if(Date.now()-bgmRadarLastAttempt<BGM_RADAR_REFRESH_MS)return;
 if(bgmRadarLastMarket!==exchange||!bgmRadarLastSuccess||Date.now()-bgmRadarLastSuccess>=BGM_RADAR_REFRESH_MS)scan(true);
},15000);
/* V1.0.19 opt-in alarms. Compare transitions only; no alarms for initial scan. */
const bgmStageAlarmSeen={burst:new Map(),quick:new Map()};
const bgmStageAlarmLast={burst:new Map(),quick:new Map()};
let bgmStageAlarmMarket='';
function bgmStageAlarmEnabled(kind){return localStorage.getItem('bgm_alarm_'+kind)==='1'}
function bgmStageAlarmQualifies(kind,x){return kind==='burst' ? x._burst?.burstRank===4&&x._burst?.traderRank===4 : x._quick?.quickRank===4&&x._quick?.traderRank===4}
function bgmStageAlarmNotify(kind,coins){
 const title='BGM '+(kind==='burst'?'Patlama Radarı':'Hızlı Trade');
 const msg=coins.slice(0,4).join(', ')+' · yeni teyitli aday';
 const status=document.getElementById('bgm-'+kind+'-alarm-status');if(status)status.textContent=new Date().toLocaleTimeString('tr-TR')+' · '+msg;
 try{if('Notification' in window&&Notification.permission==='granted')new Notification(title,{body:msg});}catch(e){}
 try{const A=window.AudioContext||window.webkitAudioContext;if(A){const ctx=new A(),osc=ctx.createOscillator(),gain=ctx.createGain();osc.connect(gain);gain.connect(ctx.destination);osc.frequency.value=880;gain.gain.value=.045;osc.start();osc.stop(ctx.currentTime+.18);osc.onended=()=>ctx.close();}}catch(e){}
}
function bgmStageCheckAlarm(kind,rows){
 const market=String(exchange||'');if(market!==bgmStageAlarmMarket){bgmStageAlarmMarket=market;for(const k of ['burst','quick']){bgmStageAlarmSeen[k].clear();bgmStageAlarmLast[k].clear();}}
 if(!market)return;const seen=bgmStageAlarmSeen[kind],last=bgmStageAlarmLast[kind],now=Date.now(),fresh=[];
 for(const x of rows){const key=market+':'+x.symbol,qualified=bgmStageAlarmQualifies(kind,x),prior=seen.get(key);if(prior===false&&qualified&&now-(last.get(key)||0)>30*60*1000){fresh.push(x.coin);last.set(key,now)}seen.set(key,qualified)}
 if(bgmStageAlarmEnabled(kind)&&fresh.length)bgmStageAlarmNotify(kind,fresh);
}
function bgmStageInitAlarms(){for(const kind of ['burst','quick']){const btn=document.getElementById('bgm-'+kind+'-alarm');if(!btn)continue;const update=()=>{const on=bgmStageAlarmEnabled(kind);btn.setAttribute('aria-pressed',String(on));btn.textContent=on?'🔔 Alarm açık':'🔕 Alarm kapalı'};btn.addEventListener('click',async()=>{const on=!bgmStageAlarmEnabled(kind);localStorage.setItem('bgm_alarm_'+kind,on?'1':'0');update();if(on&&'Notification' in window&&Notification.permission==='default'){try{await Notification.requestPermission()}catch(e){}}});update();}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bgmStageInitAlarms);else bgmStageInitAlarms();
