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
 * Must only be called when creating a brand-new segment.
 */
void JaMeetSegment_FormatFirstTime(JaMeetSharedSegment* segment, uint64_t initialEpoch, uint32_t pid);

/* ========================================================================= */
/* Producer API (Main Process / Audio Bridge Provider)                       */
/* ========================================================================= */

/**
 * Attach a producer to an existing or newly created shared segment.
 * 
 * Safety Guarantee:
 * - If the segment is already valid and formatted, this DOES NOT memset or reconstruct the segment.
 *   It atomically updates producerPid and transitions to newEpoch, allowing existing mapped
 *   consumers to safely remain mapped without seeing memory wiped out from under them.
 * - If the segment is unformatted, it formats the segment cleanly.
 */
bool JaMeetProducer_Attach(JaMeetProducer* producer, JaMeetSharedSegment* segment, uint64_t newEpoch, uint32_t pid);

/**
 * Legacy wrapper: formats and attaches to a segment.
 */
void JaMeetProducer_Init(JaMeetProducer* producer, JaMeetSharedSegment* segment, uint64_t initialEpoch, uint32_t pid);

/**
 * Write interleaved stereo float audio frames to the shared bridge.
 * 
 * Guarantees:
 * - Sanitizes partial slot remainders so stale PCM from previous generations can never leak.
 * - Lock-free seqlock publication per 128-frame slot.
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
 * Initialize an independent consumer instance.
 * Must be called before reading from any shared segment.
 */
void JaMeetConsumer_Init(JaMeetConsumer* consumer);

/**
 * Reset consumer synchronization state and read cursor.
 */
void JaMeetConsumer_Reset(JaMeetConsumer* consumer);

/**
 * Read interleaved stereo float audio frames from the shared bridge.
 * 
 * Real-Time Safety Guarantees:
 * - Zero allocations (malloc/free/new/delete).
 * - Zero mutexes or blocking synchronization.
 * - Zero filesystem or system calls.
 * - If inactive, underflowed, or torn read occurs, the affected frames are safely
 *   filled with 0.0f (digital silence) without waiting.
 * 
 * @param consumer Independent consumer state tracker.
 * @param segment Read-only pointer to mapped shared segment.
 * @param outInterleavedStereoPcm Destination buffer for stereo Float32 PCM.
 * @param frameCount Number of stereo frames requested by the audio callback.
 * @param currentTimestampMs Current monotonic time in milliseconds.
 * @return Number of frames returned (equal to frameCount).
 */
uint32_t JaMeetConsumer_ReadFrames(
    JaMeetConsumer* consumer,
    const JaMeetSharedSegment* segment,
    float* outInterleavedStereoPcm,
    uint32_t frameCount,
    uint64_t currentTimestampMs
);

/**
 * Check if the producer is alive, voice is active, and heartbeat is fresh.
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
