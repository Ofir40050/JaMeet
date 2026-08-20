class JaMeetRemoteVoiceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.batchSamples = 480 * 2; // 480 stereo frames = 960 Float32 samples = 10 ms @ 48 kHz
    this.buffer = new Float32Array(this.batchSamples);
    this.bufferOffset = 0;
    this.active = true;

    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'stop') {
        this.active = false;
        this.bufferOffset = 0;
      } else if (event.data && event.data.type === 'start') {
        this.active = true;
        this.bufferOffset = 0;
      }
    };
  }

  process(inputs) {
    if (!this.active) {
      return false;
    }

    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    const left = input[0];
    const right = input.length > 1 ? input[1] : left;
    const channelLength = left ? left.length : 0;

    for (let i = 0; i < channelLength; i++) {
      const l = left ? left[i] : 0;
      const r = right ? right[i] : l;

      this.buffer[this.bufferOffset++] = l;
      this.buffer[this.bufferOffset++] = r;

      if (this.bufferOffset >= this.batchSamples) {
        const chunk = new Float32Array(this.buffer);
        this.port.postMessage(chunk, [chunk.buffer]);
        this.bufferOffset = 0;
      }
    }

    return true;
  }
}

registerProcessor('jameet-remote-voice-processor', JaMeetRemoteVoiceProcessor);
