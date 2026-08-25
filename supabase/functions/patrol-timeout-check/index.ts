import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";
import { canonicalFloor } from "../_shared/floor.ts";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, content-type, x-cron-secret"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
type Rule={id:string;label:string;start:string;end:string;grace?:number;days?:number[];only_incomplete?:boolean;include_points?:boolean;enabled?:boolean};
type Shift={name:string;start_time:string;end_time:string;sort_order?:number};
const mins=(s:string)=>{const [h,m]=(s||"00:00").split(":").map(Number);return h*60+m;};
const normalizeShiftName=(name:string)=>String(name||"").trim().replace(/\s*巡邏\s*$/u,"");
const localParts=(d:Date)=>{const p:Record<string,string>={};new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",weekday:"short",hourCycle:"h23"}).formatToParts(d).forEach(x=>p[x.type]=x.value);return p;};
const iso=(date:string,time:string)=>new Date(`${date}T${time}:00+08:00`).toISOString();
const previousDate=(date:string)=>{const d=new Date(`${date}T00:00:00+08:00`);d.setDate(d.getDate()-1);return localParts(d).year+"-"+localParts(d).month+"-"+localParts(d).day;};
const nextDate=(date:string)=>{const d=new Date(`${date}T00:00:00+08:00`);d.setDate(d.getDate()+1);return localParts(d).year+"-"+localParts(d).month+"-"+localParts(d).day;};
const safeEqual=(a:string,b:string)=>{
  if(!a||!b||a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
};
async function authorizedCaller(req:Request,db:any){
  const cronSecret=Deno.env.get("CRON_SECRET")||"";
  if(cronSecret&&safeEqual(req.headers.get("x-cron-secret")||"",cronSecret))return "cron";
  const bearer=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!bearer)return null;
  const {data:{user}}=await db.auth.getUser(bearer);
  if(!user)return null;
  const {data}=await db.from("users").select("role,rbac_role,status").eq("auth_id",user.id).maybeSingle();
  const profile=data as {role:string|null;rbac_role:string|null;status:string|null}|null;
  return profile?.status==="active"&&(profile.role==="admin"||["admin","sysadmin"].includes(profile.rbac_role||""))?"admin":null;
}
const base64url=(input:Uint8Array|string)=>{
  const bytes=typeof input==="string"?new TextEncoder().encode(input):input;
  let binary="";bytes.forEach(byte=>binary+=String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
};
let cachedGoogleToken:{value:string;expiresAt:number}|null=null;
async function googleAccessToken(){
  if(cachedGoogleToken&&cachedGoogleToken.expiresAt>Date.now()+60000)return cachedGoogleToken.value;
  const encoded=Deno.env.get("FIREBASE_SERVICE_ACCOUNT_B64");
  if(!encoded)throw new Error("FCM 服務帳戶尚未設定");
  const service=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))));
  const now=Math.floor(Date.now()/1000);
  const header=base64url(JSON.stringify({alg:"RS256",typ:"JWT"}));
  const claims=base64url(JSON.stringify({iss:service.client_email,scope:"https://www.googleapis.com/auth/firebase.messaging",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600}));
  const signingInput=`${header}.${claims}`;
  const pem=String(service.private_key).replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,"");
  const keyBytes=Uint8Array.from(atob(pem),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey("pkcs8",keyBytes,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  const signature=new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(signingInput)));
  const assertion=`${signingInput}.${base64url(signature)}`;
  const tokenRes=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})});
  const tokenBody=await tokenRes.json();
  if(!tokenRes.ok||!tokenBody.access_token)throw new Error(`FCM OAuth 失敗：${tokenBody.error_description||tokenBody.error||tokenRes.status}`);
  cachedGoogleToken={value:tokenBody.access_token,expiresAt:Date.now()+(Number(tokenBody.expires_in)||3600)*1000};
  return cachedGoogleToken.value;
}
async function sendFcm(db:any,title:string,body:string,tag:string){
  const {data:subscriptions,error}=await db.from("fcm_subscriptions").select("subscription_id,token").eq("enabled",true);
  if(error)throw error;
  const activeSubscriptions=(subscriptions||[]) as {subscription_id:string;token:string}[];
  if(!activeSubscriptions.length)return {status:"skipped",success:0,failure:0,response:"尚無已啟用的 FCM 裝置"};
  const accessToken=await googleAccessToken(),projectId=Deno.env.get("FIREBASE_PROJECT_ID")||"jnfa-4064f";
  let success=0,failure=0;const errors:string[]=[];
  await Promise.all(activeSubscriptions.map(async sub=>{
    const res=await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({message:{token:sub.token,data:{title,body,tag,url:"./guardpatrol.html"},webpush:{headers:{Urgency:"high"},fcm_options:{link:"https://jnfakimo.github.io/word-cloud/system/guardpatrol.html"}}}})});
    const response=await res.text();
    if(res.ok){success++;return;}
    failure++;errors.push(response.slice(0,300));
    if(res.status===404||/UNREGISTERED|registration-token-not-registered/i.test(response))await db.from("fcm_subscriptions").update({enabled:false,updated_at:new Date().toISOString()}).eq("subscription_id",sub.subscription_id);
  }));
  return {status:success?"sent":"failed",success,failure,response:errors.length?errors.join("\n"):"發送成功"};
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  try{
    const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const caller=await authorizedCaller(req,db);
    if(!caller)return reply({ok:false,msg:"Unauthorized"},401);
    const body=await req.json().catch(()=>({}));
    const {data:rows,error:settingsError}=await db.from("system_settings").select("key,value");
    if(settingsError)throw settingsError;
    const s:Record<string,string>={};(rows||[]).forEach((r:{key:string;value:string})=>s[r.key]=r.value);
    if(body.verifyFcmAuth===true){await googleAccessToken();return reply({ok:true,msg:"FCM OAuth 驗證成功"});}
    const lineEnabled=s.line_notify_patrol_timeout==="true";
    const fcmEnabled=s.fcm_notify_patrol_timeout==="true";
    if(!lineEnabled&&!fcmEnabled&&!body.force)return reply({ok:true,msg:"disabled"});
    const token=s.line_channel_token,groupId=s.line_group_id;
    if(lineEnabled&&(!token||!groupId))return reply({ok:false,msg:"LINE 尚未設定"},400);
    let configuredRules:Rule[]=[];try{configuredRules=JSON.parse(s.patrol_timeout_rules||"[]");}catch(_e){}
    let staffAssignments:{templates:Record<string,string[]>;dates:Record<string,Record<string,string[]>>}={templates:{},dates:{}};
    try{staffAssignments=JSON.parse(s.patrol_shift_staff||"{}");staffAssignments.templates||={};staffAssignments.dates||={};}catch(_e){}
    const now=new Date(),p=localParts(now),today=`${p.year}-${p.month}-${p.day}`;
    const yesterday=previousDate(today);
    const weekday=new Date(`${today}T12:00:00+08:00`).getDay();
    const {data:templates,error:templateError}=await db.from("patrol_shift_template").select("name,start_time,end_time,sort_order").order("sort_order");
    if(templateError)throw templateError;
    const rules:Rule[]=(templates||[]).map((shift:Shift)=>{
      const configured=configuredRules.find(r=>normalizeShiftName(r.label)===normalizeShiftName(shift.name));
      return {
        id:`shift:${shift.name}`,
        label:shift.name,
        start:(configured?.start||shift.start_time).slice(0,5),
        end:(configured?.end||shift.end_time).slice(0,5),
        grace:configured?.grace||0,
        days:configured?.days,
        enabled:configured?.enabled!==false,
        only_incomplete:configured?.only_incomplete!==false,
        include_points:configured?.include_points!==false,
      };
    });
    const results=[];
    for(const rule of rules){
      if(rule.enabled===false||!rule.id||!rule.start||!rule.end)continue;
      const grace=Math.max(0,Number(rule.grace)||0);
      // 從今天與昨天找出「最近一個已超過通報結束時間」的班別。
      // 這能正確處理跨夜班，並避免 force/手動測試把尚未到期的未來班別提前送出。
      const candidates=[yesterday,today].map(shiftDate=>{
        const effectiveStart=rule.start.slice(0,5);
        const effectiveEnd=rule.end.slice(0,5);
        const overnight=mins(effectiveEnd)<=mins(effectiveStart);
        const endDay=overnight?nextDate(shiftDate):shiftDate;
        const notifyAt=new Date(new Date(iso(endDay,effectiveEnd)).getTime()+grace*60000);
        return {shiftDate,effectiveStart,effectiveEnd,overnight,endDay,notifyAt};
      }).filter(x=>x.notifyAt<=now).sort((a,b)=>b.notifyAt.getTime()-a.notifyAt.getTime());
      if(!candidates.length)continue;
      const {shiftDate,effectiveStart,effectiveEnd,overnight,endDay}=candidates[0];
      const shiftWeekday=new Date(`${shiftDate}T12:00:00+08:00`).getDay();
      if(rule.days?.length&&!rule.days.includes(shiftWeekday))continue;
      const startIso=iso(shiftDate,effectiveStart),endIso=iso(endDay,effectiveEnd);
      const {data:existing}=await db.from("patrol_timeout_notifications").select("notification_id,status").eq("rule_id",rule.id).eq("shift_date",shiftDate).maybeSingle();
      if(existing){results.push({rule:rule.id,msg:"already processed"});continue;}
      const {data:markers,error:markerError}=await db.from("plan_markers").select("marker_id,floor_id,label").eq("kind","patrol").eq("status","active");
      if(markerError)throw markerError;
      const {data:logs,error:logError}=await db.from("checkin_logs").select("target_id,user_id,user_name,checkin_at").eq("target_type","marker").gte("checkin_at",startIso).lte("checkin_at",endIso);
      if(logError)throw logError;
      const checkedIds=new Set((logs||[]).map((x:{target_id:string})=>x.target_id));
      const unchecked=(markers||[]).filter((m:{marker_id:string})=>!checkedIds.has(m.marker_id));
      const actual=[...new Set((logs||[]).map((x:{user_name:string})=>x.user_name).filter(Boolean))] as string[];
      let assignedNames:string[]=[],assignedDepartments:string[]=[];
      const assignedIds=staffAssignments.dates?.[shiftDate]?.[rule.label]||staffAssignments.templates?.[rule.label]||[];
      if(assignedIds.length){
        const {data:users}=await db.from("users").select("user_id,name,department,dept_id").in("user_id",assignedIds);
        assignedNames=(users||[]).map((u:{name:string})=>u.name).filter(Boolean);
        assignedDepartments=(users||[]).map((u:{department:string})=>u.department).filter(Boolean);
        const deptIds=[...new Set((users||[]).map((u:{dept_id:string})=>u.dept_id).filter(Boolean))];
        if(deptIds.length){const {data:deps}=await db.from("departments").select("dept_id,name").in("dept_id",deptIds);assignedDepartments.push(...(deps||[]).map((d:{name:string})=>d.name));}
      }
      assignedDepartments=[...new Set(assignedDepartments)];
      const expected=(markers||[]).length,checked=expected-unchecked.length,rate=expected?((checked/expected)*100).toFixed(1):"100.0";
      const floorCount:Record<string,number>={};unchecked.forEach((m:{floor_id:string})=>{const floor=canonicalFloor(m.floor_id)||"未設定";floorCount[floor]=(floorCount[floor]||0)+1;});
      const floorText=Object.entries(floorCount).map(([f,n])=>`${f}：${n} 點`).join("\n")||"無";
      const pointText=rule.include_points&&unchecked.length?"\n\n未完成點位：\n"+unchecked.slice(0,20).map((m:{floor_id:string;label:string})=>`${canonicalFloor(m.floor_id)||""}－${m.label||"未命名"}`).join("\n")+(unchecked.length>20?`\n另有 ${unchecked.length-20} 點`:""):"";
      const text=`⚠️ 駐衛警巡檢逾時通知\n\n日期：${shiftDate}\n巡邏時段：${rule.label}\n巡邏時間：${effectiveStart}～${effectiveEnd}\n\n當班部門：${assignedDepartments.join("、")||"尚未設定"}\n排定人員：${assignedNames.join("、")||"尚未指派"}\n實際打卡：${actual.join("、")||"尚無人員打卡"}\n\n應打卡：${expected} 點\n已打卡：${checked} 點\n未打卡：${unchecked.length} 點\n完成率：${rate}%\n\n未完成樓層：\n${floorText}${pointText}`;
      if(body.dryRun){results.push({rule:rule.id,shift:rule.label,shiftDate,start:effectiveStart,end:effectiveEnd,expected,checked,unchecked:unchecked.length,dryRun:true});continue;}
      const record={rule_id:rule.id,shift_date:shiftDate,shift_name:rule.label,scheduled_end:endIso,expected_count:expected,checked_count:checked,unchecked_count:unchecked.length,assigned_departments:assignedDepartments,assigned_names:assignedNames,actual_names:actual,status:"pending"};
      await db.from("patrol_timeout_notifications").upsert(record,{onConflict:"rule_id,shift_date"});
      if(rule.only_incomplete!==false&&unchecked.length===0){await db.from("patrol_timeout_notifications").update({status:"skipped",line_response:"全部完成",fcm_status:"skipped",fcm_response:"全部完成"}).eq("rule_id",rule.id).eq("shift_date",shiftDate);results.push({rule:rule.id,msg:"complete"});continue;}
      let lineResult={status:"skipped",ok:false,response:"LINE 未啟用"};
      if(lineEnabled){
        const lineRes=await fetch("https://api.line.me/v2/bot/message/push",{method:"POST",headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({to:groupId,messages:[{type:"text",text}]})});
        lineResult={status:lineRes.ok?"sent":"failed",ok:lineRes.ok,response:await lineRes.text()};
      }
      let fcmResult={status:"skipped",success:0,failure:0,response:"FCM 未啟用"};
      if(fcmEnabled){
        const fcmBody=`${shiftDate} ${rule.label}｜未打卡 ${unchecked.length} 點｜完成率 ${rate}%`;
        try{fcmResult=await sendFcm(db,"駐衛警巡檢逾時通知",fcmBody,`${rule.id}:${shiftDate}`);}catch(e){fcmResult={status:"failed",success:0,failure:1,response:e instanceof Error?e.message:String(e)};}
      }
      const anySent=lineResult.ok||fcmResult.success>0;
      await db.from("patrol_timeout_notifications").update({status:lineResult.status,line_response:lineResult.response,fcm_status:fcmResult.status,fcm_success_count:fcmResult.success,fcm_failure_count:fcmResult.failure,fcm_response:fcmResult.response,sent_at:anySent?new Date().toISOString():null}).eq("rule_id",rule.id).eq("shift_date",shiftDate);
      results.push({rule:rule.id,line:lineResult.status,fcm:fcmResult.status,fcmSuccess:fcmResult.success,expected,checked,unchecked:unchecked.length});
    }
    return reply({ok:true,weekday,ruleCount:rules.length,dryRun:body.dryRun===true,results});
  }catch(e){
    const msg=e instanceof Error?e.message:typeof e==="object"&&e?JSON.stringify(e):String(e);
    return reply({ok:false,msg},500);
  }
});
