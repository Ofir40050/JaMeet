#include "jameet_remote_bridge.h"
#include <string.h>

#define MIN_VAL(a, b) ((a) < (b) ? (a) : (b))

void JaMeetProducer_Init(JaMeetProducer* producer, JaMeetSharedSegment* segment, uint64_t initialEpoch, uint32_t pid) {
    if (!producer || !segment) return;

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

#if defined(__cplusplus)
    segment->header.producerGeneration.store(initialEpoch, std::memory_order_relaxed);
    segment->header.writeSequence.store(0, std::memory_order_relaxed);
    segment->header.heartbeatMs.store(0, std::memory_order_relaxed);
    segment->header.isVoiceActive.store(0, std::memory_order_relaxed);
    segment->header.producerPid.store(pid, std::memory_order_relaxed);
#else
    atomic_init(&segment->header.producerGeneration, initialEpoch);
    atomic_init(&segment->header.writeSequence, 0);
    atomic_init(&segment->header.heartbeatMs, 0);
    atomic_init(&segment->header.isVoiceActive, 0);
    atomic_init(&segment->header.producerPid, pid);
#endif

    for (uint32_t i = 0; i < JAMEET_SLOT_COUNT; i++) {
        JaMeetAudioSlot* slot = &segment->slots[i];
#if defined(__cplusplus)
        slot->seq.store(0, std::memory_order_relaxed);
#else
        atomic_init(&slot->seq, 0);
#endif
        slot->producerGeneration = initialEpoch;
        slot->slotStartFrame = 0;
        slot->sampleRate = JAMEET_SAMPLE_RATE;
        slot->channels = JAMEET_CHANNELS;
        slot->validFrames = 0;
        slot->flags = JAMEET_SLOT_FLAG_NONE;
        slot->reserved = 0;
    }

    producer->segment = segment;
    producer->currentEpoch = initialEpoch;
    producer->totalFramesWritten = 0;
    producer->producerPid = pid;
    producer->isInitialized = true;
}

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

#if defined(__cplusplus)
        uint64_t curSeq = slot->seq.load(std::memory_order_relaxed);
        slot->seq.store(curSeq + 1, std::memory_order_release); /* Make odd -> write in progress */
#else
        uint64_t curSeq = atomic_load_explicit(&slot->seq, memory_order_relaxed);
        atomic_store_explicit(&slot->seq, curSeq + 1, memory_order_release);
#endif

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

#if defined(__cplusplus)
        slot->seq.store(curSeq + 2, std::memory_order_release); /* Make even -> commit */
#else
        atomic_store_explicit(&slot->seq, curSeq + 2, memory_order_release);
#endif

        framesProcessed += toWrite;
    }

    producer->totalFramesWritten += frameCount;

#if defined(__cplusplus)
    segment->header.writeSequence.store(producer->totalFramesWritten, std::memory_order_release);
    segment->header.heartbeatMs.store(timestampMs, std::memory_order_release);
    segment->header.isVoiceActive.store(isVoiceActive ? 1 : 0, std::memory_order_release);
#else
    atomic_store_explicit(&segment->header.writeSequence, producer->totalFramesWritten, memory_order_release);
    atomic_store_explicit(&segment->header.heartbeatMs, timestampMs, memory_order_release);
    atomic_store_explicit(&segment->header.isVoiceActive, isVoiceActive ? 1 : 0, memory_order_release);
#endif

    return frameCount;
}

void JaMeetProducer_UpdateHeartbeat(JaMeetProducer* producer, uint64_t timestampMs, bool isVoiceActive) {
    if (!producer || !producer->isInitialized || !producer->segment) return;
    JaMeetSharedSegment* segment = producer->segment;

#if defined(__cplusplus)
    segment->header.heartbeatMs.store(timestampMs, std::memory_order_release);
    segment->header.isVoiceActive.store(isVoiceActive ? 1 : 0, std::memory_order_release);
#else
    atomic_store_explicit(&segment->header.heartbeatMs, timestampMs, memory_order_release);
    atomic_store_explicit(&segment->header.isVoiceActive, isVoiceActive ? 1 : 0, memory_order_release);
#endif
}

void JaMeetProducer_ResetGeneration(JaMeetProducer* producer, uint64_t newEpoch) {
    if (!producer || !producer->isInitialized || !producer->segment) return;
    producer->currentEpoch = newEpoch;
    JaMeetSharedSegment* segment = producer->segment;

#if defined(__cplusplus)
    segment->header.producerGeneration.store(newEpoch, std::memory_order_release);
#else
    atomic_store_explicit(&segment->header.producerGeneration, newEpoch, memory_order_release);
#endif
}

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

    /* Validate segment geometry and magic */
    if (!segment || segment->header.magic != JAMEET_SHM_MAGIC || segment->header.abiVersion != JAMEET_ABI_VERSION) {
        memset(outInterleavedStereoPcm, 0, totalBytes);
        return frameCount;
    }

#if defined(__cplusplus)
    uint64_t currentGen = segment->header.producerGeneration.load(std::memory_order_acquire);
    uint64_t writeSeq   = segment->header.writeSequence.load(std::memory_order_acquire);
    uint64_t heartbeat  = segment->header.heartbeatMs.load(std::memory_order_acquire);
    uint32_t isVoice    = segment->header.isVoiceActive.load(std::memory_order_acquire);
#else
    uint64_t currentGen = atomic_load_explicit(&segment->header.producerGeneration, memory_order_acquire);
    uint64_t writeSeq   = atomic_load_explicit(&segment->header.writeSequence, memory_order_acquire);
    uint64_t heartbeat  = atomic_load_explicit(&segment->header.heartbeatMs, memory_order_acquire);
    uint32_t isVoice    = atomic_load_explicit(&segment->header.isVoiceActive, memory_order_acquire);
#endif

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

#if defined(__cplusplus)
        uint64_t seq1 = slot->seq.load(std::memory_order_acquire);
#else
        uint64_t seq1 = atomic_load_explicit(&slot->seq, memory_order_acquire);
#endif

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

#if defined(__cplusplus)
                uint64_t seq2 = slot->seq.load(std::memory_order_acquire);
#else
                uint64_t seq2 = atomic_load_explicit(&slot->seq, memory_order_acquire);
#endif
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
    if (!segment || segment->header.magic != JAMEET_SHM_MAGIC || segment->header.abiVersion != JAMEET_ABI_VERSION) {
        return false;
    }

#if defined(__cplusplus)
    uint64_t heartbeat = segment->header.heartbeatMs.load(std::memory_order_acquire);
    uint32_t isVoice   = segment->header.isVoiceActive.load(std::memory_order_acquire);
#else
    uint64_t heartbeat = atomic_load_explicit(&segment->header.heartbeatMs, memory_order_acquire);
    uint32_t isVoice   = atomic_load_explicit(&segment->header.isVoiceActive, memory_order_acquire);
#endif

    if (!isVoice) return false;
    if (currentTimestampMs > 0 && heartbeat > 0 && currentTimestampMs > heartbeat + JAMEET_HEARTBEAT_TIMEOUT_MS) {
        return false;
    }

    return true;
}
