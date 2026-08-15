#ifndef JAMEET_REMOTE_TRANSPORT_H
#define JAMEET_REMOTE_TRANSPORT_H

#include "jameet_remote_abi.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum JaMeetTransportKind {
    JAMEET_TRANSPORT_KIND_MEMORY = 0,
    JAMEET_TRANSPORT_KIND_POSIX_SHM = 1,
    JAMEET_TRANSPORT_KIND_CUSTOM = 2
} JaMeetTransportKind;

typedef struct JaMeetTransport {
    JaMeetTransportKind kind;
    JaMeetSharedSegment* segment;
    size_t mappedSize;
    int fd;
    char shmName[128];
    bool isOwner;
    bool isReadOnly;
} JaMeetTransport;

/**
 * Create an in-memory transport (used for testing and platform-independent environments).
 */
JaMeetTransport* JaMeetTransport_CreateMemory(void);

/**
 * Open or create a POSIX Shared Memory transport (used for macOS / POSIX systems).
 * 
 * Stable Lifetime Strategy:
 * - If creating as producer: opens/creates `/jameet_remote_voice_v1` without unlinking unless corrupted.
 * - If opening as consumer: attaches to the existing segment in read-only mode.
 */
JaMeetTransport* JaMeetTransport_OpenPosixShm(const char* name, bool createIfMissing, bool readOnly);

/**
 * Close and unmap the transport.
 * 
 * @param transport Active transport instance.
 * @param unlinkShm If true and transport is owner, unlinks the shared memory object from OS.
 */
void JaMeetTransport_Close(JaMeetTransport* transport, bool unlinkShm);

/**
 * Get the mapped shared segment pointer.
 */
JaMeetSharedSegment* JaMeetTransport_GetSegment(JaMeetTransport* transport);

/**
 * Out-of-band health check for transport validity.
 */
bool JaMeetTransport_CheckHealth(const JaMeetTransport* transport);

#ifdef __cplusplus
}
#endif

#endif /* JAMEET_REMOTE_TRANSPORT_H */
