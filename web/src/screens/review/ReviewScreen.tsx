/**
 * 批閱 (spec §6.3–6.4, FRONTEND.md §4.7): one feed of submitted entries, each in full with the leader's comment
 * and, for a shared entry, 取消開放. Filters choose what the feed shows: 未讀 (what this leader hasn't read
 * since it was last submitted), a day on the calendar, or a student's month.
 * It opens on today's entries, so a leader sees them at once after signing in.
 *
 * Everything chosen lives in the address, so reloading and going back keep the place.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  useLeaderCalendar,
  useLeaderDocuments,
  useStudents,
  useUnreadCount,
  type LeaderListQuery,
} from '../../api/leader.js';
import { Button } from '../../components/Button.js';
import { Calendar } from '../../components/Calendar.js';
import { FilterLayout } from '../../components/FilterLayout.js';
import { Pagination } from '../../components/Pagination.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/States.js';
import { changes, UnsavedGuard } from '../../components/UnsavedGuard.js';
import { useI18n, type MessageKey } from '../../i18n/index.js';
import { beijingDate, formatDiaryDate, formatMonth, parseMonth } from '../../lib/dates.js';
import { EntryFeed } from '../diary/EntryFeed.js';
import styles from './review.module.css';

const DEFAULT_SIZE = 20;

function parseDate(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function parsePositive(value: string | null, fallback: number, max: number): number {
  const n = Math.trunc(Number(value));
  return n >= 1 && n <= max ? n : fallback;
}

type Filter =
  | { kind: 'unread'; page: number; size: number }
  | { kind: 'date'; date: string; page: number; size: number }
  | { kind: 'user'; user: string; month: string };

/** The feed's filter from the address; today's entries when nothing is chosen. */
export function filterFromParams(params: URLSearchParams, today: string): Filter {
  const page = parsePositive(params.get('page'), 1, 10_000);
  const size = parsePositive(params.get('size'), DEFAULT_SIZE, 100);
  if (params.get('unread') === 'true') return { kind: 'unread', page, size };
  const user = params.get('user');
  const month = parseMonth(params.get('month'));
  if (user && month) return { kind: 'user', user, month };
  return { kind: 'date', date: parseDate(params.get('date')) ?? today, page, size };
}

/** The leader list query behind a filter. */
function listQueryOf(filter: Filter): LeaderListQuery {
  switch (filter.kind) {
    case 'unread':
      return { unread: 'true', page: filter.page, size: filter.size };
    case 'date':
      return { date: filter.date, page: filter.page, size: filter.size };
    case 'user':
      return { user: filter.user, month: filter.month };
  }
}

function filterParams(filter: Filter): Record<string, string> {
  switch (filter.kind) {
    case 'unread':
      return { unread: 'true', page: String(filter.page), size: String(filter.size) };
    case 'date':
      return { date: filter.date, page: String(filter.page), size: String(filter.size) };
    case 'user':
      return { user: filter.user, month: filter.month };
  }
}

export function ReviewScreen() {
  const { t, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const today = beijingDate(new Date());
  const filter = filterFromParams(params, today);
  const show = (next: Filter) => setParams(filterParams(next), { replace: true });

  const [calendarMonth, setCalendarMonth] = useState(
    filter.kind === 'user'
      ? filter.month
      : filter.kind === 'date'
        ? filter.date.slice(0, 7)
        : today.slice(0, 7),
  );
  const calendar = useLeaderCalendar(calendarMonth);
  const students = useStudents(calendarMonth);
  const unreadCount = useUnreadCount().data;

  const list = useLeaderDocuments(listQueryOf(filter));
  const rows = list.data?.documents;

  const student =
    filter.kind === 'user' ? students.data?.users.find((s) => s.id === filter.user) : undefined;
  const heading =
    filter.kind === 'unread'
      ? t('review.unreadHeading')
      : filter.kind === 'user'
        ? t('review.userHeading', {
            name: student ? student.name || student.username : '',
            month: formatMonth(filter.month, lang),
          })
        : t('review.dayHeading', { date: formatDiaryDate(filter.date, lang) });
  const empty: MessageKey =
    filter.kind === 'unread'
      ? 'review.unreadEmpty'
      : filter.kind === 'user'
        ? 'review.userEmpty'
        : 'review.dayEmpty';

  const filters = (
    <>
      <div className={styles.quickFilters}>
        <Button
          small
          variant={filter.kind === 'unread' ? 'primary' : 'secondary'}
          aria-pressed={filter.kind === 'unread'}
          onClick={() => {
            // Again while showing it: refresh, since the unread list holds still while reading.
            if (filter.kind === 'unread') void list.refetch();
            else show({ kind: 'unread', page: 1, size: DEFAULT_SIZE });
          }}
        >
          {unreadCount === undefined
            ? t('review.unread')
            : t('review.unreadCount', { n: unreadCount })}
        </Button>
      </div>
      <Calendar
        month={calendarMonth}
        onMonthChange={setCalendarMonth}
        today={today}
        selected={filter.kind === 'date' ? filter.date : null}
        counts={calendar.data?.counts ?? {}}
        onSelect={(date) => show({ kind: 'date', date, page: 1, size: DEFAULT_SIZE })}
      />
      <Students
        month={calendarMonth}
        selected={filter.kind === 'user' ? filter.user : null}
        onSelect={(user) => show({ kind: 'user', user, month: calendarMonth })}
        query={students}
      />
    </>
  );

  const paged = filter.kind === 'unread' || filter.kind === 'date';
  return (
    // Changing what the feed shows unmounts its comment editors: ask first if one has unsaved changes.
    <UnsavedGuard leaves={changes('unread', 'date', 'user', 'month', 'page', 'size')}>
      <FilterLayout title={t('review.title')} summary={heading} filters={filters}>
        <h2>{heading}</h2>
        {filter.kind === 'unread' && <p className={styles.muted}>{t('review.unreadHint')}</p>}
        {list.isPending ? (
          <LoadingState />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !rows || rows.length === 0 ? (
          <EmptyState title={t(empty)} />
        ) : (
          <>
            <p className={styles.muted}>{t('review.total', { n: list.data.total })}</p>
            <EntryFeed rows={rows} context="review" />
          </>
        )}
        {paged && list.data && list.data.total > 0 && (
          <Pagination
            page={filter.page}
            size={filter.size}
            total={list.data.total}
            onPage={(page) => show({ ...filter, page })}
            onSize={(size) => show({ ...filter, page: 1, size })}
          />
        )}
      </FilterLayout>
    </UnsavedGuard>
  );
}

function Students({
  month,
  selected,
  onSelect,
  query,
}: {
  month: string;
  selected: string | null;
  onSelect: (id: string) => void;
  query: ReturnType<typeof useStudents>;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const users = query.data?.users ?? [];
    return needle
      ? users.filter(
          (u) => u.name.toLowerCase().includes(needle) || u.username.toLowerCase().includes(needle),
        )
      : users;
  }, [query.data, search]);

  return (
    <div className={styles.students}>
      <h2 id={`students-${month}`} className={styles.studentsHeading}>
        {t('review.students')}
      </h2>
      <input
        type="search"
        className={styles.search}
        aria-label={t('review.search')}
        placeholder={t('review.search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : shown.length === 0 && query.data ? (
        <p className={styles.muted}>{t('review.noStudents')}</p>
      ) : (
        <ul className={styles.studentList}>
          {shown.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={styles.student}
                aria-pressed={s.id === selected}
                onClick={() => onSelect(s.id)}
              >
                <span>{s.name || s.username}</span>
                <span className={styles.muted}>{t('review.studentEntries', { n: s.entries })}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
