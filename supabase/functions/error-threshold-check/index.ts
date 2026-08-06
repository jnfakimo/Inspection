// 關鍵功能異常通知 — 每隔 N 分鐘檢查 client_error_logs 是否短時間內爆量，
// 超過門檻就推播 LINE，讓維運方主動發現系統性問題（而非等使用者反映）。
// 沿用 patrol-timeout-check 的 system_settings 驅動與 LINE 推播寫法。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, content-type, x-cron-secret"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const safeEqual=(a:string,b:string)=>{if(!a||!b||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;};
async function authorized(req:Request,db:any){
  const cron=Deno.env.get("CRON_SECRET")||"";
  if(cron&&safeEqual(req.headers.get("x-cron-secret")||"",cron))return true;
  const bearer=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!bearer)return false;
  const {data:{user}}=await db.auth.getUser(bearer);if(!user)return false;
  const {data:p}=await db.from("users").select("role,rbac_role,status").eq("auth_id",user.id).maybeSingle();
  return p?.status==="active"&&(p.role==="admin"||["admin","sysadmin"].includes(p.rbac_role||""));
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  try{
    const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if(!await authorized(req,db))return reply({ok:false,msg:"Unauthorized"},401);
    const body=await req.json().catch(()=>({}));
    const {data:rows,error:settingsError}=await db.from("system_settings").select("key,value");
    if(settingsError)throw settingsError;
    const s:Record<string,string>={};(rows||[]).forEach((r:{key:string;value:string})=>s[r.key]=r.value);

    const enabled=s.line_notify_error_threshold==="true";
    if(!enabled&&!body.force)return reply({ok:true,msg:"disabled"});
    const token=s.line_channel_token,groupId=s.line_group_id;
    if(!token||!groupId)return reply({ok:false,msg:"LINE 尚未設定"},400);

    const windowMinutes=Number(s.error_threshold_window_minutes)||15;
    const threshold=Number(s.error_threshold_count)||20;
    const cooldownMinutes=Number(s.error_threshold_cooldown_minutes)||60;

    const since=new Date(Date.now()-windowMinutes*60000).toISOString();
    const {count,error:countError}=await db.from("client_error_logs").select("error_id",{count:"exact",head:true}).gte("occurred_at",since);
    if(countError)throw countError;
    const total=count||0;

    if(total<threshold&&!body.force){
      return reply({ok:true,msg:"below threshold",total,threshold,windowMinutes});
    }

    // 冷卻時間：避免同一波爆量在還沒解決前，每次排程觸發都重複推播。
    const lastNotified=s.error_threshold_last_notified?new Date(s.error_threshold_last_notified):null;
    if(lastNotified&&Date.now()-lastNotified.getTime()<cooldownMinutes*60000&&!body.force){
      return reply({ok:true,msg:"cooldown",total,threshold,lastNotified:s.error_threshold_last_notified});
    }

    const {data:byKind}=await db.from("client_error_logs").select("kind").gte("occurred_at",since);
    const kindCounts:Record<string,number>={};
    (byKind||[]).forEach((r:{kind:string})=>{kindCounts[r.kind]=(kindCounts[r.kind]||0)+1;});
    const kindText=Object.entries(kindCounts).map(([k,n])=>`${k}：${n} 筆`).join("\n")||"（無明細）";

    const text=`🚨 系統錯誤達通知門檻\n\n最近 ${windowMinutes} 分鐘內錯誤筆數：${total}（門檻 ${threshold}）\n\n分類明細：\n${kindText}\n\n請至後台「系統健康」頁查看詳情。`;

    if(!body.dryRun){
      const lineRes=await fetch("https://api.line.me/v2/bot/message/push",{method:"POST",headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({to:groupId,messages:[{type:"text",text}]})});
      const lineOk=lineRes.ok;
      await db.from("system_settings").upsert({key:"error_threshold_last_notified",value:new Date().toISOString()},{onConflict:"key"});
      const responseText=await lineRes.text();
      if(!lineOk)console.error("LINE threshold notification failed",lineRes.status,responseText);
      return reply({ok:lineOk,msg:lineOk?"sent":"line failed",total,threshold},lineOk?200:502);
    }
    return reply({ok:true,msg:"dryRun",total,threshold,text});
  }catch(e){
    const msg=e instanceof Error?e.message:typeof e==="object"&&e?JSON.stringify(e):String(e);
    console.error("Error threshold check failed",msg);
    return reply({ok:false,msg:"Error threshold service unavailable"},500);
  }
});
