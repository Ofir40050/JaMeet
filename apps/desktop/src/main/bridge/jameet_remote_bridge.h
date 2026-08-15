#ifndef JAMEET_REMOTE_BRIDGE_H
#define JAMEET_REMOTE_BRIDGE_H

#include "jameet_remote_abi.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Maximum heartbeat age in milliseconds before a consumer considers the producer offline */
#define JAMEET_HEARTBEAT_TIMEOUT_MS 500U

/* Producer Context (Main Process Native Module) */
typedef struct JaMeetProducer {
    JaMeetSharedSegment* segment;
    uint64_t currentEpoch;
    uint64_t totalFramesWritten;
    uint32_t producerPid;
    bool isInitialized;
} JaMeetProducer;

/* Consumer Context (Core Audio HAL Driver / Test / DAW Consumer) */
typedef struct JaMeetConsumer {
    uint64_t lastObservedGeneration;
    uint64_t localReadFrame;
    bool isSynchronized;
    uint32_t underrunCount;
    uint32_t tornReadCount;
} JaMeetConsumer;

/* ========================================================================= */
/* Segment Lifecycle & Validation API                                        */
/* ========================================================================= */

/**
 * Validate complete segment geometry and ABI header fields.
 * Returns true if magic, version, sizes, sample rate, channels, slots, and capacity match exactly.
 */
bool JaMeetSegment_ValidateGeometry(const JaMeetSharedSegment* segment);

/**
 * Format a newly allocated or created shared memory segment for the first time.
 * Must only be called when creating a brand-new segment by an explicit owner.
 */
void JaMeetSegment_FormatFirstTime(JaMeetSharedSegment* segment, uint64_t initialEpoch, uint32_t pid);

/* ========================================================================= */
/* Producer API (Main Process / Audio Bridge Provider)                       */
/* ========================================================================= */

/**
 * Attach a producer to an existing valid shared segment.
 * 
 * Safety Guarantee:
 * - If the segment is valid and formatted, this DOES NOT memset or reconstruct the segment.
 *   It atomically updates producerPid and transitions to newEpoch, allowing existing mapped
 *   consumers to safely remain mapped without seeing memory wiped out from under them.
 * - If the segment has invalid geometry or is unformatted, it REJECTS attachment and returns false
 *   without reformatting or overwriting the segment.
 */
bool JaMeetProducer_Attach(JaMeetProducer* producer, JaMeetSharedSegment* segment, uint64_t newEpoch, uint32_t pid);

/**
 * Format and attach to a brand-new shared segment owned by the caller.
 */
bool JaMeetProducer_InitNew(JaMeetProducer* producer, JaMeetSharedSegment* segment, uint64_t initialEpoch, uint32_t pid);

/**
 * Legacy wrapper: initializes a new segment and attaches to it.
 */
void JaMeetProducer_Init(JaMeetProducer* producer, JaMeetSharedSegment* segment, uint64_t initialEpoch, uint32_t pid);

/**
 * Write interleaved stereo float audio frames to the shared bridge.
 * 
 * Guarantees:
 * - Seqlock in-progress odd/even publication guard with sequential consistency barrier on entry.
 * - Preserves partial slot prefixes across consecutive non-128 batch writes.
 * - Sanitizes partial slot remainders so stale PCM from previous generations can never leak.
 * 
 * @param producer Initialized producer instance.
 * @param interleavedStereoPcm Pointer to interleaved Float32 PCM (L/R pairs).
 * @param frameCount Number of stereo frames to write.
 * @param isVoiceActive Whether voice is actively transmitting (true) or silent/muted (false).
 * @param timestampMs Current monotonic time in milliseconds.
 * @return Number of frames written.
 */
uint32_t JaMeetProducer_WriteFrames(
    JaMeetProducer* producer,
    const float* interleavedStereoPcm,
    uint32_t frameCount,
    bool isVoiceActive,
    uint64_t timestampMs
);

/**
 * Update the heartbeat timestamp and active voice flag without writing audio frames.
 */
void JaMeetProducer_UpdateHeartbeat(JaMeetProducer* producer, uint64_t timestampMs, bool isVoiceActive);

/**
 * Force a new producer generation epoch (e.g. on session rejoin or bridge re-creation).
 */
void JaMeetProducer_ResetGeneration(JaMeetProducer* producer, uint64_t newEpoch);

/* ========================================================================= */
/* Consumer API (Real-Time Audio Callbacks / Drivers / Test Readers)          */
/* ========================================================================= */

/**
 * Initialize consumer context.
 */
void JaMeetConsumer_Init(JaMeetConsumer* consumer);

/**
 * Reset consumer synchronization state.
 */
void JaMeetConsumer_Reset(JaMeetConsumer* consumer);

/**
 * Read interleaved stereo float audio frames from the shared bridge.
 * 
 * Real-Time Guarantees:
 * - Strictly non-blocking and wait-free (suitable for real-time audio callbacks).
 * - Verified by Seqlock pre-read and post-read odd/even guards.
 * - Returns clean digital silence (0.0f) if an in-progress write or torn block is detected.
 * 
 * @param consumer Consumer context instance.
 * @param segment Shared memory segment pointer.
 * @param outInterleavedStereoPcm Output buffer to receive Float32 PCM (L/R pairs).
 * @param frameCount Number of stereo frames requested.
 * @param currentTimestampMs Current monotonic time in milliseconds.
 * @return Number of frames read.
 */
uint32_t JaMeetConsumer_ReadFrames(
    JaMeetConsumer* consumer,
    const JaMeetSharedSegment* segment,
    float* outInterleavedStereoPcm,
    uint32_t frameCount,
    uint64_t currentTimestampMs
);

/**
 * Check if the producer is alive and actively streaming voice audio.
 */
bool JaMeetConsumer_IsVoiceActive(
    const JaMeetConsumer* consumer,
    const JaMeetSharedSegment* segment,
    uint64_t currentTimestampMs
);

#ifdef __cplusplus
}
#endif

#endif /* JAMEET_REMOTE_BRIDGE_H */
