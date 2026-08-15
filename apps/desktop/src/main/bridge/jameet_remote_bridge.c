#include "jameet_remote_bridge.h"
#include <string.h>

#define MIN_VAL(a, b) ((a) < (b) ? (a) : (b))

/* ========================================================================= */
/* Portable Lock-Free Atomic Helper Primitives                               */
/* ========================================================================= */

#if defined(__cplusplus)
#include <atomic>
static inline uint64_t atomic_load_u64_acquire(const uint64_t* ptr) {
    return reinterpret_cast<const std::atomic<uint64_t>*>(ptr)->load(std::memory_order_acquire);
}
static inline void atomic_store_u64_release(uint64_t* ptr, uint64_t val) {
    reinterpret_cast<std::atomic<uint64_t>*>(ptr)->store(val, std::memory_order_release);
}
static inline uint64_t atomic_load_u64_relaxed(const uint64_t* ptr) {
    return reinterpret_cast<const std::atomic<uint64_t>*>(ptr)->load(std::memory_order_relaxed);
}
static inline uint32_t atomic_load_u32_acquire(const uint32_t* ptr) {
    return reinterpret_cast<const std::atomic<uint32_t>*>(ptr)->load(std::memory_order_acquire);
}
static inline void atomic_store_u32_release(uint32_t* ptr, uint32_t val) {
    reinterpret_cast<std::atomic<uint32_t>*>(ptr)->store(val, std::memory_order_release);
}
#elif defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L
#include <stdatomic.h>
static inline uint64_t atomic_load_u64_acquire(const uint64_t* ptr) {
    return atomic_load_explicit((const _Atomic uint64_t*)ptr, memory_order_acquire);
}
static inline void atomic_store_u64_release(uint64_t* ptr, uint64_t val) {
    atomic_store_explicit((_Atomic uint64_t*)ptr, val, memory_order_release);
}
static inline uint64_t atomic_load_u64_relaxed(const uint64_t* ptr) {
    return atomic_load_explicit((const _Atomic uint64_t*)ptr, memory_order_relaxed);
}
static inline uint32_t atomic_load_u32_acquire(const uint32_t* ptr) {
    return atomic_load_explicit((const _Atomic uint32_t*)ptr, memory_order_acquire);
}
static inline void atomic_store_u32_release(uint32_t* ptr, uint32_t val) {
    atomic_store_explicit((_Atomic uint32_t*)ptr, val, memory_order_release);
}
#elif defined(__GNUC__) || defined(__clang__)
static inline uint64_t atomic_load_u64_acquire(const uint64_t* ptr) {
    return __atomic_load_n(ptr, __ATOMIC_ACQUIRE);
}
static inline void atomic_store_u64_release(uint64_t* ptr, uint64_t val) {
    __atomic_store_n(ptr, val, __ATOMIC_RELEASE);
}
static inline uint64_t atomic_load_u64_relaxed(const uint64_t* ptr) {
    return __atomic_load_n(ptr, __ATOMIC_RELAXED);
}
static inline uint32_t atomic_load_u32_acquire(const uint32_t* ptr) {
    return __atomic_load_n(ptr, __ATOMIC_ACQUIRE);
}
static inline void atomic_store_u32_release(uint32_t* ptr, uint32_t val) {
    __atomic_store_n(ptr, val, __ATOMIC_RELEASE);
}
#elif defined(_MSC_VER)
#include <windows.h>
static inline uint64_t atomic_load_u64_acquire(const uint64_t* ptr) {
    return (uint64_t)InterlockedCompareExchange64((volatile LONG64*)ptr, 0, 0);
}
static inline void atomic_store_u64_release(uint64_t* ptr, uint64_t val) {
    InterlockedExchange64((volatile LONG64*)ptr, (LONG64)val);
}
static inline uint64_t atomic_load_u64_relaxed(const uint64_t* ptr) {
    return *ptr;
}
static inline uint32_t atomic_load_u32_acquire(const uint32_t* ptr) {
    return (uint32_t)InterlockedCompareExchange((volatile LONG*)ptr, 0, 0);
}
static inline void atomic_store_u32_release(uint32_t* ptr, uint32_t val) {
    InterlockedExchange((volatile LONG*)ptr, (LONG)val);
}
#endif

