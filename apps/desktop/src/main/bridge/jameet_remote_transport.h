#ifndef JAMEET_REMOTE_TRANSPORT_H
#define JAMEET_REMOTE_TRANSPORT_H

#include "jameet_remote_abi.h"
#include <sys/types.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Default POSIX SHM Permissions: Owner Read/Write (0644 or 0660) */
#define JAMEET_DEFAULT_POSIX_SHM_MODE 0644

typedef enum JaMeetTransportKind {
    JAMEET_TRANSPORT_KIND_MEMORY = 0,
    JAMEET_TRANSPORT_KIND_POSIX_SHM = 1,
    JAMEET_TRANSPORT_KIND_CUSTOM = 2
} JaMeetTransportKind;

typedef struct JaMeetTransportConfig {
    const char* shmName;
    bool createIfMissing;
    bool readOnly;
    mode_t posixMode; /* Intentional permission mode (e.g. 0644 for owner RW / consumer RO) */
} JaMeetTransportConfig;

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
 * Construct default transport configuration.
 * Producer uses createIfMissing=true, readOnly=false, mode=0644.
 * Consumer uses createIfMissing=false, readOnly=true, mode=0644.
 */
JaMeetTransportConfig JaMeetTransportConfig_Default(bool createIfMissing, bool readOnly);

/**
 * Create an in-memory transport (used for testing and platform-independent environments).
 */
JaMeetTransport* JaMeetTransport_CreateMemory(void);

/**
 * Open or create a POSIX Shared Memory transport with explicit configuration and permissions.
 * 
 * Safety & Geometry Validation:
 * - Checks file size via fstat before mapping.
 * - If attaching as consumer: validates complete declared geometry before returning transport handle.
 * - Rejects incompatible, truncated, or undersized objects safely.
 */
JaMeetTransport* JaMeetTransport_OpenPosixShmConfig(const JaMeetTransportConfig* config);

/**
 * Legacy helper for POSIX Shared Memory transport.
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
 * Out-of-band health check validating complete declared geometry.
 */
bool JaMeetTransport_CheckHealth(const JaMeetTransport* transport);

#ifdef __cplusplus
}
#endif

#endif /* JAMEET_REMOTE_TRANSPORT_H */
