#include "jameet_remote_abi.h"
#include "jameet_remote_bridge.h"
#include "jameet_remote_transport.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include <math.h>
#include <pthread.h>
#include <unistd.h>
#include <stdatomic.h>

#define TEST_PASS() printf("  [PASS] %s\n", __func__)

/* ========================================================================= */
/* Test 1: ABI Layout, Sizes, and Numeric Offsets                           */
/* ========================================================================= */
static void test_abi_layout(void) {
    /* Exact Byte Sizes */
    assert(sizeof(JaMeetSharedHeader) == 128);
    assert(sizeof(JaMeetAudioSlot) == 1088);
    assert(sizeof(JaMeetSharedSegment) == 139392);

    /* 64-Byte Alignment */
    assert(sizeof(JaMeetSharedHeader) % 64 == 0);
    assert(sizeof(JaMeetAudioSlot) % 64 == 0);
    assert(sizeof(JaMeetSharedSegment) % 64 == 0);

    /* JaMeetSharedHeader Numeric Offsets */
    assert(offsetof(JaMeetSharedHeader, magic) == 0);
    assert(offsetof(JaMeetSharedHeader, abiVersion) == 4);
    assert(offsetof(JaMeetSharedHeader, headerSizeBytes) == 8);
    assert(offsetof(JaMeetSharedHeader, totalSizeBytes) == 12);
    assert(offsetof(JaMeetSharedHeader, sampleRate) == 16);
    assert(offsetof(JaMeetSharedHeader, channels) == 20);
    assert(offsetof(JaMeetSharedHeader, slotCount) == 22);
    assert(offsetof(JaMeetSharedHeader, framesPerSlot) == 24);
    assert(offsetof(JaMeetSharedHeader, totalCapacityFrames) == 28);
    assert(offsetof(JaMeetSharedHeader, producerGeneration) == 32);
    assert(offsetof(JaMeetSharedHeader, writeSequence) == 40);
    assert(offsetof(JaMeetSharedHeader, heartbeatMs) == 48);
    assert(offsetof(JaMeetSharedHeader, isVoiceActive) == 56);
    assert(offsetof(JaMeetSharedHeader, producerPid) == 60);

    /* JaMeetAudioSlot Numeric Offsets */
    assert(offsetof(JaMeetAudioSlot, publishSequence) == 0);
    assert(offsetof(JaMeetAudioSlot, producerGeneration) == 8);
    assert(offsetof(JaMeetAudioSlot, slotStartFrame) == 16);
    assert(offsetof(JaMeetAudioSlot, sampleRate) == 24);
    assert(offsetof(JaMeetAudioSlot, channels) == 28);
    assert(offsetof(JaMeetAudioSlot, validFrames) == 32);
    assert(offsetof(JaMeetAudioSlot, flags) == 36);
    assert(offsetof(JaMeetAudioSlot, reserved) == 40);
    assert(offsetof(JaMeetAudioSlot, pcmBits) == 64);

    /* JaMeetSharedSegment Offset */
    assert(offsetof(JaMeetSharedSegment, slots) == 128);

    /* Format Constants */
    assert(JAMEET_SHM_MAGIC == 0x4A4D5254U);
    assert(JAMEET_ABI_VERSION == 1U);
    assert(JAMEET_SAMPLE_RATE == 48000U);
    assert(JAMEET_CHANNELS == 2U);
    assert(JAMEET_SLOT_FRAMES == 128U);
    assert(JAMEET_SLOT_COUNT == 128U);
    assert(JAMEET_TOTAL_FRAMES == 16384U);

    TEST_PASS();
}

