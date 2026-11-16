/**
 * Leaders' voice notes on their own entries (D35, FRONTEND.md §4.3–4.4). A kept note is uploaded at once but
 * stays pending (待更新) until 提交/更新; removing a submitted note is pending the same way. The cached entry is
 * updated straight away and then refetched, since the entry's state (有未提交的修改) depends on what's pending.
 */
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type { EntryView, OwnAudioNote } from '@diary/shared';
import { api, apiBlob } from './client.js';
import { diaryKeys } from './diary.js';

type OwnNote = z.infer<typeof OwnAudioNote>;

function updateNotes(
  queryClient: QueryClient,
  documentId: string,
  change: (notes: OwnNote[]) => OwnNote[],
): void {
  queryClient.setQueryData<EntryView>(diaryKeys.entry(documentId), (old) =>
    old?.view === 'owner' ? { ...old, audio: change(old.audio) } : old,
  );
  void queryClient.invalidateQueries({ queryKey: diaryKeys.entry(documentId) });
  void queryClient.invalidateQueries({ queryKey: ['documents', 'mine'] });
}

/** Uploads a kept recording to an entry that already exists on the server. */
export function useAddAudio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId, file, durationMs }: AddAudio) =>
      api<OwnNote>(
        'POST',
        `/api/documents/${documentId}/audio?durationMs=${Math.round(durationMs)}`,
        file,
      ),
    onSuccess: (note, { documentId }) => updateNotes(queryClient, documentId, (n) => [...n, note]),
  });
}

export interface AddAudio {
  documentId: string;
  file: Blob;
  durationMs: number;
}

/** Removes a note: at once if it was never submitted, otherwise at the next 更新. */
export function useRemoveAudio(documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (audioId: string) =>
      api<{ ok: true }>('DELETE', `/api/documents/${documentId}/audio/${audioId}`),
    onSuccess: (_ok, audioId) =>
      updateNotes(queryClient, documentId, (notes) =>
        notes.flatMap((n) => {
          if (n.id !== audioId) return [n];
          return n.pending === 'add' ? [] : [{ ...n, pending: 'remove' as const }];
        }),
      ),
  });
}

/** The recording itself, fetched only when someone presses play (it isn't cached anywhere else). */
export function fetchAudio(documentId: string, audioId: string): Promise<Blob> {
  return apiBlob(`/api/documents/${documentId}/audio/${audioId}`);
}
