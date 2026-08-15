#include "jameet_remote_transport.h"
#include "jameet_remote_bridge.h"
#include <stdlib.h>
#include <string.h>

#if defined(_MSC_VER)
/* Stubs for non-POSIX platforms (e.g. Windows in Phase 1 before native driver) */
JaMeetTransport* JaMeetTransport_OpenPosixShmConfig(const JaMeetTransportConfig* config) {
    (void)config;
    return JaMeetTransport_CreateMemory();
}

JaMeetTransport* JaMeetTransport_OpenPosixShm(const char* name, bool createIfMissing, bool readOnly) {
    (void)name; (void)createIfMissing; (void)readOnly;
    return JaMeetTransport_CreateMemory();
}

void JaMeetTransport_Close(JaMeetTransport* transport, bool unlinkShm) {
    (void)unlinkShm;
    if (!transport) return;
    if (transport->segment) {
        _aligned_free(transport->segment);
    }
    free(transport);
}

JaMeetSharedSegment* JaMeetTransport_GetSegment(JaMeetTransport* transport) {
    return transport ? transport->segment : NULL;
}

bool JaMeetTransport_CheckHealth(const JaMeetTransport* transport) {
    if (!transport || !transport->segment) return false;
    return JaMeetSegment_ValidateGeometry(transport->segment);
}

#else
/* Full POSIX implementation for macOS and Linux */
#include <sys/mman.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>

JaMeetTransport* JaMeetTransport_OpenPosixShmConfig(const JaMeetTransportConfig* config) {
    if (!config) return NULL;

    const char* shmName = (config->shmName && config->shmName[0] != '\0') ? config->shmName : JAMEET_DEFAULT_SHM_NAME;
    const size_t segmentSize = sizeof(JaMeetSharedSegment);
    const mode_t mode = config->posixMode ? config->posixMode : JAMEET_DEFAULT_POSIX_SHM_MODE;

    int flags = config->readOnly ? O_RDONLY : O_RDWR;
    if (config->createIfMissing && !config->readOnly) {
        flags |= O_CREAT;
    }

    int fd = shm_open(shmName, flags, mode);
    if (fd < 0) {
        return NULL;
    }

    struct stat st;
    if (fstat(fd, &st) != 0) {
        close(fd);
        return NULL;
    }

    if (config->createIfMissing && !config->readOnly) {
        if ((size_t)st.st_size < segmentSize) {
            if (ftruncate(fd, (off_t)segmentSize) != 0) {
                close(fd);
                return NULL;
            }
        }
    } else {
        /* Consumer requires an existing object with at least the full declared segment size */
        if ((size_t)st.st_size < segmentSize) {
            close(fd);
            return NULL;
        }
    }

    int prot = config->readOnly ? PROT_READ : (PROT_READ | PROT_WRITE);
    void* mapped = mmap(NULL, segmentSize, prot, MAP_SHARED, fd, 0);
    if (mapped == MAP_FAILED) {
        close(fd);
        return NULL;
    }

    /* For consumer handles, validate complete declared geometry before returning */
    if (config->readOnly) {
        if (!JaMeetSegment_ValidateGeometry((const JaMeetSharedSegment*)mapped)) {
            munmap(mapped, segmentSize);
            close(fd);
            return NULL;
        }
    }

    JaMeetTransport* t = (JaMeetTransport*)malloc(sizeof(JaMeetTransport));
    if (!t) {
        munmap(mapped, segmentSize);
        close(fd);
        return NULL;
    }

    memset(t, 0, sizeof(JaMeetTransport));
    t->kind = JAMEET_TRANSPORT_KIND_POSIX_SHM;
    t->segment = (JaMeetSharedSegment*)mapped;
    t->mappedSize = segmentSize;
    t->fd = fd;
    t->isOwner = config->createIfMissing && !config->readOnly;
    t->isReadOnly = config->readOnly;
    strncpy(t->shmName, shmName, sizeof(t->shmName) - 1);

    return t;
}

JaMeetTransport* JaMeetTransport_OpenPosixShm(const char* name, bool createIfMissing, bool readOnly) {
    JaMeetTransportConfig cfg = JaMeetTransportConfig_Default(createIfMissing, readOnly);
    if (name && name[0] != '\0') {
        cfg.shmName = name;
    }
    return JaMeetTransport_OpenPosixShmConfig(&cfg);
}

void JaMeetTransport_Close(JaMeetTransport* transport, bool unlinkShm) {
    if (!transport) return;

    if (transport->kind == JAMEET_TRANSPORT_KIND_MEMORY) {
        if (transport->segment) {
            free(transport->segment);
        }
    } else if (transport->kind == JAMEET_TRANSPORT_KIND_POSIX_SHM) {
        if (transport->segment && transport->segment != MAP_FAILED) {
            munmap(transport->segment, transport->mappedSize);
        }
        if (transport->fd >= 0) {
            close(transport->fd);
        }
        if (unlinkShm && transport->isOwner && transport->shmName[0] != '\0') {
            shm_unlink(transport->shmName);
        }
    }

    free(transport);
}

JaMeetSharedSegment* JaMeetTransport_GetSegment(JaMeetTransport* transport) {
    return transport ? transport->segment : NULL;
}

bool JaMeetTransport_CheckHealth(const JaMeetTransport* transport) {
    if (!transport || !transport->segment || transport->segment == MAP_FAILED) return false;
    return JaMeetSegment_ValidateGeometry(transport->segment);
}

#endif
