/**
 * 翻譯 / Translate (spec §8): one small button at the right that translates into the language the reader is
 * using (D34; the server works out the source language), with the result as plain text below it, never in a
 * text box; a new click replaces it. Greyed out (the reason in its tooltip) when the server has no
 * translation provider; a note beside every button would repeat down a whole feed.
 */
import { useState } from 'react';
import { ApiError } from '../../api/client.js';
import { useTranslate } from '../../api/diary.js';
import { useSession } from '../../api/session.js';
import { Button } from '../../components/Button.js';
import { Notice } from '../../components/Notice.js';
import { useI18n } from '../../i18n/index.js';
import styles from './TranslateBlock.module.css';

export function TranslateBlock({
  source,
}: {
  source: { documentId: string } | { commentId: string };
}) {
  const { t, tError, lang } = useI18n();
  const { data: session } = useSession();
  const available = session?.status === 'ready' && session.features.translation;
  const translate = useTranslate();
  const [result, setResult] = useState<string | null>(null);

  function run() {
    setResult(null);
    translate.mutate({ ...source, target: lang }, { onSuccess: ({ text }) => setResult(text) });
  }

  const error = translate.error instanceof ApiError ? translate.error : null;
  return (
    <div className={styles.block}>
      <div className={styles.buttons}>
        <Button
          small
          variant="quiet"
          title={available ? undefined : t('translate.off')}
          disabled={!available || translate.isPending}
          onClick={run}
        >
          {t('translate.button')}
        </Button>
      </div>
      <div aria-live="polite">
        {translate.isPending && <p>{t('translate.working')}</p>}
        {result !== null && (
          <p className={styles.result}>
            <span className={styles.resultLabel}>{t('translate.result')}</span>
            {result}
          </p>
        )}
      </div>
      {error && (
        <Notice kind="error" requestId={error.requestId}>
          {tError(error.code)}
        </Notice>
      )}
    </div>
  );
}
