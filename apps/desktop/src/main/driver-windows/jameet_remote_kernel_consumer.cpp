#include "jameet_remote_kernel_consumer.h"
#include <string.h>

#if defined(_WIN32) && defined(__KERNEL__)
#include <ntddk.h>
static inline uint64_t jameet_read_u64_acquire(const volatile uint64_t* ptr) {
    #if defined(_M_ARM64) || defined(__aarch64__)
    return (uint64_t)__ldar64((unsigned __int64 volatile*)ptr);
    #else
    uint64_t val = *ptr;
    _ReadWriteBarrier();
    return val;
    #endif
}
static inline uint32_t jameet_read_u32_acquire(const volatile uint32_t* ptr) {
    #if defined(_M_ARM64) || defined(__aarch64__)
    return (uint32_t)__ldar32((unsigned int volatile*)ptr);
    #else
    uint32_t val = *ptr;
    _ReadWriteBarrier();
    return val;
    #endif
}
#elif defined(_WIN32)
#include <windows.h>
static inline uint64_t jameet_read_u64_acquire(const volatile uint64_t* ptr) {
    return (uint64_t)InterlockedCompareExchange64((LONG64 volatile*)ptr, 0, 0);
}
static inline uint32_t jameet_read_u32_acquire(const volatile uint32_t* ptr) {
    return (uint32_t)InterlockedCompareExchange((LONG volatile*)ptr, 0, 0);
}
#else
static inline uint64_t jameet_read_u64_acquire(const volatile uint64_t* ptr) {
    uint64_t val = *ptr;
    __sync_synchronize();
    return val;
}
static inline uint32_t jameet_read_u32_acquire(const volatile uint32_t* ptr) {
    uint32_t val = *ptr;
    __sync_synchronize();
    return val;
}
#endif

#define JAMEET_MAX_HEARTBEAT_AGE_MS     500ULL

