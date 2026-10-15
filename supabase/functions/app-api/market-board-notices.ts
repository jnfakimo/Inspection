import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';

// 市場看板跑馬燈只顯示「明確標記給看板」的公告（event='board_notice'、不指定收件人）。
// 登入版與公開版一致：通知中心內的資安告警、監控異常、派車提醒與個人通知都屬內部資訊，
// 依最小揭露與知悉必要原則（ISO/IEC 27001 A.5.15 存取控制、A.8.3 資訊存取限制）不得投到看板。
// 第二個參數保留是為了相容既有呼叫端；兩種檢視的篩選條件相同。
export function readMarketBoardNotices(db: Pick<SupabaseClient, 'from'>, _publicView: boolean) {
  return db.from('notifications').select('title,body,created_at')
    .eq('event', 'board_notice').is('recipient_id', null)
    .order('created_at', { ascending: false }).limit(60);
}