/* ========================================================================= */
/* Test 2: In-Memory Bridge Initialization & Basic Frame Read/Write          */
/* ========================================================================= */
static void test_basic_read_write(void) {
    JaMeetTransport* transport = JaMeetTransport_CreateMemory();
    assert(transport != NULL);
    JaMeetSharedSegment* segment = JaMeetTransport_GetSegment(transport);
    assert(segment != NULL);

    JaMeetProducer producer;
    JaMeetProducer_Init(&producer, segment, 1001ULL, 9999);

    JaMeetConsumer consumer;
    JaMeetConsumer_Init(&consumer);

    float writeBuf[128 * 2];
    for (int i = 0; i < 128; i++) {
        writeBuf[i * 2 + 0] = (float)i * 0.01f;
        writeBuf[i * 2 + 1] = -(float)i * 0.01f;
    }

    uint32_t written = JaMeetProducer_WriteFrames(&producer, writeBuf, 128, true, 100);
    assert(written == 128);

    float readBuf[128 * 2];
    memset(readBuf, 0xFF, sizeof(readBuf));

    uint32_t read = JaMeetConsumer_ReadFrames(&consumer, segment, readBuf, 128, 100);
    assert(read == 128);

    for (int i = 0; i < 128; i++) {
        assert(fabsf(readBuf[i * 2 + 0] - writeBuf[i * 2 + 0]) < 1e-6f);
        assert(fabsf(readBuf[i * 2 + 1] - writeBuf[i * 2 + 1]) < 1e-6f);
    }

    JaMeetTransport_Close(transport, false);
    TEST_PASS();
}

/* ========================================================================= */
/* Test 3: Seqlock In-Progress Publication Guard (Odd/Even Sequence)        */
/* ========================================================================= */
static void test_seqlock_in_progress_guard(void) {
    JaMeetTransport* transport = JaMeetTransport_CreateMemory();
    JaMeetSharedSegment* segment = JaMeetTransport_GetSegment(transport);

    JaMeetProducer producer;
    JaMeetProducer_Init(&producer, segment, 3001ULL, 5555);

    JaMeetConsumer consumer;
    JaMeetConsumer_Init(&consumer);

    float writeBuf[128 * 2];
    for (int i = 0; i < 128 * 2; i++) writeBuf[i] = 1.0f;
    JaMeetProducer_WriteFrames(&producer, writeBuf, 128, true, 100);

    /* Case A: Simulate in-progress write on slot 0 by setting publishSequence to an ODD value (1) */
    segment->slots[0].publishSequence = 1ULL;

    float readBuf[128 * 2];
    for (int i = 0; i < 128 * 2; i++) readBuf[i] = 99.0f;

    JaMeetConsumer_ReadFrames(&consumer, segment, readBuf, 128, 100);

    /* Must output clean silence (0.0f) and increment torn read count */
    for (int i = 0; i < 128 * 2; i++) {
        assert(readBuf[i] == 0.0f);
    }
    assert(consumer.tornReadCount > 0);

    /* Case B: Restore slot to valid EVEN sequence value (2), read again */
    segment->slots[0].publishSequence = 2ULL;
    JaMeetConsumer_Init(&consumer);
    for (int i = 0; i < 128 * 2; i++) readBuf[i] = 99.0f;
    JaMeetConsumer_ReadFrames(&consumer, segment, readBuf, 128, 100);

    for (int i = 0; i < 128 * 2; i++) {
        assert(readBuf[i] == 1.0f);
    }

    JaMeetTransport_Close(transport, false);
    TEST_PASS();
}

