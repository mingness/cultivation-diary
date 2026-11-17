/**
 * 報數 (spec §7, FRONTEND.md §4.5): what is recited, the shared progress (the total is the largest figure),
 * today's report with its date chips, automatic counting, and the latest 20 reports. Leaders and SYS_ADMINs can
 * change what is recited, the goal, and start counting again (spec §7.5). Input is trimmed and clamped as it is typed,
 * with every change said in words (spec §10.5); the typed number is also saved for the nightly job.
 */
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { COUNT_LIMITS, DAILY_COUNT_MAX, DAILY_COUNT_MIN, normaliseDailyCount } from '@diary/shared';
import {
  useCountSettings,
  useCountSummary,
  useLatestCounts,
  useSubmitCount,
  useUpdateCountSettings,
} from '../../api/count.js';
import { ApiError } from '../../api/client.js';
import { useMe } from '../../api/session.js';
import logo from '../../assets/count-logo.svg';
import { Button, buttonClass } from '../../components/Button.js';
import { DataTable, tableStyles } from '../../components/DataTable.js';
import { CheckboxRow } from '../../components/Field.js';
import { Notice } from '../../components/Notice.js';
import { ErrorState, LoadingState } from '../../components/States.js';
import { useToast } from '../../components/Toast.js';
import { useI18n, type Lang } from '../../i18n/index.js';
import { LOCALES } from '../../i18n/messages.js';
import { formatDateTime, formatDayChip, formatDiaryDate } from '../../lib/dates.js';
import { useMediaQuery } from '../../lib/media.js';
import { dateState, noticeKeys, recitationKey } from './countRules.js';
import { RecitationForm } from './RecitationForm.js';
import styles from './CountScreen.module.css';

const number = (n: number, lang: Lang) => n.toLocaleString(LOCALES[lang]);

export function CountScreen() {
  const { t, lang } = useI18n();
  const me = useMe();
  const summary = useCountSummary();
  const [changing, setChanging] = useState(false);
  const canChange = me.role === 'COURSE_LEADER' || me.role === 'SYS_ADMIN';
  const data = summary.data;
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        {/* Decorative and wordless, so it suits every language; the heading below names the page. */}
        <img className={styles.logo} src={logo} alt="" width={400} height={80} />
        {/* What is recited, named in the reader's language. */}
        <h1>{data ? t(recitationKey(data.recitation)) : t('nav.count')}</h1>
        {data && (
          <p className={styles.subtitle}>
            {data.goal === null
              ? t('count.subtitleNoGoal')
              : t('count.subtitleGoal', { goal: number(data.goal, lang) })}
          </p>
        )}
        {data && canChange && !changing && (
          <Button variant="secondary" onClick={() => setChanging(true)}>
            {t('count.change')}
          </Button>
        )}
      </header>
      {data && changing && <RecitationForm summary={data} onDone={() => setChanging(false)} />}
      {summary.isPending ? (
        <LoadingState />
      ) : summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : (
        <>
          <Progress summary={summary.data} />
          <ReportForm summary={summary.data} />
        </>
      )}
      <Latest />
      {me.role === 'SYS_ADMIN' && (
        <Link to="/admin/count" className={`${buttonClass('secondary')} ${styles.manage}`}>
          {t('count.manage')}
        </Link>
      )}
    </div>
  );
}

function Progress({ summary }: { summary: SummaryData }) {
  const { t, lang } = useI18n();
  return (
    <section className={styles.card} aria-labelledby="progress-heading">
      <h2 id="progress-heading" className={styles.totalLabel}>
        {t('count.total')}
      </h2>
      <p className={styles.total}>{number(summary.total, lang)}</p>
      {/* Without a goal there is nothing to measure progress against (spec §7.5). */}
      {summary.goal !== null && summary.percent !== null && (
        <GoalProgress goal={summary.goal} percent={summary.percent} />
      )}
      <p className={styles.today}>
        {t('count.today', { sum: number(summary.today.sum, lang), n: summary.today.entries })}
      </p>
    </section>
  );
}

