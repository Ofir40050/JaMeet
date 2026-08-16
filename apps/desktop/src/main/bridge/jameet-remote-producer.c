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
static atomic_bool gRunning = true;
static atomic_bool gVoiceActive = false;
static pthread_mutex_t gHeartbeatMutex = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t gHeartbeatCond = PTHREAD_COND_INITIALIZER;

static uint64_t get_monotonic_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ((uint64_t)ts.tv_sec * 1000ULL) + ((uint64_t)ts.tv_nsec / 1000000ULL);
}

static void handle_signal(int sig) {
    (void)sig;
    atomic_store_explicit(&gRunning, false, memory_order_release);
    pthread_mutex_lock(&gHeartbeatMutex);
    pthread_cond_broadcast(&gHeartbeatCond);
    pthread_mutex_unlock(&gHeartbeatMutex);
}

static void* heartbeat_worker(void* arg) {
    (void)arg;
    while (atomic_load_explicit(&gRunning, memory_order_acquire)) {
        uint64_t nowMs = get_monotonic_ms();
        bool active = atomic_load_explicit(&gVoiceActive, memory_order_relaxed);
        JaMeetProducer_UpdateHeartbeat(&gProducer, nowMs, active);

        struct timespec ts;
        clock_gettime(CLOCK_REALTIME, &ts);
        ts.tv_nsec += 50 * 1000 * 1000; /* 50 ms */
        if (ts.tv_nsec >= 1000000000) {
            ts.tv_sec += 1;
            ts.tv_nsec -= 1000000000;
        }

        pthread_mutex_lock(&gHeartbeatMutex);
        if (atomic_load_explicit(&gRunning, memory_order_relaxed)) {
            pthread_cond_timedwait(&gHeartbeatCond, &gHeartbeatMutex, &ts);
        }
        pthread_mutex_unlock(&gHeartbeatMutex);
    }
    return NULL;
}

#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>

#define JAMEET_BRIDGE_SOCKET_PATH   "/var/tmp/jameet_remote_voice.sock"

static void* socket_server_worker(void* arg) {
    (void)arg;
    unlink(JAMEET_BRIDGE_SOCKET_PATH);

    int sfd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (sfd < 0) return NULL;

    struct sockaddr_un addr;
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, JAMEET_BRIDGE_SOCKET_PATH, sizeof(addr.sun_path) - 1);

    if (bind(sfd, (struct sockaddr*)&addr, sizeof(addr)) != 0) {
        close(sfd);
        return NULL;
    }
    chmod(JAMEET_BRIDGE_SOCKET_PATH, 0666);
    listen(sfd, 5);

    while (atomic_load_explicit(&gRunning, memory_order_acquire)) {
        struct timeval tv = { .tv_sec = 0, .tv_usec = 100000 };
        fd_set fds;
        FD_ZERO(&fds);
        FD_SET(sfd, &fds);
        int sel = select(sfd + 1, &fds, NULL, NULL, &tv);
        if (sel > 0 && FD_ISSET(sfd, &fds)) {
            int cfd = accept(sfd, NULL, NULL);
            if (cfd >= 0) {
                if (gTransport && gTransport->fd >= 0) {
                    struct msghdr msg;
                    memset(&msg, 0, sizeof(msg));
                    char cmsgBuf[CMSG_SPACE(sizeof(int))];
                    memset(cmsgBuf, 0, sizeof(cmsgBuf));
                    struct iovec io = { .iov_base = "F", .iov_len = 1 };

                    msg.msg_iov = &io;
                    msg.msg_iovlen = 1;
                    msg.msg_control = cmsgBuf;
                    msg.msg_controllen = sizeof(cmsgBuf);

                    struct cmsghdr* cmsg = CMSG_FIRSTHDR(&msg);
                    cmsg->cmsg_level = SOL_SOCKET;
                    cmsg->cmsg_type = SCM_RIGHTS;
                    cmsg->cmsg_len = CMSG_LEN(sizeof(int));
                    *((int*)CMSG_DATA(cmsg)) = gTransport->fd;

                    sendmsg(cfd, &msg, 0);
                }
                close(cfd);
            }
        }
    }

    close(sfd);
    unlink(JAMEET_BRIDGE_SOCKET_PATH);
    return NULL;
}

static bool read_exact(int fd, void* buffer, size_t size) {
    size_t total = 0;
    uint8_t* ptr = (uint8_t*)buffer;
    while (total < size) {
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

    signal(SIGTERM, handle_signal);
    signal(SIGINT, handle_signal);
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

    pthread_t socketServerThread;
    pthread_create(&socketServerThread, NULL, socket_server_worker, NULL);

    float* pcmBuffer = NULL;
    size_t pcmBufferSize = 0;

    JaMeetCmdHeader header;
    while (atomic_load_explicit(&gRunning, memory_order_acquire)) {
        if (!read_exact(STDIN_FILENO, &header, sizeof(header))) {
            /* Stdin closed / EOF */
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

    atomic_store_explicit(&gRunning, false, memory_order_release);
    atomic_store_explicit(&gVoiceActive, false, memory_order_release);
    JaMeetProducer_UpdateHeartbeat(&gProducer, get_monotonic_ms(), false);

    pthread_mutex_lock(&gHeartbeatMutex);
    pthread_cond_broadcast(&gHeartbeatCond);
    pthread_mutex_unlock(&gHeartbeatMutex);

    pthread_join(heartbeatThread, NULL);
    pthread_join(socketServerThread, NULL);

    if (pcmBuffer) {
        free(pcmBuffer);
    }

    if (gTransport) {
        JaMeetTransport_Close(gTransport, false);
        gTransport = NULL;
    }

    return 0;
}
