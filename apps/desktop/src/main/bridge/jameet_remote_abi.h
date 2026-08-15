#ifndef JAMEET_REMOTE_ABI_H
#define JAMEET_REMOTE_ABI_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

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
 * Single audio slot within the circular buffer (1088 bytes, 64-byte aligned).
 * 
 * Uses explicit fixed-width fields with seqlock publication:
 * - seq is odd while producer is modifying the slot.
 * - seq is even when the slot is committed and safe to read.
 * - Consumer reads seq before and after copying; if seq changed, odd, or mismatched,
 *   the slot was torn/overwritten and the consumer safely outputs digital silence.
 */
typedef struct JAMEET_ALIGNED(64) JaMeetAudioSlot {
    /* Offset 0x00 (0): Seqlock publication sequence (odd = writing, even = committed) */
    uint64_t seq;

    /* Offset 0x08 (8): Stream epoch/generation when this slot was written */
    uint64_t producerGeneration;

    /* Offset 0x10 (16): Absolute monotonic frame index of sample 0 in this slot */
    uint64_t slotStartFrame;

    /* Offset 0x18 (24): Sample rate (48000) */
    uint32_t sampleRate;

    /* Offset 0x1C (28): Channels (2) */
    uint16_t channels;

    /* Offset 0x1E (30): Number of valid frames in this slot (1..128) */
    uint16_t validFrames;

    /* Offset 0x20 (32): Slot flags (JAMEET_SLOT_FLAG_*) */
    uint32_t flags;

    /* Offset 0x24 (36): Reserved padding */
    uint32_t reserved;

    /* Offset 0x28 (40): Explicit padding to align pcmData to offset 0x40 (64) */
    uint8_t headerPadding[24];

    /* Offset 0x40 (64): Interleaved Stereo 32-bit Float PCM [256 floats = 1024 bytes] */
    float pcmData[JAMEET_SLOT_SAMPLES];
} JaMeetAudioSlot;

/**
 * Shared segment header containing global stream metadata, epoch tracking,
 * producer state, and geometry validation (128 bytes, 64-byte aligned).
 */
typedef struct JAMEET_ALIGNED(64) JaMeetSharedHeader {
    /* Offset 0x00 (0): 0x4A4D5254 ('JMRT') */
    uint32_t magic;

    /* Offset 0x04 (4): ABI version (1) */
    uint32_t abiVersion;

    /* Offset 0x08 (8): sizeof(JaMeetSharedHeader) = 128 */
    uint32_t headerSizeBytes;

    /* Offset 0x0C (12): sizeof(JaMeetSharedSegment) = 139392 */
    uint32_t totalSizeBytes;

    /* Offset 0x10 (16): 48000 */
    uint32_t sampleRate;

    /* Offset 0x14 (20): 2 */
    uint16_t channels;

    /* Offset 0x16 (22): 128 */
    uint16_t slotCount;

    /* Offset 0x18 (24): 128 */
    uint32_t framesPerSlot;

    /* Offset 0x1C (28): 16384 */
    uint32_t totalCapacityFrames;

    /* Offset 0x20 (32): Unique stream generation / epoch ID */
    uint64_t producerGeneration;

    /* Offset 0x28 (40): Total monotonic frames produced */
    uint64_t writeSequence;

    /* Offset 0x30 (48): Monotonic millisecond timestamp */
    uint64_t heartbeatMs;

    /* Offset 0x38 (56): 1 = Voice actively streaming, 0 = Inactive / Silence */
    uint32_t isVoiceActive;

    /* Offset 0x3C (60): OS Process ID of active producer */
    uint32_t producerPid;

    /* Offset 0x40 (64): Reserved padding for future ABI extensions */
    uint8_t reserved[64];
} JaMeetSharedHeader;

/**
 * Complete fixed-layout shared memory segment (139,392 bytes, 64-byte aligned).
 */
typedef struct JAMEET_ALIGNED(64) JaMeetSharedSegment {
    /* Offset 0x00000 (0): Segment Header (128 bytes) */
    JaMeetSharedHeader header;

    /* Offset 0x00080 (128): Slot Array [128 slots * 1088 bytes = 139,264 bytes] */
    JaMeetAudioSlot slots[JAMEET_SLOT_COUNT];
} JaMeetSharedSegment;

/* ========================================================================= */
/* Explicit Compile-Time ABI Size and Offset Assertions                      */
/* ========================================================================= */

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L && !defined(__cplusplus)
/* JaMeetSharedHeader Assertions */
_Static_assert(sizeof(JaMeetSharedHeader) == 128, "JaMeetSharedHeader size must be exactly 128 bytes");
_Static_assert(offsetof(JaMeetSharedHeader, magic) == 0, "magic offset must be 0");
_Static_assert(offsetof(JaMeetSharedHeader, abiVersion) == 4, "abiVersion offset must be 4");
_Static_assert(offsetof(JaMeetSharedHeader, headerSizeBytes) == 8, "headerSizeBytes offset must be 8");
_Static_assert(offsetof(JaMeetSharedHeader, totalSizeBytes) == 12, "totalSizeBytes offset must be 12");
_Static_assert(offsetof(JaMeetSharedHeader, sampleRate) == 16, "sampleRate offset must be 16");
_Static_assert(offsetof(JaMeetSharedHeader, channels) == 20, "channels offset must be 20");
_Static_assert(offsetof(JaMeetSharedHeader, slotCount) == 22, "slotCount offset must be 22");
_Static_assert(offsetof(JaMeetSharedHeader, framesPerSlot) == 24, "framesPerSlot offset must be 24");
_Static_assert(offsetof(JaMeetSharedHeader, totalCapacityFrames) == 28, "totalCapacityFrames offset must be 28");
_Static_assert(offsetof(JaMeetSharedHeader, producerGeneration) == 32, "producerGeneration offset must be 32");
_Static_assert(offsetof(JaMeetSharedHeader, writeSequence) == 40, "writeSequence offset must be 40");
_Static_assert(offsetof(JaMeetSharedHeader, heartbeatMs) == 48, "heartbeatMs offset must be 48");
_Static_assert(offsetof(JaMeetSharedHeader, isVoiceActive) == 56, "isVoiceActive offset must be 56");
_Static_assert(offsetof(JaMeetSharedHeader, producerPid) == 60, "producerPid offset must be 60");

