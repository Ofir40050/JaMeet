#include "jameet_remote_kernel_consumer.h"
#include <string.h>
#include <math.h>

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
    if (isnan(conv.f) || isinf(conv.f)) {
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
        segment->header.totalFrames != JAMEET_TOTAL_FRAMES ||
        segment->header.channels != JAMEET_CHANNELS ||
        segment->header.sampleRate != JAMEET_SAMPLE_RATE) {
        memset(outFloatPcm, 0, totalSamples * sizeof(float));
        return frameCount;
    }

    /* 2. Heartbeat & Inactivity Verification */
    uint64_t lastHeartbeat = segment->header.lastHeartbeatMs;
    uint32_t isVoiceActive = segment->header.isVoiceActive;
    uint64_t currentEpoch = segment->header.producerGeneration;

    bool isHeartbeatValid = (nowMs >= lastHeartbeat) && ((nowMs - lastHeartbeat) <= JAMEET_MAX_HEARTBEAT_AGE_MS);
    if (!isVoiceActive || !isHeartbeatValid || currentEpoch == 0) {
        memset(outFloatPcm, 0, totalSamples * sizeof(float));
        if (consumer) {
            consumer->active = false;
        }
        return frameCount;
    }

    /* 3. Epoch Synchronization */
    if (consumer) {
        if (!consumer->initialized || consumer->lastObservedGeneration != currentEpoch) {
            consumer->lastObservedGeneration = currentEpoch;
            consumer->initialized = true;
            consumer->active = true;
            uint64_t prodFrames = segment->header.totalProducedFrames;
            consumer->lastConsumerFrame = (prodFrames > JAMEET_SLOT_FRAMES) ? (prodFrames - JAMEET_SLOT_FRAMES) : 0;
        }
    }

    /* 4. Slot Reading with Seqlock Parity and Index Bitmasking */
    uint32_t framesDelivered = 0;
    uint64_t targetFrame = consumer ? consumer->lastConsumerFrame : (segment->header.totalProducedFrames > frameCount ? segment->header.totalProducedFrames - frameCount : 0);

    while (framesDelivered < frameCount) {
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

            uint32_t validFrames = slot->validFrames;
            if (validFrames > JAMEET_SLOT_FRAMES) {
                validFrames = JAMEET_SLOT_FRAMES; /* Clamp untrusted validFrames */
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
