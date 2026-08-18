import type { Metadata } from 'next';
import styles from '../legal.module.css';

export const metadata: Metadata = {
  title: '服務條款｜臺北農產會議室預約系統',
  description: '臺北農產會議室預約系統使用規範與 Google 個人行事曆同步條款。',
};

export default function TermsPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.brand}>TAIPEC-MKT-1 · MEETING ROOM</p>
            <h1>服務條款</h1>
            <p className={styles.intro}>
              使用「臺北農產會議室預約系統」即表示您同意依本條款及所屬單位的資訊安全、帳號與會議室管理規範使用本服務。
            </p>
          </div>
          <a className={styles.homeLink} href="/Inspection/v2/systems/meetingroom/">返回系統首頁</a>
        </header>

        <p className={styles.meta}>生效日期：2026-08-18　｜　最後更新：2026-08-18</p>

        <article className={styles.content}>
          <section className={styles.section}>
            <h2>一、服務內容</h2>
            <p>
              本系統提供會議室資訊查詢、預約、變更、取消、報到、提醒與管理功能，並得由使用者自行選擇將本人預約同步至其 Google 個人行事曆。
            </p>
          </section>

          <section className={styles.section}>
            <h2>二、帳號與使用責任</h2>
            <ul>
              <li>使用者應使用本人獲授權的帳號登入，不得共用、冒用或轉讓帳號。</li>
              <li>使用者應確保預約及聯絡資料正確，並依實際需要合理使用會議室資源。</li>
              <li>如發現帳號遭未授權使用或資料異常，應立即通知系統管理人員。</li>
              <li>使用者不得規避權限、干擾系統、探測弱點、植入惡意程式或從事違法行為。</li>
            </ul>
          </section>

          <section className={styles.section}>
            <h2>三、Google 個人行事曆連結</h2>
            <p>
              Google 行事曆同步為選用功能。使用者按下連結並於 Google 授權畫面同意後，本系統才會取得必要權限，並僅針對與本人會議室預約相對應的活動進行建立、更新或刪除。
            </p>
            <p>
              使用者可隨時於個人資料設定解除連結，或至 Google 帳戶撤銷應用程式存取權。解除後，新預約不再同步；已存在的行事曆活動是否保留，依解除時的系統提示與使用者操作為準。
            </p>
          </section>

          <section className={styles.section}>
            <h2>四、可用性與預約效力</h2>
            <p>
              Google 行事曆內容僅為個人提醒與同步副本；會議室是否預約成功、異動狀態及使用權，以本系統資料為準。網路、第三方服務、裝置或維護可能造成延遲或暫時中斷，本系統將在合理範圍內維護服務可用性。
            </p>
          </section>

          <section className={styles.section}>
            <h2>五、智慧財產與資料使用</h2>
            <p>
              系統介面、程式、文件及相關內容受適用法律保護。使用者僅得於獲授權的業務目的範圍內使用；個人資料與 Google 使用者資料的處理方式另依本系統隱私權政策辦理。
            </p>
          </section>

          <section className={styles.section}>
            <h2>六、服務調整與使用限制</h2>
            <p>
              為維護安全、法令遵循或系統穩定，本系統得調整功能、暫停異常帳號或限制不當操作。重大服務或條款變更將以適當方式公告。
            </p>
          </section>

          <section className={styles.section}>
            <h2>七、聯絡方式</h2>
            <p>
              對本條款或服務有疑問，請聯絡：<a href="mailto:jnfakimo@gmail.com">jnfakimo@gmail.com</a>
            </p>
          </section>
        </article>

        <footer className={styles.footer}>
          <span>臺北農產會議室預約系統</span>
          <a href="/Inspection/v2/privacy/">隱私權政策</a>
        </footer>
      </div>
    </main>
  );
}
