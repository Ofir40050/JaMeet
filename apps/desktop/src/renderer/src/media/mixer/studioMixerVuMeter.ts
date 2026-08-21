import { formatPeakDbText } from './studioMixerFaderMath';
import type { StudioMixerChannel } from './studioMixerLogic';
import type { VoiceInputConfig } from '../../core/preferences';

const timeDomainBuffer = new Float32Array(256);

export function measureTimeDomainLevel(analyser: AnalyserNode | undefined): { rmsDb: number; peakDb: number } {
  if (!analyser) return { rmsDb: -60, peakDb: -60 };
  try {
    analyser.getFloatTimeDomainData(timeDomainBuffer);
  } catch {
    return { rmsDb: -60, peakDb: -60 };
  }

  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < timeDomainBuffer.length; i++) {
    const s = timeDomainBuffer[i] ?? 0;
    const abs = Math.abs(s);
    if (abs > peak) peak = abs;
    sumSq += s * s;
  }

  const rms = Math.sqrt(sumSq / timeDomainBuffer.length);
  const rmsDb = rms > 0.001 ? Math.max(-60, 20 * Math.log10(rms)) : -60;
  const peakDb = peak > 0.001 ? Math.max(-60, 20 * Math.log10(peak)) : -60;

  return { rmsDb, peakDb };
}

export interface MixerVuMeterContext {
  isMixerOpen: () => boolean;
  getChannels: () => StudioMixerChannel[];
  getVoiceInputs: () => VoiceInputConfig[];
  getVoiceMicAnalysers: (id: number) => { left: AnalyserNode | undefined; right: AnalyserNode | undefined };
  getMusicAnalysers: () => { left: AnalyserNode | undefined; right: AnalyserNode | undefined };
  getRemoteVoiceAnalysers: () => { left: AnalyserNode | undefined; right: AnalyserNode | undefined };
  getRemoteMusicAnalysers: () => { left: AnalyserNode | undefined; right: AnalyserNode | undefined };
  getRemoteMasterAnalysers: () => { left: AnalyserNode | undefined; right: AnalyserNode | undefined };
  isRemoteMuted: () => boolean;
}

let mixerVuAnimationId: number | null = null;

