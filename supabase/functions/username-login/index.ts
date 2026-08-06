import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";

const cors={"Access-Control-Allow-Origin":"https://jnfakimo.github.io","Access-Control-Allow-Headers":"apikey, content-type, x-client-info"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  if(req.method!=="POST")return reply({ok:false,message:"Method not allowed"},405);
  try{
    const body=await req.json().catch(()=>({}));
    const username=String(body.username||"").trim();
    const password=String(body.password||"");
    if(!/^[A-Za-z0-9._-]{2,80}$/.test(username)||password.length<8||password.length>200)return reply({ok:false,message:"帳號或密碼錯誤"},401);
    const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:profile}=await admin.from("users").select("email").eq("username",username).eq("status","active").maybeSingle();
    if(!profile?.email)return reply({ok:false,message:"帳號或密碼錯誤"},401);
    const authClient=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await authClient.auth.signInWithPassword({email:profile.email,password});
    if(error||!data.session)return reply({ok:false,message:"帳號或密碼錯誤"},401);
    return reply({ok:true,access_token:data.session.access_token,refresh_token:data.session.refresh_token,expires_in:data.session.expires_in});
  }catch(error){
    console.error("Username login failed",error instanceof Error?error.message:String(error));
    return reply({ok:false,message:"登入服務暫時無法使用"},503);
  }
});
