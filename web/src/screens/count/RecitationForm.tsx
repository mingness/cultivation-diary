/**
 * Leaders and SYS_ADMINs pick what is recited from the list in the code, set the goal and choose whether counting
 * starts again (spec §7.5, D40). The form starts from what applies today, so saving it untouched changes nothing;
 * a change applies from today and earlier counts are kept.
 */
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { OFFERED_RECITATIONS, RECITATION_GOAL_MAX, type Recitation } from '@diary/shared';
import { useSetRecitation, type Summary } from '../../api/count.js';
import { ApiError } from '../../api/client.js';
import { Button } from '../../components/Button.js';
import { CheckboxRow, TextField } from '../../components/Field.js';
import fieldStyles from '../../components/Field.module.css';
import { Notice } from '../../components/Notice.js';
import { useToast } from '../../components/Toast.js';
import { useI18n } from '../../i18n/index.js';
import { parseGoal, recitationKey } from './countRules.js';
import styles from './CountScreen.module.css';

export function RecitationForm({ summary, onDone }: { summary: Summary; onDone: () => void }) {
  const { t, tError } = useI18n();
  const toast = useToast();
  const save = useSetRecitation();
  const selectId = useId();
  const [recitation, setRecitation] = useState<Recitation>(summary.recitation);
  const [goalText, setGoalText] = useState(summary.goal === null ? '' : String(summary.goal));
  // Checked when counting already started again today, so saving untouched keeps it.
  const [restart, setRestart] = useState(summary.roundStartsOn === summary.today.date);
  const goal = parseGoal(goalText);
  // Today's recitation stays selectable even if it has since been retired.
  const options = OFFERED_RECITATIONS.includes(summary.recitation)
    ? OFFERED_RECITATIONS
    : [summary.recitation, ...OFFERED_RECITATIONS];

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (goal === 'invalid') return;
    save.mutate(
      { recitation, goal, restart },
      {
        onSuccess: (result) => {
          toast.show(t(result.changed ? 'recite.saved' : 'recite.unchanged'));
          onDone();
        },
      },
    );
  }

  const error = save.error instanceof ApiError ? save.error : null;
  return (
    <section className={styles.card} aria-labelledby="recite-heading">
      <h2 id="recite-heading">{t('recite.heading')}</h2>
      <form className={styles.page} onSubmit={onSubmit} noValidate>
        <div className={fieldStyles.field}>
          <label className={fieldStyles.label} htmlFor={selectId}>
            {t('recite.name')}
          </label>
          <select
            id={selectId}
            className={fieldStyles.input}
            value={recitation}
            onChange={(e) => setRecitation(e.target.value as Recitation)}
          >
            {options.map((r) => (
              <option key={r} value={r}>
                {t(recitationKey(r))}
              </option>
            ))}
          </select>
        </div>
        <TextField
          label={t('recite.goal')}
          hint={t('recite.goalHint')}
          optional
          inputMode="numeric"
          autoComplete="off"
          value={goalText}
          error={goal === 'invalid' ? t('recite.goalInvalid', { max: RECITATION_GOAL_MAX }) : null}
          onChange={(e) => setGoalText(e.target.value)}
        />
        <CheckboxRow
          label={t('recite.restart')}
          hint={t('recite.restartHint')}
          checked={restart}
          onChange={(e) => setRestart(e.target.checked)}
        />
        {recitation !== summary.recitation && (
          <Notice kind="info" live={false}>
            {t('recite.autoNote', { old: t(recitationKey(summary.recitation)) })}
          </Notice>
        )}
        {error && (
          <Notice kind="error" requestId={error.requestId}>
            {tError(error.code)}
          </Notice>
        )}
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onDone}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={goal === 'invalid' || save.isPending}>
            {t('recite.save')}
          </Button>
        </div>
      </form>
    </section>
  );
}
