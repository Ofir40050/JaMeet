#ifndef JAMEET_REMOTE_ABI_H
#define JAMEET_REMOTE_ABI_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

#if defined(__cplusplus)
#include <atomic>
#define JAMEET_ATOMIC(type) std::atomic<type>
#else
#include <stdatomic.h>
#define JAMEET_ATOMIC(type) _Atomic type
#endif

#if defined(_MSC_VER)
#define JAMEET_ALIGNED(n) __declspec(align(n))
#elif defined(__GNUC__) || defined(__clang__)
#define JAMEET_ALIGNED(n) __attribute__((aligned(n)))
#else
#define JAMEET_ALIGNED(n)
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* Magic identifier: 'JMRT' (0x4A4D5254) */
#define JAMEET_SHM_MAGIC            0x4A4D5254U
#define JAMEET_ABI_VERSION          1U

/* Audio format specifications */
#define JAMEET_SAMPLE_RATE          48000U
#define JAMEET_CHANNELS             2U
#define JAMEET_SLOT_FRAMES          128U
#define JAMEET_SLOT_COUNT           128U
#define JAMEET_SLOT_MASK            (JAMEET_SLOT_COUNT - 1U)
#define JAMEET_TOTAL_FRAMES         (JAMEET_SLOT_COUNT * JAMEET_SLOT_FRAMES) /* 16,384 frames (~341.3 ms) */
#define JAMEET_SLOT_SAMPLES         (JAMEET_SLOT_FRAMES * JAMEET_CHANNELS)   /* 256 Float32 samples per slot */

/* Default transport object identifier for POSIX Shared Memory */
#define JAMEET_DEFAULT_SHM_NAME     "/jameet_remote_voice_v1"

/* Slot flags */
#define JAMEET_SLOT_FLAG_NONE       0x00000000U
#define JAMEET_SLOT_FLAG_VOICE_ON   0x00000001U
#define JAMEET_SLOT_FLAG_DISCONT    0x00000002U

/**
 * Single audio slot within the circular buffer.
 * 
 * Uses a seqlock pattern for wait-free, lock-free publication:
 * - seq is odd while producer is modifying the slot.
 * - seq is even when the slot is committed and safe to read.
 * - Consumer reads seq before and after copying; if seq changed, odd, or mismatched,
 *   the slot was torn/overwritten and the consumer safely outputs digital silence.
 */
typedef struct JAMEET_ALIGNED(64) JaMeetAudioSlot {
    /* Seqlock publication sequence (odd = writing, even = committed) */
    JAMEET_ATOMIC(uint64_t) seq;

    /* Slot metadata */
    uint64_t producerGeneration;  /* Stream epoch/generation when this slot was written */
    uint64_t slotStartFrame;      /* Absolute monotonic frame index of sample 0 in this slot */
    uint32_t sampleRate;          /* 48000 */
    uint16_t channels;            /* 2 */
    uint16_t validFrames;         /* Number of valid frames in this slot (normally 128) */
    uint32_t flags;               /* JAMEET_SLOT_FLAG_* */
    uint32_t reserved;            /* Padding / future use */

    /* Interleaved Stereo 32-bit Float PCM: [L0, R0, L1, R1, ..., L127, R127] */
    float pcmData[JAMEET_SLOT_SAMPLES];
} JaMeetAudioSlot;

/**
 * Shared segment header containing global stream metadata, epoch tracking,
 * producer state, and geometry validation.
 */
typedef struct JAMEET_ALIGNED(64) JaMeetSharedHeader {
    uint32_t magic;                      /* 0x4A4D5254 ('JMRT') */
    uint32_t abiVersion;                 /* 1 */
    uint32_t headerSizeBytes;            /* sizeof(JaMeetSharedHeader) */
    uint32_t totalSizeBytes;             /* Total size of shared segment */

    uint32_t sampleRate;                 /* 48000 */
    uint16_t channels;                   /* 2 */
    uint16_t slotCount;                  /* 128 */
    uint32_t framesPerSlot;              /* 128 */
    uint32_t totalCapacityFrames;        /* 16384 */

    /* Monotonic Lifecycle & Generation Tracking */
    JAMEET_ATOMIC(uint64_t) producerGeneration; /* Unique stream generation / epoch ID */
    JAMEET_ATOMIC(uint64_t) writeSequence;      /* Total monotonic frames produced */
    JAMEET_ATOMIC(uint64_t) heartbeatMs;        /* Monotonic millisecond timestamp */
    JAMEET_ATOMIC(uint32_t) isVoiceActive;      /* 1 = Voice actively streaming, 0 = Inactive / Silence */
    JAMEET_ATOMIC(uint32_t) producerPid;        /* OS Process ID of active producer */

    uint8_t reserved[64];                       /* Reserved padding for future ABI extensions */
} JaMeetSharedHeader;

/**
 * Complete fixed-layout shared memory segment.
 */
typedef struct JAMEET_ALIGNED(64) JaMeetSharedSegment {
    JaMeetSharedHeader header;
    JaMeetAudioSlot slots[JAMEET_SLOT_COUNT];
} JaMeetSharedSegment;

/* Compile-time Layout & Alignment Assertions */
#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L && !defined(__cplusplus)
_Static_assert(sizeof(JaMeetAudioSlot) % 64 == 0, "JaMeetAudioSlot must be 64-byte aligned");
_Static_assert(sizeof(JaMeetSharedHeader) % 64 == 0, "JaMeetSharedHeader must be 64-byte aligned");
_Static_assert(sizeof(JaMeetSharedSegment) == sizeof(JaMeetSharedHeader) + (JAMEET_SLOT_COUNT * sizeof(JaMeetAudioSlot)), "JaMeetSharedSegment size mismatch");
#elif defined(__cplusplus)
static_assert(sizeof(JaMeetAudioSlot) % 64 == 0, "JaMeetAudioSlot must be 64-byte aligned");
static_assert(sizeof(JaMeetSharedHeader) % 64 == 0, "JaMeetSharedHeader must be 64-byte aligned");
static_assert(sizeof(JaMeetSharedSegment) == sizeof(JaMeetSharedHeader) + (JAMEET_SLOT_COUNT * sizeof(JaMeetAudioSlot)), "JaMeetSharedSegment size mismatch");
#endif

#ifdef __cplusplus
}
#endif

#endif /* JAMEET_REMOTE_ABI_H */
