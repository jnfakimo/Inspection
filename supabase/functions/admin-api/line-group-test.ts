import type { LineTextMessageResult } from "../_shared/line-message.ts";

export const LINE_GROUP_TEST_ACTION = "admin_test_line_notification";
export const LINE_GROUP_TEST_MESSAGE =
  "【LINE 群組測試通知】此訊息由系統管理員手動發送，僅測試已設定群組的推播連線，不代表司機個人通知或正式派車事件。";

export type LineGroupSettings = {
  token: string | null;
  groupId: string | null;
};

export type LineGroupTestResult = {
  status: number;
  body: { ok: boolean; message: string };
  audit?: {
    destination: "configured_group";
    result: "sent" | "failed";
    http_status: number | null;
  };
};

type Dependencies = {
  readSettings: () => Promise<LineGroupSettings>;
  sendMessage: (
    token: string,
    groupId: string,
    text: string,
  ) => Promise<LineTextMessageResult>;
};

function failure(status: number, message: string): LineGroupTestResult {
  return { status, body: { ok: false, message } };
}

export async function executeLineGroupTestAction(
  body: Record<string, unknown>,
  dependencies: Dependencies,
): Promise<LineGroupTestResult> {
  if (body.action !== LINE_GROUP_TEST_ACTION) {
    return failure(400, "不支援的後台管理動作");
  }
  if (Object.keys(body).some((key) => key !== "action")) {
    return failure(400, "LINE 群組測試不接受額外參數");
  }

  let settings: LineGroupSettings;
  try {
    settings = await dependencies.readSettings();
  } catch {
    return failure(503, "LINE 群組測試設定暫時無法讀取");
  }

  const token = settings.token?.trim() || "";
  const groupId = settings.groupId?.trim() || "";
  if (!token || !groupId) {
    return failure(400, "LINE 群組測試設定尚未完成");
  }

  let result: LineTextMessageResult;
  try {
    result = await dependencies.sendMessage(
      token,
      groupId,
      LINE_GROUP_TEST_MESSAGE,
    );
  } catch {
    result = { ok: false, status: null };
  }

  return {
    status: result.ok ? 200 : 502,
    body: {
      ok: result.ok,
      message: result.ok
        ? "LINE 群組測試訊息已送出，請至設定的 LINE 群組確認。"
        : "LINE 群組測試發送失敗，請檢查設定或服務狀態。",
    },
    audit: {
      destination: "configured_group",
      result: result.ok ? "sent" : "failed",
      http_status: result.status,
    },
  };
}