/* JaMeetAudioSlot Assertions */
_Static_assert(sizeof(JaMeetAudioSlot) == 1088, "JaMeetAudioSlot size must be exactly 1088 bytes");
_Static_assert(offsetof(JaMeetAudioSlot, seq) == 0, "seq offset must be 0");
_Static_assert(offsetof(JaMeetAudioSlot, producerGeneration) == 8, "producerGeneration offset must be 8");
_Static_assert(offsetof(JaMeetAudioSlot, slotStartFrame) == 16, "slotStartFrame offset must be 16");
_Static_assert(offsetof(JaMeetAudioSlot, sampleRate) == 24, "sampleRate offset must be 24");
_Static_assert(offsetof(JaMeetAudioSlot, channels) == 28, "channels offset must be 28");
_Static_assert(offsetof(JaMeetAudioSlot, validFrames) == 30, "validFrames offset must be 30");
_Static_assert(offsetof(JaMeetAudioSlot, flags) == 32, "flags offset must be 32");
_Static_assert(offsetof(JaMeetAudioSlot, pcmData) == 64, "pcmData offset must be 64");

/* JaMeetSharedSegment Assertions */
_Static_assert(sizeof(JaMeetSharedSegment) == 139392, "JaMeetSharedSegment size must be exactly 139,392 bytes");
_Static_assert(offsetof(JaMeetSharedSegment, slots) == 128, "slots offset must be 128");

#elif defined(__cplusplus)
static_assert(sizeof(JaMeetSharedHeader) == 128, "JaMeetSharedHeader size must be exactly 128 bytes");
static_assert(offsetof(JaMeetSharedHeader, magic) == 0, "magic offset must be 0");
static_assert(offsetof(JaMeetSharedHeader, abiVersion) == 4, "abiVersion offset must be 4");
static_assert(offsetof(JaMeetSharedHeader, headerSizeBytes) == 8, "headerSizeBytes offset must be 8");
static_assert(offsetof(JaMeetSharedHeader, totalSizeBytes) == 12, "totalSizeBytes offset must be 12");
static_assert(offsetof(JaMeetSharedHeader, sampleRate) == 16, "sampleRate offset must be 16");
static_assert(offsetof(JaMeetSharedHeader, channels) == 20, "channels offset must be 20");
static_assert(offsetof(JaMeetSharedHeader, slotCount) == 22, "slotCount offset must be 22");
static_assert(offsetof(JaMeetSharedHeader, framesPerSlot) == 24, "framesPerSlot offset must be 24");
static_assert(offsetof(JaMeetSharedHeader, totalCapacityFrames) == 28, "totalCapacityFrames offset must be 28");
static_assert(offsetof(JaMeetSharedHeader, producerGeneration) == 32, "producerGeneration offset must be 32");
static_assert(offsetof(JaMeetSharedHeader, writeSequence) == 40, "writeSequence offset must be 40");
static_assert(offsetof(JaMeetSharedHeader, heartbeatMs) == 48, "heartbeatMs offset must be 48");
static_assert(offsetof(JaMeetSharedHeader, isVoiceActive) == 56, "isVoiceActive offset must be 56");
static_assert(offsetof(JaMeetSharedHeader, producerPid) == 60, "producerPid offset must be 60");

static_assert(sizeof(JaMeetAudioSlot) == 1088, "JaMeetAudioSlot size must be exactly 1088 bytes");
static_assert(offsetof(JaMeetAudioSlot, seq) == 0, "seq offset must be 0");
static_assert(offsetof(JaMeetAudioSlot, producerGeneration) == 8, "producerGeneration offset must be 8");
static_assert(offsetof(JaMeetAudioSlot, slotStartFrame) == 16, "slotStartFrame offset must be 16");
static_assert(offsetof(JaMeetAudioSlot, sampleRate) == 24, "sampleRate offset must be 24");
static_assert(offsetof(JaMeetAudioSlot, channels) == 28, "channels offset must be 28");
static_assert(offsetof(JaMeetAudioSlot, validFrames) == 30, "validFrames offset must be 30");
static_assert(offsetof(JaMeetAudioSlot, flags) == 32, "flags offset must be 32");
static_assert(offsetof(JaMeetAudioSlot, pcmData) == 64, "pcmData offset must be 64");

static_assert(sizeof(JaMeetSharedSegment) == 139392, "JaMeetSharedSegment size must be exactly 139,392 bytes");
static_assert(offsetof(JaMeetSharedSegment, slots) == 128, "slots offset must be 128");
#endif

#ifdef __cplusplus
}
#endif

#endif /* JAMEET_REMOTE_ABI_H */
