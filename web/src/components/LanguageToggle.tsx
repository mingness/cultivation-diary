/**
 * The language switch, top right on every screen (spec §10.1). Every offered language shows, with the one in
 * use highlighted, so it's clear which is active even when the content itself is all Chinese (changed
 * 2026-10-15; it used to show only the other language's name). With three languages the Latin ones shorten
 * to EN and VI so the switch still fits at 360 px and the largest text size; the full name is the tooltip.
 */
import { previewLang, useI18n, type Lang } from '../i18n/index.js';
import { switchOptions } from '../i18n/messages.js';
import styles from './LanguageToggle.module.css';

const NAMES: Record<Lang, string> = { 'zh-Hant': '中文', en: 'English', vi: 'Tiếng Việt' };
const SHORT: Record<Lang, string> = { 'zh-Hant': '中文', en: 'EN', vi: 'VI' };

export function LanguageToggle() {
  const { lang, setLang, t } = useI18n();
  const options = switchOptions(lang, previewLang());
  const short = options.length > 2;
  return (
    <div className={styles.toggle} role="group" aria-label={t('lang.label')}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          lang={option}
          className={styles.option}
          title={short ? NAMES[option] : undefined}
          aria-pressed={option === lang}
          onClick={() => setLang(option)}
        >
          {short ? SHORT[option] : NAMES[option]}
        </button>
      ))}
    </div>
  );
}
