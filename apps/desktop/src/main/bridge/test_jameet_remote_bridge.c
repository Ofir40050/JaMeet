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

#define TEST_PASS() printf("  [PASS] %s\n", __func__)

/* ========================================================================= */
/* Test 1: ABI Layout and Alignments                                         */
/* ========================================================================= */
static void test_abi_layout(void) {
    assert(sizeof(JaMeetAudioSlot) % 64 == 0);
    assert(sizeof(JaMeetSharedHeader) % 64 == 0);
    assert(sizeof(JaMeetSharedSegment) == sizeof(JaMeetSharedHeader) + (JAMEET_SLOT_COUNT * sizeof(JaMeetAudioSlot)));

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
/* Test 3: Fractional and Multi-Slot Reads/Writes                            */
/* ========================================================================= */
static void test_fractional_and_multislot(void) {
    JaMeetTransport* transport = JaMeetTransport_CreateMemory();
    JaMeetSharedSegment* segment = JaMeetTransport_GetSegment(transport);

    JaMeetProducer producer;
    JaMeetProducer_Init(&producer, segment, 2001ULL, 1234);

    JaMeetConsumer consumer;
    JaMeetConsumer_Init(&consumer);

    /* Producer writes batches of 480 frames (10 ms @ 48kHz) */
#define BATCH_SIZE 480U
    float pcmOut[BATCH_SIZE * 2];
    for (uint32_t i = 0; i < BATCH_SIZE; i++) {
        pcmOut[i * 2 + 0] = (float)(i + 1);
        pcmOut[i * 2 + 1] = (float)(i + 1) * 10.0f;
    }

    JaMeetProducer_WriteFrames(&producer, pcmOut, BATCH_SIZE, true, 500);

    /* Consumer explicitly starts at frame 0 for complete batch verification */
    consumer.lastObservedGeneration = 2001ULL;
    consumer.localReadFrame = 0;
    consumer.isSynchronized = true;

    /* Consumer reads using varying DAW buffer sizes: 64, 128, 256, 32 */
    uint32_t requestSizes[] = { 64, 128, 256, 32 };
    uint32_t currentSampleIndex = 0;

    for (int step = 0; step < 4; step++) {
        uint32_t req = requestSizes[step];
        float readBuf[512 * 2];
        memset(readBuf, 0, sizeof(readBuf));

        uint32_t read = JaMeetConsumer_ReadFrames(&consumer, segment, readBuf, req, 500);
        assert(read == req);

        for (uint32_t f = 0; f < req; f++) {
            float expectedL = (float)(currentSampleIndex + f + 1);
            float expectedR = expectedL * 10.0f;
            assert(fabsf(readBuf[f * 2 + 0] - expectedL) < 1e-5f);
            assert(fabsf(readBuf[f * 2 + 1] - expectedR) < 1e-5f);
        }
        currentSampleIndex += req;
    }
    assert(currentSampleIndex == BATCH_SIZE);

    JaMeetTransport_Close(transport, false);
    TEST_PASS();
}

/* ========================================================================= */
/* Test 4: Seqlock Torn-Write & Overwrite Detection                          */
/* ========================================================================= */
static void test_seqlock_torn_write_detection(void) {
    JaMeetTransport* transport = JaMeetTransport_CreateMemory();
    JaMeetSharedSegment* segment = JaMeetTransport_GetSegment(transport);

    JaMeetProducer producer;
    JaMeetProducer_Init(&producer, segment, 3001ULL, 5555);

    JaMeetConsumer consumer;
    JaMeetConsumer_Init(&consumer);

    float writeBuf[128 * 2];
    for (int i = 0; i < 128 * 2; i++) writeBuf[i] = 1.0f;
    JaMeetProducer_WriteFrames(&producer, writeBuf, 128, true, 100);

    /* Case A: Simulate write-in-progress (seq is odd) on slot 0 */
    segment->slots[0].seq = 3; /* Odd -> in-progress */

    float readBuf[128 * 2];
    for (int i = 0; i < 128 * 2; i++) readBuf[i] = 99.0f;

    JaMeetConsumer_ReadFrames(&consumer, segment, readBuf, 128, 100);

    /* Must output clean silence (0.0f) and increment torn read count */
    for (int i = 0; i < 128 * 2; i++) {
        assert(readBuf[i] == 0.0f);
    }
    assert(consumer.tornReadCount > 0);

    /* Case B: Restore slot to even seq, write new frames, then simulate slot generation mismatch */
    segment->slots[0].seq = 4; /* Even */
    segment->slots[0].producerGeneration = 999ULL; /* Wrong epoch */

    JaMeetConsumer_Init(&consumer);
    for (int i = 0; i < 128 * 2; i++) readBuf[i] = 99.0f;
    JaMeetConsumer_ReadFrames(&consumer, segment, readBuf, 128, 100);

    for (int i = 0; i < 128 * 2; i++) {
        assert(readBuf[i] == 0.0f);
    }

    JaMeetTransport_Close(transport, false);
    TEST_PASS();
}

/* ========================================================================= */
/* Test 5: Producer Generation Epoch Resync                                   */
/* ========================================================================= */
static void test_generation_epoch_resync(void) {
    JaMeetTransport* transport = JaMeetTransport_CreateMemory();
    JaMeetSharedSegment* segment = JaMeetTransport_GetSegment(transport);

    JaMeetProducer producer;
    JaMeetProducer_Init(&producer, segment, 100ULL, 1111);

    JaMeetConsumer consumer;
    JaMeetConsumer_Init(&consumer);

    float data1[128 * 2];
    for (int i = 0; i < 128 * 2; i++) data1[i] = 1.0f;
    JaMeetProducer_WriteFrames(&producer, data1, 128, true, 100);

    float readBuf[128 * 2];
    JaMeetConsumer_ReadFrames(&consumer, segment, readBuf, 128, 100);
    assert(readBuf[0] == 1.0f);
    assert(consumer.lastObservedGeneration == 100ULL);

    /* Producer resets to epoch 200 and resets write sequence (e.g. app restart) */
    JaMeetProducer_Init(&producer, segment, 200ULL, 1111);

    float data2[128 * 2];
    for (int i = 0; i < 128 * 2; i++) data2[i] = 2.0f;
    JaMeetProducer_WriteFrames(&producer, data2, 128, true, 200);

    /* Consumer reads again: should detect generation change and read epoch 200 data safely */
    JaMeetConsumer_ReadFrames(&consumer, segment, readBuf, 128, 200);
    assert(consumer.lastObservedGeneration == 200ULL);
    assert(readBuf[0] == 2.0f);

    JaMeetTransport_Close(transport, false);
    TEST_PASS();
}

/* ========================================================================= */
/* Test 6: Inactivity & Heartbeat Expiration                                 */
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
/* Test 7: Multi-Consumer Concurrent Stress Test                             */
/* ========================================================================= */
typedef struct {
    JaMeetSharedSegment* segment;
    volatile bool stop;
    uint32_t totalFramesProduced;
} MultiThreadContext;

static void* consumer_worker(void* arg) {
    MultiThreadContext* ctx = (MultiThreadContext*)arg;
    JaMeetConsumer consumer;
    JaMeetConsumer_Init(&consumer);

    float localBuf[1024 * 2];
    uint32_t requestSizes[] = { 32, 64, 128, 256, 512, 1024 };
    int reqIdx = 0;

    while (!ctx->stop) {
        uint32_t req = requestSizes[reqIdx % 6];
        reqIdx++;
        JaMeetConsumer_ReadFrames(&consumer, ctx->segment, localBuf, req, 1000);
        /* Verify samples are valid finite numbers (not NaN or Inf) */
        for (uint32_t i = 0; i < req * 2; i++) {
            assert(!isnan(localBuf[i]));
            assert(!isinf(localBuf[i]));
        }
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
    ctx.stop = false;
    ctx.totalFramesProduced = 0;

    pthread_t threads[4];
    for (int i = 0; i < 4; i++) {
        int res = pthread_create(&threads[i], NULL, consumer_worker, &ctx);
        assert(res == 0);
    }

    /* Producer writes 10 ms batches (480 frames) in a loop */
    float pcm[480 * 2];
    for (int i = 0; i < 480 * 2; i++) pcm[i] = 0.5f;

    for (int iter = 0; iter < 200; iter++) {
        JaMeetProducer_WriteFrames(&producer, pcm, 480, true, 1000 + iter * 10);
        usleep(500); /* 0.5 ms */
    }

    ctx.stop = true;
    for (int i = 0; i < 4; i++) {
        pthread_join(threads[i], NULL);
    }

    JaMeetTransport_Close(transport, false);
    TEST_PASS();
}

/* ========================================================================= */
/* Test 8: POSIX Shared Memory Transport Lifetime                            */
/* ========================================================================= */
static void test_posix_shm_lifetime(void) {
    const char* testShm = "/jameet_test_p1_shm";

    /* Producer opens/creates */
    JaMeetTransport* prodTransport = JaMeetTransport_OpenPosixShm(testShm, true, false);
    assert(prodTransport != NULL);
    JaMeetSharedSegment* prodSeg = JaMeetTransport_GetSegment(prodTransport);
    assert(prodSeg != NULL);

    JaMeetProducer producer;
    JaMeetProducer_Init(&producer, prodSeg, 888ULL, getpid());

    float writeBuf[128 * 2];
    for (int i = 0; i < 128 * 2; i++) writeBuf[i] = 7.7f;
    JaMeetProducer_WriteFrames(&producer, writeBuf, 128, true, 100);

    /* Consumer opens existing in read-only mode */
    JaMeetTransport* consTransport = JaMeetTransport_OpenPosixShm(testShm, false, true);
    assert(consTransport != NULL);
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

    /* New consumer attaches to the same object */
    JaMeetTransport* consTransport2 = JaMeetTransport_OpenPosixShm(testShm, false, true);
    assert(consTransport2 != NULL);
    JaMeetSharedSegment* consSeg2 = JaMeetTransport_GetSegment(consTransport2);
    JaMeetConsumer consumer2;
    JaMeetConsumer_Init(&consumer2);

    JaMeetConsumer_ReadFrames(&consumer2, consSeg2, readBuf, 128, 110);
    assert(fabsf(readBuf[0] - 8.8f) < 1e-5f);

    JaMeetTransport_Close(consTransport2, false);
    JaMeetTransport_Close(prodTransport, true); /* Clean up and unlink */

    TEST_PASS();
}

/* ========================================================================= */
/* Test 9: Buffer Overrun Lag Catch-Up                                       */
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
    test_fractional_and_multislot();
    test_seqlock_torn_write_detection();
    test_generation_epoch_resync();
    test_inactivity_and_heartbeat();
    test_multithreaded_concurrency();
    test_posix_shm_lifetime();
    test_buffer_overrun_catchup();
    printf("All Phase 1 Bridge Tests Passed Successfully!\n");
    return 0;
}

