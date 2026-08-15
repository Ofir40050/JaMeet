#include "jameet_remote_bridge.h"
#include <string.h>

#define MIN_VAL(a, b) ((a) < (b) ? (a) : (b))

/* ========================================================================= */
/* Portable Lock-Free Atomic Helper Primitives (Direct Pointer Storage)       */
/* ========================================================================= */

#if defined(__GNUC__) || defined(__clang__)
static inline uint64_t jameet_atomic_load_u64_acquire(const uint64_t* ptr) {
    return __atomic_load_n(ptr, __ATOMIC_ACQUIRE);
}
static inline void jameet_atomic_store_u64_release(uint64_t* ptr, uint64_t val) {
    __atomic_store_n(ptr, val, __ATOMIC_RELEASE);
}
static inline uint64_t jameet_atomic_load_u64_relaxed(const uint64_t* ptr) {
    return __atomic_load_n(ptr, __ATOMIC_RELAXED);
}

static inline uint32_t jameet_atomic_load_u32_acquire(const uint32_t* ptr) {
    return __atomic_load_n(ptr, __ATOMIC_ACQUIRE);
}
static inline void jameet_atomic_store_u32_release(uint32_t* ptr, uint32_t val) {
    __atomic_store_n(ptr, val, __ATOMIC_RELEASE);
}
static inline uint32_t jameet_atomic_load_u32_relaxed(const uint32_t* ptr) {
    return __atomic_load_n(ptr, __ATOMIC_RELAXED);
}
static inline void jameet_atomic_store_u32_relaxed(uint32_t* ptr, uint32_t val) {
    __atomic_store_n(ptr, val, __ATOMIC_RELAXED);
}

#elif defined(_MSC_VER)
#include <windows.h>
#include <intrin.h>
static inline uint64_t jameet_atomic_load_u64_acquire(const uint64_t* ptr) {
    uint64_t val = (uint64_t)InterlockedCompareExchange64((volatile LONG64*)ptr, 0, 0);
    _ReadWriteBarrier();
    return val;
}
static inline void jameet_atomic_store_u64_release(uint64_t* ptr, uint64_t val) {
    _ReadWriteBarrier();
    InterlockedExchange64((volatile LONG64*)ptr, (LONG64)val);
}
static inline uint64_t jameet_atomic_load_u64_relaxed(const uint64_t* ptr) {
    return *ptr;
}
static inline void jameet_atomic_store_u64_relaxed(uint64_t* ptr, uint64_t val) {
    *ptr = val;
}

static inline uint32_t jameet_atomic_load_u32_acquire(const uint32_t* ptr) {
    uint32_t val = (uint32_t)InterlockedCompareExchange((volatile LONG*)ptr, 0, 0);
    _ReadWriteBarrier();
    return val;
}
static inline void jameet_atomic_store_u32_release(uint32_t* ptr, uint32_t val) {
    _ReadWriteBarrier();
    InterlockedExchange((volatile LONG*)ptr, (LONG)val);
}
static inline uint32_t jameet_atomic_load_u32_relaxed(const uint32_t* ptr) {
    return *ptr;
}
static inline void jameet_atomic_store_u32_relaxed(uint32_t* ptr, uint32_t val) {
    *ptr = val;
}
#endif

static inline void jameet_atomic_store_f32_relaxed(float* dest, float val) {
    uint32_t raw;
    memcpy(&raw, &val, sizeof(float));
    jameet_atomic_store_u32_relaxed((uint32_t*)dest, raw);
}

static inline float jameet_atomic_load_f32_relaxed(const float* src) {
    uint32_t raw = jameet_atomic_load_u32_relaxed((const uint32_t*)src);
    float val;
    memcpy(&val, &raw, sizeof(float));
    return val;
}

/* ========================================================================= */
/* Segment Lifecycle & Geometry Validation                                   */
/* ========================================================================= */

