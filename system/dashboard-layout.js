(function(){
  'use strict';
  var CATALOG=[
    // 系統 11
    {key:'alerts',system:11,title:'重要提醒與異常警報',description:'即時重大警報、設備異常跑馬燈',x:0,y:0,w:12,h:2,minW:3,minH:1},
    {key:'kpis',system:11,title:'營運關鍵指標',description:'進場車次、出勤率、在線率、異常件數',x:0,y:2,w:12,h:2,minW:4,minH:2},
    {key:'patrol',system:11,title:'駐衛警巡檢即時',description:'巡檢點打卡進度、排班執勤狀況',x:0,y:4,w:8,h:6,minW:4,minH:4},
    {key:'repairs',system:11,title:'報修案件分佈',description:'各區報修處理進度與完工率',x:8,y:4,w:4,h:6,minW:3,minH:4},
    {key:'equipment_status',system:11,title:'設備狀態監控',description:'冷凍設備、電力系統、消防感測妥善率',x:0,y:10,w:6,h:4,minW:3,minH:3},
    {key:'realtime_incident_map',system:11,title:'全場異常事件即時地圖',description:'全市場熱點分佈、緊急應變案件定位',x:6,y:10,w:6,h:4,minW:3,minH:3},
    {key:'sla_compliance',system:11,title:'維修 SLA 達成率與 MTTR',description:'修復平均時間 MTTR 與 SLA 達標統計',x:0,y:14,w:6,h:3,minW:3,minH:2},
    {key:'staff_duty_matrix',system:11,title:'在勤人員打卡與跨班排班',description:'日班/夜班在勤人力配置與即時簽到',x:6,y:14,w:6,h:4,minW:3,minH:3},
    {key:'cctv_ipcam_grid',system:11,title:'關鍵場區攝影機監控雲臺',description:'拍賣區、進出閘口即時影像聯網輪播',x:0,y:17,w:6,h:4,minW:3,minH:3},
    {key:'weather_risk_radar',system:11,title:'氣象特報與防汛應變',description:'降雨機率、颱風豪雨警報與防汛整備級別',x:6,y:17,w:6,h:3,minW:3,minH:2},
    {key:'weather_taiwan',system:11,title:'臺灣即時氣象特報',description:'中央氣象署警特報、縣市觀測與鄉鎮預報',x:0,y:21,w:12,h:4,minW:6,minH:3},
    {key:'rank_dept',system:11,title:'各單位報修排行',description:'各單位區間報修件數分析統計',x:0,y:25,w:6,h:4,minW:3,minH:3},
    {key:'rank_equipment',system:11,title:'各設備故障排行',description:'設備故障件數與維修頻率排行',x:6,y:25,w:6,h:4,minW:3,minH:3},
    {key:'rank_technician',system:11,title:'維修人員承辦件數',description:'技術人員承辦件數與結案效率',x:0,y:29,w:6,h:4,minW:3,minH:3},
    {key:'rank_fault',system:11,title:'故障類型分析',description:'電氣、機械、管線故障類型佔比',x:6,y:29,w:6,h:4,minW:3,minH:3},
    {key:'trend',system:11,title:'各月份報修趨勢',description:'最近十二個月報修累積趨勢折線圖',x:0,y:33,w:12,h:4,minW:4,minH:3},

    // 系統 10
    {key:'trading_kpi',system:10,title:'市場交易量分析',description:'今日交易量、金額、品項數與成交率',x:0,y:37,w:6,h:3,minW:3,minH:2},
    {key:'price_comparison',system:10,title:'蔬果價格同期比較',description:'各類別蔬果本日與昨日均價長條比較',x:6,y:37,w:6,h:4,minW:3,minH:3},
    {key:'weekly_trend',system:10,title:'每週交易趨勢走勢',description:'近一週成交量與歷史同期對比柱狀圖',x:0,y:41,w:8,h:4,minW:4,minH:3},
    {key:'market_allocation',system:10,title:'配置與妥善率儀表',description:'市場滿載率、作業人員與車輛配置',x:8,y:41,w:4,h:4,minW:3,minH:3},
    {key:'supplier_ranking',system:10,title:'主要產地／供應商進貨排行',description:'西螺、溪湖、九如等各產區到貨噸數排行',x:0,y:45,w:6,h:4,minW:3,minH:3},
    {key:'price_volatility',system:10,title:'行情波動與異常價位警示',description:'單日漲跌超過 15% 異常波動品項監控',x:6,y:45,w:6,h:4,minW:3,minH:3},
    {key:'auction_efficiency',system:10,title:'拍賣場次交易進度與速度',description:'第一/第二拍賣場即時進度與每批均速',x:0,y:49,w:6,h:3,minW:3,minH:2},
    {key:'floor_congestion',system:10,title:'卸貨場區滿載率與車流動態',description:'大車卸貨泊位佔用與等待進場車流動態',x:6,y:49,w:6,h:4,minW:3,minH:3},

    // 系統 12
    {key:'public_price_board',system:12,title:'公開大宗即時報價看板',description:'高麗菜、番茄、青花菜等即時行情走勢',x:0,y:53,w:6,h:5,minW:4,minH:3},
    {key:'market_turnover',system:12,title:'市場公開總成交額',description:'近 8 日大宗批發交易總額折線分佈',x:6,y:53,w:6,h:4,minW:3,minH:3},
    {key:'commodity_ratio',system:12,title:'品項交易佔比分佈',description:'葉菜類、根莖類、瓜果類交易比重',x:0,y:58,w:6,h:4,minW:3,minH:3},
    {key:'realtime_ticker',system:12,title:'即時滾動跑馬燈行情',description:'各拍賣台最新成交批次及時文字廣播',x:6,y:58,w:6,h:2,minW:4,minH:1},
    {key:'top_gainers_losers',system:12,title:'今日蔬果漲跌幅排行榜',description:'本日漲幅前三、跌幅前三蔬果統計',x:0,y:62,w:6,h:4,minW:3,minH:3},
    {key:'origin_weather_map',system:12,title:'主要產地天氣與供貨狀態',description:'中南部主產地天候降雨與路況概況',x:6,y:62,w:6,h:4,minW:3,minH:3},
    {key:'historical_price_curve',system:12,title:'30日/同季歷史價格曲線',description:'歷史同期比價與 30 日均價趨勢曲線',x:0,y:66,w:6,h:4,minW:3,minH:3},
    {key:'consumer_guide_board',system:12,title:'平價蔬果專區與供應指引',description:'平價供應專區資訊與大宗採購指引',x:6,y:66,w:6,h:4,minW:3,minH:3}
  ];
  var BY_KEY={};CATALOG.forEach(function(x){BY_KEY[x.key]=x;});

  function defaults(){
    return CATALOG.map(function(x,i){return {
      widget_key:x.key,title:x.title,x:x.x,y:x.y,width:x.w,height:x.h,
      min_width:x.minW,min_height:x.minH,visible:true,refresh_seconds:60,
      config:{},sort_order:(i+1)*10
    };});
  }
  function int(v,f,min,max){
    v=parseInt(v,10);if(!Number.isFinite(v))v=f;
    return Math.max(min,Math.min(max,v));
  }
  function normalize(rows){
    var source=Array.isArray(rows)?rows:[];
    var map={};source.forEach(function(r){if(r&&BY_KEY[r.widget_key])map[r.widget_key]=r;});
    return defaults().map(function(d){
      var r=map[d.widget_key]||{};
      return {
        widget_key:d.widget_key,
        title:String(r.title||d.title).slice(0,80),
        x:int(r.x,d.x,0,24),y:int(r.y,d.y,0,999),
        width:int(r.width,d.width,1,24),height:int(r.height,d.height,1,20),
        min_width:int(r.min_width,d.min_width,1,24),min_height:int(r.min_height,d.min_height,1,20),
        visible:r.visible!==false,
        refresh_seconds:int(r.refresh_seconds,d.refresh_seconds,0,86400),
        config:r.config&&typeof r.config==='object'?r.config:{},
        sort_order:int(r.sort_order,d.sort_order,0,9999)
      };
    });
  }
  function escapeHTML(value){
    return String(value==null?'':value).replace(/[&<>'"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c];});
  }
  function applyToGrid(grid,rows){
    var items=normalize(rows);
    items.forEach(function(item){
      var el=document.querySelector('.grid-stack-item[data-widget-key="'+item.widget_key+'"]');
      if(!el)return;
      el.hidden=!item.visible;
      el.dataset.widgetTitle=item.title;
      var title=el.querySelector('[data-widget-title]');if(title)title.textContent=item.title;
      if(item.visible)grid.update(el,{x:item.x,y:item.y,w:item.width,h:item.height,minW:item.min_width,minH:item.min_height,id:item.widget_key});
      else grid.removeWidget(el,false,false);
    });
    if(typeof grid.compact==='function')grid.compact();
    return items;
  }
  function payloadFromGrid(grid,titleMap,visibilityMap){
    var nodes=grid.save(false)||[];
    var map={};nodes.forEach(function(n){map[n.id]=n;});
    return normalize(CATALOG.map(function(c,i){
      var n=map[c.key]||{};
      return {
        widget_key:c.key,title:titleMap&&titleMap[c.key]||c.title,
        x:n.x==null?c.x:n.x,y:n.y==null?c.y:n.y,
        width:n.w==null?c.w:n.w,height:n.h==null?c.h:n.h,
        min_width:c.minW,min_height:c.minH,
        visible:!visibilityMap||visibilityMap[c.key]!==false,
        refresh_seconds:60,config:{},sort_order:(i+1)*10
      };
    }));
  }
  window.DashboardLayout={catalog:CATALOG,byKey:BY_KEY,defaults:defaults,normalize:normalize,escapeHTML:escapeHTML,applyToGrid:applyToGrid,payloadFromGrid:payloadFromGrid};
})();
