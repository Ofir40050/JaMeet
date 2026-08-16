#ifndef JAMEET_REMOTE_TRANSPORT_H
#define JAMEET_REMOTE_TRANSPORT_H

#include "jameet_remote_abi.h"
#include <sys/types.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum JaMeetTransportKind {
    JAMEET_TRANSPORT_KIND_MEMORY = 0,
    JAMEET_TRANSPORT_KIND_POSIX_SHM = 1,
    JAMEET_TRANSPORT_KIND_CUSTOM = 2,
    JAMEET_TRANSPORT_KIND_WIN32_DRIVER = 3
} JaMeetTransportKind;

typedef struct JaMeetTransportConfig {
    const char* shmName;
    bool createIfMissing;
    bool readOnly;
    mode_t posixMode; /* Private mode (0600) by default */
} JaMeetTransportConfig;

typedef struct JaMeetTransport {
    JaMeetTransportKind kind;
    JaMeetSharedSegment* segment;
    size_t mappedSize;
    int fd;
    void* handle; /* Win32 HANDLE or custom pointer */
    char shmName[128];
    bool isOwner;
    bool isReadOnly;
    bool isNewlyCreated; /* True if POSIX object was genuinely created fresh with O_EXCL */
} JaMeetTransport;

/**
 * Construct default transport configuration.
 * Sets private owner-only permissions (0600) by default.
 */
JaMeetTransportConfig JaMeetTransportConfig_Default(bool createIfMissing, bool readOnly);

/**
 * Create an in-memory transport (used for testing and platform-independent environments).
 */
JaMeetTransport* JaMeetTransport_CreateMemory(void);

/**
 * Open or create a POSIX Shared Memory transport with explicit configuration and permissions.
 * 
 * Safety & Creation Guarantees:
 * - Uses O_EXCL to detect genuinely new objects vs existing objects.
 * - Only a genuinely new object is allowed to be initialized from scratch.
 * - Existing objects with incompatible sizes or invalid geometry are rejected safely without modification.
 */
JaMeetTransport* JaMeetTransport_OpenPosixShmConfig(const JaMeetTransportConfig* config);

/**
 * Legacy helper for POSIX Shared Memory transport.
 */
JaMeetTransport* JaMeetTransport_OpenPosixShm(const char* name, bool createIfMissing, bool readOnly);

/**
 * Open Windows kernel-mode driver transport by dynamically querying GUID_DEVINTERFACE_JAMEET_REMOTE
 * and mapping the driver-owned shared section view via IOCTL_JAMEET_MAP_PRODUCER_VIEW.
 */
JaMeetTransport* JaMeetTransport_OpenWin32Device(void);

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
