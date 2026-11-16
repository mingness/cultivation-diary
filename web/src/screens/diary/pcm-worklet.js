/**
 * Runs on the browser's audio thread while a voice note is recorded (D35): passes the microphone's samples
 * (mono, as floats) to the page in batches, where they're encoded to MP3. 'flush' sends what's left, then
 * 'done'. Plain JavaScript because the browser loads it as is (mp3Recorder.ts).
 */
/* global AudioWorkletProcessor, registerProcessor */
const BATCH = 4096;

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(BATCH);
    this.filled = 0;
    this.port.onmessage = (event) => {
      if (event.data !== 'flush') return;
      this.send();
      this.port.postMessage('done');
    };
  }

  send() {
    if (this.filled === 0) return;
    this.port.postMessage(this.buffer.slice(0, this.filled));
    this.filled = 0;
  }

  process(inputs) {
    const samples = inputs[0]?.[0];
    if (samples) {
      let at = 0;
      while (at < samples.length) {
        const take = Math.min(samples.length - at, BATCH - this.filled);
        this.buffer.set(samples.subarray(at, at + take), this.filled);
        this.filled += take;
        at += take;
        if (this.filled === BATCH) this.send();
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
