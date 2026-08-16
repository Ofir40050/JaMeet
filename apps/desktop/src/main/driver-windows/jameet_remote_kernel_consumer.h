#ifndef JAMEET_REMOTE_KERNEL_CONSUMER_H
#define JAMEET_REMOTE_KERNEL_CONSUMER_H

#include "../bridge/jameet_remote_abi.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct JaMeetKernelConsumer {
    uint64_t lastConsumerFrame;
    uint64_t lastObservedGeneration;
    bool initialized;
    bool active;
} JaMeetKernelConsumer;

/**
 * Initialize kernel consumer instance.
 */
void JaMeetKernelConsumer_Init(JaMeetKernelConsumer* consumer);

/**
 * Read Float32 stereo PCM frames from untrusted kernel shared segment.
 * Performs strict validation:
 * - ABI version and geometry verification
 * - Slot index bitmasking (& JAMEET_SLOT_MASK)
 * - Seqlock parity validation
 * - NaN / Inf float sanitization
 * - Inactivity and heartbeat timeout silence generation
 * 
 * @param consumer Kernel consumer state.
 * @param segment Mapped kernel shared segment pointer (untrusted).
 * @param outFloatPcm Output buffer for interleaved stereo Float32 PCM.
 * @param frameCount Number of stereo frames to read.
 * @param nowMs Current monotonic millisecond timestamp.
 * @return Number of frames read.
 */
uint32_t JaMeetKernelConsumer_ReadFloatFrames(
    JaMeetKernelConsumer* consumer,
    const JaMeetSharedSegment* segment,
    float* outFloatPcm,
    uint32_t frameCount,
    uint64_t nowMs
);

/**
 * Read Int16 stereo PCM frames from untrusted kernel shared segment,
 * converting validated Float32 audio with saturation clamping.
 */
uint32_t JaMeetKernelConsumer_ReadInt16Frames(
    JaMeetKernelConsumer* consumer,
    const JaMeetSharedSegment* segment,
    int16_t* outInt16Pcm,
    uint32_t frameCount,
    uint64_t nowMs
);

#ifdef __cplusplus
}
#endif

#endif /* JAMEET_REMOTE_KERNEL_CONSUMER_H */
