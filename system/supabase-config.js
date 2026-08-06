// 共用 Supabase 連線設定 — 全站唯一來源，取代 30 個頁面各自硬編的 SUPA_URL/
// SUPA_KEY 與 createClient() 呼叫。anon key 設計上本來就是公開值（此純前端
// 多頁架構無建置流程，真正的存取控制在 Supabase RLS，不在於這把 key 是否可見）；
// 集中一份的目的單純是「金鑰輪替/端點變更時只需改一個檔案」的維護性，不是資安層。
//
// 用法：頁面在建立 client 前載入本檔（<script src="supabase-config.js">，需排在
// @supabase/supabase-js 之後），改用 window.createDb() 取代原本的
// supabase.createClient(SUPA_URL, SUPA_KEY)。登入憑證只放 sessionStorage，
// 關閉分頁後即清除，避免共用電腦殘留長效 refresh token。
window.SUPA_URL = 'https://qztffronusdhgxhjjubt.supabase.co';
window.SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6dGZmcm9udXNkaGd4aGpqdWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2OTI1MzgsImV4cCI6MjA5NzI2ODUzOH0.FnUxot5YXI3yKCUCmJA5P4ysEJhmtaQQA6rM7MRy3oA';
window.createDb = function (options) {
  var config=Object.assign({},options||{});
  config.auth=Object.assign({persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.sessionStorage},config.auth||{});
  return supabase.createClient(window.SUPA_URL, window.SUPA_KEY, config);
};
window.safeDbError = function (error) {
  var code=String(error&&error.code||'');
  var message=String(error&&error.message||error||'');
  if(code==='23505')return '資料已存在，請勿重複送出';
  if(code==='23503')return '資料仍被其他紀錄使用，無法完成操作';
  if(code==='23502'||code==='22P02')return '資料格式不正確或缺少必填欄位';
  if(code==='42501'||/row-level security|permission denied/i.test(message))return '您沒有執行此操作的權限';
  if(/failed to fetch|networkerror|load failed/i.test(message))return '網路連線失敗，請確認連線後重試';
  if(code==='42P01'||code==='42703'||/schema cache|does not exist/i.test(message))return '系統資料結構尚未完成更新，請聯絡管理員';
  return '操作失敗，請稍後重試；若持續發生請聯絡管理員';
};