function GoalProgress({ goal, percent }: { goal: number; percent: number }) {
  const { t, lang } = useI18n();
  return (
    <>
      <div
        className={styles.bar}
        role="progressbar"
        aria-label={t('count.progress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, percent)}
        aria-valuetext={t('count.percent', { p: percent.toFixed(2) })}
      >
        {/* React sets this through the CSSOM, which the Content-Security-Policy allows. */}
        <div className={styles.barFill} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      <div className={styles.goalRow}>
        <span>
          {t('count.goal')} {number(goal, lang)}
        </span>
        <span>{t('count.percent', { p: percent.toFixed(2) })}</span>
      </div>
    </>
  );
}

type SummaryData = NonNullable<ReturnType<typeof useCountSummary>['data']>;
type SettingsData = NonNullable<ReturnType<typeof useCountSettings>['data']>;

/** "今天" for today, otherwise the day and weekday ("13日 週二"). */
function chipLabel(date: string, today: string, lang: Lang, todayLabel: string) {
  return date === today ? todayLabel : formatDayChip(date, lang);
}

/** Waits for my settings, so the form can start from the number the nightly job would use. */
function ReportForm({ summary }: { summary: SummaryData }) {
  const settings = useCountSettings();
  if (settings.isPending) return <LoadingState />;
  if (settings.isError) {
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  }
  return <ReportFormLoaded summary={summary} saved={settings.data} />;
}

function ReportFormLoaded({ summary, saved }: { summary: SummaryData; saved: SettingsData }) {
  const { t, tError, lang } = useI18n();
  const toast = useToast();
  // Two separate saves: the quiet one for the typed number must not look like the checkbox changing.
  const saveNumber = useUpdateCountSettings();
  const toggleAuto = useUpdateCountSettings();
  const submit = useSubmitCount();
  const current = useCountSettings().data ?? saved;
  const [text, setText] = useState(saved.savedCount > 0 ? String(saved.savedCount) : '');
  const [notices, setNotices] = useState<string[]>([]);
  const [countDate, setCountDate] = useState(summary.today.date);
  const value = normaliseDailyCount(text).value;
  const state = dateState(summary.mine, countDate);

  // The typed number is saved, a moment after typing stops, so the 02:00 job always uses the latest one.
  const lastSaved = useRef(saved.savedCount);
  const { mutate: saveNumberNow } = saveNumber;
  useEffect(() => {
    if (value === null || value === lastSaved.current) return;
    const timer = window.setTimeout(() => {
      lastSaved.current = value;
      saveNumberNow({ savedCount: value });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [value, saveNumberNow]);

  function onType(raw: string) {
    const normalised = normaliseDailyCount(raw);
    setText(normalised.text);
    setNotices(
      noticeKeys(normalised.notices).map((key) =>
        t(key, { max: DAILY_COUNT_MAX, min: DAILY_COUNT_MIN }),
      ),
    );
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (value === null || state.atLimit) return;
    submit.mutate(
      { count: value, countDate },
      { onSuccess: () => toast.show(t('count.submitted', { n: value })) },
    );
  }

  const error = submit.error instanceof ApiError ? submit.error : null;
  // The box follows the click at once (React state, not the request's, which starts a tick later); the
  // server's answer, or a refusal, then settles it.
  const [picked, setPicked] = useState<boolean | null>(null);
  const autoOn = picked ?? current.autoSubmit;

  return (
    <section className={styles.card} aria-labelledby="report-heading">
      <h2 id="report-heading">{t('count.mine')}</h2>
      <form className={styles.page} onSubmit={onSubmit} noValidate>
        {/* Which day first, then the number, then 提交 right below it. */}
        <fieldset className={styles.chips}>
          <legend className={styles.legend}>{t('count.date')}</legend>
          {summary.countDates.map((date) => (
            <label key={date} className={styles.chip}>
              <input
                type="radio"
                name="countDate"
                value={date}
                checked={date === countDate}
                onChange={() => setCountDate(date)}
              />
              <span>{chipLabel(date, summary.today.date, lang, t('count.todayChip'))}</span>
            </label>
          ))}
        </fieldset>
        <div className={styles.numberRow}>
          <label htmlFor="count-number" className={styles.numberLabel}>
            {t('count.number')}
          </label>
          <input
            id="count-number"
            className={styles.numberInput}
            inputMode="numeric"
            autoComplete="off"
            aria-describedby="count-notices count-note"
            value={text}
            onChange={(e) => onType(e.target.value)}
          />
        </div>
        <p id="count-notices" className={styles.notices} aria-live="polite">
          {notices.join(' ')}
        </p>
        <p id="count-note" className={styles.note} aria-live="polite">
          {state.atLimit
            ? t('count.limit', { max: COUNT_LIMITS.manualPerCountDate })
            : state.existing !== null
              ? t('count.replaces', { n: state.existing })
              : ''}
        </p>
        {error && (
          <Notice kind="error" requestId={error.requestId}>
            {tError(error.code)}
          </Notice>
        )}
        <Button
          type="submit"
          variant="primary"
          wide
          disabled={value === null || state.atLimit || submit.isPending}
        >
          {t('count.submit')}
        </Button>
      </form>
      {current.autoStopped && (
        <Notice kind="warning" live={false}>
          {t('count.autoStopped', { name: t(recitationKey(summary.recitation)) })}
        </Notice>
      )}
      <CheckboxRow
        label={t('count.auto')}
        hint={t('count.autoHint')}
        checked={autoOn}
        disabled={toggleAuto.isPending}
        onChange={(e) => {
          setPicked(e.target.checked);
          toggleAuto.mutate(
            { autoSubmit: e.target.checked },
            {
              onSuccess: (s) => toast.show(t(s.autoSubmit ? 'count.autoOn' : 'count.autoOff')),
              onError: toast.showError,
              // A refusal leaves it as it was (spec §7.2).
              onSettled: () => setPicked(null),
            },
          );
        }}
      />
    </section>
  );
}

/** The latest 20 reports (spec §7.1): a list on phones, the spec's table on desktop. */
function Latest() {
  const { t, lang } = useI18n();
  const latest = useLatestCounts();
  const desktop = useMediaQuery('(min-width: 1024px)');
  if (latest.isPending) return <LoadingState />;
  if (latest.isError)
    return <ErrorState error={latest.error} onRetry={() => void latest.refetch()} />;
  const rows = latest.data.rows;
  const name = (row: (typeof rows)[number]) => (
    <span className={row.autoSubmit ? styles.autoName : undefined}>
      {row.name}
      {row.autoSubmit && <span className={styles.note}> · {t('count.autoMark')}</span>}
    </span>
  );
  return (
    <section className={styles.page} aria-labelledby="latest-heading">
      <h2 id="latest-heading">{t('count.latest')}</h2>
      {desktop ? (
        <DataTable caption={t('count.latest')}>
          <thead>
            <tr>
              <th scope="col">{t('count.name')}</th>
              <th scope="col" className={tableStyles.num}>
                {t('count.todayCount')}
              </th>
              <th scope="col" className={tableStyles.num}>
                {t('count.totalCol')}
              </th>
              <th scope="col">{t('count.first')}</th>
              <th scope="col">{t('count.latestAt')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.userId}>
                <td>{name(row)}</td>
                <td className={tableStyles.num}>{number(row.todayCount, lang)}</td>
                <td className={tableStyles.num}>{number(row.total, lang)}</td>
                <td>{formatDiaryDate(row.firstCountDate, lang)}</td>
                <td>{formatDateTime(row.latestSubmitAt, lang)}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.userId} className={styles.listRow}>
              <span className={styles.listHead}>
                {name(row)}
                <span className={styles.count}>{number(row.todayCount, lang)}</span>
              </span>
              <span className={styles.note}>
                {t('count.row', {
                  total: number(row.total, lang),
                  first: formatDiaryDate(row.firstCountDate, lang),
                  at: formatDateTime(row.latestSubmitAt, lang),
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