/* ========================================================================= */
/* Test 4: Consecutive Non-128 Writes and Delayed Consumer Continuity        */
/* ========================================================================= */
static void test_consecutive_non128_writes_and_delayed_consumer(void) {
    JaMeetTransport* transport = JaMeetTransport_CreateMemory();
    JaMeetSharedSegment* segment = JaMeetTransport_GetSegment(transport);

    JaMeetProducer producer;
    JaMeetProducer_Init(&producer, segment, 2001ULL, 1234);

    /* 
     * Write 1: 480 frames (frames 0 .. 479)
     * Spans Slot 0, Slot 1, Slot 2, and partial Slot 3 (96 frames).
     */
    float pcm1[480 * 2];
    for (uint32_t i = 0; i < 480; i++) {
        pcm1[i * 2 + 0] = (float)(i + 1);
        pcm1[i * 2 + 1] = (float)(i + 1) * 10.0f;
    }
    JaMeetProducer_WriteFrames(&producer, pcm1, 480, true, 500);

    /*
     * Write 2: 480 frames (frames 480 .. 959)
     * Completes Slot 3 (32 frames) and continues across Slot 4, 5, 6, 7.
     */
    float pcm2[480 * 2];
    for (uint32_t i = 0; i < 480; i++) {
        pcm2[i * 2 + 0] = (float)(480 + i + 1);
        pcm2[i * 2 + 1] = (float)(480 + i + 1) * 10.0f;
    }
    JaMeetProducer_WriteFrames(&producer, pcm2, 480, true, 510);

    /*
     * Delayed Consumer:
     * Starts reading AFTER both batches are completely written (total 960 frames).
     * Must read all 960 frames with exact continuity and zero dropped/erased frames in Slot 3!
     */
    JaMeetConsumer consumer;
    JaMeetConsumer_Init(&consumer);
    consumer.lastObservedGeneration = 2001ULL;
    consumer.localReadFrame = 0;
    consumer.isSynchronized = true;

    uint32_t requestSizes[] = { 64, 128, 256, 32, 128, 256, 96 };
    uint32_t totalExpected = 960;
    uint32_t framesReadTotal = 0;

    for (int step = 0; step < 7; step++) {
        uint32_t req = requestSizes[step];
        float readBuf[512 * 2];
        memset(readBuf, 0, sizeof(readBuf));

        uint32_t read = JaMeetConsumer_ReadFrames(&consumer, segment, readBuf, req, 510);
        assert(read == req);

        for (uint32_t f = 0; f < req; f++) {
            float expectedL = (float)(framesReadTotal + f + 1);
            float expectedR = expectedL * 10.0f;
            assert(fabsf(readBuf[f * 2 + 0] - expectedL) < 1e-5f);
            assert(fabsf(readBuf[f * 2 + 1] - expectedR) < 1e-5f);
        }
        framesReadTotal += req;
    }
    assert(framesReadTotal == totalExpected);

    /* Also verify consecutive 960-frame writes (960 + 960 = 1920 frames) */
    JaMeetProducer_ResetGeneration(&producer, 2002ULL);
    for (int iter = 0; iter < 2; iter++) {
        float pcm960[960 * 2];
        for (uint32_t i = 0; i < 960; i++) {
            pcm960[i * 2 + 0] = (float)(iter * 960 + i + 1);
            pcm960[i * 2 + 1] = (float)(iter * 960 + i + 1) * 2.0f;
        }
        JaMeetProducer_WriteFrames(&producer, pcm960, 960, true, 600 + iter * 20);
    }

    JaMeetConsumer_Init(&consumer);
    consumer.lastObservedGeneration = 2002ULL;
    consumer.localReadFrame = 0;
    consumer.isSynchronized = true;

    for (uint32_t f = 0; f < 1920; f += 128) {
        float readBuf[128 * 2];
        JaMeetConsumer_ReadFrames(&consumer, segment, readBuf, 128, 650);
        for (uint32_t i = 0; i < 128; i++) {
            float expL = (float)(f + i + 1);
            float expR = expL * 2.0f;
            assert(fabsf(readBuf[i * 2 + 0] - expL) < 1e-5f);
            assert(fabsf(readBuf[i * 2 + 1] - expR) < 1e-5f);
        }
    }

    JaMeetTransport_Close(transport, false);
    TEST_PASS();
}

