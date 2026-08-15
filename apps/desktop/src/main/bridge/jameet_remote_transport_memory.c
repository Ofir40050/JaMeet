#include "jameet_remote_transport.h"
#include "jameet_remote_bridge.h"
#include <stdlib.h>
#include <string.h>

#if defined(_MSC_VER)
#include <malloc.h>
#define jameet_aligned_alloc(align, size) _aligned_malloc(size, align)
#define jameet_aligned_free(ptr) _aligned_free(ptr)
#elif defined(_POSIX_C_SOURCE) && _POSIX_C_SOURCE >= 200112L || defined(__APPLE__)
#define jameet_aligned_alloc(align, size) ({ void* p = NULL; posix_memalign(&p, align, size) == 0 ? p : NULL; })
#define jameet_aligned_free(ptr) free(ptr)
#else
#define jameet_aligned_alloc(align, size) malloc(size)
#define jameet_aligned_free(ptr) free(ptr)
#endif

JaMeetTransportConfig JaMeetTransportConfig_Default(bool createIfMissing, bool readOnly) {
    JaMeetTransportConfig cfg;
    cfg.shmName = JAMEET_DEFAULT_SHM_NAME;
    cfg.createIfMissing = createIfMissing;
    cfg.readOnly = readOnly;
    cfg.posixMode = JAMEET_DEFAULT_POSIX_SHM_MODE;
    return cfg;
}

JaMeetTransport* JaMeetTransport_CreateMemory(void) {
    JaMeetTransport* t = (JaMeetTransport*)malloc(sizeof(JaMeetTransport));
    if (!t) return NULL;

    memset(t, 0, sizeof(JaMeetTransport));
    t->kind = JAMEET_TRANSPORT_KIND_MEMORY;
    t->mappedSize = sizeof(JaMeetSharedSegment);
    t->fd = -1;
    t->isOwner = true;
    t->isReadOnly = false;
    t->isNewlyCreated = true;
    strncpy(t->shmName, "in-memory", sizeof(t->shmName) - 1);

    t->segment = (JaMeetSharedSegment*)jameet_aligned_alloc(64, sizeof(JaMeetSharedSegment));
    if (!t->segment) {
        free(t);
        return NULL;
    }

    memset(t->segment, 0, sizeof(JaMeetSharedSegment));
    JaMeetSegment_FormatFirstTime(t->segment, 0, 0);
    return t;
}