bool JaMeetSegment_ValidateGeometry(const JaMeetSharedSegment* segment) {
    if (!segment) return false;
    const JaMeetSharedHeader* h = &segment->header;
    return (h->magic == JAMEET_SHM_MAGIC &&
            h->abiVersion == JAMEET_ABI_VERSION &&
            h->headerSizeBytes == sizeof(JaMeetSharedHeader) &&
            h->totalSizeBytes == sizeof(JaMeetSharedSegment) &&
            h->sampleRate == JAMEET_SAMPLE_RATE &&
            h->channels == JAMEET_CHANNELS &&
            h->slotCount == JAMEET_SLOT_COUNT &&
            h->framesPerSlot == JAMEET_SLOT_FRAMES &&
            h->totalCapacityFrames == JAMEET_TOTAL_FRAMES);
}

void JaMeetSegment_FormatFirstTime(JaMeetSharedSegment* segment, uint64_t initialEpoch, uint32_t pid) {
    if (!segment) return;

    memset(segment, 0, sizeof(JaMeetSharedSegment));

    segment->header.magic = JAMEET_SHM_MAGIC;
    segment->header.abiVersion = JAMEET_ABI_VERSION;
    segment->header.headerSizeBytes = (uint32_t)sizeof(JaMeetSharedHeader);
    segment->header.totalSizeBytes = (uint32_t)sizeof(JaMeetSharedSegment);
    segment->header.sampleRate = JAMEET_SAMPLE_RATE;
    segment->header.channels = JAMEET_CHANNELS;
    segment->header.slotCount = JAMEET_SLOT_COUNT;
    segment->header.framesPerSlot = JAMEET_SLOT_FRAMES;
    segment->header.totalCapacityFrames = JAMEET_TOTAL_FRAMES;

    segment->header.producerGeneration = initialEpoch;
    segment->header.writeSequence = 0;
    segment->header.heartbeatMs = 0;
    segment->header.isVoiceActive = 0;
    segment->header.producerPid = pid;

    for (uint32_t i = 0; i < JAMEET_SLOT_COUNT; i++) {
        JaMeetAudioSlot* slot = &segment->slots[i];
        slot->publishSequence = 0;
        slot->producerGeneration = initialEpoch;
        slot->slotStartFrame = 0;
        slot->sampleRate = JAMEET_SAMPLE_RATE;
        slot->channels = JAMEET_CHANNELS;
        slot->validFrames = 0;
        slot->flags = JAMEET_SLOT_FLAG_NONE;
        slot->reserved = 0;
        memset(slot->pcmData, 0, sizeof(slot->pcmData));
    }
}

bool JaMeetProducer_Attach(JaMeetProducer* producer, JaMeetSharedSegment* segment, uint64_t newEpoch, uint32_t pid) {
    if (!producer || !segment) return false;

    if (!JaMeetSegment_ValidateGeometry(segment)) {
        /* Format uninitialized segment */
        JaMeetSegment_FormatFirstTime(segment, newEpoch, pid);
    } else {
        /* 
         * Reattaching to existing formatted segment:
         * DO NOT memset or zero active memory.
         * Atomically publish new epoch, reset sequence, and update pid.
         */
        jameet_atomic_store_u32_release(&segment->header.producerPid, pid);
        jameet_atomic_store_u32_release(&segment->header.isVoiceActive, 0);
        jameet_atomic_store_u64_release(&segment->header.writeSequence, 0);
        jameet_atomic_store_u64_release(&segment->header.producerGeneration, newEpoch);
    }

    producer->segment = segment;
    producer->currentEpoch = newEpoch;
    producer->totalFramesWritten = 0;
    producer->producerPid = pid;
    producer->isInitialized = true;
    return true;
}

void JaMeetProducer_Init(JaMeetProducer* producer, JaMeetSharedSegment* segment, uint64_t initialEpoch, uint32_t pid) {
    JaMeetProducer_Attach(producer, segment, initialEpoch, pid);
}

/* ========================================================================= */
/* Producer Operations                                                       */
/* ========================================================================= */