/* ========================================================================= */
/* Test 5: Generation Epoch Resync & Partial Slot Sanitization                */
/* ========================================================================= */
static void test_generation_epoch_resync_and_sanitization(void) {
    JaMeetTransport* transport = JaMeetTransport_CreateMemory();
    JaMeetSharedSegment* segment = JaMeetTransport_GetSegment(transport);

    JaMeetProducer producer;
    JaMeetProducer_Init(&producer, segment, 100ULL, 1111);

    JaMeetConsumer consumer;
    JaMeetConsumer_Init(&consumer);

    /* Epoch 100: write partial slot (60 frames) with identifiable data (1.0f) */
    float data1[60 * 2];
    for (int i = 0; i < 60 * 2; i++) data1[i] = 1.0f;
    JaMeetProducer_WriteFrames(&producer, data1, 60, true, 100);

    /* Verify remainder of slot 0 was sanitized with zeros */
    for (int i = 60 * 2; i < 128 * 2; i++) {
        assert(segment->slots[0].pcmBits[i] == 0U);
    }

    /* Producer transitions to epoch 200 via JaMeetProducer_ResetGeneration */
    JaMeetProducer_ResetGeneration(&producer, 200ULL);

    /* Write partial slot in epoch 200 (40 frames with 2.0f) */
    float data2[40 * 2];
    for (int i = 0; i < 40 * 2; i++) data2[i] = 2.0f;
    JaMeetProducer_WriteFrames(&producer, data2, 40, true, 200);

    /* Consumer reads 128 frames: must get 40 frames of 2.0f and 88 frames of 0.0f silence */
    float readBuf[128 * 2];
    JaMeetConsumer_ReadFrames(&consumer, segment, readBuf, 128, 200);
    assert(consumer.lastObservedGeneration == 200ULL);
    for (int i = 0; i < 40 * 2; i++) {
        assert(readBuf[i] == 2.0f);
    }
    for (int i = 40 * 2; i < 128 * 2; i++) {
        assert(readBuf[i] == 0.0f);
    }

    JaMeetTransport_Close(transport, false);
    TEST_PASS();
}

/* ========================================================================= */
/* Test 6: Producer Reattachment Without Memset                              */
/* ========================================================================= */
static void test_producer_reattachment_without_memset(void) {
    JaMeetTransport* transport = JaMeetTransport_CreateMemory();
    JaMeetSharedSegment* segment = JaMeetTransport_GetSegment(transport);

    /* Format segment first time */
    JaMeetSegment_FormatFirstTime(segment, 500ULL, 1234);

    /* Consumer maps segment */
    JaMeetConsumer consumer;
    JaMeetConsumer_Init(&consumer);

    /* Producer 1 writes 128 frames */
    JaMeetProducer producer1;
    JaMeetProducer_Attach(&producer1, segment, 500ULL, 1234);
    float pcm[128 * 2];
    for (int i = 0; i < 128 * 2; i++) pcm[i] = 5.0f;
    JaMeetProducer_WriteFrames(&producer1, pcm, 128, true, 1000);

    /* Consumer reads 128 frames */
    float readBuf[128 * 2];
    JaMeetConsumer_ReadFrames(&consumer, segment, readBuf, 128, 1000);
    assert(readBuf[0] == 5.0f);

    /* Producer restarts and attaches as Producer 2 with epoch 600 */
    JaMeetProducer producer2;
    bool attached = JaMeetProducer_Attach(&producer2, segment, 600ULL, 5678);
    assert(attached == true);
    assert(segment->header.producerPid == 5678);
    assert(segment->header.producerGeneration == 600ULL);

    /* Consumer is still mapped; reading without new frames should safely return silence */
    JaMeetConsumer_ReadFrames(&consumer, segment, readBuf, 128, 1001);
    for (int i = 0; i < 128 * 2; i++) {
        assert(readBuf[i] == 0.0f);
    }
    assert(consumer.lastObservedGeneration == 600ULL);

    /* Producer 2 writes new frames */
    for (int i = 0; i < 128 * 2; i++) pcm[i] = 6.0f;
    JaMeetProducer_WriteFrames(&producer2, pcm, 128, true, 1002);

    JaMeetConsumer_ReadFrames(&consumer, segment, readBuf, 128, 1002);
    assert(readBuf[0] == 6.0f);

    JaMeetTransport_Close(transport, false);
    TEST_PASS();
}

