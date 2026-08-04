(function(){
  'use strict';
  var CATALOG=[
    {key:'alerts',title:'重要提醒',description:'逾期、待派工與區間案件提醒',x:0,y:0,w:12,h:1,minW:3,minH:1},
    {key:'kpis',title:'營運關鍵指標',description:'新增、完成、SLA、MTTR 與 MTBF',x:0,y:1,w:12,h:2,minW:4,minH:2},
    {key:'patrol',title:'駐衛警巡檢即時',description:'當班打卡狀態與巡邏點明細',x:0,y:3,w:8,h:6,minW:4,minH:4},
    {key:'status',title:'案件狀態分佈',description:'報修案件狀態圓餅圖',x:8,y:3,w:4,h:6,minW:3,minH:4},
    {key:'rank_dept',title:'各單位報修排行',description:'各單位區間報修件數',x:0,y:9,w:6,h:4,minW:3,minH:3},
    {key:'rank_equipment',title:'各設備故障排行',description:'設備故障件數排行',x:6,y:9,w:6,h:4,minW:3,minH:3},
    {key:'rank_technician',title:'維修人員案件數',description:'維修人員承辦案件排行',x:0,y:13,w:6,h:4,minW:3,minH:3},
    {key:'rank_fault',title:'故障類型分析',description:'故障類型件數排行',x:6,y:13,w:6,h:4,minW:3,minH:3},
    {key:'trend',title:'各月份報修趨勢',description:'最近十二個月報修趨勢',x:0,y:17,w:12,h:5,minW:4,minH:4}
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
        x:int(r.x,d.x,0,11),y:int(r.y,d.y,0,999),
        width:int(r.width,d.width,1,12),height:int(r.height,d.height,1,20),
        min_width:int(r.min_width,d.min_width,1,12),min_height:int(r.min_height,d.min_height,1,20),
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
