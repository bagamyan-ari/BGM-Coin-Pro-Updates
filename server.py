"""BGM Coin PRO V0.6.65: public, read-only Binance Global and Binance TR market research."""
import json, os, threading, time, urllib.request, urllib.parse, urllib.error, webbrowser, math, hashlib, tempfile, subprocess
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from concurrent.futures import ThreadPoolExecutor, as_completed
from statistics import mean
from pathlib import Path
ROOT=Path(__file__).resolve().parent
GLOBAL='https://data-api.binance.vision/api/v3'
TR_SYMBOLS='https://www.binance.tr/open/v1/common/symbols'
TR_SYMBOLS_ALT='https://www.binance.tr/open/v1/common/symbols' 
TR_MAIN='https://api.binance.me/api/v1/klines'
TR_ALT='https://cloudme-tr.2meta.app/api/v1/klines'
CACHE={};LOCK=threading.RLock(); SCAN_LOCK=threading.Lock()
def fetch(url,params=None,ttl=60):
    url=url+('?' + urllib.parse.urlencode(params) if params else '')
    with LOCK:
        hit=CACHE.get(url)
        if hit and time.time()-hit[0]<ttl:return hit[1]
    req=urllib.request.Request(url,headers={'User-Agent':'BGM-Coin-Public-Research/0.6.52','Accept':'application/json'})
    last_error=None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req,timeout=14) as r: obj=json.load(r)
            break
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            last_error=exc
            if attempt==2:raise
            time.sleep(0.6*(attempt+1))
    with LOCK:CACHE[url]=(time.time(),obj)
    return obj
def global_get(path,params=None,ttl=60):return fetch(GLOBAL+path,params,ttl)
def unwrap_list(j, keys=('list','symbols','rows','items')):
    if isinstance(j,list):return j
    if isinstance(j,dict):
        for k in keys:
            if isinstance(j.get(k),list):return j[k]
        if 'data' in j:return unwrap_list(j['data'],keys)
    return []
def tr_list():
    try:j=fetch(TR_SYMBOLS,ttl=1200)
    except Exception as exc:raise ValueError('Binance TR parite servisine erişilemedi: '+str(exc)) from exc
    items=unwrap_list(j)
    if not items:raise ValueError('Binance TR parite yanıtında liste bulunamadı; yanıt alanları: '+', '.join(map(str,j.keys()))[:160] if isinstance(j,dict) else 'Binance TR parite yanıtı boş')
    result={}
    for s in items:
        if not isinstance(s,dict):continue
        raw=str(s.get('symbol') or s.get('name') or '').upper()
        quote=str(s.get('quoteAsset') or s.get('quote') or '').upper()
        base=str(s.get('baseAsset') or s.get('base') or '').upper()
        if not quote and raw.endswith('TRY'):quote='TRY'
        if not quote and raw.endswith('_TRY'):quote='TRY'
        if quote!='TRY':continue
        status=str(s.get('status','')).upper()
        if status and status not in ('TRADING','1','ACTIVE','ENABLED','ONLINE'):continue
        if not base:base=raw.replace('_','')[:-3] if raw.replace('_','').endswith('TRY') else ''
        if not raw or not base:continue
        try:typ=int(s.get('type',1) or 1)
        except (TypeError,ValueError):typ=1
        if base not in result or typ==1:result[base]={'symbol':base+'TRY','raw':raw,'type':typ,'coin':base}
    if not result:raise ValueError('TR yanıtında '+str(len(items))+' kayıt var fakat etkin TRY paritesi ayrıştırılamadı; örnek alanlar: '+', '.join(map(str,items[0].keys()))[:140] if isinstance(items[0],dict) else 'TR pariteleri geçersiz')
    return list(result.values())
