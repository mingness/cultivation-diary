/**
 * Diary data (spec §5–6): my entries, open entries, one entry, and the writes. Writes update the cached entry
 * and refresh the lists, so every screen agrees after a save without reloading by hand.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  AccessChangeRequest,
  AccessChangeResponse,
  DocumentVersions,
  EntryView,
  MyDocumentList,
  OpenDocumentList,
  OwnDocument,
  TranslateTarget,
  TranslateResponse,
} from '@diary/shared';
import { api } from './client.js';

export type MyDocumentRow = z.infer<typeof MyDocumentList>['documents'][number];
export type OpenDocumentRow = z.infer<typeof OpenDocumentList>['documents'][number];
export type OwnerEntry = Extract<EntryView, { view: 'owner' }>;
type Access = z.infer<typeof AccessChangeResponse>['access'];

/** How often the lists check for new entries and comments while they're on screen (spec §6.2). */
export const POLL_MS = 30_000;

export const diaryKeys = {
  all: ['documents'] as const,
  mine: (month: string) => ['documents', 'mine', month] as const,
  open: (month: string) => ['documents', 'open', month] as const,
  entry: (id: string) => ['documents', 'entry', id] as const,
  versions: (id: string) => ['documents', 'versions', id] as const,
};

export function useMyDocuments(month: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: diaryKeys.mine(month),
    queryFn: () => api<z.infer<typeof MyDocumentList>>('GET', `/api/documents/mine?month=${month}`),
    // Only while the list is mounted; TanStack Query also pauses it while the tab is hidden.
    refetchInterval: POLL_MS,
  });
}

export function useOpenDocuments(month: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: diaryKeys.open(month),
    queryFn: () =>
      api<z.infer<typeof OpenDocumentList>>('GET', `/api/documents/open?month=${month}`),
  });
}

export function useEntry(id: string | null) {
  return useQuery({
    queryKey: diaryKeys.entry(id ?? 'none'),
    queryFn: () => api<EntryView>('GET', `/api/documents/${id}`),
    enabled: id !== null,
  });
}

export function useVersions(id: string, enabled: boolean) {
  return useQuery({
    queryKey: diaryKeys.versions(id),
    queryFn: () => api<z.infer<typeof DocumentVersions>>('GET', `/api/documents/${id}/versions`),
    enabled,
  });
}

/**
 * Folds a write's answer into the cached owner view (comments and the rest stay as they were). A submitted
 * entry with nothing pending has had its voice-note changes applied (D35), so the cached notes follow suit.
 */
export function storeOwnDocument(queryClient: QueryClient, document: OwnDocument): void {
  queryClient.setQueryData<EntryView>(diaryKeys.entry(document.id), (old) => {
    if (old?.view !== 'owner') {
      return { ...document, view: 'owner', comments: [], myComment: null, audio: [] };
    }
    const audio =
      document.state === 'submitted'
        ? old.audio.filter((a) => a.pending !== 'remove').map((a) => ({ ...a, pending: null }))
        : old.audio;
    return { ...old, ...document, audio };
  });
  void queryClient.invalidateQueries({ queryKey: ['documents', 'mine'] });
  void queryClient.invalidateQueries({ queryKey: diaryKeys.versions(document.id) });
}

export interface EntryContent {
  title: string;
  body: string;
}

export const saveEntry = {
  create: (content: EntryContent) => api<OwnDocument>('POST', '/api/documents', content),
  draft: (id: string, content: EntryContent) =>
    api<OwnDocument>('PUT', `/api/documents/${id}/draft`, content),
  submit: (id: string, content: EntryContent) =>
    api<OwnDocument>('POST', `/api/documents/${id}/submit`, content),
};

/** Share with the author's class, or unshare (the only change a leader can make). */
export type AccessChange = z.infer<typeof AccessChangeRequest>;

export function useAccessChange(id: string) {
  const change = useAccessChangeOf();
  return {
    ...change,
    mutate: (body: AccessChange, options?: Parameters<typeof change.mutate>[1]) =>
      change.mutate({ id, change: body }, options),
  };
}

/** The same, for whichever entry each call names: one just created by its first 提交 has no ID until then. */
export function useAccessChangeOf() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, change }: { id: string; change: AccessChange }) =>
      api<{ access: Access }>('POST', `/api/documents/${id}/access`, change),
    onSuccess: ({ access }, { id }) => {
      queryClient.setQueryData<EntryView>(diaryKeys.entry(id), (old) =>
        old?.view === 'owner'
          ? // Unsharing also unpins (D36).
            { ...old, access, pinned: old.pinned && access !== 'private' }
          : old && 'access' in old
            ? { ...old, access }
            : old,
      );
      void queryClient.invalidateQueries({ queryKey: diaryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['leader'] });
    },
  });
}

/** Take a sent entry back to "only me" (D37); refused once someone else has commented. */
export function useWithdraw(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<OwnDocument>('POST', `/api/documents/${id}/withdraw`),
    onSuccess: (document) => {
      storeOwnDocument(queryClient, document);
      void queryClient.invalidateQueries({ queryKey: diaryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['leader'] });
    },
  });
}

/** Pin the leader's own shared entry to the top of 開放日記, or unpin it (D36). */
export function usePin(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pinned: boolean) =>
      api<{ pinned: boolean }>('PUT', `/api/documents/${id}/pin`, { pinned }),
    onSuccess: ({ pinned }) => {
      queryClient.setQueryData<EntryView>(diaryKeys.entry(id), (old) =>
        old?.view === 'owner' ? { ...old, pinned } : old,
      );
      void queryClient.invalidateQueries({ queryKey: ['documents', 'open'] });
    },
  });
}

export function useTranslate() {
  return useMutation({
    mutationFn: (
      body: ({ documentId: string } | { commentId: string }) & { target: TranslateTarget },
    ) => api<z.infer<typeof TranslateResponse>>('POST', '/api/translate', body),
  });
}
