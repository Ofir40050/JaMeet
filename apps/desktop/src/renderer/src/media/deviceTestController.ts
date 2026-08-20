let microphonePlayback: HTMLAudioElement | undefined;

export interface DeviceTestControllerOptions {
  getPrimaryTrack: () => MediaStreamTrack | undefined;
  getAudioOutputId: () => string | undefined;
  getOutputVolume: () => number | undefined;
  onSetMessage: (id: string, text: string, isError?: boolean) => void;
}

export function getMicrophonePlayback(): HTMLAudioElement | undefined {
  return microphonePlayback;
}

export async function testSpeakers(pan: 'both' | 'left' | 'right' = 'both', options: Pick<DeviceTestControllerOptions, 'getAudioOutputId' | 'getOutputVolume'>): Promise<void> {
  const context = new AudioContext();
  if (context.state === 'suspended') await context.resume();
  const destination = context.createMediaStreamDestination();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const volume = options.getOutputVolume() ?? 1;
  oscillator.frequency.value = pan === 'left' ? 380 : pan === 'right' ? 520 : 440;
  gain.gain.value = 0.12 * volume;

  const merger = context.createChannelMerger(2);
  if (pan === 'left') {
    gain.connect(merger, 0, 0); // Left
  } else if (pan === 'right') {
    gain.connect(merger, 0, 1); // Right
  } else {
    gain.connect(merger, 0, 0);
    gain.connect(merger, 0, 1);
  }
  oscillator.connect(gain);
  merger.connect(destination);

  const element = new Audio();
  element.srcObject = destination.stream;
  if (element.setSinkId) await element.setSinkId(options.getAudioOutputId() ?? '');
  await element.play();
  oscillator.start();
  oscillator.stop(context.currentTime + 0.7);
  await new Promise((resolve) => window.setTimeout(resolve, 850));
  element.pause();
  await context.close();
}

export async function testMicrophone(options: DeviceTestControllerOptions): Promise<void> {
  const track = options.getPrimaryTrack();
  if (!track) throw new Error('Choose an audio input first.');
  options.onSetMessage('setup-status', 'Recording a 3-second microphone test…');
  const clone = track.clone();
  const recorder = new MediaRecorder(new MediaStream([clone]));
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  recorder.start();
  await new Promise((resolve) => window.setTimeout(resolve, 3_000));
  const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
  recorder.stop();
  await stopped;
  clone.stop();
  microphonePlayback?.pause();
  const mimeType = recorder.mimeType || 'audio/webm';
  microphonePlayback = new Audio(URL.createObjectURL(new Blob(chunks, { type: mimeType })));
  if (microphonePlayback.setSinkId) await microphonePlayback.setSinkId(options.getAudioOutputId() ?? '');
  await microphonePlayback.play();
  options.onSetMessage('setup-status', 'Playing the recorded microphone test.');
}
