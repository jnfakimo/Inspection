import type { Metadata } from 'next';
import styles from '../legal.module.css';

export const metadata: Metadata = {
  title: '隱私權政策｜臺北農產會議室預約系統',
  description: '臺北農產會議室預約系統的個人資料與 Google 行事曆資料處理說明。',
};

export default function PrivacyPolicyPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.brand}>TAIPEC-MKT-1 · MEETING ROOM</p>
            <h1>隱私權政策</h1>
            <p className={styles.intro}>
              本政策說明「臺北農產會議室預約系統」如何蒐集、使用、保護及管理使用者資料，包含使用者自行選擇連結的 Google 個人行事曆資料。
            </p>
          </div>
          <a className={styles.homeLink} href="/Inspection/v2/systems/meetingroom/">返回系統首頁</a>
        </header>

        <p className={styles.meta}>生效日期：2026-08-18　｜　最後更新：2026-08-18</p>

        <article className={styles.content}>
          <section className={styles.section}>
            <h2>一、適用範圍</h2>
            <p>
              本政策適用於本系統的會議室查詢、預約、異動、提醒、報到，以及使用者主動啟用的 Google 個人行事曆同步功能。未經使用者授權，本系統不會存取其 Google 帳戶資料。
            </p>
          </section>

          <section className={styles.section}>
            <h2>二、蒐集與處理的資料</h2>
            <ul>
              <li>系統帳號資料：姓名、部門／單位、電子郵件、聯絡電話及權限角色。</li>
              <li>預約資料：會議名稱、會議室、日期、起訖時間、申請與異動紀錄、報到及通知狀態。</li>
              <li>安全與稽核資料：登入、操作、錯誤、裝置與連線相關紀錄，用於安全防護及問題排查。</li>
              <li>Google OAuth 資料：Google 帳號識別資訊、授權範圍、存取權杖與更新權杖，以及本系統建立之行事曆活動識別碼。</li>
            </ul>
          </section>

          <section className={styles.section}>
            <h2>三、Google 行事曆資料的使用</h2>
            <p>
              本系統僅在使用者主動連結 Google 帳號後，使用 <code>calendar.events.owned</code> 權限建立、更新或刪除與該使用者會議室預約相對應的 Google 行事曆活動。
            </p>
            <ul>
              <li>不讀取或分析與本系統預約無關的私人活動。</li>
              <li>不存取其他使用者的 Google 行事曆。</li>
              <li>不出售 Google 使用者資料，也不將資料用於廣告或建立行銷輪廓。</li>
              <li>除提供使用者要求的同步功能、安全防護或依法令要求外，不向第三方揭露資料。</li>
            </ul>
            <div className={styles.notice}>
              本系統對 Google API 所取得資料的使用與轉移，遵守 Google API Services User Data Policy，包含 Limited Use 規範。
            </div>
          </section>

          <section className={styles.section}>
            <h2>四、資料保存與安全措施</h2>
            <p>
              本系統採取最小權限、傳輸加密、資料庫存取控制、列級安全政策、稽核紀錄及伺服器端權杖加密等措施。Google OAuth 權杖不會回傳或儲存在使用者瀏覽器中；僅限授權的伺服器端流程使用。
            </p>
            <p>
              資料依業務、稽核及法令所需期間保存。使用者解除 Google 連結時，系統會停止後續同步並撤銷可用的 Google 授權；不再需要的連結資料將依維運及備份週期清除。
            </p>
          </section>

          <section className={styles.section}>
            <h2>五、使用者選擇與權利</h2>
            <p>使用者可在個人資料設定中查詢 Google 連結狀態、解除連結，並可於 Google 帳戶的第三方應用程式存取設定中撤銷授權。</p>
            <p>如需查詢、更正或處理個人資料，或對資料使用方式有疑問，請使用下方聯絡方式提出申請。</p>
          </section>

          <section className={styles.section}>
            <h2>六、第三方服務</h2>
            <p>
              本系統使用 Google OAuth／Google Calendar API 提供個人行事曆同步，並使用 Supabase 提供身分驗證、資料庫及伺服器端功能。各服務亦可能依其政策處理必要的技術資料。
            </p>
          </section>

          <section className={styles.section}>
            <h2>七、政策更新與聯絡方式</h2>
            <p>本政策若有重大變更，將更新本頁日期並於適當位置公告。繼續使用服務前，建議使用者定期查閱最新內容。</p>
            <p>
              開發及隱私聯絡信箱：<a href="mailto:jnfakimo@gmail.com">jnfakimo@gmail.com</a>
            </p>
          </section>
        </article>

        <footer className={styles.footer}>
          <span>臺北農產會議室預約系統</span>
          <a href="/Inspection/v2/terms/">服務條款</a>
        </footer>
      </div>
    </main>
  );
}