/* ========================================================================= */
/* Segment Lifecycle & Validation                                            */
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
        slot->seq = 0;
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
        atomic_store_u32_release(&segment->header.producerPid, pid);
        atomic_store_u32_release(&segment->header.isVoiceActive, 0);
        atomic_store_u64_release(&segment->header.writeSequence, 0);
        atomic_store_u64_release(&segment->header.producerGeneration, newEpoch);
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

        uint64_t curSeq = atomic_load_u64_relaxed(&slot->seq);
        atomic_store_u64_release(&slot->seq, curSeq + 1); /* Make odd -> write in progress */

        slot->producerGeneration = producer->currentEpoch;
        slot->slotStartFrame = slotStartFrame;
        slot->sampleRate = JAMEET_SAMPLE_RATE;
        slot->channels = JAMEET_CHANNELS;
        slot->validFrames = (uint16_t)(offsetInSlot + toWrite);
        slot->flags = isVoiceActive ? JAMEET_SLOT_FLAG_VOICE_ON : JAMEET_SLOT_FLAG_NONE;

        if (interleavedStereoPcm && isVoiceActive) {
            memcpy(
                &slot->pcmData[offsetInSlot * JAMEET_CHANNELS],
                &interleavedStereoPcm[framesProcessed * JAMEET_CHANNELS],
                toWrite * JAMEET_CHANNELS * sizeof(float)
            );
        } else {
            memset(
                &slot->pcmData[offsetInSlot * JAMEET_CHANNELS],
                0,
                toWrite * JAMEET_CHANNELS * sizeof(float)
            );
        }

        /* 
         * Partial Slot Sanitization:
         * Ensure any unwritten remainder of the slot is completely zeroed so
         * stale PCM from previous generations or cycles can never be read.
         */
        if (offsetInSlot + toWrite < JAMEET_SLOT_FRAMES) {
            uint32_t remainderOffset = (offsetInSlot + toWrite) * JAMEET_CHANNELS;
            uint32_t remainderSamples = (JAMEET_SLOT_FRAMES - (offsetInSlot + toWrite)) * JAMEET_CHANNELS;
            memset(&slot->pcmData[remainderOffset], 0, remainderSamples * sizeof(float));
        }

        atomic_store_u64_release(&slot->seq, curSeq + 2); /* Make even -> commit */

        framesProcessed += toWrite;
    }

    producer->totalFramesWritten += frameCount;

    atomic_store_u64_release(&segment->header.writeSequence, producer->totalFramesWritten);
    atomic_store_u64_release(&segment->header.heartbeatMs, timestampMs);
    atomic_store_u32_release(&segment->header.isVoiceActive, isVoiceActive ? 1 : 0);

    return frameCount;
}

void JaMeetProducer_UpdateHeartbeat(JaMeetProducer* producer, uint64_t timestampMs, bool isVoiceActive) {
    if (!producer || !producer->isInitialized || !producer->segment) return;
    JaMeetSharedSegment* segment = producer->segment;

    atomic_store_u64_release(&segment->header.heartbeatMs, timestampMs);
    atomic_store_u32_release(&segment->header.isVoiceActive, isVoiceActive ? 1 : 0);
}

void JaMeetProducer_ResetGeneration(JaMeetProducer* producer, uint64_t newEpoch) {
    if (!producer || !producer->isInitialized || !producer->segment) return;
    producer->currentEpoch = newEpoch;
    producer->totalFramesWritten = 0;
    JaMeetSharedSegment* segment = producer->segment;

    atomic_store_u64_release(&segment->header.writeSequence, 0);
    atomic_store_u64_release(&segment->header.producerGeneration, newEpoch);
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

    uint64_t currentGen = atomic_load_u64_acquire(&segment->header.producerGeneration);
    uint64_t writeSeq   = atomic_load_u64_acquire(&segment->header.writeSequence);
    uint64_t heartbeat  = atomic_load_u64_acquire(&segment->header.heartbeatMs);
    uint32_t isVoice    = atomic_load_u32_acquire(&segment->header.isVoiceActive);

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

    /* 5. Read Frames across slots using Seqlock Verification */
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

        uint32_t framesInSlot = JAMEET_SLOT_FRAMES - offsetInSlot;
        uint32_t availableFromProducer = (uint32_t)(writeSeq - targetFrame);
        uint32_t toCopy = MIN_VAL(frameCount - framesRead, MIN_VAL(framesInSlot, availableFromProducer));

        const JaMeetAudioSlot* slot = &segment->slots[slotIndex];

        uint64_t seq1 = atomic_load_u64_acquire(&slot->seq);

        bool slotValid = true;
        if ((seq1 & 1U) != 0U) {
            /* Producer write currently in progress */
            slotValid = false;
        } else {
            /* Verify slot metadata */
            if (slot->producerGeneration != currentGen || slot->slotStartFrame != slotStartFrame) {
                slotValid = false;
            } else {
                /* Copy audio data */
                memcpy(
                    &outInterleavedStereoPcm[framesRead * JAMEET_CHANNELS],
                    &slot->pcmData[offsetInSlot * JAMEET_CHANNELS],
                    toCopy * JAMEET_CHANNELS * sizeof(float)
                );

                uint64_t seq2 = atomic_load_u64_acquire(&slot->seq);
                if (seq1 != seq2) {
                    /* Slot was modified while copying */
                    slotValid = false;
                }
            }
        }

        if (!slotValid) {
            /* Discard torn data and output clean digital silence */
            memset(&outInterleavedStereoPcm[framesRead * JAMEET_CHANNELS], 0, toCopy * JAMEET_CHANNELS * sizeof(float));
            consumer->tornReadCount++;
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

    uint64_t heartbeat = atomic_load_u64_acquire(&segment->header.heartbeatMs);
    uint32_t isVoice   = atomic_load_u32_acquire(&segment->header.isVoiceActive);

    if (!isVoice) return false;
    if (currentTimestampMs > 0 && heartbeat > 0 && currentTimestampMs > heartbeat + JAMEET_HEARTBEAT_TIMEOUT_MS) {
        return false;
    }

    return true;
}
