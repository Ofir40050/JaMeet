#include "jameet_remote_bridge.h"
#include "jameet_remote_transport.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <time.h>
#include <stdatomic.h>

#ifdef _WIN32
#include <windows.h>
#include <io.h>
#include <fcntl.h>
#include <process.h>
#define STDIN_FILENO 0
#else
#include <unistd.h>
#include <pthread.h>
#endif

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
#ifdef _WIN32
    return (uint64_t)GetTickCount64();
#else
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ((uint64_t)ts.tv_sec * 1000ULL) + ((uint64_t)ts.tv_nsec / 1000000ULL);
#endif
}

/* Strictly async-signal-safe */
#ifdef _WIN32
static BOOL WINAPI handle_console_ctrl(DWORD ctrlType) {
    (void)ctrlType;
    gRunning = 0;
    return TRUE;
}
#else
static void handle_signal(int sig) {
    (void)sig;
    gRunning = 0;
}
#endif

#ifdef _WIN32
static unsigned __stdcall heartbeat_worker(void* arg) {
    (void)arg;
    while (gRunning) {
        uint64_t nowMs = get_monotonic_ms();
        bool active = atomic_load_explicit(&gVoiceActive, memory_order_relaxed);
        JaMeetProducer_UpdateHeartbeat(&gProducer, nowMs, active);
        Sleep(50);
    }
    return 0;
}
#else
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
#endif

static bool read_exact(int fd, void* buffer, size_t size) {
    size_t total = 0;
    uint8_t* ptr = (uint8_t*)buffer;
    while (total < size) {
        if (!gRunning) {
            return false;
        }
#ifdef _WIN32
        int bytesRead = _read(fd, ptr + total, (unsigned int)(size - total));
#else
        ssize_t bytesRead = read(fd, ptr + total, size - total);
#endif
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

#ifdef _WIN32
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stderr), _O_BINARY);
    SetConsoleCtrlHandler(handle_console_ctrl, TRUE);

    /* Open Windows Kernel Driver Transport via dynamic device interface enumeration */
    gTransport = JaMeetTransport_OpenWin32Device();
    if (!gTransport || !gTransport->segment) {
        fprintf(stderr, "[JaMeetProducer] Error: Failed to open Windows JaMeet Remote device transport\n");
        return 1;
    }
#else
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
#endif

    uint64_t initialEpoch = (uint64_t)time(NULL);
#ifdef _WIN32
    uint32_t pid = (uint32_t)GetCurrentProcessId();
#else
    uint32_t pid = (uint32_t)getpid();
#endif

    if (!JaMeetProducer_Attach(&gProducer, gTransport->segment, initialEpoch, pid)) {
        fprintf(stderr, "[JaMeetProducer] Error: Failed to attach producer to segment\n");
        JaMeetTransport_Close(gTransport, false);
        return 1;
    }

#ifdef _WIN32
    HANDLE heartbeatThread = (HANDLE)_beginthreadex(NULL, 0, heartbeat_worker, NULL, 0, NULL);
#else
    pthread_t heartbeatThread;
    pthread_create(&heartbeatThread, NULL, heartbeat_worker, NULL);
#endif

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
            if (!gRunning) {
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
            if (!gRunning) {
                break;
            }

            bool isVoiceActive = (payload.isVoiceActive != 0);
            if (!gRunning) {
                break;
            }
            atomic_store_explicit(&gVoiceActive, isVoiceActive, memory_order_relaxed);

            if (!gRunning) {
                break;
            }
            uint64_t nowMs = get_monotonic_ms();
            JaMeetProducer_WriteFrames(&gProducer, pcmBuffer, payload.frameCount, isVoiceActive, nowMs);
        } else if (header.command == JAMEET_CMD_SET_ACTIVE) {
            JaMeetSetActivePayload payload;
            if (!read_exact(STDIN_FILENO, &payload, sizeof(payload))) {
                break;
            }
            if (!gRunning) {
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

#ifdef _WIN32
    if (heartbeatThread != NULL) {
        WaitForSingleObject(heartbeatThread, 1000);
        CloseHandle(heartbeatThread);
    }
#else
    pthread_join(heartbeatThread, NULL);
#endif

    if (pcmBuffer) {
        free(pcmBuffer);
    }

    if (gTransport) {
        JaMeetTransport_Close(gTransport, false);
        gTransport = NULL;
    }

    return 0;
}