uint32_t JaMeetProducer_WriteFrames(
    JaMeetProducer* producer,
    const float* interleavedStereoPcm,
    uint32_t frameCount,
    bool isVoiceActive,
    uint64_t timestampMs
) {
    if (!producer || !producer->isInitialized || !producer->segment) return 0;
    if (frameCount == 0) {
        JaMeetProducer_UpdateHeartbeat(producer, timestampMs, isVoiceActive);
        return 0;
    }

    JaMeetSharedSegment* segment = producer->segment;
    uint64_t currentFrame = producer->totalFramesWritten;
    uint32_t framesProcessed = 0;

    while (framesProcessed < frameCount) {
        uint64_t targetFrame = currentFrame + framesProcessed;
        uint32_t slotIndex = (uint32_t)((targetFrame / JAMEET_SLOT_FRAMES) & JAMEET_SLOT_MASK);
        uint32_t offsetInSlot = (uint32_t)(targetFrame % JAMEET_SLOT_FRAMES);
        uint64_t slotStartFrame = targetFrame - offsetInSlot;

        uint32_t framesAvailableInSlot = JAMEET_SLOT_FRAMES - offsetInSlot;
        uint32_t toWrite = MIN_VAL(frameCount - framesProcessed, framesAvailableInSlot);

        JaMeetAudioSlot* slot = &segment->slots[slotIndex];

        /*
         * Update Slot Metadata:
         * Preserves existing prefix frames when offsetInSlot > 0 (e.g. consecutive 480-frame writes).
         */
        slot->producerGeneration = producer->currentEpoch;
        slot->slotStartFrame = slotStartFrame;
        slot->sampleRate = JAMEET_SAMPLE_RATE;
        slot->channels = JAMEET_CHANNELS;
        slot->validFrames = (uint16_t)(offsetInSlot + toWrite);
        slot->flags = isVoiceActive ? JAMEET_SLOT_FLAG_VOICE_ON : JAMEET_SLOT_FLAG_NONE;

        /* Write PCM samples using atomic 32-bit stores */
        if (interleavedStereoPcm && isVoiceActive) {
            for (uint32_t f = 0; f < toWrite; f++) {
                float l = interleavedStereoPcm[(framesProcessed + f) * JAMEET_CHANNELS + 0];
                float r = interleavedStereoPcm[(framesProcessed + f) * JAMEET_CHANNELS + 1];
                jameet_atomic_store_f32_relaxed(&slot->pcmData[(offsetInSlot + f) * JAMEET_CHANNELS + 0], l);
                jameet_atomic_store_f32_relaxed(&slot->pcmData[(offsetInSlot + f) * JAMEET_CHANNELS + 1], r);
            }
        } else {
            for (uint32_t f = 0; f < toWrite; f++) {
                jameet_atomic_store_f32_relaxed(&slot->pcmData[(offsetInSlot + f) * JAMEET_CHANNELS + 0], 0.0f);
                jameet_atomic_store_f32_relaxed(&slot->pcmData[(offsetInSlot + f) * JAMEET_CHANNELS + 1], 0.0f);
            }
        }

        /* Partial Slot Sanitization: zero unwritten remainder */
        if (offsetInSlot + toWrite < JAMEET_SLOT_FRAMES) {
            for (uint32_t f = offsetInSlot + toWrite; f < JAMEET_SLOT_FRAMES; f++) {
                jameet_atomic_store_f32_relaxed(&slot->pcmData[f * JAMEET_CHANNELS + 0], 0.0f);
                jameet_atomic_store_f32_relaxed(&slot->pcmData[f * JAMEET_CHANNELS + 1], 0.0f);
            }
        }

        /* Atomically publish the slot with release semantics */
        uint64_t curSeq = jameet_atomic_load_u64_relaxed(&slot->publishSequence);
        jameet_atomic_store_u64_release(&slot->publishSequence, curSeq + 1);

        framesProcessed += toWrite;
    }

    producer->totalFramesWritten += frameCount;

    jameet_atomic_store_u64_release(&segment->header.writeSequence, producer->totalFramesWritten);
    jameet_atomic_store_u64_release(&segment->header.heartbeatMs, timestampMs);
    jameet_atomic_store_u32_release(&segment->header.isVoiceActive, isVoiceActive ? 1 : 0);

    return frameCount;
}

void JaMeetProducer_UpdateHeartbeat(JaMeetProducer* producer, uint64_t timestampMs, bool isVoiceActive) {
    if (!producer || !producer->isInitialized || !producer->segment) return;
    JaMeetSharedSegment* segment = producer->segment;

    jameet_atomic_store_u64_release(&segment->header.heartbeatMs, timestampMs);
    jameet_atomic_store_u32_release(&segment->header.isVoiceActive, isVoiceActive ? 1 : 0);
}

