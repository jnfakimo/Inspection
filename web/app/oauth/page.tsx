import type { Metadata } from 'next';
import styles from '../legal.module.css';

export const metadata: Metadata = {
  title: '臺北農產會議室預約系統',
  description: '會議室預約、異動、提醒與個人 Google 行事曆同步服務。',
};

export default function OAuthApplicationHomePage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.brand}>TAIPEC-MKT-1 · MEETING ROOM</p>
            <h1>臺北農產會議室預約系統</h1>
            <p className={styles.intro}>
              提供會議室查詢、預約、變更、取消、報到與提醒功能；使用者亦可自行選擇連結個人 Google 帳號，將本人預約同步至個人 Google 行事曆。
            </p>
          </div>
          <a className={styles.homeLink} href="/Inspection/v2/login/">登入系統</a>
        </header>

        <article className={styles.content}>
          <section className={styles.section}>
            <h2>服務用途</h2>
            <p>
              本應用程式協助已授權的使用者管理會議室預約及其後續異動。Google 行事曆整合為選用功能，僅在使用者主動連結並同意授權後啟用。
            </p>
          </section>

          <section className={styles.section}>
            <h2>Google 行事曆整合</h2>
            <ul>
              <li>將使用者本人建立或擁有的會議室預約同步到其個人主要行事曆。</li>
              <li>預約改期、取消時，同步更新相對應的行事曆活動。</li>
              <li>不讀取或分析與本系統預約無關的私人活動。</li>
              <li>使用者可隨時在個人資料設定中解除 Google 帳號連結。</li>
            </ul>
          </section>

          <section className={styles.section}>
            <h2>資料與安全</h2>
            <p>
              本系統採用 OAuth 2.0 官方授權流程、最小權限原則、伺服器端權杖加密及資料庫存取控制。Google 授權資訊不會直接暴露於前端瀏覽器。
            </p>
            <div className={styles.notice}>
              使用 Google 行事曆同步前，請先閱讀本系統的隱私權政策與服務條款。
            </div>
          </section>

          <section className={styles.section}>
            <h2>聯絡方式</h2>
            <p>
              使用或資料處理相關問題，請聯絡：<a href="mailto:jnfakimo@gmail.com">jnfakimo@gmail.com</a>
            </p>
          </section>
        </article>

        <footer className={styles.footer}>
          <span>臺北農產會議室預約系統</span>
          <span>
            <a href="/Inspection/v2/privacy/">隱私權政策</a>
            {' · '}
            <a href="/Inspection/v2/terms/">服務條款</a>
          </span>
        </footer>
      </div>
    </main>
  );
}