def _aggregate_15m_to_1h(rows, limit):
    # Binance TR'nin 1h REST serisi bazı oturumlarda grafikle uyuşmayan/stale seri döndürebiliyor.
    # 15m serisi Binance TR/TradingView ile doğrulandı; 1h mumunu aynı borsanın dört 15m mumundan kuruyoruz.
    HOUR=60*60*1000
    buckets={}
    for r in rows:
        if not isinstance(r,(list,tuple)) or len(r)<6: continue
        t=int(r[0]); key=(t//HOUR)*HOUR
        buckets.setdefault(key,[]).append(r)
    out=[]
    for key in sorted(buckets):
        g=sorted(buckets[key],key=lambda r:int(r[0]))
        # Tam kapanmış saatlerde 4 adet 15m beklenir; açık saatte 1-4 adet olabilir.
        o=float(g[0][1]); h=max(float(r[2]) for r in g); l=min(float(r[3]) for r in g); c=float(g[-1][4]); v=sum(float(r[5]) for r in g)
        close_time=key+HOUR-1
        qv=sum(float(r[7]) for r in g if len(r)>7) if any(len(r)>7 for r in g) else v*c
        trades=sum(int(float(r[8])) for r in g if len(r)>8) if any(len(r)>8 for r in g) else 0
        out.append([key,str(o),str(h),str(l),str(c),str(v),close_time,str(qv),trades])
    return out[-limit:]

def get_klines(item,period='1h',limit=85,exchange='global',fresh=False):
    if exchange=='global':return global_get('/klines',{'symbol':item['symbol'],'interval':period,'limit':limit},ttl=0 if fresh else 8)
    url=TR_MAIN if item['type']==1 else TR_ALT
    sym=item['raw'].replace('_','') if item['type']==1 else item['raw']
    # TR 1h: verified 15m candles -> deterministic 1h aggregation.
    # Request enough 15m history for RSI/MACD warm-up and radar calculations.
    req_period='15m' if period=='1h' else period
    req_limit=min(1000, max(limit*4+8, 120)) if period=='1h' else limit
    j=fetch(url,{'symbol':sym,'interval':req_period,'limit':req_limit},ttl=0 if fresh else 8)
    x=unwrap_list(j) if isinstance(j,dict) else j
    if not isinstance(x,list):raise ValueError('Binance TR mum yanıtı beklenmeyen biçimde')
    return _aggregate_15m_to_1h(x,limit) if period=='1h' else x

def get_live_price(item, exchange):
    """Public last-trade price from the same selected exchange. No API key required."""
    if exchange=='global':
        t=global_get('/ticker/price',{'symbol':item['symbol']},ttl=0)
        return float(t['price'])
    if item.get('type',1)==1:
        j=fetch('https://api.binance.me/api/v3/trades',{'symbol':item['raw'].replace('_',''),'limit':1},ttl=0)
    else:
        j=fetch('https://www.binance.tr/open/v1/market/trades',{'symbol':item['raw'],'limit':1},ttl=0)
    rows=unwrap_list(j, keys=('list','rows','items')) if isinstance(j,dict) else j
    if isinstance(rows,list) and rows:
        r=rows[-1]
        if isinstance(r,dict): return float(r.get('price') or r.get('p'))
        if isinstance(r,(list,tuple)) and r: return float(r[0])
    raise ValueError('Anlık işlem fiyatı alınamadı')

def apply_live_price_to_open_candle(raw, live_price):
    # Binance/TradingView açık mumunun Close değeri son gerçekleşen işlem fiyatıdır.
    # Kline REST yanıtı birkaç saniye geride kalırsa yalnız açık mumun OHLC close/high/low
    # alanlarını son trade ile eşitleriz. Kapanmış mumlara ve hacme dokunmayız.
    out=[list(x) for x in raw]
    if out:
        out[-1][4]=str(live_price)
        out[-1][2]=str(max(float(out[-1][2]), live_price))
        out[-1][3]=str(min(float(out[-1][3]), live_price))
    return out

def ema(values, n):
    k=2/(n+1); result=values[0]
    for value in values[1:]:result=value*k+result*(1-k)
    return result

def macd_values(close):
    line=[];signal=[];e12=e26=None;sig=None
    for price in close:
        e12=price if e12 is None else price*(2/13)+e12*(11/13)
        e26=price if e26 is None else price*(2/27)+e26*(25/27)
        m=e12-e26;sig=m if sig is None else m*.2+sig*.8
        line.append(m);signal.append(sig)
    return line,signal

def wilder_rsi(close, n=14):
    if len(close)<n+1:return None
    changes=[close[i]-close[i-1] for i in range(1,len(close))]
    avg_gain=mean(max(d,0) for d in changes[:n]);avg_loss=mean(max(-d,0) for d in changes[:n])
    for d in changes[n:]:
        avg_gain=(avg_gain*(n-1)+max(d,0))/n
        avg_loss=(avg_loss*(n-1)+max(-d,0))/n
    if avg_loss==0:return 100.0 if avg_gain else 50.0
    return 100-100/(1+avg_gain/avg_loss)

def period_metrics(raw):
    # Grafik altindaki gostergeler Binance/TradingView ile ayni ekrani kiyaslayabilmek icin
    # ACIK (halen olusan) son mumu da hesaba katar. Radar/karar motoru ise indicators()
    # icinde yalnizca kapanmis mumlari kullanmaya devam eder.
    series=raw
    if len(series)<100: raise ValueError('Gösterge için yeterli mum yok')
    close=[float(x[4]) for x in series]; high=[float(x[2]) for x in series]; low=[float(x[3]) for x in series]; vol=[float(x[5]) for x in series]
    rsi=wilder_rsi(close,14)
    macd_line,signal_line=macd_values(close); hist=macd_line[-1]-signal_line[-1]; prev=macd_line[-2]-signal_line[-2]
    tr=[max(high[i]-low[i],abs(high[i]-close[i-1]),abs(low[i]-close[i-1])) for i in range(1,len(close))]
    atr=mean(tr[:14])
    for v in tr[14:]: atr=(atr*13+v)/14
    live_vol=vol[-1]
    last_closed_vol=vol[-2]
    avg20=mean(vol[-22:-2])
    vr=last_closed_vol/max(avg20,1e-12)
    live_avg20=mean(vol[-21:-1])
    live_vr=live_vol/max(live_avg20,1e-12)
    return {'rsi':round(rsi,2),'macd':round(macd_line[-1],8),'macd_signal':round(signal_line[-1],8),'macd_hist':round(hist,8),'macd_hist_previous':round(prev,8),'macd_direction':'artıyor' if hist>prev else ('azalıyor' if hist<prev else 'yatay'),'atr':round(atr,8),'volume_ratio':round(vr,2),'volume_last':last_closed_vol,'volume_avg20':avg20,'volume_live':live_vol,'volume_live_ratio':round(live_vr,2),'indicator_mode':'live_open_candle','indicator_source':'seçili zaman dilimi + açık mum','macd_params':'12,26,9','rsi_params':'Wilder 14','volume_reference':'son kapanan mum / önceki 20 kapanan mum','indicator_candle_open_time':int(series[-1][0]),'indicator_candle_close_time':int(series[-1][6]) if len(series[-1])>6 else None,'ma7':mean(close[-7:]),'ma25':mean(close[-25:]),'ma99':mean(close[-99:])}

def indicators(item,exchange):
    raw=get_klines(item,period='1h',limit=200,exchange=exchange)[:-1] # exclude unfinished candle
    if len(raw)<55:raise ValueError('Yeterli kapanmış mum yok')
    close=[float(x[4]) for x in raw];vol=[float(x[5]) for x in raw]
    quotevol=[float(x[7]) if len(x)>7 else float(x[5])*float(x[4]) for x in raw]
    # V0.6.65: hacim sadece buyuk mu degil, fiyat yonuyle birlikte mi geliyor?
    dv=raw[-12:]; up_qv=sum((float(x[7]) if len(x)>7 else float(x[5])*float(x[4])) for x in dv if float(x[4])>=float(x[1])); down_qv=sum((float(x[7]) if len(x)>7 else float(x[5])*float(x[4])) for x in dv if float(x[4])<float(x[1])); total_dir=max(up_qv+down_qv,1e-12); buy_share=100*up_qv/total_dir
    volume_direction='ALIM' if buy_share>=58 else ('SATIS' if buy_share<=42 else 'KARISIK')
    price=close[-1];ma7=mean(close[-7:]);ma21=mean(close[-25:]);ma50=mean(close[-99:])
    rsi=wilder_rsi(close)
    vr=vol[-1]/max(mean(vol[-21:-1]),1e-12)
    resistance=max(float(x[2]) for x in raw[-21:-1]);breakout=price>resistance
    extended=price>ma21*1.065 or rsi>72
    macd_line,signal_line=macd_values(close)
    hist=macd_line[-1]-signal_line[-1];previous_hist=macd_line[-2]-signal_line[-2]
    high=[float(x[2]) for x in raw];low=[float(x[3]) for x in raw]
    recent_range=max(high[-12:])-min(low[-12:]);prior_range=max(high[-24:-12])-min(low[-24:-12])
    compression=prior_range>0 and recent_range/prior_range<.78
    rising_lows=min(low[-5:])>min(low[-10:-5])
    proximity=price/resistance if resistance else 0
    breakout=price>resistance
    volume_ok=vr>=1.25
    macd_positive=hist>0 and hist>=previous_hist
    trend=ma7>ma21>ma50
    # V0.6.30 scoring: continuous scores to separate similar setups instead of fixed 85/79 piles.
    def clamp(v,lo=0.0,hi=1.0): return max(lo,min(hi,v))
    def band_score(v,ideal_lo,ideal_hi,outer_lo,outer_hi):
        if ideal_lo <= v <= ideal_hi:return 1.0
        if v < ideal_lo:return clamp((v-outer_lo)/max(ideal_lo-outer_lo,1e-12))
        return clamp((outer_hi-v)/max(outer_hi-ideal_hi,1e-12))

    # Smooth components (0..1). No single boolean can make many coins tie.
    ma_fast=clamp((ma7/ma21-1)/0.025 + .5) if ma21 else 0
    ma_slow=clamp((ma21/ma50-1)/0.05 + .5) if ma50 else 0
    price_ma=clamp((price/ma7-1)/0.025 + .5) if ma7 else 0
    rsi_quality=band_score(rsi,52,64,40,74)
    vol_quality=band_score(vr,1.20,2.20,.65,4.0)
    vol_confirm=clamp((vr-.85)/1.65)
    hist_positive=1.0 if hist>0 else clamp(1 + hist/max(abs(previous_hist),abs(hist),1e-12))
    hist_accel=clamp(.5 + (hist-previous_hist)/(2*max(abs(previous_hist),abs(hist),1e-12)))
    distance_to_res=(resistance-price)/resistance if resistance else 1
    near_res=clamp(1-abs(distance_to_res)/.035)
    breakout_depth=clamp((price/resistance-1)/.02) if resistance and price>resistance else 0
    compression_ratio=(recent_range/prior_range) if prior_range>0 else 2
    compression_quality=clamp((1.0-compression_ratio)/.35)
    low_now=min(low[-5:]); low_prev=min(low[-10:-5]);
    rising_low_quality=clamp(.5 + ((low_now/low_prev-1)/.025)) if low_prev else 0
    chg24=(close[-1]/close[-25]-1)*100 if len(close)>=25 and close[-25] else 0
    chase_penalty=clamp((max(chg24,0)-3.0)/7.0)

    strength_raw=100*(.18*ma_fast + .16*ma_slow + .08*price_ma + .15*rsi_quality +
                      .13*hist_positive + .10*hist_accel + .10*vol_quality + .10*near_res)
    strength=strength_raw - 10*chase_penalty
    if not breakout: strength=min(strength,88)
    if hist<=previous_hist: strength=min(strength,82)
    strength=round(clamp(strength,0,100))

    # Preparation = early setup quality. Strongly rewards compression/structure/near-resistance,
    # but penalizes coins that already ran too far in the last 24h.
    preparation_raw=100*(.26*compression_quality + .20*rising_low_quality + .22*near_res +
                          .14*vol_quality + .12*hist_accel + .06*rsi_quality)
    preparation=round(clamp(preparation_raw - 28*chase_penalty - 18*breakout_depth,0,100))

    # Confirmation = actual break + participation + momentum; stays modest before a break.
    confirmation_raw=100*(.38*breakout_depth + .24*vol_confirm + .18*hist_positive +
                           .12*hist_accel + .08*price_ma)
    if not breakout: confirmation_raw=min(confirmation_raw,54)
    confirmation=round(clamp(confirmation_raw,0,100))

    extended=price>ma21*1.065 or rsi>72 or (resistance>0 and price>resistance*1.045) or chg24>10
    # Entry quality combines structure with risk/reward below; unlike V0.6.11 it is continuous.
    # Wilder ATR(14), using completed candles only.
    tr_values=[max(high[i]-low[i],abs(high[i]-close[i-1]),abs(low[i]-close[i-1])) for i in range(1,len(close))]
    atr=mean(tr_values[:14])
    for tr_value in tr_values[14:]:atr=(atr*13+tr_value)/14
    recent_support=min(low[-12:]);risk=max(price-recent_support,price*.002)
    potential=max(resistance*1.035-price,0)
    rr=potential/risk if risk else 0
    rr_quality=clamp((rr-.6)/1.9)
    entry_raw=100*(.18*ma_fast + .14*ma_slow + .15*rsi_quality + .12*vol_quality +
                    .13*near_res + .10*hist_accel + .18*rr_quality)
    entry=entry_raw - 32*chase_penalty - (22 if extended else 0)
    if rr<1: entry-=12
    if not breakout: entry=min(entry,86)
    entry=round(clamp(entry,0,100))
    if extended:state='wait';label='UZAMIŞ FİYAT · BEKLE'
    elif breakout and volume_ok and macd_positive and entry>=60:state='confirmed';label='KIRILIM TEYİDİ'
    elif preparation>=55 and strength>=50 and not breakout:state='preparing';label='İZLEME / HAZIRLIK'
    else:state='wait';label='BEKLE / TEYİT YOK'
    reasons=['MA dizilimi olumlu' if trend else 'MA dizilimi tam olumlu değil',f'Hacim oranı {vr:.2f}×', 'MACD histogramı artıyor' if hist>previous_hist else 'MACD histogramı artmıyor', 'Fiyat sıkışması var' if compression else 'Belirgin sıkışma yok', 'Direnç üzerinde kapanış' if breakout else 'Direnç kırılımı yok']
    if extended:reasons.append('Fiyat uzamış: girişte kovalamama filtresi')
    if rr<1:reasons.append('Örnek risk/getiri mesafesi zayıf')
    # V0.6.30: separate pullback buy zones from the breakout/confirmation level.
    # This avoids presenting a resistance level above market as if it were an immediate buy price.
    breakout_level=resistance
    if breakout:
        # After a confirmed close above resistance, prefer a retest zone around the broken level.
        buy1=min(price, breakout_level + 0.20*atr)
        buy2=max(recent_support, breakout_level - 0.35*atr)
    else:
        # Before breakout, two pullback zones: shallow near MA7 / price, deeper toward MA25/support.
        buy1=min(price, max(ma7, price - 0.30*atr))
        buy2=max(recent_support, min(ma21, price - 0.75*atr))
    if buy2>buy1: buy2=buy1-0.35*atr
    reference_entry=(buy1+buy2)/2
    proposed_stop=max(recent_support, reference_entry-1.5*atr) if recent_support<reference_entry else reference_entry-1.5*atr
    proposed_risk=reference_entry-proposed_stop
    proposed_target=reference_entry+2*proposed_risk
    proposed_target2=reference_entry+3*proposed_risk
    proposed_rr=(proposed_target-reference_entry)/proposed_risk if proposed_risk>0 else 0
    plan_valid=(atr>0 and reference_entry>0 and buy1>0 and buy2>0 and proposed_stop>0 and proposed_risk>0 and
                proposed_risk/reference_entry<=.08 and not extended and proposed_rr>=1.5)
    if not plan_valid:
        plan_note=('BEKLE: fiyat uzamış; yeni giriş için geri çekilme beklenmeli.' if extended else 'BEKLE: ATR, destek veya risk mesafesi uygun değil.')
    elif not breakout:
        plan_note='Hazırlık senaryosu: Alım 1/2 geri çekilme bölgeleridir. Kırılım seviyesi alım fiyatı değildir; 1h kapanış ve hacim teyidi için izlenir.'
    else:
        plan_note='Kırılım kapanmış 1h mumda teyitli. Alım 1/2, kırılan seviyeye geri çekilme/retest bölgeleridir; fiyat fazla uzaklaşırsa kovalanmaz.'
    # V0.6.30 decision engine: classify the setup, without changing candle/RSI/MACD/MA calculations.
    support_level=recent_support
    support_distance=(price-support_level)/price if price>0 else 1
    retest_distance=abs(price-breakout_level)/breakout_level if breakout_level else 1
    support_turn=(support_distance<=.025 and 42<=rsi<=64 and hist>=previous_hist)
    retest_setup=(breakout and retest_distance<=.018 and hist>=previous_hist)
    breakout_setup=(breakout and volume_ok and macd_positive and entry>=60)
    if retest_setup:
        strategy_type='RETEST'; strategy_reason='Kırılan direnç bölgesine yakın ve momentum korunuyor.'
    elif breakout_setup:
        strategy_type='KIRILIM'; strategy_reason='1h kapanış direnç üzerinde; hacim ve momentum teyidi var.'
    elif support_turn:
        strategy_type='DESTEK'; strategy_reason='Fiyat yakın desteğe yaklaşmış ve momentumda toparlanma işareti var.'
    else:
        strategy_type='BEKLE'; strategy_reason='Destek, kırılım veya retest koşullarından hiçbiri yeterince tamamlanmadı.'
    # V0.6.30 REAL MOVEMENT GATE. MACD/score alone may NOT wake a flat coin.
    # A dormant coin only escapes the filter when price range itself expands AND volume confirms it.
    atr_pct=(atr/price*100) if price>0 else 0
    recent6_range_pct=((max(high[-6:])-min(low[-6:]))/price*100) if price>0 else 0
    last_range_pct=((high[-1]-low[-1])/close[-1]*100) if close[-1]>0 else 0
    price_alive=(atr_pct>=0.45 or recent6_range_pct>=1.35)
    breakout_wakeup=(vr>=1.50 and last_range_pct>=max(0.30,atr_pct*0.80) and hist>previous_hist)
    dormant=(not price_alive and not breakout_wakeup)
    movement_score=round(clamp(100*(0.34*clamp(atr_pct/2.00)+0.31*clamp(recent6_range_pct/5.50)+0.20*clamp(last_range_pct/2.00)+0.15*clamp((vr-0.70)/2.30)),0,100))
    return {'atr':round(atr,8),'atr_pct':round(atr_pct,3),'recent_range_pct':round(recent6_range_pct,3),'last_range_pct':round(last_range_pct,3),'movement_score':movement_score,'dormant':dormant,'price_alive':price_alive,'breakout_wakeup':breakout_wakeup,'macd_hist_previous':round(previous_hist,8),'buy_volume_share':round(buy_share,1),'volume_direction':volume_direction,
            'macd_direction':'artıyor' if hist>previous_hist else ('azalıyor' if hist<previous_hist else 'yatay'),
            'plan_valid':plan_valid,'plan_note':plan_note,'strategy_type':strategy_type,'strategy_reason':strategy_reason,'support_level':round(support_level,8),
            'plan_buy':round(reference_entry,8) if plan_valid else None,
            'plan_buy1':round(buy1,8) if plan_valid else None,
            'plan_buy2':round(buy2,8) if plan_valid else None,
            'breakout_level':round(breakout_level,8) if breakout_level else None,
            'plan_stop':round(proposed_stop,8) if plan_valid else None,
            'plan_target':round(proposed_target,8) if plan_valid else None,
            'plan_target2':round(proposed_target2,8) if plan_valid else None,
            'plan_rr':round(proposed_rr,2) if plan_valid else None,'plan_risk_pct':round(100*proposed_risk/reference_entry,2) if reference_entry>0 else None,'coin':item['coin'],'symbol':item['symbol'],'raw':item.get('raw'),'type':item.get('type'),'price':price,'strength':strength,'preparation':preparation,'confirmation':confirmation,'entry':entry,'volume':round(vr,2),'rsi':round(rsi,1),'macd':round(macd_line[-1],8),'macd_signal':round(signal_line[-1],8),'macd_hist':round(hist,8),'rr_estimate':round(rr,2),'state':state,'label':label,'comment':'. '.join(reasons)+'. Kural tabanlı değerlendirme; doğrulanmış alım sinyali veya AI analizi değildir.','ma7':ma7,'ma21':ma21,'ma50':ma50,'asof':raw[-1][6] if len(raw[-1])>6 else raw[-1][0],'quote_volume':sum(quotevol[-24:]),'high24':max(high[-24:]),'low24':min(low[-24:]),'chg':(close[-1]/close[-25]-1)*100 if len(close)>=25 and close[-25] else 0}

def classify_error(exc):
    message=str(exc)
    if 'Yeterli kapanmış mum yok' in message:return 'insufficient_history'
    if isinstance(exc,urllib.error.HTTPError):return 'http_'+str(exc.code)
    if isinstance(exc,(urllib.error.URLError,TimeoutError,ConnectionError)):return 'network'
    return 'other'
def new_pair_test():
    # Pure simulation: does not change saved lists or contact Binance.
    initial={'BTCUSDT','ETHUSDT'}
    next_scan=initial|{'TESTUSDT'}
    detected=next_scan-initial
    repeat=next_scan-next_scan
    return {'ok':detected=={'TESTUSDT'} and not repeat,'first_scan_new':[],'second_scan_new':sorted(detected),'third_scan_new':sorted(repeat),'saved_files_modified':False,'note':'TESTUSDT is simulated, not a real exchange listing.'}
def known_pairs(exchange, symbols):
    # First observation is not proof of exchange listing date.
    path=ROOT/('known_'+exchange+'.json')
    try: old=set(json.loads(path.read_text(encoding='utf-8')))
    except (OSError,ValueError,TypeError): old=set()
    new=set(symbols)-old if old else set()
    if set(symbols)!=old:
        try:path.write_text(json.dumps(sorted(set(symbols)|old)),encoding='utf-8')
        except OSError:pass
    return new


def usd_try_rate():
    """Binance TR public USDT/TRY last price for display-only TRY -> USD reference conversion."""
    try:
        item=next((x for x in tr_list() if str(x.get('coin','')).upper()=='USDT'),None)
        if not item:return None
        v=float(get_live_price(item,'tr'))
        return v if math.isfinite(v) and v>0 else None
    except Exception:
        return None

def global_benchmark():
    """V0.6.53: BTC/ETH benchmark always comes directly from Binance Global, independent of selected market/radar."""
    out={'btc':None,'eth':None,'error':None}
    try:
        ticks=global_get('/ticker/24hr',ttl=20)
        if not isinstance(ticks,list):
            raise ValueError('Global 24s ticker listesi alınamadı')
        tmap={x.get('symbol'):x for x in ticks if isinstance(x,dict)}
        for coin in ('BTC','ETH'):
            sym=coin+'USDT'; t=tmap.get(sym)
            if not t: continue
            rec={'price':float(t.get('lastPrice') or 0),'chg':float(t.get('priceChangePercent') or 0)}
            if coin in ('BTC','ETH'):
                try:
                    tech=indicators({'symbol':sym,'coin':coin},'global')
                    rec.update({'strength':tech.get('strength'),'confirmation':tech.get('confirmation'),
                                'movement_score':tech.get('movement_score'),
                                'support':tech.get('support_level'),'breakout':tech.get('breakout_level')})
                except Exception as exc:
                    rec['tech_error']=str(exc)[:140]
            out[coin.lower()]=rec
    except Exception as exc:
        out['error']=str(exc)[:180]
    return out


def binance_fear_greed():
    """Fetch Binance Square index; optional clearly attributed Alternative.me fallback.

    Never present a third-party value as Binance's own score.
    """
    key='sentiment_index_v059'
    with LOCK:
        hit=CACHE.get(key)
        if hit and time.time()-hit[0]<900:return hit[1]
    out={'score':None,'label':'VERİ YOK','source':'Binance Square','available':False}
    import re
    try:
        url='https://www.binance.com/en/square/fear-and-greed-index'
        req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 (compatible; BGMResearch/1.0)','Accept':'text/html','Accept-Language':'en-US,en;q=0.9'})
        with urllib.request.urlopen(req,timeout=5) as r: html=r.read().decode('utf-8','ignore')
        # Use only fields explicitly associated with the Fear & Greed index.
        patterns=[r'"fearGreedIndex"\s*:\s*"?(\d{1,3})',r'"fearGreedValue"\s*:\s*"?(\d{1,3})',r'"fearAndGreedIndex"\s*:\s*"?(\d{1,3})']
        for pat in patterns:
            m=re.search(pat,html,re.I)
            if m and 0<=int(m.group(1))<=100:
                score=int(m.group(1));out={'score':score,'label':fear_label(score),'source':'Binance Square','available':True};break
    except Exception as exc:out['binance_error']=str(exc)[:110]
    if out['score'] is None:
        # Fallback is a DIFFERENT index; explicitly display provider in UI.
        try:
            url='https://api.alternative.me/fng/?limit=1'
            req=urllib.request.Request(url,headers={'User-Agent':'BGM-Coin-Pro/0.6.65','Accept':'application/json'})
            with urllib.request.urlopen(req,timeout=5) as r: obj=json.loads(r.read().decode('utf-8'))
            item=obj['data'][0];score=int(item['value'])
            if 0<=score<=100:out.update({'score':score,'label':str(item.get('value_classification') or fear_label(score)).upper(),'source':'Alternative.me (Binance değil)','available':True})
        except Exception as exc:out['fallback_error']=str(exc)[:110]
    with LOCK:CACHE[key]=(time.time(),out)
    return out

def fear_label(score):
    return 'AŞIRI KORKU' if score<25 else 'KORKU' if score<45 else 'NÖTR' if score<56 else 'AÇGÖZLÜLÜK' if score<76 else 'AŞIRI AÇGÖZLÜLÜK'

def market_regime(rows, benchmark=None):
    """V0.6.53: BTC+ETH majors vs altcoins (BTC/ETH excluded), plus risk appetite. Never breaks radar."""
    def num(v, default=None):
        try:
            if v is None or v == '': return default
            n=float(v); return n if math.isfinite(n) else default
        except (TypeError, ValueError): return default
    def pct(v): return max(0.0,min(100.0,float(v)))
    benchmark=benchmark or {}; btc=benchmark.get('btc') or {}; eth=benchmark.get('eth') or {}
    base={'label':None,'majors_power':None,'btc_power':None,'alt_power':None,'risk_appetite':None,
          'reason':'Piyasa avantajı için veri bekleniyor.',
          'btc_price':num(btc.get('price')),'btc_chg':num(btc.get('chg')),
          'eth_price':num(eth.get('price')),'eth_chg':num(eth.get('chg')),
          'btc_support':num(btc.get('support')),'btc_breakout':num(btc.get('breakout')),
          'benchmark_source':'Binance Global BTCUSDT + ETHUSDT'}
    try:
        analyzed=[x for x in rows if x.get('analyzed')]
        alts=[x for x in analyzed if str(x.get('coin','')).upper() not in ('BTC','ETH') and not x.get('dormant')]
        if not btc or not eth or len(alts)<10:
            base['reason']='BTC/ETH veya Altcoin Gücü için yeterli veri henüz hazır değil.'; return base
        def major_score(rec):
            vals=[num(rec.get(k)) for k in ('strength','confirmation','movement_score','chg')]
            if any(v is None for v in vals): return None
            tech,conf,move,chg=vals
            change=pct(50+chg*6)
            return pct(.42*pct(tech)+.23*pct(conf)+.20*pct(move)+.15*change)
        bp,ep=major_score(btc),major_score(eth)
        if bp is None or ep is None:
            base['reason']='BTC/ETH fiyatı geldi; teknik güç bileşenleri henüz hazır değil.'; return base
        majors=(bp+ep)/2.0
        pos=sum(1 for x in alts if (num(x.get('chg'),0) or 0)>0)/len(alts)*100
        strong=sum(1 for x in alts if (num(x.get('strength'),0) or 0)>=55)/len(alts)*100
        confirming=sum(1 for x in alts if (num(x.get('confirmation'),0) or 0)>=50)/len(alts)*100
        avg_strength=sum(pct(num(x.get('strength'),0) or 0) for x in alts)/len(alts)
        alt=pct(.34*pos+.24*strong+.22*confirming+.20*avg_strength)
        # Risk appetite rewards broad participation/confirmation, not a single high-volume mover.
        risk=pct(.35*alt+.25*pos+.20*confirming+.20*((pct(bp)+pct(ep))/2))
        diff=alt-majors
        if diff>=8: label='ALTCOIN'; reason=f'Altcoin genişliği büyüklerden güçlü · pozitif altcoin %{pos:.0f} · risk iştahı {risk:.0f}/100.'
        elif diff<=-8: label='MAJORS'; reason=f'BTC+ETH göreceli gücü altcoin genişliğinin önünde · pozitif altcoin %{pos:.0f} · risk iştahı {risk:.0f}/100.'
        else: label='NÖTR'; reason=f'BTC+ETH ve altcoin gücü yakın · pozitif altcoin %{pos:.0f} · risk iştahı {risk:.0f}/100.'
        fg={'score':None,'label':'AYRI YÜKLENİYOR','source':None}
        binance_risk=None
        base.update({'label':label,'majors_power':round(majors),'btc_power':round(majors),'btc_individual_power':round(bp),'eth_individual_power':round(ep),'alt_power':round(alt),'risk_appetite':binance_risk,'risk_label':fg.get('label'),'risk_source':fg.get('source'),'internal_risk':round(risk),'alt_positive_pct':round(pos,1),'alt_count':len(alts)})
        return base
    except Exception as exc:
        base['reason']='Piyasa avantajı hesaplanamadı; Radar çalışmaya devam ediyor.'; base['debug']=str(exc)[:120]; return base

def scan(exchange,force=False):
    key='scan_'+exchange
    with LOCK:
        hit=CACHE.get(key)
        if hit and not force and time.time()-hit[0]<300:return hit[1]
    if not SCAN_LOCK.acquire(blocking=False):
        with LOCK:
            hit=CACHE.get(key)
            if hit:return hit[1]
        raise ValueError('Başka bir tarama devam ediyor. Biraz bekleyip tekrar deneyin.')
    try:
        if exchange=='global':
            info=global_get('/exchangeInfo',ttl=1800);ticks=global_get('/ticker/24hr',ttl=45)
            active={x['symbol'] for x in info['symbols'] if x.get('status')=='TRADING' and x.get('quoteAsset')=='USDT' and x.get('isSpotTradingAllowed',True)}
            eligible=[x for x in ticks if x['symbol'] in active]
            eligible.sort(key=lambda x:float(x['quoteVolume']),reverse=True)
            items=[{'symbol':x['symbol'],'coin':x['symbol'][:-4]} for x in eligible];tmap={x['symbol']:x for x in eligible}
        else:
            items=tr_list();active={x['symbol'] for x in items};eligible=items;tmap={}
        new=known_pairs(exchange,[x['symbol'] for x in items]);rows=[];errors=[];error_details=[];error_types={}
        # All pairs remain visible even if candle analysis is unavailable.
        with ThreadPoolExecutor(max_workers=4) as pool:
            fs={pool.submit(indicators,x,exchange):x['symbol'] for x in items}
            for f in as_completed(fs):
                try:
                    r=f.result()
                    if exchange=='global':
                        t=tmap[r['symbol']];r['price']=float(t['lastPrice']);r['chg']=float(t['priceChangePercent']);r['quote_volume']=float(t['quoteVolume'])
                    r['new']=r['symbol'] in new;r['analyzed']=True
                    r['liquidity']='low' if r['quote_volume']<2_000_000 else 'normal' if exchange=='global' else 'unverified'
                    rows.append(r)
                except Exception as exc:
                    sym=fs[f];category=classify_error(exc);errors.append(f'{sym}: {str(exc)[:100]}');error_details.append({'symbol':sym,'category':category,'message':str(exc)[:180]});error_types[category]=error_types.get(category,0)+1
                    item=next(x for x in items if x['symbol']==sym)
                    t=tmap.get(sym,{})
                    rows.append({'coin':item['coin'],'symbol':sym,'price':float(t.get('lastPrice') or 0),'chg':float(t.get('priceChangePercent') or 0),'strength':0,'preparation':0,'confirmation':0,'entry':0,'volume':0,'rsi':0,'macd':None,'macd_signal':None,'macd_hist':None,'state':'unavailable','label':'VERİ EKSİK','comment':str(exc)[:180],'quote_volume':float(t.get('quoteVolume') or 0),'new':sym in new,'analyzed':False,'liquidity':'unknown'})
        
        for x in rows:
            # V0.6.30 RADAR ONLY: readiness-first ranking. STABLE CORE indicators/candles are untouched.
            if not x.get('analyzed'):
                x['radar_score']=0; x['radar_stage']=0; x['radar_reason']='VERİ EKSİK'; continue
            st=x.get('state','wait'); entry=x.get('entry',0); prep=x.get('preparation',0); conf=x.get('confirmation',0); strength=x.get('strength',0)
            rsi=x.get('rsi',0); vol=x.get('volume',0); chg=x.get('chg',0); hist=x.get('macd_hist',0); prev=x.get('macd_hist_previous',0)
            strategy=x.get('strategy_type','BEKLE'); dormant=bool(x.get('dormant',False)); movement=x.get('movement_score',0)
            # V0.6.55 RADAR: detect quality BEFORE full confirmation, without rewarding noise.
            macd_rising=(hist is not None and prev is not None and hist>prev)
            macd_positive=(hist is not None and hist>0)
            preparation_ready=(prep>=52 and strength>=58 and entry>=60 and conf>=38 and vol>=1.00 and macd_rising)
            early_strength=(strength>=68 and entry>=64 and conf>=40 and prep>=35 and vol>=1.15 and macd_rising and 40<=rsi<=70 and chg<4.5)
            early_strong=(strength>=72 and entry>=68 and conf>=45 and vol>=1.35 and macd_rising and 42<=rsi<=68 and chg<4.0)
            strong_confirmation=(conf>=68 and strength>=64 and entry>=65 and vol>=1.35 and macd_rising and chg<5 and rsi<72)
            moving_wait=(not dormant and movement>=22 and (prep>=45 or strength>=50 or abs(chg)>=0.75))
            if st=='preparing' and not (preparation_ready or early_strength):
                st='wait'; x['state']='wait'
            # Stages: confirmed > strong early setup > early strengthening > ordinary movement/wait.
            if st=='confirmed' or strong_confirmation: stage=4
            elif early_strong or (preparation_ready and conf>=48): stage=3
            elif early_strength or preparation_ready: stage=2
            else: stage=1
            if strategy=='RETEST' and st=='confirmed': stage=4
            elif strategy=='KIRILIM' and st=='confirmed': stage=4
            elif strategy=='DESTEK':
                support_quality=(macd_rising and conf>=45 and entry>=62 and strength>=60 and vol>=1.0 and 38<=rsi<=66)
                stage=max(stage,3 if support_quality else stage)
            # Opportunity quality: confirmation matters, but it no longer hides a high-quality setup before breakout.
            score=.27*entry+.18*conf+.15*prep+.22*strength+.10*min(vol*35,100)+(.08*min(movement,100))
            # V0.6.56: relative volume is NOT enough. Include actual 24h quote liquidity and anti-chase jump score.
            qv=float(x.get('quote_volume') or 0); hi=float(x.get('high24') or 0); lo=float(x.get('low24') or 0); px=float(x.get('price') or 0)
            if exchange=='tr':
                if qv<2_000_000: liq_score=15
                elif qv<5_000_000: liq_score=35
                elif qv<10_000_000: liq_score=50
                elif qv<25_000_000: liq_score=68
                elif qv<50_000_000: liq_score=82
                else: liq_score=100
            else:
                liq_score=max(10,min(100,20+20*math.log10(max(qv,1)/1_000_000+1)))
            range_pos=((px-lo)/(hi-lo)*100) if hi>lo and px>0 else 50
            jump_score=max(0,min(100,abs(chg)*10 + max(0,range_pos-70)*0.65))
            potential=max(0,min(100,0.38*strength+0.24*entry+0.18*conf+0.12*min(vol*40,100)+0.08*liq_score-0.38*jump_score))
            x['liquidity_score']=round(liq_score); x['jump_score']=round(jump_score); x['potential_score']=round(potential); x['range_position']=round(range_pos,1)
            # Kalite korumalari: goreceli hacim tek basina firsat sayilmaz.
            buy_share=float(x.get('buy_volume_share') or 50); vdir=x.get('volume_direction','KARISIK')
            if vdir=='ALIM': potential=min(100,potential+5)
            elif vdir=='SATIS': potential=max(0,potential-8)
            x['potential_score']=round(potential); x['buy_volume_share']=round(buy_share,1); x['volume_direction']=vdir
            if exchange=='tr':
                if qv<2_000_000: score-=22; stage=min(stage,1)
                elif qv<5_000_000: score-=13; stage=min(stage,2)
                elif qv<10_000_000: score-=7
                elif qv>=50_000_000: score+=5
            score += (potential-50)*0.10
            if conf<55: score=min(score,82)
            if hist is not None and hist<0: score=min(score,80)
            if exchange=='tr':
                if qv<5_000_000: score=min(score,62)
                elif qv<10_000_000: score=min(score,74)
            if x.get('volume_direction')=='SATIS': score-=9
            elif x.get('volume_direction')=='ALIM': score+=3
            if jump_score>=75: score-=14
            elif jump_score>=55: score-=8
            if macd_rising: score+=6
            if early_strength: score+=5
            if early_strong: score+=4
            reasons=[]
            if exchange=='tr' and qv<2_000_000: reasons.append('gerçek 24s hacim çok düşük')
            elif exchange=='tr' and qv<10_000_000: reasons.append('gerçek 24s hacim düşük')
            elif exchange=='tr' and qv>=50_000_000: reasons.append('gerçek likidite güçlü')
            if x.get('volume_direction')=='ALIM': reasons.append('alım yönlü hacim')
            elif x.get('volume_direction')=='SATIS': reasons.append('satış yönlü hacim')
            if jump_score>=75: reasons.append('sıçrama ilerlemiş')
            elif potential>=70: reasons.append('kalan potansiyel yüksek')
            if early_strong: reasons.append('erken güçlenme güçlü')
            elif early_strength: reasons.append('erken güçlenme')
            if conf>=55: reasons.append('teyit güçleniyor')
            elif conf<38: reasons.append('teyit zayıf')
            if entry>=70: reasons.append('giriş kalitesi yüksek')
            if vol>=1.5: reasons.append('hacim destekli')
            elif vol<1.0: reasons.append('hacim zayıf')
            if macd_rising: reasons.append('MACD ivmesi artıyor')
            else: reasons.append('MACD ivmesi zayıflıyor')
            # Anti-chase / weak-quality gates.
            if 'UZAMIŞ' in x.get('label','') or rsi>=78:
                stage=0; score-=35; reasons.append('uzamış/RSI çok yüksek')
            elif rsi>=72:
                score-=18; reasons.append('RSI yüksek')
            if chg>=8: score-=18; reasons.append('24s hareket büyük')
            elif chg>=5: score-=10; reasons.append('24s hareket ilerlemiş')
            if entry<55: score-=12
            if conf<32: score-=10
            if dormant:
                stage=-1; score=0; reasons=['hareketsiz · radar dışı']; x['radar_label']='HAREKETSİZ · RADAR DIŞI'
            elif 'UZAMIŞ' in x.get('label','') or chg>=5:
                x['radar_label']='KOVALAMA · RETEST BEKLE'
            elif st=='confirmed' or strong_confirmation:
                x['radar_label']='TEYİTLİ · GİRİŞİ KONTROL ET'
            elif early_strong:
                x['radar_label']='ERKEN GÜÇLENME · ÖNCELİKLİ İZLE'
            elif early_strength:
                x['radar_label']='ERKEN GÜÇLENME · TAKİP'
            elif preparation_ready:
                x['radar_label']='HAZIRLIK · TEYİT BEKLE'
            elif moving_wait:
                x['radar_label']='HAREKETLİ · TEYİT BEKLE'
            else:
                x['radar_label']='BEKLE · KURULUM YOK'
            # A high movement score never substitutes for quality.
            if not macd_rising and st!='confirmed':
                score=min(score,60); score-=8; reasons.append('MACD zayıflıyor')
            if conf<38 and st!='confirmed': score=min(score,58)
            if vol>=3 and not macd_rising:
                score=min(score,55); reasons.append('yüksek hacim tek başına fırsat değil')
            if movement>=85 and not (early_strength or st=='confirmed'):
                score-=7; reasons.append('hareket yüksek ama kalite eksik')
            x['radar_stage']=stage
            x['radar_score']=round(max(0,min(100,score)),1)
            x['radar_reason']=' · '.join(reasons[:4])

            # V0.6.65 BGM TRADER ENGINE V2
            # Trader gibi yorum: tek bir gosterge degil, birbirini dogrulayan veri gruplari.
            score_final=float(x['radar_score'])
            pot=float(x.get('potential_score') or 0); jump=float(x.get('jump_score') or 0)
            liq=float(x.get('liquidity_score') or 0); buy=float(x.get('buy_volume_share') or 50)
            contradictions=[]; positives=[]; risks=[]

            # 1) Fiyat/teknik yapi
            if strength>=75: positives.append(f'teknik yapı güçlü ({strength:.0f})')
            elif strength>=65: positives.append(f'teknik yapı olumlu ({strength:.0f})')
            elif strength<52: risks.append(f'teknik yapı zayıf ({strength:.0f})')
            if entry>=68: positives.append(f'giriş kalitesi iyi ({entry:.0f})')
            elif entry<50: risks.append(f'giriş kalitesi düşük ({entry:.0f})')

            # 2) Momentum
            if macd_rising and conf>=50: positives.append('MACD ivmesi + teyit birlikte güçleniyor')
            elif macd_rising: positives.append('MACD ivmesi artıyor')
            else: risks.append('MACD ivmesi zayıflıyor')

            # 3) Hacim: yuksek hacim tek basina olumlu degil.
            if vdir=='ALIM' and buy>=62 and vol>=1.15:
                positives.append(f'alım mum hacmi baskın (%{buy:.0f}, {vol:.2f}x)')
            elif vdir=='ALIM':
                positives.append(f'alım yönü olumlu (%{buy:.0f})')
            elif vdir=='SATIS':
                risks.append(f'hacim satış yönünde (%{100-buy:.0f})')
            elif vol>=1.5:
                risks.append(f'hacim yüksek ({vol:.2f}x) ama yön karışık')
            else:
                risks.append('hacim yönü net değil')

            # 4) Zamanlama / kalan alan
            if jump<=20 and pot>=58: positives.append(f'henüz sıçramamış ({jump:.0f}) · potansiyel {pot:.0f}')
            elif jump>=65: risks.append(f'hareketin önemli kısmı gerçekleşmiş (sıçrama {jump:.0f})')
            elif pot<45: risks.append(f'kalan potansiyel sınırlı ({pot:.0f})')
            if conf>=60: positives.append(f'teyit güçlü ({conf:.0f})')
            elif conf<45: risks.append(f'teyit düşük ({conf:.0f})')

            # 5) Likidite
            if exchange=='tr' and qv>=25_000_000: positives.append('TRY likiditesi yeterli')
            elif exchange=='tr' and qv<8_000_000: risks.append('TRY likiditesi düşük')

            # Ciddi celiskiler: gorunurde guclu puanlar birbirini teyit etmiyor.
            if strength>=75 and not macd_rising: contradictions.append('teknik güçlü ama MACD ivmesi zayıf')
            if conf>=60 and vdir=='SATIS': contradictions.append('teyit yüksek ama hacim satış yönünde')
            if pot>=60 and jump>=65: contradictions.append('potansiyel puanı yüksek ama coin zaten ilerlemiş')
            if movement>=80 and jump>=65: contradictions.append('hareket güçlü fakat yeni giriş geç kalmış olabilir')
            if entry>=68 and conf<40: contradictions.append('giriş puanı iyi ama teyit yetersiz')
            if vol>=2.5 and buy<50: contradictions.append('yüksek hacim alıcılar tarafından doğrulanmıyor')
            if vdir=='ALIM' and not macd_rising and conf<50: contradictions.append('alım mum hacmi var ama momentum teyit etmiyor')

            # Firsat = bundan sonra alinabilecek yol / zamanlama. Guven = mevcut sinyalin teyit kalitesi.
            opportunity=max(0,min(100,
                .28*score_final + .22*pot + .15*entry + .10*prep + .10*liq +
                .08*min(vol*40,100) + .07*(buy if vdir!='SATIS' else max(0,100-buy)) - .18*jump))
            confidence=max(0,min(100,
                .28*conf + .18*strength + .14*liq + .14*(90 if macd_rising else 25) +
                .14*(90 if vdir=='ALIM' and buy>=58 else 52 if vdir=='KARISIK' else 20) +
                .12*min(vol*45,100)))
            opportunity-=len(contradictions)*7 + max(0,len(risks)-2)*2
            confidence-=len(contradictions)*6 + max(0,len(risks)-2)*2
            if chg>=8 or jump>=80: opportunity=min(opportunity,35)
            if jump>=65 and pot<55: opportunity=min(opportunity,42)
            if not macd_rising and vdir!='ALIM': opportunity=min(opportunity,58)
            if exchange=='tr' and qv<5_000_000: opportunity=min(opportunity,48); confidence=min(confidence,55)
            opportunity=round(max(0,min(100,opportunity)))
            confidence=round(max(0,min(100,confidence)))

            # Trader karari: sinif once, puan sonra. Tek bir metrik ust sinifa tasiyamaz.
            confirmations=sum([
                strength>=65, entry>=60, macd_rising, conf>=50,
                vdir=='ALIM' and buy>=58, vol>=1.15, pot>=55, jump<55
            ])
            if dormant or (vdir=='SATIS' and not macd_rising and conf<45):
                trank=1; tlabel='🔴 UZAK DUR'; twait='Momentum ve hacim yönünün birlikte düzelmesini bekle'
            elif chg>=6 or jump>=70 or rsi>=74:
                trank=2; tlabel='🟠 KOVALAMA'; twait='Retest / destek tutunması ve daha iyi risk-getiri bekle'
            elif opportunity>=72 and confidence>=68 and conf>=55 and entry>=62 and macd_rising and vdir!='SATIS' and confirmations>=6 and not contradictions:
                trank=6; tlabel='🟢 ALIMA EN YAKIN'; twait='Giriş bölgesi korunursa stop ve R:R planını doğrula'
            elif opportunity>=63 and confidence>=55 and macd_rising and jump<50 and vdir!='SATIS' and confirmations>=5:
                trank=5; tlabel='🔥 ERKEN GÜÇLENME'; twait=f'Teyit {conf:.0f} → 55+; alım hacmi ve MACD ivmesi korunmalı'
            elif opportunity>=53 and (prep>=50 or strength>=65) and vdir!='SATIS':
                trank=4; tlabel='🟡 TEYİT BEKLE'
                wait_parts=[]
                if conf < 55: wait_parts.append(f'Teyit {conf:.0f} → 55+')
                if not macd_rising: wait_parts.append('MACD yeniden yukarı dönmeli')
                elif conf < 55: wait_parts.append('MACD ivmesi korunmalı')
                if vdir!='ALIM' or buy<58: wait_parts.append('alım hacmi %58+ ile desteklemeli')
                else: wait_parts.append('alım hacmi korunmalı')
                twait='; '.join(wait_parts) if wait_parts else 'Mevcut teyitlerin korunması ve giriş bölgesinin doğrulanması'
            elif opportunity>=40:
                trank=3; tlabel='🔵 İZLE'; twait='Kurulum kalitesi, hacim yönü ve giriş zamanlaması gelişmeli'
            else:
                trank=1; tlabel='🔴 UZAK DUR'; twait='Yeni ve daha kaliteli kurulum bekle'
            if len(contradictions)>=2 and trank>4:
                trank=4; tlabel='🟡 TEYİT BEKLE'; twait='Çelişkiler çözülmeden giriş yapma: '+contradictions[0]
            elif contradictions and trank==6:
                trank=5; tlabel='🔥 ERKEN GÜÇLENME'; twait='Girişten önce çelişki çözülmeli: '+contradictions[0]

            x['trader_rank']=trank; x['trader_label']=tlabel
            x['opportunity_score']=opportunity; x['confidence_score']=confidence
            x['trader_positive']=positives[:5]; x['trader_risks']=risks[:4]; x['trader_conflicts']=contradictions[:3]
            x['trader_wait']=twait; x['trader_confirmations']=confirmations
            # Kisa tablo yorumu + secili coin paneli icin daha derin yorum.
            best=positives[:2]
            warn=(contradictions[:1] or risks[:1])
            short=[]
            if best: short.append(' + '.join(best))
            if warn: short.append('Dikkat: '+warn[0])
            x['trader_short']=' · '.join(short) if short else 'Kurulum verileri değerlendiriliyor'
            detail=[]
            if positives: detail.append('Olumlu: '+ ' · '.join(positives[:4]))
            if contradictions: detail.append('Çelişki: '+ ' · '.join(contradictions[:2]))
            elif risks: detail.append('Risk: '+ ' · '.join(risks[:2]))
            detail.append('Karar: '+tlabel.replace('🟢 ','').replace('🔥 ','').replace('🟡 ','').replace('🔵 ','').replace('🟠 ','').replace('🔴 ',''))
            detail.append('Beklenen: '+twait)
            x['trader_comment']=' | '.join(detail)
        rows.sort(key=lambda x:(x['analyzed'], x.get('trader_rank',0), x.get('opportunity_score',0), x.get('confidence_score',0), x.get('potential_score',0), x.get('radar_score',0)),reverse=True)
        # HOTFIX retained in V0.6.65: optional market widgets must NEVER turn a completed Radar scan into VERİ HATASI.
        benchmark={'btc':None,'eth':None,'error':'benchmark bekleniyor'}
        regime={'label':None,'majors_power':None,'btc_power':None,'alt_power':None,'risk_appetite':None,'reason':'Piyasa göstergeleri bekleniyor.'}
        try:
            benchmark=global_benchmark()
            regime=market_regime(rows,benchmark)
        except Exception as exc:
            regime['reason']='Piyasa göstergesi alınamadı; Radar verisi korunuyor.'
            regime['debug']=str(exc)[:120]
        try:
            fx=usd_try_rate() if exchange=='tr' else None
        except Exception:
            fx=None
        result={'exchange':exchange,'quote':'TRY' if exchange=='tr' else 'USDT','usd_try':fx,'universe':len(active),'eligible':len(eligible),'attempted':len(items),'analyzed':sum(x['analyzed'] for x in rows),'new_count':len(new),'rows':rows,'market_regime':regime,'error_count':len(errors),'errors':errors[:5],'error_details':error_details,'error_types':error_types,'timestamp':int(time.time()*1000),'version':'0.6.65','note':('Binance TR aktif TRY pariteleri' if exchange=='tr' else 'Binance Global: tüm aktif USDT spot pariteler; düşük hacim ayrıca işaretlenir')+' · 1h kapanmış mumlarla ilk deneme puanlaması. '+('TR 24s değişim son 24 kapanmış 1h mumdan hesaplanır.' if exchange=='tr' else '')}
        with LOCK:CACHE[key]=(time.time(),result)
        return result
    finally:SCAN_LOCK.release()
DESKTOP_VERSION='1.0.3'
def _version_tuple(v):
    try:return tuple(int(x) for x in str(v).strip().lstrip('vV').split('.'))
    except:return (0,)
def _update_manifest():
    cfg_path=ROOT/'update_config.json'
    if not cfg_path.exists():return None
    try: cfg=json.loads(cfg_path.read_text(encoding='utf-8'))
    except Exception:return None
    url=str(cfg.get('manifest_url') or '').strip()
    if not url.startswith('https://'):return None
    req=urllib.request.Request(url,headers={'User-Agent':'BGM-Coin-Pro-Updater/'+DESKTOP_VERSION,'Accept':'application/json'})
    with urllib.request.urlopen(req,timeout=10) as r: m=json.load(r)
    latest=str(m.get('version') or '').strip(); installer=str(m.get('installer_url') or m.get('download_url') or '').strip(); m['installer_url']=installer; sha=str(m.get('sha256') or '').lower().strip()
    if not latest or not installer.startswith('https://') or len(sha)!=64:return None
    m['available']=_version_tuple(latest)>_version_tuple(DESKTOP_VERSION)
    return m

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
    def do_POST(self):
        parsed=urllib.parse.urlsplit(self.path)
        if parsed.path!='/api/update-download':
            self.send_error(404);return
        try:
            m=_update_manifest()
            if not m or not m.get('available'):raise RuntimeError('Yeni sürüm bulunamadı.')
            target=Path(tempfile.gettempdir())/('BGM_Coin_Pro_Setup_'+str(m['version'])+'.exe')
            req=urllib.request.Request(m['installer_url'],headers={'User-Agent':'BGM-Coin-Pro-Updater/'+DESKTOP_VERSION})
            h=hashlib.sha256()
            with urllib.request.urlopen(req,timeout=60) as r, open(target,'wb') as f:
                while True:
                    chunk=r.read(1024*1024)
                    if not chunk:break
                    h.update(chunk);f.write(chunk)
            if h.hexdigest().lower()!=str(m['sha256']).lower():
                try:target.unlink()
                except:pass
                raise RuntimeError('Güncelleme dosyası güvenlik doğrulamasını geçemedi.')
            # Use a separate updater EXE copied to TEMP. It survives while Setup replaces app files.
            import sys, shutil
            app_exe=Path(sys.executable).resolve()
            helper_src=app_exe.parent/'BGM Updater.exe'
            if not helper_src.exists():raise RuntimeError('BGM Updater.exe bulunamadı. Temiz kurulum gerekli.')
            helper_tmp=Path(tempfile.gettempdir())/'BGM_Updater_Runtime.exe'
            shutil.copy2(helper_src,helper_tmp)
            subprocess.Popen([str(helper_tmp),str(target),str(app_exe)],shell=False)
            payload={'ok':True,'version':m['version'],'closing':True};code=200
            # Let HTTP response reach UI; launcher exits shortly after.
            threading.Thread(target=lambda:(time.sleep(1.2), os._exit(0)),daemon=True).start()
        except Exception as e:
            payload={'ok':False,'error':str(e)};code=500
        body=json.dumps(payload,ensure_ascii=False).encode();self.send_response(code);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)

    def do_GET(self):
        parsed=urllib.parse.urlsplit(self.path)
        if not parsed.path.startswith('/api/'):return super().do_GET()
        if parsed.path=='/api/version':
            out=json.dumps({'version':DESKTOP_VERSION},ensure_ascii=False).encode();self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(out)));self.end_headers();self.wfile.write(out);return
        if parsed.path=='/api/update-info':
            try:
                m=_update_manifest();payload={'ok':True,'current':DESKTOP_VERSION,'available':bool(m and m.get('available')),'latest':(m or {}).get('version'),'notes':(m or {}).get('notes','')}
            except Exception as e:payload={'ok':False,'current':DESKTOP_VERSION,'available':False,'error':str(e)}
            out=json.dumps(payload,ensure_ascii=False).encode();self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(out)));self.end_headers();self.wfile.write(out);return
        try:
            p=urllib.parse.parse_qs(parsed.query);exchange=p.get('exchange',['global'])[0]
            if exchange not in ('tr','global'):raise ValueError('Geçersiz borsa')
            if parsed.path=='/api/scan':payload=scan(exchange,force=p.get('force',['0'])[0]=='1')
            elif parsed.path=='/api/candles':
                symbol=p.get('symbol',['BTCUSDT'])[0];period=p.get('period',['1h'])[0]
                if not symbol.isalnum() or period not in ('15m','1h','4h','1d') or not symbol.endswith('TRY' if exchange=='tr' else 'USDT'):raise ValueError('Geçersiz parite veya zaman dilimi')
                if exchange=='tr':
                    matches=[x for x in tr_list() if x['symbol']==symbol]
                    if not matches:raise ValueError('TR paritesi bulunamadı')
                    item=matches[0]
                else:item={'symbol':symbol}
                raw=get_klines(item,period,1000,exchange,fresh=True) # uzun warm-up + açık mum
                if not raw:raise ValueError('Mum verisi boş')
                candle_price=float(raw[-1][4]);live_price=candle_price;price_source='kline açık mum close'
                try:
                    live_price=get_live_price(item,exchange)
                    raw=apply_live_price_to_open_candle(raw,live_price)
                    price_source='aynı borsanın son gerçekleşen işlemi'
                except Exception:
                    pass
                metrics=period_metrics(raw)
                payload={'symbol':symbol,'period':period,'candles':[[int(x[0]),float(x[1]),float(x[2]),float(x[3]),float(x[4]),float(x[5])] for x in raw], 'metrics':metrics, 'updated_at':int(time.time()*1000),'price':live_price,'price_source':price_source,'open_candle':True}
            elif parsed.path=='/api/new-test':payload=new_pair_test()
            elif parsed.path=='/api/tr-check':
                try:
                    pairs=tr_list();payload={'ok':True,'pair_count':len(pairs),'examples':[x['symbol'] for x in pairs[:8]]}
                except Exception as exc:payload={'ok':False,'error':str(exc)}
            elif parsed.path=='/api/sentiment':payload=binance_fear_greed()
            elif parsed.path=='/api/health':payload={'ok':True,'mode':'public read-only market data','version':'0.6.65'}
            else:raise ValueError('Bilinmeyen adres')
            status=200
        except Exception as exc:payload={'error':str(exc)};status=503
        out=json.dumps(payload,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(out)));self.end_headers();self.wfile.write(out)
if __name__=='__main__':
    port=int(os.environ.get('BGM_PORT','8545'));server=ThreadingHTTPServer(('127.0.0.1',port),Handler)
    print('BGM COIN PRO V0.6.65: http://127.0.0.1:%s'%port,flush=True)
    threading.Timer(1,lambda:webbrowser.open('http://127.0.0.1:%s/?v=0665'%port)).start();server.serve_forever()
