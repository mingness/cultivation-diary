/**
 * Records voice notes as MP3 in every browser (D35). Browsers' own recorders each pick a different format
 * (MP4 with AAC or Opus, WebM), not all of which every phone plays; MP3 plays everywhere. The microphone goes
 * through Web Audio (`pcm-worklet.js`) and LAME, loaded only when a recording starts, encodes it.
 *
 * iPhones let a page start audio only from a tap, so the tap that opens or restarts the recorder calls
 * `unlockAudio()`, and the recording then uses that audio context.
 */
// no-inline: Vite would otherwise inline this small file as a data: URL, which the Content-Security-Policy
// (rightly) refuses to run.
import workletUrl from './pcm-worklet.js?url&no-inline';
import { afterWarmUp, FADE_IN_MS, WARM_UP_MS } from '../../lib/recording.js';

/** Mono at 48 kbps: about 6 KB a second, so two minutes stay well under the server's cap. */
const KBPS = 48;
/** The rates an MP3 can have; a context at any other rate (some audio interfaces run at 96 kHz) can't encode. */
const MP3_RATES = new Set([8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]);

let unlocked: AudioContext | null = null;

/** Whether this browser can record here (Web Audio worklets and the microphone need https or localhost). */
export function canRecord(): boolean {
  return (
    typeof AudioContext !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

/** Call from the tap that starts a recording, before anything is awaited. */
export function unlockAudio(): void {
  if (!canRecord()) return;
  void unlocked?.close();
  unlocked = newContext();
  void unlocked.resume();
}

function newContext(): AudioContext {
  try {
    // 48 kHz is an MP3 rate; browsers resample the microphone to it.
    return new AudioContext({ sampleRate: 48_000 });
  } catch {
    return new AudioContext();
  }
}

export class MicrophoneDenied extends Error {}
export class CannotRecord extends Error {}

export interface Mp3Recording {
  /** Ends the recording: the MP3 and its length. */
  stop(): Promise<{ file: Blob; durationMs: number }>;
  /** Ends it and throws it away (the sheet closed). */
  cancel(): void;
}

/**
 * Asks for the microphone and starts recording. The microphone's first second is thrown away while the device
 * settles (`WARM_UP_MS`); `onLive` fires when the recording proper begins, which is when the countdown should
 * start. `onFull` fires once `maxMs` has been recorded; the caller then calls `stop()`.
 */
export async function startMp3Recording({
  maxMs,
  onLive,
  onFull,
}: {
  maxMs: number;
  onLive: () => void;
  onFull: () => void;
}): Promise<Mp3Recording> {
  let context = unlocked ?? newContext();
  unlocked = null;
  let stream: MediaStream | null = null;
  const release = () => {
    stream?.getTracks().forEach((track) => track.stop());
    void context.close().catch(() => undefined);
  };
  try {
    const [granted, lame] = await Promise.all([
      navigator.mediaDevices.getUserMedia({ audio: true }).catch((error: unknown) => {
        throw new MicrophoneDenied(String(error));
      }),
      import('@breezystack/lamejs'),
      context.resume(),
    ]);
    stream = granted;
    await context.audioWorklet.addModule(workletUrl);
    let source: MediaStreamAudioSourceNode;
    try {
      source = context.createMediaStreamSource(stream);
    } catch {
      // Firefox can't feed a microphone into a context at another rate: use the microphone's own rate.
      void context.close();
      context = new AudioContext();
      await context.audioWorklet.addModule(workletUrl);
      source = context.createMediaStreamSource(stream);
    }
    const rate = context.sampleRate;
    if (!MP3_RATES.has(rate)) throw new CannotRecord(`sample rate ${rate}`);

    const encoder = new lame.Mp3Encoder(1, rate, KBPS);
    const chunks: Uint8Array[] = [];
    const maxSamples = Math.round((maxMs / 1000) * rate);
    const skip = Math.round((WARM_UP_MS / 1000) * rate);
    const fade = Math.round((FADE_IN_MS / 1000) * rate);
    /** Everything the microphone sent, warm-up included. */
    let arrived = 0;
    /** What the recording holds. */
    let samples = 0;
    let full = false;
    const node = new AudioWorkletNode(context, 'pcm-capture');
    let flushed: () => void = () => undefined;
    node.port.onmessage = (event: MessageEvent<Float32Array | 'done'>) => {
      if (event.data === 'done') {
        flushed();
        return;
      }
      if (full) return;
      const kept = afterWarmUp(event.data, arrived, skip, fade);
      arrived += event.data.length;
      if (kept.length === 0) return;
      if (samples === 0) onLive();
      const input = kept.subarray(0, Math.max(0, maxSamples - samples));
      samples += input.length;
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i] ?? 0));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      const out = encoder.encodeBuffer(pcm);
      if (out.length > 0) chunks.push(out);
      if (samples >= maxSamples) {
        full = true;
        onFull();
      }
    };
    source.connect(node);
    // Some browsers only run a node that leads somewhere; it outputs silence.
    node.connect(context.destination);

    let ended = false;
    let result: Promise<{ file: Blob; durationMs: number }> | null = null;
    const finish = async () => {
      ended = true;
      // The worklet still holds up to one batch: wait for it before closing.
      await new Promise<void>((resolve) => {
        flushed = resolve;
        node.port.postMessage('flush');
      });
      source.disconnect();
      node.disconnect();
      release();
      const last = encoder.flush();
      if (last.length > 0) chunks.push(last);
      return {
        file: new Blob(chunks as BlobPart[], { type: 'audio/mpeg' }),
        durationMs: (samples / rate) * 1000,
      };
    };
    return {
      stop() {
        result ??= finish();
        return result;
      },
      cancel() {
        if (ended) return;
        ended = true;
        source.disconnect();
        node.disconnect();
        release();
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}
