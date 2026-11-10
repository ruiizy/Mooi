// Off the UI thread: Float32 mic samples at the device's native rate become PCM16 little-endian mono
// frames of 100 ms at 16 kHz, transferred to the page without copying; short frames keep the first
// words and the page's signal check prompt. The context runs at the native rate on purpose: iOS can
// deliver silence when a context forces another rate onto the microphone, so the downsampling
// happens here (box-filter averaging, enough for speech). On 'stop'
// the tail frame is flushed before answering 'stopped', so no spoken word is lost on release.
// The engine's AudioContext is shared by every dictation, and a processor whose `process` keeps
// returning true outlives its node: every leaked one would run on each render quantum and starve
// later dictations. So 'close' ends a processor at once, and one left without input past any
// capture recovery ends itself.
const TARGET_RATE = 16000;
const FRAME_SAMPLES = TARGET_RATE / 10;
const ORPHAN_SECONDS = 10;

class DictationProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.buffer = new Int16Array(FRAME_SAMPLES);
    this.offset = 0;
    this.sum = 0;
    this.count = 0;
    this.phase = 0;
    this.stopped = false;
    this.lastInputFrame = currentFrame;
    this.port.onmessage = ({ data }) => {
      if (data === 'close') this.stopped = true;
      if (data !== 'stop' || this.stopped) return;
      this.stopped = true;
      if (this.offset) this.port.postMessage(this.buffer.slice(0, this.offset).buffer);
      this.port.postMessage('stopped');
    };
  }

  emit(value) {
    const clamped = Math.max(-1, Math.min(1, value));
    this.buffer[this.offset++] = Math.round(clamped * (clamped < 0 ? 32768 : 32767));
    if (this.offset === this.buffer.length) {
      this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
      this.buffer = new Int16Array(FRAME_SAMPLES);
      this.offset = 0;
    }
  }

  process(inputs) {
    if (this.stopped) return false;
    const samples = inputs[0]?.[0];
    if (!samples) return currentFrame - this.lastInputFrame < ORPHAN_SECONDS * sampleRate;
    this.lastInputFrame = currentFrame;
    for (const value of samples) {
      this.sum += value;
      this.count += 1;
      this.phase += 1;
      if (this.phase < this.ratio) continue;
      const average = this.sum / this.count;
      while (this.phase >= this.ratio) {
        this.emit(average);
        this.phase -= this.ratio;
      }
      this.sum = 0;
      this.count = 0;
    }
    return true;
  }
}

registerProcessor('dictation', DictationProcessor);
