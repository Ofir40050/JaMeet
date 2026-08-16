#include "jameet_remote_transport.h"
#include "jameet_remote_bridge.h"
#include <stdlib.h>
#include <string.h>

JaMeetTransportConfig JaMeetTransportConfig_Default(bool createIfMissing, bool readOnly) {
    JaMeetTransportConfig cfg;
    cfg.shmName = JAMEET_DEFAULT_SHM_NAME;
    cfg.createIfMissing = createIfMissing;
    cfg.readOnly = readOnly;
    cfg.posixMode = JAMEET_DEFAULT_POSIX_SHM_MODE;
    return cfg;
}

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

    int fd = -1;
    bool isNewlyCreated = false;

    if (config->createIfMissing && !config->readOnly) {
        /*
         * Exclusive creation with O_EXCL to detect if object is genuinely new.
         */
        fd = shm_open(shmName, O_RDWR | O_CREAT | O_EXCL, mode);
        if (fd >= 0) {
            isNewlyCreated = true;
            if (ftruncate(fd, (off_t)segmentSize) != 0) {
                close(fd);
                shm_unlink(shmName);
                return NULL;
            }
        } else if (errno == EEXIST) {
            /* Object already exists: open existing handle without truncating */
            fd = shm_open(shmName, O_RDWR, mode);
            if (fd < 0) {
                return NULL;
            }
            isNewlyCreated = false;
        } else {
            return NULL;
        }
    } else {
        /* Consumer opens existing object in read-only mode */
        fd = shm_open(shmName, O_RDONLY, mode);
        if (fd < 0) {
            return NULL;
        }
        isNewlyCreated = false;
    }

    struct stat st;
    if (fstat(fd, &st) != 0 || (size_t)st.st_size < segmentSize) {
        close(fd);
        if (isNewlyCreated) {
            shm_unlink(shmName);
        }
        return NULL;
    }

    int prot = config->readOnly ? PROT_READ : (PROT_READ | PROT_WRITE);
    void* mapped = mmap(NULL, segmentSize, prot, MAP_SHARED, fd, 0);
    if (mapped == MAP_FAILED) {
        close(fd);
        if (isNewlyCreated) {
            shm_unlink(shmName);
        }
        return NULL;
    }

    JaMeetSharedSegment* seg = (JaMeetSharedSegment*)mapped;

    if (isNewlyCreated) {
        /* Format genuinely new segment */
        JaMeetSegment_FormatFirstTime(seg, 0, (uint32_t)getpid());
    } else {
        /* Existing segment: validate complete declared geometry before allowing use */
        if (!JaMeetSegment_ValidateGeometry(seg)) {
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
    t->segment = seg;
    t->mappedSize = segmentSize;
    t->fd = fd;
    t->isOwner = isNewlyCreated; /* Only the genuine creator is considered the owner with unlink rights */
    t->isReadOnly = config->readOnly;
    t->isNewlyCreated = isNewlyCreated;
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
        /* Only genuinely new owner object can unlink */
        if (unlinkShm && transport->isOwner && transport->isNewlyCreated && transport->shmName[0] != '\0') {
            shm_unlink(transport->shmName);
        }
#ifdef _WIN32
    } else if (transport->kind == JAMEET_TRANSPORT_KIND_WIN32_DRIVER) {
        if (transport->handle != NULL && transport->handle != INVALID_HANDLE_VALUE) {
            DWORD unmapReturned = 0;
            DeviceIoControl(
                (HANDLE)transport->handle,
                IOCTL_JAMEET_UNMAP_PRODUCER_VIEW,
                NULL,
                0,
                NULL,
                0,
                &unmapReturned,
                NULL
            );
            CloseHandle((HANDLE)transport->handle);
            transport->handle = NULL;
        }
#endif
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
