# 資安政策

## 支援版本

本系統僅支援 `main` 分支目前正式部署的 V2 版本。舊版頁面只維持相容性，
不應作為新功能或新部署的基礎。

## 弱點通報

請私下通知本系統管理員或專案擁有者。請勿在公開 Issue、討論區或截圖中張貼
密碼、權杖、Cookie、個人資料、內網位址或完整弱點利用方式。

通報內容至少應包含受影響網址／功能、重現條件、預期與實際結果；機密值請以
遮蔽方式提供。收到通報後應先完成影響評估與保存稽核證據，再依風險處理停用、
修補、金鑰輪替及事件通知。

## 自動化防線

- `npm run security:secrets`：檢查公開前端是否誤放伺服器端秘密。
- `npm run security:gitleaks`：掃描完整 Git 歷史；既有公開金鑰只用精確指紋放行。
- `npm run security:semgrep`：以專案規則掃描維護中的應用程式來源。
- GitHub Actions 的 CI、CodeQL 與 Hardened Pages 掃描必須全部通過後才能視為驗證完成。

Supabase anon key、Firebase Web API key 與 Web Push VAPID public key本來就會傳送到
瀏覽器，但仍須搭配 RLS、網域／API 限制及配額告警；service-role、Access Token、
CRON_SECRET、服務帳戶私鑰與其他伺服器秘密禁止出現在版控中。
