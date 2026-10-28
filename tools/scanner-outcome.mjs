// A target count is not proof that the scanner completed or scanned every file.
export function scannerOutcome(name, result, targetCount) {
  if (result?.error) {
    return { code: 1, message: `無法啟動 ${name}：${result.error.message}` };
  }
  if (result?.signal || result?.status !== 0) {
    const code = Number.isInteger(result?.status) && result.status > 0 ? result.status : 1;
    return { code, message: `${name} 未通過或未完成（退出碼 ${code}${result?.signal ? `，訊號 ${result.signal}` : ''}）；請檢視工具輸出，不得視為通過。` };
  }
  return { code: 0, message: `${name} 執行成功；提交 ${targetCount} 個候選檔案，實際掃描與略過數量以工具報告為準。` };
}