export function startMixerVuAnimation(ctx: MixerVuMeterContext): void {
  if (mixerVuAnimationId) return;
  const updateVu = () => {
    if (!ctx.isMixerOpen()) {
      mixerVuAnimationId = null;
      return;
    }
    const studioMixerChannels = ctx.getChannels();
    const hasLocalSolo = studioMixerChannels.some((c) => !c.isMaster && (c.section === 'local' || c.id === 'music-stream' || c.id.startsWith('you-mic')) && c.soloed);
    const hasRemoteSolo = studioMixerChannels.some((c) => !c.isMaster && c.section === 'remote' && c.id !== 'master-out' && c.soloed);

    // 1. Dynamic Local Microphone Channels Metering
    const voiceInputs = ctx.getVoiceInputs();
    const activeMics = (voiceInputs && voiceInputs.length > 0)
      ? voiceInputs.filter((v) => v.enabled)
      : [{ id: 1, name: 'Mic 1', enabled: true, gain: 1, channelRoute: '1' }];

    const localMicChannelIds = new Set<string>(
      activeMics.map((mic) => (mic.id === 1 ? 'you-mic' : `you-mic-${mic.id}`))
    );

    activeMics.forEach((mic) => {
      const chId = mic.id === 1 ? 'you-mic' : `you-mic-${mic.id}`;
      const micCh = studioMixerChannels.find((c) => c.id === chId || (mic.id === 1 && c.id === 'you-mic'));
      if (!micCh) return;

      const stripEl = document.querySelector(`.mixer-strip[data-channel-id="${micCh.id}"]`);
      if (stripEl) {
        const vuLeft = stripEl.querySelector<HTMLElement>('.vu-fill-l');
        const vuRight = stripEl.querySelector<HTMLElement>('.vu-fill-r');
        const peakEl = stripEl.querySelector<HTMLElement>('.mixer-peak-val');
        if (vuLeft && vuRight) {
          const numMicId = Number(mic.id);
          const isAudible = !micCh.muted && (!hasLocalSolo || micCh.soloed);
          const { left: micAnalyserL, right: micAnalyserR } = ctx.getVoiceMicAnalysers(numMicId);

          if (!isAudible || !micAnalyserL || !micAnalyserR) {
            vuLeft.style.height = '0%';
            vuRight.style.height = '0%';
            if (peakEl) {
              peakEl.textContent = '';
              peakEl.classList.remove('is-clipping');
            }
          } else {
            const leftMeas = measureTimeDomainLevel(micAnalyserL);
            const rightMeas = measureTimeDomainLevel(micAnalyserR);
            const maxRmsDb = Math.max(leftMeas.rmsDb, rightMeas.rmsDb);
            const maxPeakDb = Math.max(leftMeas.peakDb, rightMeas.peakDb);

            if (maxRmsDb <= -58) {
              vuLeft.style.height = '0%';
              vuRight.style.height = '0%';
            } else {
              const pctL = Math.max(0, Math.min(100, ((leftMeas.rmsDb + 60) / 60) * 100));
              const pctR = Math.max(0, Math.min(100, ((rightMeas.rmsDb + 60) / 60) * 100));
              vuLeft.style.height = `${pctL.toFixed(1)}%`;
              vuRight.style.height = `${pctR.toFixed(1)}%`;
            }

            if (peakEl) {
              if (maxPeakDb <= -55) {
                peakEl.textContent = '';
                peakEl.classList.remove('is-clipping');
              } else {
                peakEl.textContent = formatPeakDbText(maxPeakDb);
                peakEl.classList.toggle('is-clipping', maxPeakDb >= -0.5);
              }
            }
          }
        }
      }
    });

    // 2. Musician (Remote Voice) Channel Metering (Real Time-Domain Amplitude)
    const voiceCh = studioMixerChannels.find((c) => c.id === 'remote-voice');
    if (voiceCh) {
      const isAudible = !voiceCh.muted && (!hasRemoteSolo || voiceCh.soloed);
      const stripEl = document.querySelector(`.mixer-strip[data-channel-id="${voiceCh.id}"]`);
      if (stripEl) {
        const vuLeft = stripEl.querySelector<HTMLElement>('.vu-fill-l');
        const vuRight = stripEl.querySelector<HTMLElement>('.vu-fill-r');
        const peakEl = stripEl.querySelector<HTMLElement>('.mixer-peak-val');
        if (vuLeft && vuRight) {
          const { left: remoteVoiceAnalyserL, right: remoteVoiceAnalyserR } = ctx.getRemoteVoiceAnalysers();
          if (!isAudible || !remoteVoiceAnalyserL || !remoteVoiceAnalyserR) {
            vuLeft.style.height = '0%';
            vuRight.style.height = '0%';
            if (peakEl) {
              peakEl.textContent = '';
              peakEl.classList.remove('is-clipping');
            }
          } else {
            const leftMeas = measureTimeDomainLevel(remoteVoiceAnalyserL);
            const rightMeas = measureTimeDomainLevel(remoteVoiceAnalyserR);
            const maxRmsDb = Math.max(leftMeas.rmsDb, rightMeas.rmsDb);
            const maxPeakDb = Math.max(leftMeas.peakDb, rightMeas.peakDb);

            if (maxRmsDb <= -58) {
              vuLeft.style.height = '0%';
              vuRight.style.height = '0%';
            } else {
              const pctL = Math.max(0, Math.min(100, ((leftMeas.rmsDb + 60) / 60) * 100));
              const pctR = Math.max(0, Math.min(100, ((rightMeas.rmsDb + 60) / 60) * 100));
              vuLeft.style.height = `${pctL.toFixed(1)}%`;
              vuRight.style.height = `${pctR.toFixed(1)}%`;
            }

            if (peakEl) {
              if (maxPeakDb <= -55) {
                peakEl.textContent = '';
                peakEl.classList.remove('is-clipping');
              } else {
                peakEl.textContent = formatPeakDbText(maxPeakDb);
                peakEl.classList.toggle('is-clipping', maxPeakDb >= -0.5);
              }
            }
          }
        }
      }
    }

    // 3. Local Music Channel Metering (from local music level only)
    const localMusicCh = studioMixerChannels.find((c) => c.id === 'music-stream');
    if (localMusicCh) {
      const isAudible = !localMusicCh.muted && (!hasLocalSolo || localMusicCh.soloed);
      const stripEl = document.querySelector(`.mixer-strip[data-channel-id="${localMusicCh.id}"]`);
      if (stripEl) {
        const vuLeft = stripEl.querySelector<HTMLElement>('.vu-fill-l');
        const vuRight = stripEl.querySelector<HTMLElement>('.vu-fill-r');
        const peakEl = stripEl.querySelector<HTMLElement>('.mixer-peak-val');
        if (vuLeft && vuRight) {
          const { left: musicAnalyserL, right: musicAnalyserR } = ctx.getMusicAnalysers();

          if (!isAudible || !musicAnalyserL || !musicAnalyserR) {
            vuLeft.style.height = '0%';
            vuRight.style.height = '0%';
            if (peakEl) {
              peakEl.textContent = '';
              peakEl.classList.remove('is-clipping');
            }
          } else {
            const leftMeas = measureTimeDomainLevel(musicAnalyserL);
            const rightMeas = measureTimeDomainLevel(musicAnalyserR);
            const maxRmsDb = Math.max(leftMeas.rmsDb, rightMeas.rmsDb);
            const maxPeakDb = Math.max(leftMeas.peakDb, rightMeas.peakDb);

            if (maxRmsDb <= -58) {
              vuLeft.style.height = '0%';
              vuRight.style.height = '0%';
            } else {
              const pctL = Math.max(0, Math.min(100, ((leftMeas.rmsDb + 60) / 60) * 100));
              const pctR = Math.max(0, Math.min(100, ((rightMeas.rmsDb + 60) / 60) * 100));
              vuLeft.style.height = `${pctL.toFixed(1)}%`;
              vuRight.style.height = `${pctR.toFixed(1)}%`;
            }

            if (peakEl) {
              if (maxPeakDb <= -55) {
                peakEl.textContent = '';
                peakEl.classList.remove('is-clipping');
              } else {
                peakEl.textContent = formatPeakDbText(maxPeakDb);
                peakEl.classList.toggle('is-clipping', maxPeakDb >= -0.5);
              }
            }
          }
        }
      }
    }

    // 4. Remote Music Channel Metering (Real Time-Domain Amplitude)
    const remoteMusicCh = studioMixerChannels.find((c) => c.id === 'remote-music');
    if (remoteMusicCh) {
      const isAudible = !remoteMusicCh.muted && (!hasRemoteSolo || remoteMusicCh.soloed);
      const stripEl = document.querySelector(`.mixer-strip[data-channel-id="${remoteMusicCh.id}"]`);
      if (stripEl) {
        const vuLeft = stripEl.querySelector<HTMLElement>('.vu-fill-l');
        const vuRight = stripEl.querySelector<HTMLElement>('.vu-fill-r');
        const peakEl = stripEl.querySelector<HTMLElement>('.mixer-peak-val');
        if (vuLeft && vuRight) {
          const { left: remoteMusicAnalyserL, right: remoteMusicAnalyserR } = ctx.getRemoteMusicAnalysers();
          if (!isAudible || !remoteMusicAnalyserL || !remoteMusicAnalyserR) {
            vuLeft.style.height = '0%';
            vuRight.style.height = '0%';
            if (peakEl) {
              peakEl.textContent = '';
              peakEl.classList.remove('is-clipping');
            }
          } else {
            const leftMeas = measureTimeDomainLevel(remoteMusicAnalyserL);
            const rightMeas = measureTimeDomainLevel(remoteMusicAnalyserR);
            const maxRmsDb = Math.max(leftMeas.rmsDb, rightMeas.rmsDb);
            const maxPeakDb = Math.max(leftMeas.peakDb, rightMeas.peakDb);

            if (maxRmsDb <= -58) {
              vuLeft.style.height = '0%';
              vuRight.style.height = '0%';
            } else {
              const pctL = Math.max(0, Math.min(100, ((leftMeas.rmsDb + 60) / 60) * 100));
              const pctR = Math.max(0, Math.min(100, ((rightMeas.rmsDb + 60) / 60) * 100));
              vuLeft.style.height = `${pctL.toFixed(1)}%`;
              vuRight.style.height = `${pctR.toFixed(1)}%`;
            }

            if (peakEl) {
              if (maxPeakDb <= -55) {
                peakEl.textContent = '';
                peakEl.classList.remove('is-clipping');
              } else {
                peakEl.textContent = formatPeakDbText(maxPeakDb);
                peakEl.classList.toggle('is-clipping', maxPeakDb >= -0.5);
              }
            }
          }
        }
      }
    }

    // 5. Master Output Metering (Real Time-Domain Amplitude from Post-Limiter Analyser Taps)
    const masterCh = studioMixerChannels.find((c) => c.id === 'master-out');
    if (masterCh) {
      const isAudible = !masterCh.muted && !ctx.isRemoteMuted();
      const stripEl = document.querySelector(`.mixer-strip[data-channel-id="${masterCh.id}"]`);
      if (stripEl) {
        const vuLeft = stripEl.querySelector<HTMLElement>('.vu-fill-l');
        const vuRight = stripEl.querySelector<HTMLElement>('.vu-fill-r');
        const peakEl = stripEl.querySelector<HTMLElement>('.mixer-peak-val');
        if (vuLeft && vuRight) {
          const { left: remoteMasterAnalyserL, right: remoteMasterAnalyserR } = ctx.getRemoteMasterAnalysers();
          if (!isAudible || !remoteMasterAnalyserL || !remoteMasterAnalyserR) {
            vuLeft.style.height = '0%';
            vuRight.style.height = '0%';
            if (peakEl) {
              peakEl.textContent = '';
              peakEl.classList.remove('is-clipping');
            }
          } else {
            const leftMeas = measureTimeDomainLevel(remoteMasterAnalyserL);
            const rightMeas = measureTimeDomainLevel(remoteMasterAnalyserR);
            const maxRmsDb = Math.max(leftMeas.rmsDb, rightMeas.rmsDb);
            const maxPeakDb = Math.max(leftMeas.peakDb, rightMeas.peakDb);

            if (maxRmsDb <= -58) {
              vuLeft.style.height = '0%';
              vuRight.style.height = '0%';
            } else {
              const pctL = Math.max(0, Math.min(100, ((leftMeas.rmsDb + 60) / 60) * 100));
              const pctR = Math.max(0, Math.min(100, ((rightMeas.rmsDb + 60) / 60) * 100));
              vuLeft.style.height = `${pctL.toFixed(1)}%`;
              vuRight.style.height = `${pctR.toFixed(1)}%`;
            }

            if (peakEl) {
              if (maxPeakDb <= -55) {
                peakEl.textContent = '';
                peakEl.classList.remove('is-clipping');
              } else {
                peakEl.textContent = formatPeakDbText(maxPeakDb);
                peakEl.classList.toggle('is-clipping', maxPeakDb >= -0.5);
              }
            }
          }
        }
      }
    }

    // 6. Aux & Other Channels
    studioMixerChannels
      .filter((c) => !localMicChannelIds.has(c.id) && !c.id.startsWith('you-mic') && c.id !== 'remote-voice' && c.id !== 'remote-music' && c.id !== 'music-stream' && c.id !== 'master-out')
      .forEach((ch) => {
        const stripEl = document.querySelector(`.mixer-strip[data-channel-id="${ch.id}"]`);
        if (stripEl) {
          const vuLeft = stripEl.querySelector<HTMLElement>('.vu-fill-l');
          const vuRight = stripEl.querySelector<HTMLElement>('.vu-fill-r');
          const peakEl = stripEl.querySelector<HTMLElement>('.mixer-peak-val');
          if (vuLeft && vuRight) {
            vuLeft.style.height = '0%';
            vuRight.style.height = '0%';
            if (peakEl) {
              peakEl.textContent = '';
              peakEl.classList.remove('is-clipping');
            }
          }
        }
      });

    mixerVuAnimationId = requestAnimationFrame(updateVu);
  };
  mixerVuAnimationId = requestAnimationFrame(updateVu);
}

export function stopMixerVuAnimation(): void {
  if (mixerVuAnimationId) {
    cancelAnimationFrame(mixerVuAnimationId);
    mixerVuAnimationId = null;
  }
}
