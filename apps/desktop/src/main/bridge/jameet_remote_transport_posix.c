#include "jameet_remote_transport.h"
#include <stdlib.h>
#include <string.h>

#if defined(_MSC_VER)
/* Stubs for non-POSIX platforms (e.g. Windows in Phase 1 before native driver) */
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
    return (transport->segment->header.magic == JAMEET_SHM_MAGIC &&
            transport->segment->header.abiVersion == JAMEET_ABI_VERSION);
}

#else
/* Full POSIX implementation for macOS and Linux */
#include <sys/mman.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>

JaMeetTransport* JaMeetTransport_OpenPosixShm(const char* name, bool createIfMissing, bool readOnly) {
    const char* shmName = (name && name[0] != '\0') ? name : JAMEET_DEFAULT_SHM_NAME;
    const size_t segmentSize = sizeof(JaMeetSharedSegment);

    int flags = readOnly ? O_RDONLY : O_RDWR;
    if (createIfMissing && !readOnly) {
        flags |= O_CREAT;
    }

    int fd = shm_open(shmName, flags, 0666);
    if (fd < 0) {
        return NULL;
    }

    if (createIfMissing && !readOnly) {
        struct stat st;
        if (fstat(fd, &st) == 0 && (size_t)st.st_size < segmentSize) {
            if (ftruncate(fd, (off_t)segmentSize) != 0) {
                close(fd);
                return NULL;
            }
        }
    }

    int prot = readOnly ? PROT_READ : (PROT_READ | PROT_WRITE);
    void* mapped = mmap(NULL, segmentSize, prot, MAP_SHARED, fd, 0);
    if (mapped == MAP_FAILED) {
        close(fd);
        return NULL;
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
    t->isOwner = createIfMissing;
    t->isReadOnly = readOnly;
    strncpy(t->shmName, shmName, sizeof(t->shmName) - 1);

    return t;
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
    return (transport->segment->header.magic == JAMEET_SHM_MAGIC &&
            transport->segment->header.abiVersion == JAMEET_ABI_VERSION);
}

#endif
