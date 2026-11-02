import { createLineGroupRegisterCode } from "../_shared/line-group-register.ts";
import { sha256Hex } from "../_shared/vehicle-line-link.ts";

export const LINE_GROUP_REGISTER_ACTION = "admin_create_line_group_register_code";

export type LineGroupRegisterResult = {
  status: number;
  body: { ok: boolean; message: string; data?: { code: string; expires_at: string } };
  audit?: { result: "created"; expires_at: string };
};

type Dependencies = {
  userId: string;
  createIntent: (input: { userId: string; codeHash: string; now: string }) => Promise<{ outcome: string; expiresAt: string | null }>;
  now?: () => Date;
  createCode?: () => { code: string; display: string };
};

function failure(status: number, message: string): LineGroupRegisterResult {
  return { status, body: { ok: false, message } };
}

/** 產生 10 分鐘有效的群組登記碼；明碼只回給發出請求的管理員一次，資料庫與稽核只留雜湊與到期時間。 */
export async function executeLineGroupRegisterAction(
  body: Record<string, unknown>,
  dependencies: Dependencies,
): Promise<LineGroupRegisterResult> {
  if (body.action !== LINE_GROUP_REGISTER_ACTION) return failure(400, "不支援的後台管理動作");
  if (Object.keys(body).some((key) => key !== "action")) return failure(400, "產生群組登記碼不接受額外參數");

  const { code, display } = (dependencies.createCode ?? (() => createLineGroupRegisterCode()))();
  let created: { outcome: string; expiresAt: string | null };
  try {
    created = await dependencies.createIntent({
      userId: dependencies.userId,
      codeHash: await sha256Hex(code),
      now: (dependencies.now ?? (() => new Date()))().toISOString(),
    });
  } catch {
    return failure(503, "群組登記碼暫時無法產生，請稍後再試");
  }
  if (created.outcome !== "created" || !created.expiresAt) return failure(400, "群組登記碼產生失敗");

  return {
    status: 200,
    body: {
      ok: true,
      message: `請在 10 分鐘內，到要接收通知的 LINE 群組輸入「登記 ${display}」。`,
      data: { code: display, expires_at: created.expiresAt },
    },
    audit: { result: "created", expires_at: created.expiresAt },
  };
}
