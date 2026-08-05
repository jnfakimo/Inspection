// 共用 Supabase 連線設定 — 全站唯一來源，取代 30 個頁面各自硬編的 SUPA_URL/
// SUPA_KEY 與 createClient() 呼叫。anon key 設計上本來就是公開值（此純前端
// 多頁架構無建置流程，真正的存取控制在 Supabase RLS，不在於這把 key 是否可見）；
// 集中一份的目的單純是「金鑰輪替/端點變更時只需改一個檔案」的維護性，不是資安層。
//
// 用法：頁面在建立 client 前載入本檔（<script src="supabase-config.js">，需排在
// @supabase/supabase-js 之後），改用 window.createDb() 取代原本的
// supabase.createClient(SUPA_URL, SUPA_KEY)。
window.SUPA_URL = 'https://qztffronusdhgxhjjubt.supabase.co';
window.SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6dGZmcm9udXNkaGd4aGpqdWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2OTI1MzgsImV4cCI6MjA5NzI2ODUzOH0.FnUxot5YXI3yKCUCmJA5P4ysEJhmtaQQA6rM7MRy3oA';
window.createDb = function (options) {
  return supabase.createClient(window.SUPA_URL, window.SUPA_KEY, options);
};
