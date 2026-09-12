// app-api 共用的稽核紀錄寫入。所有業務操作的異動都經由這裡寫入 audit_logs。

export type AuditClient = {
  from: (table: string) => {
    insert: (values: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
  };
};

export async function writeAudit(
  db: AuditClient, operatorId: string, table: string, recordId: string,
  auditAction: 'insert' | 'update' | 'status_change', before: unknown, after: unknown,
) {
  const { error } = await db.from('audit_logs').insert({
    table_name: table, record_id: String(recordId), action: auditAction,
    changes: { before, after }, operator_id: operatorId, source: 'app-api',
  });
  // 稽核失敗不應讓已完成的業務操作回報為失敗，僅記錄於函式日誌。
  if (error) console.warn('audit write skipped:', error.message);
}
