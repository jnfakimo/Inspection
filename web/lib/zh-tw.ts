const valueLabels: Record<string, string> = {
  active: '啟用', inactive: '停用', enabled: '啟用', disabled: '停用', retired: '已汰除',
  pending: '待處理', pending_review: '待審核', in_progress: '處理中', assigned: '已指派',
  pending_supervisor: '待主管審核', pending_manager: '待管理員審核', pending_dispatch: '待派工',
  pending_completion: '待完工', pending_acceptance: '待驗收', approved_pending_dispatch: '已核准待派工',
  completed: '已完成', closed: '已結案', cancelled: '已取消', canceled: '已取消',
  approved: '已核准', rejected: '已駁回', resolved: '已處理', processing: '處理中', done: '已完成',
  open: '未結案', draft: '草稿', booked: '已預約', confirmed: '已確認', cancel_pending: '待取消',
  normal: '正常', abnormal: '異常', urgent: '緊急', critical: '重大', high: '高', medium: '中', low: '低',
  major: '重大', minor: '一般', warning: '警告', info: '資訊', online: '連線中', offline: '離線',
  success: '成功', failed: '失敗', sent: '已發送', unsent: '未發送', skipped: '已略過', scheduled: '已排程', overdue: '已逾期',
  read: '已讀', unread: '未讀', published: '已發布', requested: '申請中', checked_in: '已報到',
  no_show: '未報到', released: '已釋出', available: '可使用', unavailable: '不可使用',
  red: '紅燈', green: '綠燈', patrol: '巡邏', manual: '手動', automatic: '自動',
  qr: 'QR Code', nfc: 'NFC 感應', v2_dashboard: '系統操作', marker: '巡檢點', space: '巡檢區域',
  admin: '管理員', supervisor: '主管', maintenance: '維修人員', inspector: '巡檢人員',
  sysadmin: '系統管理員', unit_supervisor: '單位主管', technician: '維修人員', reporter: '一般人員',
  employee: '一般人員', manager: '管理員', driver: '駕駛', guard: '駐衛警',
  day: '日班', night: '夜班', morning: '早班', afternoon: '午班', evening: '晚班',
  preventive: '預防保養', corrective: '故障維修', create: '建立', update: '更新', approve: '核准',
  dispatch: '派工', complete: '完成', cancel: '取消', reminder: '提醒', deadline: '期限提醒',
  true: '是', false: '否',
};

const phraseLabels: Record<string, string> = {
  'RBAC 角色': '權限角色', '工單 ID': '工單編號', '報修 ID': '報修編號', '申請 ID': '申請編號',
  'X': '橫向座標', 'Y': '縱向座標',
};

export function zhValue(value: unknown): string {
  const raw = String(value ?? '').trim();
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_');
  return valueLabels[normalized] || phraseLabels[raw] || raw;
}

export function zhSystemCode(code: string): string {
  const number = code.match(/\d+/)?.[0];
  return number ? `第 ${Number(number)} 系統` : '系統';
}

export function zhModuleCode(index: number): string {
  return `子系統 ${String(index + 1).padStart(2, '0')}`;
}