/* ========================================================================= */
/* Test 7: Inactivity & Heartbeat Expiration                                 */
/* ========================================================================= */
static void test_inactivity_and_heartbeat(void) {
    JaMeetTransport* transport = JaMeetTransport_CreateMemory();
    JaMeetSharedSegment* segment = JaMeetTransport_GetSegment(transport);

    JaMeetProducer producer;
    JaMeetProducer_Init(&producer, segment, 500ULL, 2222);

    JaMeetConsumer consumer;
    JaMeetConsumer_Init(&consumer);

    float writeBuf[128 * 2];
    for (int i = 0; i < 128 * 2; i++) writeBuf[i] = 5.0f;

    /* Write with isVoiceActive = false */
    JaMeetProducer_WriteFrames(&producer, writeBuf, 128, false, 1000);

    float readBuf[128 * 2];
    for (int i = 0; i < 128 * 2; i++) readBuf[i] = 99.0f;
    JaMeetConsumer_ReadFrames(&consumer, segment, readBuf, 128, 1000);

    /* Must be 0.0f silence */
    for (int i = 0; i < 128 * 2; i++) {
        assert(readBuf[i] == 0.0f);
    }

    /* Write active voice, then let heartbeat expire (> 500 ms) */
    JaMeetProducer_WriteFrames(&producer, writeBuf, 128, true, 1000);
    assert(JaMeetConsumer_IsVoiceActive(&consumer, segment, 1000) == true);

    /* Timestamp is now 1600 (600 ms later) */
    assert(JaMeetConsumer_IsVoiceActive(&consumer, segment, 1600) == false);

    for (int i = 0; i < 128 * 2; i++) readBuf[i] = 99.0f;
    JaMeetConsumer_ReadFrames(&consumer, segment, readBuf, 128, 1600);
    for (int i = 0; i < 128 * 2; i++) {
        assert(readBuf[i] == 0.0f);
    }

    JaMeetTransport_Close(transport, false);
    TEST_PASS();
}

/* ========================================================================= */
/* Test 8: Multi-Consumer Concurrent Stress Test with Strict Continuity      */
/* ========================================================================= */
typedef struct {
    JaMeetSharedSegment* segment;
    _Atomic bool stop;
    _Atomic uint32_t totalSamplesVerified;
} MultiThreadContext;

static void* consumer_worker(void* arg) {
    MultiThreadContext* ctx = (MultiThreadContext*)arg;
    JaMeetConsumer consumer;
    JaMeetConsumer_Init(&consumer);

    float localBuf[1024 * 2];
    uint32_t requestSizes[] = { 32, 64, 128, 256, 512, 1024 };
    int reqIdx = 0;

    while (!atomic_load_explicit(&ctx->stop, memory_order_acquire)) {
        uint32_t req = requestSizes[reqIdx % 6];
        reqIdx++;
        JaMeetConsumer_ReadFrames(&consumer, ctx->segment, localBuf, req, 1000);

        /* 
         * Verify strict payload consistency:
         * Samples must be either:
         * - Digital silence (0.0f)
         * - OR strictly continuous sequential values (sample[i+1] == sample[i] + 1)
         * Must never contain NaNs, stale corrupted values, or duplicated frames.
         */
        float prevVal = -1.0f;
        for (uint32_t i = 0; i < req; i++) {
            float l = localBuf[i * 2 + 0];
            float r = localBuf[i * 2 + 1];
            assert(!isnan(l) && !isinf(l));
            assert(!isnan(r) && !isinf(r));

            if (l != 0.0f || r != 0.0f) {
                assert(fabsf(r - (l * 2.0f)) < 1e-4f);
                if (prevVal >= 0.0f) {
                    /* Check monotonic continuity within active block */
                    assert(fabsf(l - (prevVal + 1.0f)) < 1e-4f);
                }
                prevVal = l;
            } else {
                prevVal = -1.0f;
            }
        }
        atomic_fetch_add_explicit(&ctx->totalSamplesVerified, req, memory_order_relaxed);
        usleep(100); /* 0.1 ms */
    }
    return NULL;
}

