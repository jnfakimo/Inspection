import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, content-type"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});

const REMINDER_LEAD_MIN=15;   // 開始前 15 分鐘內送提醒
const EXPIRE_GRACE_MIN=15;    // 開始後 15 分鐘未報到自動取消

type Booking={
  booking_id:string;room_id:string;user_id:string|null;purpose:string|null;
  booking_date:string;start_time:string;end_time:string;status:string;
  meeting_rooms?:{name:string}[]|null; users?:{name:string}[]|null;
};
const roomName=(b:Booking)=>b.meeting_rooms?.[0]?.name||"未知";
const userName=(b:Booking)=>b.users?.[0]?.name||"未知";

const iso=(date:string,time:string)=>new Date(`${date}T${time}+08:00`).toISOString();

async function sendLine(token:string,groupId:string,text:string){
  const res=await fetch("https://api.line.me/v2/bot/message/push",{
    method:"POST",
    headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
    body:JSON.stringify({to:groupId,messages:[{type:"text",text}]})
  });
  return {ok:res.ok,response:await res.text()};
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  try{
    const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body=await req.json().catch(()=>({}));

    const {data:settingsRows,error:settingsError}=await db.from("system_settings").select("key,value");
    if(settingsError)throw settingsError;
    const s:Record<string,string>={};(settingsRows||[]).forEach((r:{key:string;value:string})=>s[r.key]=r.value);
    const token=s.line_channel_token,groupId=s.line_group_id;
    const lineReady=!!(token&&groupId);

    const now=new Date();
    const results:Record<string,unknown>[]=[];

    // ── 1) 逾時未報到自動取消 ────────────────────────────────
    const {data:bookedRows,error:bookedError}=await db.from("meeting_bookings")
      .select("booking_id,room_id,user_id,purpose,booking_date,start_time,end_time,status,meeting_rooms(name),users(name)")
      .eq("status","booked");
    if(bookedError)throw bookedError;

    for(const b of (bookedRows||[]) as Booking[]){
      const startAt=new Date(iso(b.booking_date,b.start_time));
      const expireAt=new Date(startAt.getTime()+EXPIRE_GRACE_MIN*60000);
      if(now>=expireAt){
        if(body.dryRun){results.push({booking:b.booking_id,action:"would_expire"});continue;}
        const {data:existing}=await db.from("meeting_booking_notifications").select("notification_id").eq("booking_id",b.booking_id).eq("notification_type","expired").maybeSingle();
        if(existing){results.push({booking:b.booking_id,msg:"expired already processed"});continue;}
        await db.from("meeting_booking_notifications").upsert({booking_id:b.booking_id,notification_type:"expired",status:"pending"},{onConflict:"booking_id,notification_type"});
        await db.from("meeting_bookings").update({status:"expired"}).eq("booking_id",b.booking_id);
        await db.from("audit_logs").insert({table_name:"meeting_bookings",record_id:b.booking_id,action:"update",changes:{before:{status:"booked"},after:{status:"expired"}},operator_id:null,source:"meeting-booking-check"});
        let sendResult={status:"skipped",response:"LINE 未設定"};
        if(lineReady){
          const text=`⏰ 會議室預約逾時未報到，已自動釋出\n\n會議室：${roomName(b)}\n日期：${b.booking_date}\n時段：${b.start_time.slice(0,5)}–${b.end_time.slice(0,5)}\n預約人：${userName(b)}\n用途：${b.purpose||"—"}`;
          const r=await sendLine(token,groupId,text);
          sendResult={status:r.ok?"sent":"failed",response:r.response};
        }
        await db.from("meeting_booking_notifications").update({status:sendResult.status,line_response:sendResult.response,sent_at:sendResult.status==="sent"?new Date().toISOString():null}).eq("booking_id",b.booking_id).eq("notification_type","expired");
        results.push({booking:b.booking_id,action:"expired",line:sendResult.status});
        continue;
      }

      // ── 2) 到期前提醒 ────────────────────────────────────
      const reminderAt=new Date(startAt.getTime()-REMINDER_LEAD_MIN*60000);
      if(now>=reminderAt&&now<startAt){
        if(body.dryRun){results.push({booking:b.booking_id,action:"would_remind"});continue;}
        const {data:existing}=await db.from("meeting_booking_notifications").select("notification_id").eq("booking_id",b.booking_id).eq("notification_type","reminder").maybeSingle();
        if(existing){continue;}
        await db.from("meeting_booking_notifications").upsert({booking_id:b.booking_id,notification_type:"reminder",status:"pending"},{onConflict:"booking_id,notification_type"});
        let sendResult={status:"skipped",response:"LINE 未設定"};
        if(lineReady){
          const text=`🔔 會議室預約即將開始提醒\n\n會議室：${roomName(b)}\n日期：${b.booking_date}\n時段：${b.start_time.slice(0,5)}–${b.end_time.slice(0,5)}\n預約人：${userName(b)}\n用途：${b.purpose||"—"}\n\n請準時到場報到，逾時 ${EXPIRE_GRACE_MIN} 分鐘未報到將自動釋出。`;
          const r=await sendLine(token,groupId,text);
          sendResult={status:r.ok?"sent":"failed",response:r.response};
        }
        await db.from("meeting_booking_notifications").update({status:sendResult.status,line_response:sendResult.response,sent_at:sendResult.status==="sent"?new Date().toISOString():null}).eq("booking_id",b.booking_id).eq("notification_type","reminder");
        results.push({booking:b.booking_id,action:"reminder",line:sendResult.status});
      }
    }

    return reply({ok:true,checked:(bookedRows||[]).length,results});
  }catch(e){
    const msg=e instanceof Error?e.message:typeof e==="object"&&e?JSON.stringify(e):String(e);
    return reply({ok:false,msg},500);
  }
});