void JaMeetProducer_ResetGeneration(JaMeetProducer* producer, uint64_t newEpoch) {
    if (!producer || !producer->isInitialized || !producer->segment) return;
    producer->currentEpoch = newEpoch;
    producer->totalFramesWritten = 0;
    JaMeetSharedSegment* segment = producer->segment;

    jameet_atomic_store_u64_release(&segment->header.writeSequence, 0);
    jameet_atomic_store_u64_release(&segment->header.producerGeneration, newEpoch);
}

/* ========================================================================= */
/* Consumer Operations                                                       */
/* ========================================================================= */

void JaMeetConsumer_Init(JaMeetConsumer* consumer) {
    if (!consumer) return;
    consumer->lastObservedGeneration = 0;
    consumer->localReadFrame = 0;
    consumer->isSynchronized = false;
    consumer->underrunCount = 0;
    consumer->tornReadCount = 0;
}

void JaMeetConsumer_Reset(JaMeetConsumer* consumer) {
    JaMeetConsumer_Init(consumer);
}

uint32_t JaMeetConsumer_ReadFrames(
    JaMeetConsumer* consumer,
    const JaMeetSharedSegment* segment,
    float* outInterleavedStereoPcm,
    uint32_t frameCount,
    uint64_t currentTimestampMs
) {
    if (!consumer || !outInterleavedStereoPcm || frameCount == 0) return 0;

    const size_t totalBytes = (size_t)frameCount * JAMEET_CHANNELS * sizeof(float);

    /* Validate complete segment geometry */
    if (!JaMeetSegment_ValidateGeometry(segment)) {
        memset(outInterleavedStereoPcm, 0, totalBytes);
        return frameCount;
    }

    uint64_t currentGen = jameet_atomic_load_u64_acquire(&segment->header.producerGeneration);
    uint64_t writeSeq   = jameet_atomic_load_u64_acquire(&segment->header.writeSequence);
    uint64_t heartbeat  = jameet_atomic_load_u64_acquire(&segment->header.heartbeatMs);
    uint32_t isVoice    = jameet_atomic_load_u32_acquire(&segment->header.isVoiceActive);

    /* 1. Generation Epoch Check */
    if (currentGen == 0 || currentGen != consumer->lastObservedGeneration) {
        consumer->lastObservedGeneration = currentGen;
        consumer->localReadFrame = (writeSeq >= frameCount) ? (writeSeq - frameCount) : 0;
        consumer->isSynchronized = true;
    }

    /* 2. Heartbeat Timeout / Inactive Stream Check */
    bool isHeartbeatExpired = (currentTimestampMs > 0 && heartbeat > 0 && currentTimestampMs > heartbeat + JAMEET_HEARTBEAT_TIMEOUT_MS);
    if (!isVoice || isHeartbeatExpired) {
        memset(outInterleavedStereoPcm, 0, totalBytes);
        consumer->localReadFrame = writeSeq;
        return frameCount;
    }

    /* 3. Underflow Check */
    if (consumer->localReadFrame > writeSeq) {
        memset(outInterleavedStereoPcm, 0, totalBytes);
        consumer->localReadFrame = writeSeq;
        consumer->underrunCount++;
        return frameCount;
    }

    /* 4. Lag Overrun Check (Cap read lag to maximum capacity) */
    if (writeSeq - consumer->localReadFrame > JAMEET_TOTAL_FRAMES) {
        consumer->localReadFrame = writeSeq - JAMEET_TOTAL_FRAMES;
    }

    /* 5. Read Frames across slots using Race-Free Atomic Sample Extraction */
    uint32_t framesRead = 0;
    uint64_t targetFrame = consumer->localReadFrame;

    while (framesRead < frameCount) {
        if (targetFrame >= writeSeq) {
            /* Producer has no more frames; zero-fill remainder */
            uint32_t remFrames = frameCount - framesRead;
            memset(&outInterleavedStereoPcm[framesRead * JAMEET_CHANNELS], 0, remFrames * JAMEET_CHANNELS * sizeof(float));
            consumer->underrunCount++;
            break;
        }

        uint32_t slotIndex = (uint32_t)((targetFrame / JAMEET_SLOT_FRAMES) & JAMEET_SLOT_MASK);
        uint32_t offsetInSlot = (uint32_t)(targetFrame % JAMEET_SLOT_FRAMES);
        uint64_t slotStartFrame = targetFrame - offsetInSlot;

        const JaMeetAudioSlot* slot = &segment->slots[slotIndex];

        /* Load publish sequence before reading slot */
        uint64_t seq1 = jameet_atomic_load_u64_acquire(&slot->publishSequence);

        uint64_t slotGen = jameet_atomic_load_u64_relaxed(&slot->producerGeneration);
        uint64_t slotStart = jameet_atomic_load_u64_relaxed(&slot->slotStartFrame);
        uint32_t validCount = (uint32_t)slot->validFrames;

        bool slotValid = true;
        if (slotGen != currentGen || slotStart != slotStartFrame || offsetInSlot >= validCount) {
            slotValid = false;
        }

        if (!slotValid) {
            uint32_t framesInSlot = JAMEET_SLOT_FRAMES - offsetInSlot;
            uint32_t availableFromProducer = (uint32_t)(writeSeq - targetFrame);
            uint32_t toZero = MIN_VAL(frameCount - framesRead, MIN_VAL(framesInSlot, availableFromProducer));
            memset(&outInterleavedStereoPcm[framesRead * JAMEET_CHANNELS], 0, toZero * JAMEET_CHANNELS * sizeof(float));
            consumer->tornReadCount++;
            framesRead += toZero;
            targetFrame += toZero;
            continue;
        }

        uint32_t framesInSlot = validCount - offsetInSlot;
        uint32_t availableFromProducer = (uint32_t)(writeSeq - targetFrame);
        uint32_t toCopy = MIN_VAL(frameCount - framesRead, MIN_VAL(framesInSlot, availableFromProducer));

        /* Read samples atomically */
        for (uint32_t f = 0; f < toCopy; f++) {
            float l = jameet_atomic_load_f32_relaxed(&slot->pcmData[(offsetInSlot + f) * JAMEET_CHANNELS + 0]);
            float r = jameet_atomic_load_f32_relaxed(&slot->pcmData[(offsetInSlot + f) * JAMEET_CHANNELS + 1]);
            outInterleavedStereoPcm[(framesRead + f) * JAMEET_CHANNELS + 0] = l;
            outInterleavedStereoPcm[(framesRead + f) * JAMEET_CHANNELS + 1] = r;
        }

        /* Check if the slot was replaced or wrapped while copying */
        uint64_t seq2 = jameet_atomic_load_u64_acquire(&slot->publishSequence);
        if (seq1 != seq2) {
            uint64_t postSlotGen = jameet_atomic_load_u64_relaxed(&slot->producerGeneration);
            uint64_t postSlotStart = jameet_atomic_load_u64_relaxed(&slot->slotStartFrame);
            if (postSlotGen != currentGen || postSlotStart != slotStartFrame) {
                /* Slot was overwritten by future ring cycle: discard and zero-fill */
                memset(&outInterleavedStereoPcm[framesRead * JAMEET_CHANNELS], 0, toCopy * JAMEET_CHANNELS * sizeof(float));
                consumer->tornReadCount++;
            }
        }

        framesRead += toCopy;
        targetFrame += toCopy;
    }

    consumer->localReadFrame += frameCount;
    if (consumer->localReadFrame > writeSeq) {
        consumer->localReadFrame = writeSeq;
    }

    return frameCount;
}

bool JaMeetConsumer_IsVoiceActive(
    const JaMeetConsumer* consumer,
    const JaMeetSharedSegment* segment,
    uint64_t currentTimestampMs
) {
    (void)consumer;
    if (!JaMeetSegment_ValidateGeometry(segment)) {
        return false;
    }

    uint64_t heartbeat = jameet_atomic_load_u64_acquire(&segment->header.heartbeatMs);
    uint32_t isVoice   = jameet_atomic_load_u32_acquire(&segment->header.isVoiceActive);

    if (!isVoice) return false;
    if (currentTimestampMs > 0 && heartbeat > 0 && currentTimestampMs > heartbeat + JAMEET_HEARTBEAT_TIMEOUT_MS) {
        return false;
    }

    return true;
}