static void test_multithreaded_concurrency(void) {
    JaMeetTransport* transport = JaMeetTransport_CreateMemory();
    JaMeetSharedSegment* segment = JaMeetTransport_GetSegment(transport);

    JaMeetProducer producer;
    JaMeetProducer_Init(&producer, segment, 777ULL, 3333);

    MultiThreadContext ctx;
    ctx.segment = segment;
    atomic_init(&ctx.stop, false);
    atomic_init(&ctx.totalSamplesVerified, 0);

    pthread_t threads[4];
    for (int i = 0; i < 4; i++) {
        int res = pthread_create(&threads[i], NULL, consumer_worker, &ctx);
        assert(res == 0);
    }

    /* Producer continuously writes 480-frame batches with strictly monotonic sample values */
    float pcm[480 * 2];
    uint32_t totalGenerated = 0;

    for (int iter = 0; iter < 200; iter++) {
        for (int i = 0; i < 480; i++) {
            float val = (float)(totalGenerated + i + 1);
            pcm[i * 2 + 0] = val;
            pcm[i * 2 + 1] = val * 2.0f;
        }
        totalGenerated += 480;
        JaMeetProducer_WriteFrames(&producer, pcm, 480, true, 1000 + iter * 10);
        usleep(500); /* 0.5 ms */
    }

    atomic_store_explicit(&ctx.stop, true, memory_order_release);
    for (int i = 0; i < 4; i++) {
        pthread_join(threads[i], NULL);
    }

    assert(atomic_load(&ctx.totalSamplesVerified) > 10000);
    JaMeetTransport_Close(transport, false);
    TEST_PASS();
}

/* ========================================================================= */
/* Test 9: POSIX Shared Memory Geometry Validation & O_EXCL Reattachment    */
/* ========================================================================= */
static void test_posix_shm_geometry_and_lifetime(void) {
    const char* testShm = "/jameet_test_p1_shm";

    /* Producer opens/creates with standard private 0600 mode */
    JaMeetTransportConfig prodCfg = JaMeetTransportConfig_Default(true, false);
    prodCfg.shmName = testShm;
    JaMeetTransport* prodTransport = JaMeetTransport_OpenPosixShmConfig(&prodCfg);
    assert(prodTransport != NULL);
    assert(prodTransport->isNewlyCreated == true);
    assert(prodTransport->isOwner == true);
    assert(JaMeetTransport_CheckHealth(prodTransport) == true);

    JaMeetSharedSegment* prodSeg = JaMeetTransport_GetSegment(prodTransport);
    assert(prodSeg != NULL);

    JaMeetProducer producer;
    JaMeetProducer_Init(&producer, prodSeg, 888ULL, getpid());
    assert(JaMeetTransport_CheckHealth(prodTransport) == true);

    float writeBuf[128 * 2];
    for (int i = 0; i < 128 * 2; i++) writeBuf[i] = 7.7f;
    JaMeetProducer_WriteFrames(&producer, writeBuf, 128, true, 100);

    /* Consumer opens existing in read-only mode */
    JaMeetTransportConfig consCfg = JaMeetTransportConfig_Default(false, true);
    consCfg.shmName = testShm;
    JaMeetTransport* consTransport = JaMeetTransport_OpenPosixShmConfig(&consCfg);
    assert(consTransport != NULL);
    assert(consTransport->isNewlyCreated == false);
    assert(consTransport->isOwner == false);
    assert(JaMeetTransport_CheckHealth(consTransport) == true);

    JaMeetSharedSegment* consSeg = JaMeetTransport_GetSegment(consTransport);
    assert(consSeg != NULL);

    JaMeetConsumer consumer;
    JaMeetConsumer_Init(&consumer);

    float readBuf[128 * 2];
    JaMeetConsumer_ReadFrames(&consumer, consSeg, readBuf, 128, 100);
    assert(fabsf(readBuf[0] - 7.7f) < 1e-5f);

    /* Consumer closes without unlinking */
    JaMeetTransport_Close(consTransport, false);

    /* Producer can still write */
    for (int i = 0; i < 128 * 2; i++) writeBuf[i] = 8.8f;
    JaMeetProducer_WriteFrames(&producer, writeBuf, 128, true, 110);

    /* Reattaching secondary writer to existing valid segment */
    JaMeetTransportConfig writeExistingCfg = JaMeetTransportConfig_Default(true, false);
    writeExistingCfg.shmName = testShm;
    JaMeetTransport* writeExistingTransport = JaMeetTransport_OpenPosixShmConfig(&writeExistingCfg);
    assert(writeExistingTransport != NULL);
    assert(writeExistingTransport->isNewlyCreated == false);
    assert(writeExistingTransport->isOwner == false); /* Not the original creator */

    /* Closing secondary writer with unlinkShm=true should NOT unlink since it's not the creator */
    JaMeetTransport_Close(writeExistingTransport, true);

    /* Original producer and consumer still work */
    JaMeetTransport* consTransport2 = JaMeetTransport_OpenPosixShmConfig(&consCfg);
    assert(consTransport2 != NULL);
    JaMeetSharedSegment* consSeg2 = JaMeetTransport_GetSegment(consTransport2);
    JaMeetConsumer consumer2;
    JaMeetConsumer_Init(&consumer2);

    JaMeetConsumer_ReadFrames(&consumer2, consSeg2, readBuf, 128, 110);
    assert(fabsf(readBuf[0] - 8.8f) < 1e-5f);

    JaMeetTransport_Close(consTransport2, false);
    JaMeetTransport_Close(prodTransport, true); /* Original creator unlinks cleanly */

    TEST_PASS();
}

