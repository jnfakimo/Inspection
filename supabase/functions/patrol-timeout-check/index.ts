import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, content-type"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
type Rule={id:string;label:string;start:string;end:string;grace?:number;days?:number[];only_incomplete?:boolean;include_points?:boolean;enabled?:boolean};
const mins=(s:string)=>{const [h,m]=(s||"00:00").split(":").map(Number);return h*60+m;};
const localParts=(d:Date)=>{const p:Record<string,string>={};new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",weekday:"short",hourCycle:"h23"}).formatToParts(d).forEach(x=>p[x.type]=x.value);return p;};
const iso=(date:string,time:string)=>new Date(`${date}T${time}:00+08:00`).toISOString();
const previousDate=(date:string)=>{const d=new Date(`${date}T00:00:00+08:00`);d.setDate(d.getDate()-1);return localParts(d).year+"-"+localParts(d).month+"-"+localParts(d).day;};

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  try{
    const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body=await req.json().catch(()=>({}));
    const {data:rows,error:settingsError}=await db.from("system_settings").select("key,value");
    if(settingsError)throw settingsError;
    const s:Record<string,string>={};(rows||[]).forEach((r:{key:string;value:string})=>s[r.key]=r.value);
    if(s.line_notify_patrol_timeout!=="true"&&!body.force)return reply({ok:true,msg:"disabled"});
    const token=s.line_channel_token,groupId=s.line_group_id;
    if(!token||!groupId)return reply({ok:false,msg:"LINE 尚未設定"},400);
    let rules:Rule[]=[];try{rules=JSON.parse(s.patrol_timeout_rules||"[]");}catch(_e){}
    const now=new Date(),p=localParts(now),today=`${p.year}-${p.month}-${p.day}`,nowMin=Number(p.hour)*60+Number(p.minute);
    const weekday=new Date(`${today}T12:00:00+08:00`).getDay();
    const results=[];
    for(const rule of rules){
      if(rule.enabled===false||!rule.id||!rule.start||!rule.end)continue;
      const {data:todayShift}=await db.from("patrol_shifts").select("start_time,end_time,assigned_user_ids").eq("shift_date",today).eq("name",rule.label).maybeSingle();
      const {data:shiftTemplate}=await db.from("patrol_shift_template").select("start_time,end_time,assigned_user_ids").eq("name",rule.label).eq("status","active").maybeSingle();
      const effectiveStart=(todayShift?.start_time||shiftTemplate?.start_time||rule.start).slice(0,5);
      const effectiveEnd=(todayShift?.end_time||shiftTemplate?.end_time||rule.end).slice(0,5);
      const startMin=mins(effectiveStart),endMin=mins(effectiveEnd),grace=Math.max(0,Number(rule.grace)||0),overnight=endMin<=startMin;
      let shiftDate=today,notifyMin=endMin+grace;
      if(overnight&&nowMin<=notifyMin+15)shiftDate=previousDate(today);
      const shiftWeekday=new Date(`${shiftDate}T12:00:00+08:00`).getDay();
      if(rule.days?.length&&!rule.days.includes(shiftWeekday))continue;
      const due=overnight&&shiftDate!==today?nowMin>=notifyMin&&nowMin<notifyMin+10:nowMin>=notifyMin&&nowMin<notifyMin+10;
      if(!body.force&&!due)continue;
      const endDate=overnight?localParts(new Date(new Date(`${shiftDate}T12:00:00+08:00`).getTime()+86400000)):null;
      const endDay=endDate?`${endDate.year}-${endDate.month}-${endDate.day}`:shiftDate;
      const startIso=iso(shiftDate,effectiveStart),endIso=iso(endDay,effectiveEnd);
      const {data:existing}=await db.from("patrol_timeout_notifications").select("notification_id,status").eq("rule_id",rule.id).eq("shift_date",shiftDate).maybeSingle();
      if(existing&&!body.force){results.push({rule:rule.id,msg:"already processed"});continue;}
      const {data:markers,error:markerError}=await db.from("plan_markers").select("marker_id,floor_id,label").eq("kind","patrol").eq("status","active");
      if(markerError)throw markerError;
      const {data:logs,error:logError}=await db.from("checkin_logs").select("target_id,user_id,user_name,checkin_at").eq("target_type","marker").gte("checkin_at",startIso).lte("checkin_at",endIso);
      if(logError)throw logError;
      const checkedIds=new Set((logs||[]).map((x:{target_id:string})=>x.target_id));
      const unchecked=(markers||[]).filter((m:{marker_id:string})=>!checkedIds.has(m.marker_id));
      const actual=[...new Set((logs||[]).map((x:{user_name:string})=>x.user_name).filter(Boolean))] as string[];
      let assignedNames:string[]=[],assignedDepartments:string[]=[];
      const {data:dailyShift}=shiftDate===today?{data:todayShift}:await db.from("patrol_shifts").select("assigned_user_ids").eq("shift_date",shiftDate).eq("name",rule.label).maybeSingle();
      const assignedIds=(dailyShift?.assigned_user_ids?.length?dailyShift.assigned_user_ids:shiftTemplate?.assigned_user_ids)||[];
      if(assignedIds.length){
        const {data:users}=await db.from("users").select("user_id,name,department,dept_id").in("user_id",assignedIds);
        assignedNames=(users||[]).map((u:{name:string})=>u.name).filter(Boolean);
        assignedDepartments=(users||[]).map((u:{department:string})=>u.department).filter(Boolean);
        const deptIds=[...new Set((users||[]).map((u:{dept_id:string})=>u.dept_id).filter(Boolean))];
        if(deptIds.length){const {data:deps}=await db.from("departments").select("dept_id,name").in("dept_id",deptIds);assignedDepartments.push(...(deps||[]).map((d:{name:string})=>d.name));}
      }
      assignedDepartments=[...new Set(assignedDepartments)];
      const expected=(markers||[]).length,checked=expected-unchecked.length,rate=expected?((checked/expected)*100).toFixed(1):"100.0";
      const floorCount:Record<string,number>={};unchecked.forEach((m:{floor_id:string})=>floorCount[m.floor_id||"未設定"]=(floorCount[m.floor_id||"未設定"]||0)+1);
      const floorText=Object.entries(floorCount).map(([f,n])=>`${f}：${n} 點`).join("\n")||"無";
      const pointText=rule.include_points&&unchecked.length?"\n\n未完成點位：\n"+unchecked.slice(0,20).map((m:{floor_id:string;label:string})=>`${m.floor_id||""}－${m.label||"未命名"}`).join("\n")+(unchecked.length>20?`\n另有 ${unchecked.length-20} 點`:""):"";
      const text=`⚠️ 駐衛警巡檢逾時通知\n\n日期：${shiftDate}\n巡邏時段：${rule.label}\n巡邏時間：${effectiveStart}～${effectiveEnd}\n\n當班部門：${assignedDepartments.join("、")||"尚未設定"}\n排定人員：${assignedNames.join("、")||"尚未指派"}\n實際打卡：${actual.join("、")||"尚無人員打卡"}\n\n應打卡：${expected} 點\n已打卡：${checked} 點\n未打卡：${unchecked.length} 點\n完成率：${rate}%\n\n未完成樓層：\n${floorText}${pointText}`;
      const record={rule_id:rule.id,shift_date:shiftDate,shift_name:rule.label,scheduled_end:endIso,expected_count:expected,checked_count:checked,unchecked_count:unchecked.length,assigned_departments:assignedDepartments,assigned_names:assignedNames,actual_names:actual,status:"pending"};
      await db.from("patrol_timeout_notifications").upsert(record,{onConflict:"rule_id,shift_date"});
      if(rule.only_incomplete!==false&&unchecked.length===0){await db.from("patrol_timeout_notifications").update({status:"skipped",line_response:"全部完成"}).eq("rule_id",rule.id).eq("shift_date",shiftDate);results.push({rule:rule.id,msg:"complete"});continue;}
      const lineRes=await fetch("https://api.line.me/v2/bot/message/push",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({to:groupId,messages:[{type:"text",text}]})});
      const responseText=await lineRes.text();
      await db.from("patrol_timeout_notifications").update({status:lineRes.ok?"sent":"failed",line_response:responseText,sent_at:lineRes.ok?new Date().toISOString():null}).eq("rule_id",rule.id).eq("shift_date",shiftDate);
      results.push({rule:rule.id,ok:lineRes.ok,expected,checked,unchecked:unchecked.length});
    }
    return reply({ok:true,weekday,results});
  }catch(e){return reply({ok:false,msg:e instanceof Error?e.message:String(e)},500);}
});
