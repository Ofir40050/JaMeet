#include "jameet_remote_kernel_consumer.h"
#include <string.h>

#define JAMEET_MAX_SEQLOCK_RETRIES      3
#define JAMEET_MAX_HEARTBEAT_AGE_MS     500ULL

void JaMeetKernelConsumer_Init(JaMeetKernelConsumer* consumer) {
    if (!consumer) return;
    memset(consumer, 0, sizeof(JaMeetKernelConsumer));
}

static inline float sanitize_sample(uint32_t rawBits) {
    union {
        uint32_t u;
        float f;
    } conv;
    conv.u = rawBits;

#if defined(__KERNEL__) || defined(_NTDDK_) || defined(_NTIFS_)
    /* In kernel mode, check IEEE 754 float exponent bits for NaN/Inf */
    uint32_t exp = (rawBits >> 23) & 0xFF;
    if (exp == 0xFF) {
        return 0.0f; /* NaN or Infinity -> clamp to silence */
    }
#else
    /* Non-kernel test environment */
    uint32_t exp = (rawBits >> 23) & 0xFF;
    if (exp == 0xFF) {
        return 0.0f;
    }
#endif

    /* Clamp extreme float amplitudes to [-4.0, 4.0] for safety */
    if (conv.f > 4.0f) return 4.0f;
    if (conv.f < -4.0f) return -4.0f;
    return conv.f;
}

