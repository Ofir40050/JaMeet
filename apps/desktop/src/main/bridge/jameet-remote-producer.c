#include "jameet_remote_bridge.h"
#include "jameet_remote_transport.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <pthread.h>
#include <time.h>
#include <stdatomic.h>

#define JAMEET_PRODUCER_MAGIC       0x4A4D5250U /* "JMRP" */
#define JAMEET_CMD_WRITE_FRAMES     1U
#define JAMEET_CMD_SET_ACTIVE       2U
#define JAMEET_CMD_STOP             3U

#pragma pack(push, 1)
typedef struct JaMeetCmdHeader {
    uint32_t magic;
    uint32_t command;
    uint32_t payloadSize;
} JaMeetCmdHeader;

typedef struct JaMeetWriteFramesPayload {
    uint32_t frameCount;
    uint32_t isVoiceActive;
} JaMeetWriteFramesPayload;

typedef struct JaMeetSetActivePayload {
    uint32_t isVoiceActive;
} JaMeetSetActivePayload;
#pragma pack(pop)

static JaMeetTransport* gTransport = NULL;
static JaMeetProducer gProducer;
static volatile sig_atomic_t gRunning = 1;
static atomic_bool gVoiceActive = false;

static uint64_t get_monotonic_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ((uint64_t)ts.tv_sec * 1000ULL) + ((uint64_t)ts.tv_nsec / 1000000ULL);
}

/* Strictly async-signal-safe: modifies only a sig_atomic_t variable without locks */
static void handle_signal(int sig) {
    (void)sig;
    gRunning = 0;
}

static void* heartbeat_worker(void* arg) {
    (void)arg;
    while (gRunning) {
        uint64_t nowMs = get_monotonic_ms();
        bool active = atomic_load_explicit(&gVoiceActive, memory_order_relaxed);
        JaMeetProducer_UpdateHeartbeat(&gProducer, nowMs, active);
        usleep(50000); /* 50 ms */
    }
    return NULL;
}

static bool read_exact(int fd, void* buffer, size_t size) {
    size_t total = 0;
    uint8_t* ptr = (uint8_t*)buffer;
    while (total < size) {
        if (!gRunning) {
            return false;
        }
        ssize_t bytesRead = read(fd, ptr + total, size - total);
        if (bytesRead <= 0) {
            return false;
        }
        total += (size_t)bytesRead;
    }
    return true;
}

int main(int argc, char* argv[]) {
    (void)argc;
    (void)argv;

    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_handler = handle_signal;
    sigemptyset(&sa.sa_mask);
    sigaction(SIGTERM, &sa, NULL);
    sigaction(SIGINT, &sa, NULL);
    signal(SIGPIPE, SIG_IGN);

    /* Open POSIX shared memory transport with default owner-only 0600 mode */
    JaMeetTransportConfig config = JaMeetTransportConfig_Default(true, false);
    gTransport = JaMeetTransport_OpenPosixShmConfig(&config);
    if (!gTransport || !gTransport->segment) {
        fprintf(stderr, "[JaMeetProducer] Error: Failed to open transport at %s\n", config.shmName);
        return 1;
    }

    uint64_t initialEpoch = (uint64_t)time(NULL);
    uint32_t pid = (uint32_t)getpid();
    if (!JaMeetProducer_Attach(&gProducer, gTransport->segment, initialEpoch, pid)) {
        fprintf(stderr, "[JaMeetProducer] Error: Failed to attach producer to segment\n");
        JaMeetTransport_Close(gTransport, false);
        return 1;
    }

    pthread_t heartbeatThread;
    pthread_create(&heartbeatThread, NULL, heartbeat_worker, NULL);

    float* pcmBuffer = NULL;
    size_t pcmBufferSize = 0;

    JaMeetCmdHeader header;
    while (gRunning) {
        if (!read_exact(STDIN_FILENO, &header, sizeof(header))) {
            /* Stdin closed / EOF or signal received */
            break;
        }

        if (header.magic != JAMEET_PRODUCER_MAGIC) {
            fprintf(stderr, "[JaMeetProducer] Warning: Invalid command magic 0x%08X\n", header.magic);
            break;
        }

        if (header.command == JAMEET_CMD_WRITE_FRAMES) {
            JaMeetWriteFramesPayload payload;
            if (!read_exact(STDIN_FILENO, &payload, sizeof(payload))) {
                break;
            }

            size_t pcmBytes = (size_t)payload.frameCount * JAMEET_CHANNELS * sizeof(float);
            if (pcmBytes > header.payloadSize - sizeof(payload)) {
                fprintf(stderr, "[JaMeetProducer] Error: PCM size exceeds payload size\n");
                break;
            }

            if (pcmBytes > pcmBufferSize) {
                float* newBuf = (float*)realloc(pcmBuffer, pcmBytes);
                if (!newBuf) {
                    fprintf(stderr, "[JaMeetProducer] Error: Out of memory allocating PCM buffer\n");
                    break;
                }
                pcmBuffer = newBuf;
                pcmBufferSize = pcmBytes;
            }

            if (!read_exact(STDIN_FILENO, pcmBuffer, pcmBytes)) {
                break;
            }

            bool isVoiceActive = (payload.isVoiceActive != 0);
            atomic_store_explicit(&gVoiceActive, isVoiceActive, memory_order_relaxed);

            uint64_t nowMs = get_monotonic_ms();
            JaMeetProducer_WriteFrames(&gProducer, pcmBuffer, payload.frameCount, isVoiceActive, nowMs);
        } else if (header.command == JAMEET_CMD_SET_ACTIVE) {
            JaMeetSetActivePayload payload;
            if (!read_exact(STDIN_FILENO, &payload, sizeof(payload))) {
                break;
            }
            bool isVoiceActive = (payload.isVoiceActive != 0);
            atomic_store_explicit(&gVoiceActive, isVoiceActive, memory_order_relaxed);
            JaMeetProducer_UpdateHeartbeat(&gProducer, get_monotonic_ms(), isVoiceActive);
        } else if (header.command == JAMEET_CMD_STOP) {
            atomic_store_explicit(&gVoiceActive, false, memory_order_relaxed);
            JaMeetProducer_UpdateHeartbeat(&gProducer, get_monotonic_ms(), false);
            break;
        } else {
            /* Skip unknown payload */
            if (header.payloadSize > 0) {
                void* dummy = malloc(header.payloadSize);
                if (dummy) {
                    read_exact(STDIN_FILENO, dummy, header.payloadSize);
                    free(dummy);
                }
            }
        }
    }

    gRunning = 0;
    atomic_store_explicit(&gVoiceActive, false, memory_order_release);
    JaMeetProducer_UpdateHeartbeat(&gProducer, get_monotonic_ms(), false);

    pthread_join(heartbeatThread, NULL);

    if (pcmBuffer) {
        free(pcmBuffer);
    }

    if (gTransport) {
        JaMeetTransport_Close(gTransport, false);
        gTransport = NULL;
    }

    return 0;
}