/* ========================================================================= */
/* Test 10: Buffer Overrun Lag Catch-Up                                      */
/* ========================================================================= */
static void test_buffer_overrun_catchup(void) {
    JaMeetTransport* transport = JaMeetTransport_CreateMemory();
    JaMeetSharedSegment* segment = JaMeetTransport_GetSegment(transport);

    JaMeetProducer producer;
    JaMeetProducer_Init(&producer, segment, 999ULL, 4444);

    JaMeetConsumer consumer;
    JaMeetConsumer_Init(&consumer);

    /* Producer writes 20,000 frames (more than 16,384 capacity) */
    float pcm[128 * 2];
    for (int i = 0; i < 128 * 2; i++) pcm[i] = 1.0f;

    for (int i = 0; i < 20000 / 128; i++) {
        JaMeetProducer_WriteFrames(&producer, pcm, 128, true, 1000 + i);
    }

    /* Consumer has fallen far behind; reading should auto-catch up without hang */
    float readBuf[128 * 2];
    uint32_t read = JaMeetConsumer_ReadFrames(&consumer, segment, readBuf, 128, 1200);
    assert(read == 128);
    for (int i = 0; i < 128 * 2; i++) {
        assert(readBuf[i] == 1.0f);
    }

    JaMeetTransport_Close(transport, false);
    TEST_PASS();
}

int main(void) {
    printf("Running JaMeet Remote Bridge Phase 1 Test Suite...\n");
    test_abi_layout();
    test_basic_read_write();
    test_seqlock_in_progress_guard();
    test_consecutive_non128_writes_and_delayed_consumer();
    test_generation_epoch_resync_and_sanitization();
    test_producer_reattachment_without_memset();
    test_inactivity_and_heartbeat();
    test_multithreaded_concurrency();
    test_posix_shm_geometry_and_lifetime();
    test_buffer_overrun_catchup();
    printf("All Phase 1 Bridge Tests Passed Successfully!\n");
    return 0;
}
