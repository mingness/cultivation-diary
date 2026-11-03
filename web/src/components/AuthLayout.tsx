import type { ReactNode } from 'react';
import { useT } from '../i18n/index.js';
import { LanguageToggle } from './LanguageToggle.js';
import { SITE_TITLE } from '../site.js';
import styles from './AuthLayout.module.css';

/** The frame for screens shown before sign-in: app name, language toggle and one centred card. */
export function AuthLayout({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.brand}>{t(SITE_TITLE)}</span>
        <LanguageToggle />
      </header>
      <main className={styles.main}>
        <div className={styles.card}>{children}</div>
      </main>
    </div>
  );
}