#ifndef MIN_VAL
#define MIN_VAL(a, b) (((a) < (b)) ? (a) : (b))
#endif

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

    /* Check IEEE 754 float exponent bits for NaN/Inf */
    uint32_t exp = (rawBits >> 23) & 0xFF;
    if (exp == 0xFF) {
        return 0.0f; /* NaN or Infinity -> clamp to silence */
    }

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

    /* 2. Heartbeat & Inactivity Verification using Atomic Acquire Reads */
    uint64_t lastHeartbeat = jameet_read_u64_acquire(&segment->header.heartbeatMs);
    uint32_t isVoiceActive = jameet_read_u32_acquire(&segment->header.isVoiceActive);
    uint64_t currentGeneration = jameet_read_u64_acquire(&segment->header.producerGeneration);
    uint64_t writeSequence = jameet_read_u64_acquire(&segment->header.writeSequence);

    bool isHeartbeatValid = (nowMs >= lastHeartbeat) && ((nowMs - lastHeartbeat) <= JAMEET_MAX_HEARTBEAT_AGE_MS);
    if (!isVoiceActive || !isHeartbeatValid || currentGeneration == 0 || writeSequence == 0) {
        memset(outFloatPcm, 0, totalSamples * sizeof(float));
        if (consumer) {
            consumer->active = false;
            consumer->lastConsumerFrame = writeSequence;
        }
        return frameCount;
    }

    /* 3. Generation / Epoch Synchronization */
    if (consumer) {
        if (!consumer->initialized || consumer->lastObservedGeneration != currentGeneration) {
            consumer->lastObservedGeneration = currentGeneration;
            consumer->initialized = true;
            consumer->active = true;
            consumer->lastConsumerFrame = (writeSequence >= frameCount) ? (writeSequence - frameCount) : 0;
        }
    }

    /* 4. Bound Requested Target Range Against Ring Geometry */
    uint64_t targetFrame = consumer ? consumer->lastConsumerFrame : (writeSequence >= frameCount ? writeSequence - frameCount : 0);

    /* If target is ahead of produced audio, clamp to silence and clamp cursor to writeSequence */
    if (targetFrame >= writeSequence) {
        memset(outFloatPcm, 0, totalSamples * sizeof(float));
        if (consumer) {
            consumer->lastConsumerFrame = writeSequence;
        }
        return frameCount;
    }

    /* If target has been overwritten (lagged beyond ring buffer capacity), fast-forward */
    if (targetFrame + JAMEET_TOTAL_FRAMES < writeSequence) {
        targetFrame = (writeSequence > JAMEET_TOTAL_FRAMES) ? (writeSequence - JAMEET_TOTAL_FRAMES / 2) : 0;
    }

    /* 5. Continuous Multi-Slot Reading with Seqlock Parity and Untrusted Value Hardening */
    uint32_t framesDelivered = 0;

    while (framesDelivered < frameCount) {
        if (targetFrame >= writeSequence) {
            /* Remaining frames are not produced yet -> exact digital silence */
            uint32_t remainingFrames = frameCount - framesDelivered;
            memset(&outFloatPcm[framesDelivered * JAMEET_CHANNELS], 0, remainingFrames * JAMEET_CHANNELS * sizeof(float));
            framesDelivered = frameCount;
            targetFrame = writeSequence;
            break;
        }

        uint32_t slotIdx = (uint32_t)((targetFrame / JAMEET_SLOT_FRAMES) & JAMEET_SLOT_MASK);
        uint32_t offsetInSlot = (uint32_t)(targetFrame % JAMEET_SLOT_FRAMES);
        uint64_t expectedSlotStartFrame = targetFrame - offsetInSlot;

        const JaMeetAudioSlot* slot = &segment->slots[slotIdx];

        /* Pre-read Seqlock Guard: Must be EVEN. If ODD, writer in progress -> silence this chunk */
        uint64_t seq1 = jameet_read_u64_acquire(&slot->publishSequence);
        if ((seq1 & 1ULL) != 0) {
            uint32_t framesInSlot = JAMEET_SLOT_FRAMES - offsetInSlot;
            uint32_t availableFromProducer = (uint32_t)(writeSequence - targetFrame);
            uint32_t toZero = MIN_VAL(frameCount - framesDelivered, MIN_VAL(framesInSlot, availableFromProducer));
            memset(&outFloatPcm[framesDelivered * JAMEET_CHANNELS], 0, toZero * JAMEET_CHANNELS * sizeof(float));
            framesDelivered += toZero;
            targetFrame += toZero;
            continue;
        }

        /* Read slot metadata using atomic acquire reads */
        uint64_t slotGen = jameet_read_u64_acquire(&slot->producerGeneration);
        uint64_t slotStart = jameet_read_u64_acquire(&slot->slotStartFrame);
        uint32_t validCount = jameet_read_u32_acquire(&slot->validFrames);
        if (validCount > JAMEET_SLOT_FRAMES) {
            validCount = JAMEET_SLOT_FRAMES; /* Clamp untrusted validFrames */
        }

        if (slotGen != currentGeneration || slotStart != expectedSlotStartFrame || offsetInSlot >= validCount) {
            uint32_t framesInSlot = JAMEET_SLOT_FRAMES - offsetInSlot;
            uint32_t availableFromProducer = (uint32_t)(writeSequence - targetFrame);
            uint32_t toZero = MIN_VAL(frameCount - framesDelivered, MIN_VAL(framesInSlot, availableFromProducer));
            memset(&outFloatPcm[framesDelivered * JAMEET_CHANNELS], 0, toZero * JAMEET_CHANNELS * sizeof(float));
            framesDelivered += toZero;
            targetFrame += toZero;
            continue;
        }

        uint32_t framesInSlot = validCount - offsetInSlot;
        uint32_t availableFromProducer = (uint32_t)(writeSequence - targetFrame);
        uint32_t toCopy = MIN_VAL(frameCount - framesDelivered, MIN_VAL(framesInSlot, availableFromProducer));

        /* Read PCM sample bits and sanitize float values */
        for (uint32_t f = 0; f < toCopy; f++) {
            uint32_t rawL = slot->pcmBits[(offsetInSlot + f) * JAMEET_CHANNELS + 0];
            uint32_t rawR = slot->pcmBits[(offsetInSlot + f) * JAMEET_CHANNELS + 1];
            outFloatPcm[(framesDelivered + f) * JAMEET_CHANNELS + 0] = sanitize_sample(rawL);
            outFloatPcm[(framesDelivered + f) * JAMEET_CHANNELS + 1] = sanitize_sample(rawR);
        }

        /* Post-read Seqlock Guard using atomic acquire */
        uint64_t seq2 = jameet_read_u64_acquire(&slot->publishSequence);
        if (seq1 != seq2 || (seq2 & 1ULL) != 0) {
            /* Torn read: discard copied output and fill with digital silence */
            memset(&outFloatPcm[framesDelivered * JAMEET_CHANNELS], 0, toCopy * JAMEET_CHANNELS * sizeof(float));
        }

        framesDelivered += toCopy;
        targetFrame += toCopy;
    }

    if (consumer) {
        if (targetFrame > writeSequence) {
            targetFrame = writeSequence;
        }
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