uint32_t JaMeetKernelConsumer_ReadFloatFrames(
    JaMeetKernelConsumer* consumer,
    const JaMeetSharedSegment* segment,
    float* outFloatPcm,
    uint32_t frameCount,
    uint64_t nowMs
) {
    if (!outFloatPcm || frameCount == 0) {
        return 0;
    }

    size_t totalSamples = (size_t)frameCount * JAMEET_CHANNELS;

    /* 1. Untrusted Header Validation */
    if (!segment) {
        memset(outFloatPcm, 0, totalSamples * sizeof(float));
        return frameCount;
    }

    if (segment->header.magic != JAMEET_SHM_MAGIC ||
        segment->header.abiVersion != JAMEET_ABI_VERSION ||
        segment->header.headerSizeBytes != sizeof(JaMeetSharedHeader) ||
        segment->header.totalSizeBytes != sizeof(JaMeetSharedSegment) ||
        segment->header.totalCapacityFrames != JAMEET_TOTAL_FRAMES ||
        segment->header.framesPerSlot != JAMEET_SLOT_FRAMES ||
        segment->header.slotCount != JAMEET_SLOT_COUNT ||
        segment->header.channels != JAMEET_CHANNELS ||
        segment->header.sampleRate != JAMEET_SAMPLE_RATE) {
        memset(outFloatPcm, 0, totalSamples * sizeof(float));
        return frameCount;
    }

    /* 2. Heartbeat & Inactivity Verification */
    uint64_t lastHeartbeat = segment->header.heartbeatMs;
    uint32_t isVoiceActive = segment->header.isVoiceActive;
    uint64_t currentGeneration = segment->header.producerGeneration;
    uint64_t writeSequence = segment->header.writeSequence;

    bool isHeartbeatValid = (nowMs >= lastHeartbeat) && ((nowMs - lastHeartbeat) <= JAMEET_MAX_HEARTBEAT_AGE_MS);
    if (!isVoiceActive || !isHeartbeatValid || currentGeneration == 0 || writeSequence == 0) {
        memset(outFloatPcm, 0, totalSamples * sizeof(float));
        if (consumer) {
            consumer->active = false;
        }
        return frameCount;
    }

    /* 3. Generation / Epoch Synchronization */
    if (consumer) {
        if (!consumer->initialized || consumer->lastObservedGeneration != currentGeneration) {
            consumer->lastObservedGeneration = currentGeneration;
            consumer->initialized = true;
            consumer->active = true;
            consumer->lastConsumerFrame = (writeSequence > JAMEET_SLOT_FRAMES) ? (writeSequence - JAMEET_SLOT_FRAMES) : 0;
        }
    }

    /* 4. Bound Requested Target Range Against Ring Geometry */
    uint64_t targetFrame = consumer ? consumer->lastConsumerFrame : (writeSequence > frameCount ? writeSequence - frameCount : 0);

    /* If target is ahead of produced audio, clamp to silence */
    if (targetFrame >= writeSequence) {
        memset(outFloatPcm, 0, totalSamples * sizeof(float));
        return frameCount;
    }

    /* If target has been overwritten (lagged beyond ring buffer capacity), fast-forward */
    if (targetFrame + JAMEET_TOTAL_FRAMES < writeSequence) {
        targetFrame = (writeSequence > JAMEET_TOTAL_FRAMES) ? (writeSequence - JAMEET_TOTAL_FRAMES / 2) : 0;
    }

    /* 5. Slot Reading with Seqlock Parity and Untrusted Value Hardening */
    uint32_t framesDelivered = 0;

    while (framesDelivered < frameCount) {
        /* Check if we've reached current produced writeSequence */
        if (targetFrame >= writeSequence) {
            /* Remaining frames are not produced yet -> exact digital silence */
            uint32_t remainingFrames = frameCount - framesDelivered;
            memset(&outFloatPcm[framesDelivered * JAMEET_CHANNELS], 0, remainingFrames * JAMEET_CHANNELS * sizeof(float));
            framesDelivered = frameCount;
            break;
        }

        uint32_t slotIdx = (uint32_t)((targetFrame / JAMEET_SLOT_FRAMES) & JAMEET_SLOT_MASK);
        const JaMeetAudioSlot* slot = &segment->slots[slotIdx];

        uint32_t slotOffset = (uint32_t)(targetFrame % JAMEET_SLOT_FRAMES);
        uint32_t framesAvailableInSlot = JAMEET_SLOT_FRAMES - slotOffset;
        uint32_t framesToCopy = frameCount - framesDelivered;
        if (framesToCopy > framesAvailableInSlot) {
            framesToCopy = framesAvailableInSlot;
        }

        /* Seqlock read loop */
        bool readSuccess = false;
        uint32_t tempBits[JAMEET_SLOT_SAMPLES];

        for (int retry = 0; retry < JAMEET_MAX_SEQLOCK_RETRIES; retry++) {
            uint64_t seq1 = slot->publishSequence;
            if (seq1 & 1) {
                continue; /* Writer in progress */
            }

            /* Verify slot belongs to the current active generation */
            if (slot->producerGeneration != currentGeneration) {
                break;
            }

            /* Verify slot covers the target frame */
            uint64_t slotStart = slot->slotStartFrame;
            uint32_t validFrames = slot->validFrames;
            if (validFrames > JAMEET_SLOT_FRAMES) {
                validFrames = JAMEET_SLOT_FRAMES; /* Clamp untrusted validFrames */
            }

            if (targetFrame < slotStart || targetFrame >= slotStart + validFrames) {
                break; /* Target frame outside valid produced range in this slot */
            }

            uint32_t samplesToRead = framesToCopy * JAMEET_CHANNELS;
            uint32_t sampleStart = slotOffset * JAMEET_CHANNELS;

            for (uint32_t i = 0; i < samplesToRead; i++) {
                tempBits[i] = slot->pcmBits[sampleStart + i];
            }

            uint64_t seq2 = slot->publishSequence;
            if (seq1 == seq2) {
                readSuccess = true;
                break;
            }
        }

        if (readSuccess) {
            for (uint32_t i = 0; i < framesToCopy * JAMEET_CHANNELS; i++) {
                outFloatPcm[(framesDelivered * JAMEET_CHANNELS) + i] = sanitize_sample(tempBits[i]);
            }
        } else {
            /* Fallback to exact digital silence for this quantum */
            memset(&outFloatPcm[framesDelivered * JAMEET_CHANNELS], 0, framesToCopy * JAMEET_CHANNELS * sizeof(float));
        }

        framesDelivered += framesToCopy;
        targetFrame += framesToCopy;
    }

    if (consumer) {
        consumer->lastConsumerFrame = targetFrame;
    }

    return frameCount;
}

uint32_t JaMeetKernelConsumer_ReadInt16Frames(
    JaMeetKernelConsumer* consumer,
    const JaMeetSharedSegment* segment,
    int16_t* outInt16Pcm,
    uint32_t frameCount,
    uint64_t nowMs
) {
    if (!outInt16Pcm || frameCount == 0) {
        return 0;
    }

    /* Temporary bounded stack buffer for conversion (max 480 frames = 960 floats) */
    float tempFloats[480 * 2];
    uint32_t processed = 0;

    while (processed < frameCount) {
        uint32_t chunk = frameCount - processed;
        if (chunk > 480) chunk = 480;

        JaMeetKernelConsumer_ReadFloatFrames(consumer, segment, tempFloats, chunk, nowMs);

        for (uint32_t i = 0; i < chunk * JAMEET_CHANNELS; i++) {
            float f = tempFloats[i];
            if (f > 1.0f) f = 1.0f;
            else if (f < -1.0f) f = -1.0f;

            int32_t sample = (int32_t)(f * 32767.0f);
            if (sample > 32767) sample = 32767;
            if (sample < -32768) sample = -32768;

            outInt16Pcm[(processed * JAMEET_CHANNELS) + i] = (int16_t)sample;
        }

        processed += chunk;
    }

    return frameCount;
}
