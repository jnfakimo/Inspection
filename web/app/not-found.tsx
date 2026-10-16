import Link from 'next/link';
import styles from './not-found.module.css';

export default function NotFound() {
  return <main className={styles.page}>
    <section className={styles.card} aria-labelledby="not-found-title">
      <p className={styles.code}>404</p>
      <h1 id="not-found-title">找不到頁面</h1>
      <p>網址可能已變更，請返回首頁選擇需要的功能。</p>
      <Link className="primary-btn" href="/">返回首頁</Link>
    </section>
  </main>;
}
