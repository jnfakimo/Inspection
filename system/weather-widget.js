(function(){
  'use strict';

  const COUNTIES=['基隆市','臺北市','新北市','桃園市','新竹市','新竹縣','苗栗縣','臺中市','彰化縣','南投縣','雲林縣','嘉義市','嘉義縣','臺南市','高雄市','屏東縣','宜蘭縣','花蓮縣','臺東縣','澎湖縣','金門縣','連江縣'];
  const MAIN_ISLAND_COUNTIES=COUNTIES.filter(county=>!['澎湖縣','金門縣','連江縣'].includes(county));
  const MAIN_ISLAND_VIEWBOX='270 210 340 560';
  const state={endpoint:'',anonKey:'',summary:null,selected:'臺北市',towns:[],svgText:'',refreshTimer:null,townRequest:0};
  const byId=id=>document.getElementById(id);
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const canonical=value=>String(value||'').trim().replaceAll('台','臺');
  const present=value=>value!==null&&value!==undefined&&value!=='';
  const numberText=(value,digits=0)=>present(value)&&Number.isFinite(Number(value))?Number(value).toFixed(digits):'—';

  function weatherIcon(text,code){
    const value=String(text||'')+' '+String(code||'');
    if(/雷|閃電|雷雨/.test(value))return '⛈️';
    if(/雪|冰雹/.test(value))return '❄️';
    if(/雨|陣雨|降雨/.test(value))return /晴/.test(value)?'🌦️':'🌧️';
    if(/霧|霾/.test(value))return '🌫️';
    if(/陰/.test(value))return '☁️';
    if(/雲/.test(value))return /晴/.test(value)?'🌤️':'🌥️';
    if(/晴/.test(value))return '☀️';
    return '🌡️';
  }

  function localTime(value){
    if(!value)return '時間未提供';
    const date=new Date(value);if(Number.isNaN(date.getTime()))return String(value);
    return new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
  }

  function countyData(name){
    return (state.summary?.counties||[]).find(item=>canonical(item.county)===canonical(name))||{county:name};
  }

  function countyAlerts(name){
    const stem=canonical(name).replace(/[市縣]$/,'');
    return (state.summary?.alerts||[]).filter(alert=>(alert.areas||[]).some(area=>canonical(area).includes(stem)));
  }

  async function api(view,params={}){
    const url=new URL(state.endpoint);
    url.searchParams.set('view',view);
    Object.entries(params).forEach(([key,value])=>url.searchParams.set(key,value));
    const response=await fetch(url,{cache:'no-store',headers:{apikey:state.anonKey,Authorization:'Bearer '+state.anonKey}});
    let payload={};try{payload=await response.json();}catch(error){}
    if(!response.ok||!payload.ok)throw new Error(payload.message||`氣象服務回應 ${response.status}`);
    return payload;
  }

  function renderAlerts(){
    const box=byId('weatherAlertTrack');if(!box)return;
    const bulletins=state.summary?.bulletins||[];
    if(bulletins.length){
      box.innerHTML=bulletins.map(item=>{
        const issuedAt=item.status==='clear'||!item.issuedAt?'':'　'+esc(localTime(item.issuedAt));
        return `<a class="weather-alert-item ${item.status==='clear'?'is-clear':'is-current'}" href="${esc(item.sourceUrl||'#')}" target="_blank" rel="noopener" title="${esc(item.content||item.title||item.label)}"><b>● ${esc(item.title||item.label)}</b>${issuedAt}</a>`;
      }).join('');
      return;
    }
    const alerts=state.summary?.alerts||[];
    if(!alerts.length){box.innerHTML='<span class="weather-alert-clear">目前無生效中的氣象警特報</span>';return;}
    box.innerHTML=alerts.map(alert=>{
      const areas=(alert.areas||[]).slice(0,8).join('、');
      return `<span class="weather-alert-item"><b>● ${esc(alert.title||alert.type||'氣象警特報')}</b>${areas?esc(areas):'影響區域請查看詳細內容'}</span>`;
    }).join('');
  }

  function metric(label,value,unit=''){
    return `<div class="weather-metric"><div class="label">${esc(label)}</div><div class="value">${esc(value)}${value==='—'?'':esc(unit)}</div></div>`;
  }

  function countyMarkup(data,compact=false){
    const current=numberText(data.temperature);
    const low=numberText(data.minTemperature),high=numberText(data.maxTemperature);
    const range=low==='—'&&high==='—'?'—':`${low}°–${high}°`;
    return `<div class="weather-place-row"><div class="weather-main-icon" aria-hidden="true">${weatherIcon(data.weather,data.weatherCode)}</div><div><div class="weather-place">${esc(data.county||state.selected)}</div><div class="weather-desc">${esc(data.weather||'天氣資料待更新')}</div></div><div class="weather-temp">${current}${current==='—'?'':'°'}<small>${current==='—'?'':'C'}</small></div></div>
      <div class="weather-metrics">${metric('預報溫度',range)}${metric('降雨機率',numberText(data.rainProbability),'%')}${metric('相對濕度',numberText(data.humidity),'%')}${metric('風速',numberText(data.windSpeed,1),' m/s')}</div>
      ${compact?`<div class="weather-hint">觀測站：${esc(data.stationName||'暫無即時觀測站資料')}｜觀測時間：${esc(localTime(data.observedAt))}<br>點擊左側臺灣本島地圖，可查看 19 縣市與鄉鎮市區預報。</div>`:''}`;
  }

  function renderSummary(){
    const box=byId('weatherSummary');if(!box)return;
    box.innerHTML=countyMarkup(countyData(state.selected),true);
  }

  function renderCountyPanel(){
    const box=byId('weatherCountyPanel');if(box)box.innerHTML=countyMarkup(countyData(state.selected));
    const alertsBox=byId('weatherCountyAlerts');if(!alertsBox)return;
    const alerts=countyAlerts(state.selected);
    if(!alerts.length){alertsBox.innerHTML='<div class="weather-alert-clear">目前無該縣市生效中的氣象警特報</div>';return;}
    alertsBox.innerHTML=alerts.map(alert=>`<div class="weather-county-alert"><b>${esc(alert.title||alert.type||'氣象警特報')}</b><br>${esc(alert.content||'詳細內容請依中央氣象署最新發布資訊為準。')}</div>`).join('');
  }

  function updateMapStates(){
    document.querySelectorAll('.weather-map-shell .county').forEach(path=>{
      const county=canonical(path.dataset.county);
      path.classList.toggle('selected',county===state.selected);
      path.classList.toggle('alerting',countyAlerts(county).length>0);
      path.setAttribute('aria-label',county+'天氣');
      path.setAttribute('tabindex','0');
    });
  }

  function addMapMarkers(svg){
    const layer=svg.querySelector('.weather-marker-layer');if(!layer)return;
    layer.textContent='';
    if(!state.summary)return;
    svg.querySelectorAll('.county').forEach(path=>{
      const data=countyData(path.dataset.county),x=Number(path.dataset.cx),y=Number(path.dataset.cy);
      if(!Number.isFinite(x)||!Number.isFinite(y))return;
      const group=document.createElementNS('http://www.w3.org/2000/svg','g');group.setAttribute('class','weather-marker');group.setAttribute('transform',`translate(${x} ${y})`);
      const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');circle.setAttribute('r','27');
      const icon=document.createElementNS('http://www.w3.org/2000/svg','text');icon.setAttribute('y','-1');icon.textContent=weatherIcon(data.weather,data.weatherCode);
      const temp=document.createElementNS('http://www.w3.org/2000/svg','text');temp.setAttribute('class','marker-temp');temp.setAttribute('y','36');temp.textContent=present(data.temperature)?Math.round(Number(data.temperature))+'°':'';
      group.append(circle,icon,temp);layer.appendChild(group);
    });
  }

  async function loadSvg(){
    if(state.svgText)return state.svgText;
    const response=await fetch('assets/taiwan-counties.svg?v=20260804-1',{cache:'force-cache'});
    if(!response.ok)throw new Error('臺灣縣市地圖載入失敗');
    state.svgText=await response.text();return state.svgText;
  }

  async function hydrateMap(id,full){
    const box=byId(id);if(!box)return;
    box.innerHTML=await loadSvg();
    const svg=box.querySelector('svg');if(!svg)return;
    svg.setAttribute('viewBox',MAIN_ISLAND_VIEWBOX);
    svg.setAttribute('aria-label','臺灣本島十九縣市互動氣象地圖');
    svg.querySelectorAll('.county').forEach(path=>{
      if(!MAIN_ISLAND_COUNTIES.includes(canonical(path.dataset.county)))path.remove();
    });
    addMapMarkers(svg);
    svg.querySelectorAll('.county').forEach(path=>{
      const choose=event=>{event.preventDefault();event.stopPropagation();selectCounty(path.dataset.county,full);};
      const showTowns=event=>{event.preventDefault();event.stopPropagation();selectCounty(path.dataset.county,false);openModal();};
      path.addEventListener('click',choose);
      if(!full)path.addEventListener('dblclick',showTowns);
      path.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ' )choose(event);});
    });
    updateMapStates();
  }

  function renderTown(){
    const select=byId('weatherTownSelect'),panel=byId('weatherTownPanel');if(!select||!panel)return;
    const town=state.towns.find(item=>item.town===select.value);
    if(!town){panel.textContent=state.towns.length?'請選擇鄉鎮市區。':'目前沒有可顯示的鄉鎮預報。';return;}
    const temp=present(town.temperature)?`${numberText(town.temperature)}°C`:`${numberText(town.minTemperature)}°–${numberText(town.maxTemperature)}°C`;
    panel.innerHTML=`<strong>${esc(town.town)}</strong>　${weatherIcon(town.weather,town.weatherCode)} ${esc(town.weather||'天氣資料待更新')}<br>溫度 ${esc(temp)}｜降雨機率 ${esc(numberText(town.rainProbability))}%｜相對濕度 ${esc(numberText(town.humidity))}%${town.windSpeed?`｜風速 ${esc(town.windSpeed)}`:''}<br>${esc(town.description||'')}`;
  }

  async function loadTowns(county){
    const request=++state.townRequest,select=byId('weatherTownSelect'),panel=byId('weatherTownPanel');
    if(select){select.disabled=true;select.innerHTML='<option value="">鄉鎮預報載入中…</option>';}
    if(panel)panel.textContent='正在讀取中央氣象署鄉鎮預報…';
    try{
      const payload=await api('town',{county});if(request!==state.townRequest)return;
      state.towns=payload.towns||[];
      if(select){select.disabled=false;select.innerHTML=state.towns.length?state.towns.map((item,index)=>`<option value="${esc(item.town)}"${index===0?' selected':''}>${esc(item.town)}</option>`).join(''):'<option value="">目前無鄉鎮資料</option>';}
      renderTown();
    }catch(error){
      if(request!==state.townRequest)return;state.towns=[];
      if(select){select.disabled=false;select.innerHTML='<option value="">鄉鎮預報載入失敗</option>';}
      if(panel)panel.textContent=error.message||'鄉鎮預報載入失敗';
    }
  }

  function selectCounty(name,withTowns=false){
    const county=canonical(name);if(!MAIN_ISLAND_COUNTIES.includes(county))return;
    state.selected=county;
    const select=byId('weatherCountySelect');if(select)select.value=county;
    renderSummary();renderCountyPanel();updateMapStates();
    if(withTowns)loadTowns(county);
  }

  function openModal(){
    const modal=byId('weatherModal');if(!modal)return;
    modal.hidden=false;document.body.style.overflow='hidden';selectCounty(state.selected,true);
    setTimeout(()=>modal.querySelector('[data-weather-close]')?.focus(),0);
  }

  function closeModal(){
    const modal=byId('weatherModal');if(!modal)return;
    modal.hidden=true;document.body.style.overflow='';
  }

  function showError(message){
    const summary=byId('weatherSummary'),alerts=byId('weatherAlertTrack'),updated=byId('weatherUpdated');
    if(summary)summary.innerHTML=`<div class="weather-error">${esc(message)}<br>完成 CWA_API_KEY 與 Edge Function 設定後會自動顯示。</div>`;
    if(alerts)alerts.innerHTML='<span class="weather-alert-clear">氣象資料服務尚未啟用</span>';
    if(updated)updated.textContent='尚未連線';
  }

  async function refresh(){
    try{
      await Promise.all([hydrateMap('weatherMiniMap',false),hydrateMap('weatherFullMap',true)]);
    }catch(error){
      console.error(error);
      ['weatherMiniMap','weatherFullMap'].forEach(id=>{const box=byId(id);if(box)box.textContent='臺灣縣市地圖載入失敗';});
    }
    try{
      state.summary=await api('summary');
      const updated=byId('weatherUpdated');if(updated)updated.textContent=(state.summary.stale?'快取資料 ':'更新 ')+localTime(state.summary.updatedAt);
      renderAlerts();renderSummary();renderCountyPanel();
      document.querySelectorAll('.weather-map-shell svg').forEach(addMapMarkers);
      updateMapStates();
    }catch(error){showError(error.message||'中央氣象署資料載入失敗');}
  }

  function bind(){
    document.querySelectorAll('[data-weather-open]').forEach(button=>{
      button.addEventListener(button.classList.contains('weather-map-button')?'dblclick':'click',openModal);
      button.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openModal();}});
    });
    document.querySelectorAll('[data-weather-close]').forEach(button=>button.addEventListener('click',closeModal));
    byId('weatherModal')?.addEventListener('click',event=>{if(event.target===event.currentTarget)closeModal();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!byId('weatherModal')?.hidden)closeModal();});
    const countySelect=byId('weatherCountySelect');
    if(countySelect){countySelect.innerHTML=MAIN_ISLAND_COUNTIES.map(county=>`<option value="${county}">${county}</option>`).join('');countySelect.value=state.selected;countySelect.addEventListener('change',()=>selectCounty(countySelect.value,true));}
    byId('weatherTownSelect')?.addEventListener('change',renderTown);
  }

  window.CwaWeatherWidget={
    init(options={}){
      if(!byId('weatherCard'))return;
      state.endpoint=options.endpoint||'';state.anonKey=options.anonKey||'';
      bind();refresh();clearInterval(state.refreshTimer);state.refreshTimer=setInterval(refresh,10*60*1000);
    },
    refresh,
  };
})();
