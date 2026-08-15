#include "JaMeetRemoteDriver.h"

#include <mach/mach_time.h>
#include <stdatomic.h>
#include <string.h>
#include <stdlib.h>
#include <pthread.h>
#include <time.h>

#define UNUSED_PARAM(x) ((void)(x))

/* Action constants for Device Configuration Changes */
enum {
    kChangeAction_SetBufferFrameSize = 1
};

/* ========================================================================= */
/* Client State Management (Bounded, Preallocated Client Table)              */
/* ========================================================================= */

typedef struct JaMeetClientSlot {
    _Atomic uint32_t clientID;
    pid_t processID;
    JaMeetConsumer consumer;
} JaMeetClientSlot;

static JaMeetClientSlot gClientSlots[JAMEET_DRIVER_MAX_CLIENTS];

/* ========================================================================= */
/* Global Plug-In & Clock State                                              */
/* ========================================================================= */

static ULONG gRefCount = 0;
static AudioServerPlugInHostRef gHost = NULL;
static mach_timebase_info_data_t gTimebaseInfo = { 0, 0 };

/* Real-Time Safe Bridge State */
static _Atomic(JaMeetSharedSegment*) gSharedSegment = NULL;
static JaMeetTransport* gActiveTransport = NULL;

/* Clock State */
static uint64_t gClockSeed = 1;

/* Device Configuration State */
static _Atomic uint32_t gIOState = 0; /* 0 = stopped, >0 = running client count */
static _Atomic uint32_t gBufferFrameSize = JAMEET_DRIVER_DEFAULT_BUFFER_SIZE;

/* Out-of-band Discovery Thread State */
static pthread_t gDiscoveryThread;
static _Atomic bool gDiscoveryRunning = false;
static pthread_mutex_t gDiscoveryMutex = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t gDiscoveryCond = PTHREAD_COND_INITIALIZER;

/* Forward declarations */
static void JaMeetDriver_DetachBridge(void);
static ULONG STDMETHODCALLTYPE JaMeetDriver_AddRef(void* inDriver);
static ULONG STDMETHODCALLTYPE JaMeetDriver_Release(void* inDriver);

/* ========================================================================= */
/* Out-of-band Shared Memory Lifecycle & Background Discovery                */
/* ========================================================================= */

static void JaMeetDriver_TryAttachBridge(void) {
    if (atomic_load_explicit(&gSharedSegment, memory_order_relaxed) != NULL) {
        return;
    }

    JaMeetTransportConfig config = JaMeetTransportConfig_Default(false, true);
    JaMeetTransport* transport = JaMeetTransport_OpenPosixShmConfig(&config);
    if (transport != NULL) {
        JaMeetSharedSegment* seg = JaMeetTransport_GetSegment(transport);
        if (seg != NULL && JaMeetSegment_ValidateGeometry(seg)) {
            gActiveTransport = transport;
            atomic_store_explicit(&gSharedSegment, seg, memory_order_release);
        } else {
            JaMeetTransport_Close(transport, false);
        }
    }
}

static void JaMeetDriver_DetachBridge(void) {
    atomic_store_explicit(&gSharedSegment, NULL, memory_order_release);
    if (gActiveTransport != NULL) {
        JaMeetTransport_Close(gActiveTransport, false);
        gActiveTransport = NULL;
    }
}

static void* JaMeetDriver_DiscoveryWorker(void* arg) {
    UNUSED_PARAM(arg);

    while (atomic_load_explicit(&gDiscoveryRunning, memory_order_relaxed)) {
        if (atomic_load_explicit(&gSharedSegment, memory_order_relaxed) == NULL) {
            JaMeetDriver_TryAttachBridge();
        }

        struct timespec ts;
        clock_gettime(CLOCK_REALTIME, &ts);
        ts.tv_nsec += 100 * 1000 * 1000; /* 100 ms polling interval */
        if (ts.tv_nsec >= 1000000000) {
            ts.tv_sec += 1;
            ts.tv_nsec -= 1000000000;
        }

        pthread_mutex_lock(&gDiscoveryMutex);
        if (atomic_load_explicit(&gDiscoveryRunning, memory_order_relaxed)) {
            pthread_cond_timedwait(&gDiscoveryCond, &gDiscoveryMutex, &ts);
        }
        pthread_mutex_unlock(&gDiscoveryMutex);
    }

    return NULL;
}

/* ========================================================================= */
/* AudioServerPlugIn COM / CFPlugIn Interface Methods                        */
/* ========================================================================= */

static HRESULT STDMETHODCALLTYPE JaMeetDriver_QueryInterface(
    void* inDriver,
    REFIID inUUID,
    LPVOID* outInterface
) {
    if (!outInterface) return E_POINTER;
    *outInterface = NULL;

    CFUUIDRef reqUUID = CFUUIDCreateFromUUIDBytes(kCFAllocatorDefault, inUUID);
    if (!reqUUID) return E_NOINTERFACE;

    if (CFEqual(reqUUID, IUnknownUUID) || CFEqual(reqUUID, kAudioServerPlugInDriverInterfaceUUID)) {
        JaMeetDriver_AddRef(inDriver);
        *outInterface = inDriver;
        CFRelease(reqUUID);
        return S_OK;
    }

    CFRelease(reqUUID);
    return E_NOINTERFACE;
}

static ULONG STDMETHODCALLTYPE JaMeetDriver_AddRef(void* inDriver) {
    UNUSED_PARAM(inDriver);
    return ++gRefCount;
}

static ULONG STDMETHODCALLTYPE JaMeetDriver_Release(void* inDriver) {
    UNUSED_PARAM(inDriver);
    if (gRefCount > 0) {
        --gRefCount;
        if (gRefCount == 0) {
            /* Stop background discovery worker */
            if (atomic_load_explicit(&gDiscoveryRunning, memory_order_relaxed)) {
                atomic_store_explicit(&gDiscoveryRunning, false, memory_order_relaxed);
                pthread_mutex_lock(&gDiscoveryMutex);
                pthread_cond_broadcast(&gDiscoveryCond);
                pthread_mutex_unlock(&gDiscoveryMutex);
                pthread_join(gDiscoveryThread, NULL);
            }
            JaMeetDriver_DetachBridge();
        }
    }
    return gRefCount;
}

/* ========================================================================= */
/* Driver Lifecycle API                                                      */
/* ========================================================================= */

static OSStatus STDMETHODCALLTYPE JaMeetDriver_Initialize(
    AudioServerPlugInDriverRef inDriver,
    AudioServerPlugInHostRef inHost
) {
    UNUSED_PARAM(inDriver);
    gHost = inHost;

    mach_timebase_info(&gTimebaseInfo);
    if (gTimebaseInfo.denom == 0) {
        gTimebaseInfo.numer = 1;
        gTimebaseInfo.denom = 1;
    }

    gClockSeed = 1;

    /* Initialize preallocated client slots */
    for (uint32_t i = 0; i < JAMEET_DRIVER_MAX_CLIENTS; i++) {
        atomic_store_explicit(&gClientSlots[i].clientID, 0, memory_order_relaxed);
        gClientSlots[i].processID = 0;
        JaMeetConsumer_Init(&gClientSlots[i].consumer);
    }

    /* Out-of-band attempt to connect to bridge (clean prior state first) */
    JaMeetDriver_DetachBridge();
    JaMeetDriver_TryAttachBridge();

    /* Launch background discovery worker if not running */
    if (!atomic_load_explicit(&gDiscoveryRunning, memory_order_relaxed)) {
        atomic_store_explicit(&gDiscoveryRunning, true, memory_order_relaxed);
        pthread_create(&gDiscoveryThread, NULL, JaMeetDriver_DiscoveryWorker, NULL);
    }

    return kAudioHardwareNoError;
}

static OSStatus STDMETHODCALLTYPE JaMeetDriver_CreateDevice(
    AudioServerPlugInDriverRef inDriver,
    CFDictionaryRef inDescription,
    const AudioServerPlugInClientInfo* inClientInfo,
    AudioObjectID* outDeviceObjectID
) {
    UNUSED_PARAM(inDriver);
    UNUSED_PARAM(inDescription);
    UNUSED_PARAM(inClientInfo);
    UNUSED_PARAM(outDeviceObjectID);
    return kAudioHardwareUnsupportedOperationError;
}

static OSStatus STDMETHODCALLTYPE JaMeetDriver_DestroyDevice(
    AudioServerPlugInDriverRef inDriver,
    AudioObjectID inDeviceObjectID
) {
    UNUSED_PARAM(inDriver);
    UNUSED_PARAM(inDeviceObjectID);
    return kAudioHardwareUnsupportedOperationError;
}

static OSStatus STDMETHODCALLTYPE JaMeetDriver_AddDeviceClient(
    AudioServerPlugInDriverRef inDriver,
    AudioObjectID inDeviceObjectID,
    const AudioServerPlugInClientInfo* inClientInfo
) {
    UNUSED_PARAM(inDriver);
    UNUSED_PARAM(inDeviceObjectID);
    if (!inClientInfo || inClientInfo->mClientID == 0) {
        return kAudioHardwareIllegalOperationError;
    }

    /* Recheck bridge connectivity outside real-time path */
    JaMeetDriver_TryAttachBridge();

    /* 1. Check if client already exists */
    for (uint32_t i = 0; i < JAMEET_DRIVER_MAX_CLIENTS; i++) {
        uint32_t currentID = atomic_load_explicit(&gClientSlots[i].clientID, memory_order_relaxed);
        if (currentID == inClientInfo->mClientID) {
            JaMeetConsumer_Init(&gClientSlots[i].consumer);
            gClientSlots[i].processID = inClientInfo->mProcessID;
            return kAudioHardwareNoError;
        }
    }

    /* 2. Allocate free slot: ensure slot state is fully initialized BEFORE publishing clientID */
    for (uint32_t i = 0; i < JAMEET_DRIVER_MAX_CLIENTS; i++) {
        uint32_t currentID = atomic_load_explicit(&gClientSlots[i].clientID, memory_order_relaxed);
        if (currentID == 0) {
            JaMeetConsumer_Init(&gClientSlots[i].consumer);
            gClientSlots[i].processID = inClientInfo->mProcessID;

            uint32_t expected = 0;
            if (atomic_compare_exchange_strong_explicit(&gClientSlots[i].clientID, &expected, inClientInfo->mClientID, memory_order_release, memory_order_relaxed)) {
                return kAudioHardwareNoError;
            }
        }
    }

    /* Bounded table is full: fail cleanly without assigning unisolated state */
    return kAudioHardwareIllegalOperationError;
}

static OSStatus STDMETHODCALLTYPE JaMeetDriver_RemoveDeviceClient(
    AudioServerPlugInDriverRef inDriver,
    AudioObjectID inDeviceObjectID,
    const AudioServerPlugInClientInfo* inClientInfo
) {
    UNUSED_PARAM(inDriver);
    UNUSED_PARAM(inDeviceObjectID);
    if (!inClientInfo || inClientInfo->mClientID == 0) {
        return kAudioHardwareIllegalOperationError;
    }

    for (uint32_t i = 0; i < JAMEET_DRIVER_MAX_CLIENTS; i++) {
        uint32_t currentID = atomic_load_explicit(&gClientSlots[i].clientID, memory_order_relaxed);
        if (currentID == inClientInfo->mClientID) {
            atomic_store_explicit(&gClientSlots[i].clientID, 0, memory_order_release);
            gClientSlots[i].processID = 0;
            return kAudioHardwareNoError;
        }
    }

    return kAudioHardwareNoError;
}

static OSStatus STDMETHODCALLTYPE JaMeetDriver_PerformDeviceConfigurationChange(
    AudioServerPlugInDriverRef inDriver,
    AudioObjectID inDeviceObjectID,
    UInt64 inChangeAction,
    void* inChangeInfo
) {
    UNUSED_PARAM(inDriver);
    UNUSED_PARAM(inChangeInfo);

    if (inDeviceObjectID == kObjectID_Device && inChangeAction == kChangeAction_SetBufferFrameSize) {
        uint32_t requestedSize = (uint32_t)(uintptr_t)inChangeInfo;
        if (requestedSize >= JAMEET_DRIVER_MIN_BUFFER_SIZE && requestedSize <= JAMEET_DRIVER_MAX_BUFFER_SIZE) {
            atomic_store_explicit(&gBufferFrameSize, requestedSize, memory_order_relaxed);
            if (gHost != NULL && gHost->PropertiesChanged != NULL) {
                AudioObjectPropertyAddress addr = {
                    kAudioDevicePropertyBufferFrameSize,
                    kAudioObjectPropertyScopeGlobal,
                    kAudioObjectPropertyElementMain
                };
                gHost->PropertiesChanged(gHost, kObjectID_Device, 1, &addr);
            }
            return kAudioHardwareNoError;
        }
    }

    return kAudioHardwareNoError;
}

static OSStatus STDMETHODCALLTYPE JaMeetDriver_AbortDeviceConfigurationChange(
    AudioServerPlugInDriverRef inDriver,
    AudioObjectID inDeviceObjectID,
    UInt64 inChangeAction,
    void* inChangeInfo
) {
    UNUSED_PARAM(inDriver);
    UNUSED_PARAM(inDeviceObjectID);
    UNUSED_PARAM(inChangeAction);
    UNUSED_PARAM(inChangeInfo);
    return kAudioHardwareNoError;
}

/* ========================================================================= */
/* Property Implementation                                                   */
/* ========================================================================= */

static Boolean STDMETHODCALLTYPE JaMeetDriver_HasProperty(
    AudioServerPlugInDriverRef inDriver,
    AudioObjectID inObjectID,
    pid_t inClientPID,
    const AudioObjectPropertyAddress* inAddress
) {
    UNUSED_PARAM(inDriver);
    UNUSED_PARAM(inClientPID);
    if (!inAddress) return false;

    switch (inObjectID) {
        case kObjectID_PlugIn:
            switch (inAddress->mSelector) {
                case kAudioObjectPropertyBaseClass:
                case kAudioObjectPropertyClass:
                case kAudioObjectPropertyOwner:
                case kAudioObjectPropertyManufacturer:
                case kAudioPlugInPropertyBundleID:
                case kAudioPlugInPropertyBoxList:
                case kAudioPlugInPropertyTranslateUIDToDevice:
                case kAudioPlugInPropertyDeviceList:
                case kAudioPlugInPropertyResourceBundle:
                    return true;
                default:
                    return false;
            }

        case kObjectID_Device:
            switch (inAddress->mSelector) {
                case kAudioObjectPropertyBaseClass:
                case kAudioObjectPropertyClass:
                case kAudioObjectPropertyOwner:
                case kAudioObjectPropertyManufacturer:
                case kAudioObjectPropertyName:
                case kAudioDevicePropertyDeviceUID:
                case kAudioDevicePropertyModelUID:
                case kAudioDevicePropertyTransportType:
                case kAudioDevicePropertyDeviceIsAlive:
                case kAudioDevicePropertyDeviceIsRunning:
                case kAudioDevicePropertyDeviceCanBeDefaultDevice:
                case kAudioDevicePropertyDeviceCanBeDefaultSystemDevice:
                case kAudioDevicePropertyIsHidden:
                case kAudioDevicePropertyStreams:
                case kAudioDevicePropertyNominalSampleRate:
                case kAudioDevicePropertyAvailableNominalSampleRates:
                case kAudioDevicePropertyPreferredChannelsForStereo:
                case kAudioDevicePropertyPreferredChannelLayout:
                case kAudioDevicePropertyBufferFrameSize:
                case kAudioDevicePropertyBufferFrameSizeRange:
                case kAudioDevicePropertyUsesVariableIOBufferFrameSizes:
                case kAudioDevicePropertyLatency:
                case kAudioDevicePropertySafetyOffset:
                case kAudioDevicePropertyZeroTimeStampPeriod:
                case kAudioDevicePropertyClockDomain:
                case kAudioDevicePropertyClockAlgorithm:
                case kAudioDevicePropertyClockIsStable:
                    return true;
                default:
                    return false;
            }

        case kObjectID_Stream_Input:
            switch (inAddress->mSelector) {
                case kAudioObjectPropertyBaseClass:
                case kAudioObjectPropertyClass:
                case kAudioObjectPropertyOwner:
                case kAudioStreamPropertyIsActive:
                case kAudioStreamPropertyDirection:
                case kAudioStreamPropertyTerminalType:
                case kAudioStreamPropertyStartingChannel:
                case kAudioStreamPropertyLatency:
                case kAudioStreamPropertyVirtualFormat:
                case kAudioStreamPropertyPhysicalFormat:
                case kAudioStreamPropertyAvailableVirtualFormats:
                case kAudioStreamPropertyAvailablePhysicalFormats:
                    return true;
                default:
                    return false;
            }

        default:
            return false;
    }
}

static OSStatus STDMETHODCALLTYPE JaMeetDriver_IsPropertySettable(
    AudioServerPlugInDriverRef inDriver,
    AudioObjectID inObjectID,
    pid_t inClientPID,
    const AudioObjectPropertyAddress* inAddress,
    Boolean* outIsSettable
) {
    UNUSED_PARAM(inDriver);
    UNUSED_PARAM(inClientPID);
    if (!inAddress || !outIsSettable) return kAudioHardwareIllegalOperationError;

    *outIsSettable = false;

    if (inObjectID == kObjectID_Device) {
        if (inAddress->mSelector == kAudioDevicePropertyBufferFrameSize) {
            *outIsSettable = true;
        }
    }

    return kAudioHardwareNoError;
}

static OSStatus STDMETHODCALLTYPE JaMeetDriver_GetPropertyDataSize(
    AudioServerPlugInDriverRef inDriver,
    AudioObjectID inObjectID,
    pid_t inClientPID,
    const AudioObjectPropertyAddress* inAddress,
    UInt32 inQualifierDataSize,
    const void* inQualifierData,
    UInt32* outDataSize
) {
    UNUSED_PARAM(inDriver);
    UNUSED_PARAM(inClientPID);
    UNUSED_PARAM(inQualifierDataSize);
    UNUSED_PARAM(inQualifierData);
    if (!inAddress || !outDataSize) return kAudioHardwareIllegalOperationError;

    switch (inObjectID) {
        case kObjectID_PlugIn:
            switch (inAddress->mSelector) {
                case kAudioObjectPropertyBaseClass:
                case kAudioObjectPropertyClass:
                case kAudioObjectPropertyOwner:
                    *outDataSize = sizeof(AudioClassID);
                    return kAudioHardwareNoError;
                case kAudioObjectPropertyManufacturer:
                case kAudioPlugInPropertyBundleID:
                case kAudioPlugInPropertyResourceBundle:
                    *outDataSize = sizeof(CFStringRef);
                    return kAudioHardwareNoError;
                case kAudioPlugInPropertyBoxList:
                    *outDataSize = 0;
                    return kAudioHardwareNoError;
                case kAudioPlugInPropertyDeviceList:
                    *outDataSize = sizeof(AudioObjectID);
                    return kAudioHardwareNoError;
                case kAudioPlugInPropertyTranslateUIDToDevice:
                    *outDataSize = sizeof(AudioObjectID);
                    return kAudioHardwareNoError;
                default:
                    return kAudioHardwareUnknownPropertyError;
            }

        case kObjectID_Device:
            switch (inAddress->mSelector) {
                case kAudioObjectPropertyBaseClass:
                case kAudioObjectPropertyClass:
                case kAudioObjectPropertyOwner:
                    *outDataSize = sizeof(AudioClassID);
                    return kAudioHardwareNoError;
                case kAudioObjectPropertyManufacturer:
                case kAudioObjectPropertyName:
                case kAudioDevicePropertyDeviceUID:
                case kAudioDevicePropertyModelUID:
                    *outDataSize = sizeof(CFStringRef);
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyTransportType:
                case kAudioDevicePropertyDeviceIsAlive:
                case kAudioDevicePropertyDeviceIsRunning:
                case kAudioDevicePropertyDeviceCanBeDefaultDevice:
                case kAudioDevicePropertyDeviceCanBeDefaultSystemDevice:
                case kAudioDevicePropertyIsHidden:
                case kAudioDevicePropertyBufferFrameSize:
                case kAudioDevicePropertyUsesVariableIOBufferFrameSizes:
                case kAudioDevicePropertyLatency:
                case kAudioDevicePropertySafetyOffset:
                case kAudioDevicePropertyZeroTimeStampPeriod:
                case kAudioDevicePropertyClockDomain:
                case kAudioDevicePropertyClockAlgorithm:
                case kAudioDevicePropertyClockIsStable:
                    *outDataSize = sizeof(UInt32);
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyStreams:
                    if (inAddress->mScope == kAudioObjectPropertyScopeInput || inAddress->mScope == kAudioObjectPropertyScopeGlobal) {
                        *outDataSize = sizeof(AudioObjectID);
                    } else {
                        *outDataSize = 0;
                    }
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyNominalSampleRate:
                    *outDataSize = sizeof(Float64);
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyAvailableNominalSampleRates:
                    *outDataSize = sizeof(AudioValueRange);
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyPreferredChannelsForStereo:
                    *outDataSize = 2 * sizeof(UInt32);
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyPreferredChannelLayout:
                    *outDataSize = sizeof(AudioChannelLayout);
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyBufferFrameSizeRange:
                    *outDataSize = sizeof(AudioValueRange);
                    return kAudioHardwareNoError;
                default:
                    return kAudioHardwareUnknownPropertyError;
            }

        case kObjectID_Stream_Input:
            switch (inAddress->mSelector) {
                case kAudioObjectPropertyBaseClass:
                case kAudioObjectPropertyClass:
                case kAudioObjectPropertyOwner:
                    *outDataSize = sizeof(AudioClassID);
                    return kAudioHardwareNoError;
                case kAudioStreamPropertyIsActive:
                case kAudioStreamPropertyDirection:
                case kAudioStreamPropertyTerminalType:
                case kAudioStreamPropertyStartingChannel:
                case kAudioStreamPropertyLatency:
                    *outDataSize = sizeof(UInt32);
                    return kAudioHardwareNoError;
                case kAudioStreamPropertyVirtualFormat:
                case kAudioStreamPropertyPhysicalFormat:
                    *outDataSize = sizeof(AudioStreamBasicDescription);
                    return kAudioHardwareNoError;
                case kAudioStreamPropertyAvailableVirtualFormats:
                case kAudioStreamPropertyAvailablePhysicalFormats:
                    *outDataSize = sizeof(AudioStreamRangedDescription);
                    return kAudioHardwareNoError;
                default:
                    return kAudioHardwareUnknownPropertyError;
            }

        default:
            return kAudioHardwareBadObjectError;
    }
}

static OSStatus STDMETHODCALLTYPE JaMeetDriver_GetPropertyData(
    AudioServerPlugInDriverRef inDriver,
    AudioObjectID inObjectID,
    pid_t inClientPID,
    const AudioObjectPropertyAddress* inAddress,
    UInt32 inQualifierDataSize,
    const void* inQualifierData,
    UInt32 inDataSize,
    UInt32* outDataSize,
    void* outData
) {
    UNUSED_PARAM(inDriver);
    UNUSED_PARAM(inClientPID);
    UNUSED_PARAM(inQualifierDataSize);
    UNUSED_PARAM(inQualifierData);
    if (!inAddress || !outDataSize || !outData) return kAudioHardwareIllegalOperationError;

    switch (inObjectID) {
        case kObjectID_PlugIn:
            switch (inAddress->mSelector) {
                case kAudioObjectPropertyBaseClass:
                    *((AudioClassID*)outData) = kAudioObjectClassID;
                    *outDataSize = sizeof(AudioClassID);
                    return kAudioHardwareNoError;
                case kAudioObjectPropertyClass:
                    *((AudioClassID*)outData) = kAudioPlugInClassID;
                    *outDataSize = sizeof(AudioClassID);
                    return kAudioHardwareNoError;
                case kAudioObjectPropertyOwner:
                    *((AudioObjectID*)outData) = kAudioObjectUnknown;
                    *outDataSize = sizeof(AudioObjectID);
                    return kAudioHardwareNoError;
                case kAudioObjectPropertyManufacturer:
                    *((CFStringRef*)outData) = CFSTR(JAMEET_MANUFACTURER_NAME);
                    *outDataSize = sizeof(CFStringRef);
                    return kAudioHardwareNoError;
                case kAudioPlugInPropertyBundleID:
                    *((CFStringRef*)outData) = CFSTR(JAMEET_BUNDLE_ID);
                    *outDataSize = sizeof(CFStringRef);
                    return kAudioHardwareNoError;
                case kAudioPlugInPropertyBoxList:
                    *outDataSize = 0;
                    return kAudioHardwareNoError;
                case kAudioPlugInPropertyDeviceList:
                    if (inDataSize < sizeof(AudioObjectID)) return kAudioHardwareBadPropertySizeError;
                    *((AudioObjectID*)outData) = kObjectID_Device;
                    *outDataSize = sizeof(AudioObjectID);
                    return kAudioHardwareNoError;
                case kAudioPlugInPropertyTranslateUIDToDevice: {
                    if (inQualifierDataSize < sizeof(CFStringRef) || !inQualifierData) {
                        return kAudioHardwareIllegalOperationError;
                    }
                    CFStringRef inUID = *((CFStringRef*)inQualifierData);
                    if (CFStringCompare(inUID, CFSTR(JAMEET_DEVICE_UID), 0) == kCFCompareEqualTo) {
                        *((AudioObjectID*)outData) = kObjectID_Device;
                    } else {
                        *((AudioObjectID*)outData) = kAudioObjectUnknown;
                    }
                    *outDataSize = sizeof(AudioObjectID);
                    return kAudioHardwareNoError;
                }
                case kAudioPlugInPropertyResourceBundle:
                    *((CFStringRef*)outData) = CFSTR("");
                    *outDataSize = sizeof(CFStringRef);
                    return kAudioHardwareNoError;
                default:
                    return kAudioHardwareUnknownPropertyError;
            }

        case kObjectID_Device:
            switch (inAddress->mSelector) {
                case kAudioObjectPropertyBaseClass:
                    *((AudioClassID*)outData) = kAudioObjectClassID;
                    *outDataSize = sizeof(AudioClassID);
                    return kAudioHardwareNoError;
                case kAudioObjectPropertyClass:
                    *((AudioClassID*)outData) = kAudioDeviceClassID;
                    *outDataSize = sizeof(AudioClassID);
                    return kAudioHardwareNoError;
                case kAudioObjectPropertyOwner:
                    *((AudioObjectID*)outData) = kObjectID_PlugIn;
                    *outDataSize = sizeof(AudioObjectID);
                    return kAudioHardwareNoError;
                case kAudioObjectPropertyManufacturer:
                    *((CFStringRef*)outData) = CFSTR(JAMEET_MANUFACTURER_NAME);
                    *outDataSize = sizeof(CFStringRef);
                    return kAudioHardwareNoError;
                case kAudioObjectPropertyName:
                    *((CFStringRef*)outData) = CFSTR(JAMEET_DEVICE_NAME);
                    *outDataSize = sizeof(CFStringRef);
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyDeviceUID:
                    *((CFStringRef*)outData) = CFSTR(JAMEET_DEVICE_UID);
                    *outDataSize = sizeof(CFStringRef);
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyModelUID:
                    *((CFStringRef*)outData) = CFSTR(JAMEET_MODEL_UID);
                    *outDataSize = sizeof(CFStringRef);
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyTransportType:
                    *((UInt32*)outData) = kAudioDeviceTransportTypeVirtual;
                    *outDataSize = sizeof(UInt32);
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyDeviceIsAlive:
                    *((UInt32*)outData) = 1;
                    *outDataSize = sizeof(UInt32);
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyDeviceIsRunning:
                    *((UInt32*)outData) = (atomic_load_explicit(&gIOState, memory_order_relaxed) > 0) ? 1 : 0;
                    *outDataSize = sizeof(UInt32);
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyDeviceCanBeDefaultDevice:
                    *((UInt32*)outData) = 1;
                    *outDataSize = sizeof(UInt32);
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyDeviceCanBeDefaultSystemDevice:
                    *((UInt32*)outData) = 0;
                    *outDataSize = sizeof(UInt32);
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyIsHidden:
                    *((UInt32*)outData) = 0;
                    *outDataSize = sizeof(UInt32);
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyStreams:
                    if (inAddress->mScope == kAudioObjectPropertyScopeInput || inAddress->mScope == kAudioObjectPropertyScopeGlobal) {
                        if (inDataSize < sizeof(AudioObjectID)) return kAudioHardwareBadPropertySizeError;
                        *((AudioObjectID*)outData) = kObjectID_Stream_Input;
                        *outDataSize = sizeof(AudioObjectID);
                    } else {
                        *outDataSize = 0;
                    }
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyNominalSampleRate:
                    *((Float64*)outData) = JAMEET_DRIVER_SAMPLE_RATE;
                    *outDataSize = sizeof(Float64);
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyAvailableNominalSampleRates: {
                    if (inDataSize < sizeof(AudioValueRange)) return kAudioHardwareBadPropertySizeError;
                    AudioValueRange* range = (AudioValueRange*)outData;
                    range->mMinimum = JAMEET_DRIVER_SAMPLE_RATE;
                    range->mMaximum = JAMEET_DRIVER_SAMPLE_RATE;
                    *outDataSize = sizeof(AudioValueRange);
                    return kAudioHardwareNoError;
                }
                case kAudioDevicePropertyPreferredChannelsForStereo: {
                    if (inDataSize < 2 * sizeof(UInt32)) return kAudioHardwareBadPropertySizeError;
                    UInt32* ch = (UInt32*)outData;
                    ch[0] = 1;
                    ch[1] = 2;
                    *outDataSize = 2 * sizeof(UInt32);
                    return kAudioHardwareNoError;
                }
                case kAudioDevicePropertyPreferredChannelLayout: {
                    if (inDataSize < sizeof(AudioChannelLayout)) return kAudioHardwareBadPropertySizeError;
                    AudioChannelLayout* layout = (AudioChannelLayout*)outData;
                    layout->mChannelLayoutTag = kAudioChannelLayoutTag_Stereo;
                    layout->mChannelBitmap = 0;
                    layout->mNumberChannelDescriptions = 0;
                    *outDataSize = sizeof(AudioChannelLayout);
                    return kAudioHardwareNoError;
                }
                case kAudioDevicePropertyBufferFrameSize:
                    *((UInt32*)outData) = atomic_load_explicit(&gBufferFrameSize, memory_order_relaxed);
                    *outDataSize = sizeof(UInt32);
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyBufferFrameSizeRange: {
                    if (inDataSize < sizeof(AudioValueRange)) return kAudioHardwareBadPropertySizeError;
                    AudioValueRange* range = (AudioValueRange*)outData;
                    range->mMinimum = (Float64)JAMEET_DRIVER_MIN_BUFFER_SIZE;
                    range->mMaximum = (Float64)JAMEET_DRIVER_MAX_BUFFER_SIZE;
                    *outDataSize = sizeof(AudioValueRange);
                    return kAudioHardwareNoError;
                }
                case kAudioDevicePropertyUsesVariableIOBufferFrameSizes:
                    *((UInt32*)outData) = 1;
                    *outDataSize = sizeof(UInt32);
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyLatency:
                case kAudioDevicePropertySafetyOffset:
                    *((UInt32*)outData) = 0;
                    *outDataSize = sizeof(UInt32);
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyZeroTimeStampPeriod:
                    *((UInt32*)outData) = JAMEET_DRIVER_ZERO_TIMESTAMP_PERIOD;
                    *outDataSize = sizeof(UInt32);
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyClockDomain:
                    *((UInt32*)outData) = 0;
                    *outDataSize = sizeof(UInt32);
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyClockAlgorithm:
                    *((UInt32*)outData) = 0;
                    *outDataSize = sizeof(UInt32);
                    return kAudioHardwareNoError;
                case kAudioDevicePropertyClockIsStable:
                    *((UInt32*)outData) = 1;
                    *outDataSize = sizeof(UInt32);
                    return kAudioHardwareNoError;
                default:
                    return kAudioHardwareUnknownPropertyError;
            }

        case kObjectID_Stream_Input:
            switch (inAddress->mSelector) {
                case kAudioObjectPropertyBaseClass:
                    *((AudioClassID*)outData) = kAudioObjectClassID;
                    *outDataSize = sizeof(AudioClassID);
                    return kAudioHardwareNoError;
                case kAudioObjectPropertyClass:
                    *((AudioClassID*)outData) = kAudioStreamClassID;
                    *outDataSize = sizeof(AudioClassID);
                    return kAudioHardwareNoError;
                case kAudioObjectPropertyOwner:
                    *((AudioObjectID*)outData) = kObjectID_Device;
                    *outDataSize = sizeof(AudioObjectID);
                    return kAudioHardwareNoError;
                case kAudioStreamPropertyIsActive:
                    *((UInt32*)outData) = 1;
                    *outDataSize = sizeof(UInt32);
                    return kAudioHardwareNoError;
                case kAudioStreamPropertyDirection:
                    *((UInt32*)outData) = 1; /* Input */
                    *outDataSize = sizeof(UInt32);
                    return kAudioHardwareNoError;
                case kAudioStreamPropertyTerminalType:
                    *((UInt32*)outData) = kAudioStreamTerminalTypeMicrophone;
                    *outDataSize = sizeof(UInt32);
                    return kAudioHardwareNoError;
                case kAudioStreamPropertyStartingChannel:
                    *((UInt32*)outData) = 1;
                    *outDataSize = sizeof(UInt32);
                    return kAudioHardwareNoError;
                case kAudioStreamPropertyLatency:
                    *((UInt32*)outData) = 0;
                    *outDataSize = sizeof(UInt32);
                    return kAudioHardwareNoError;
                case kAudioStreamPropertyVirtualFormat:
                case kAudioStreamPropertyPhysicalFormat: {
                    if (inDataSize < sizeof(AudioStreamBasicDescription)) return kAudioHardwareBadPropertySizeError;
                    AudioStreamBasicDescription* asbd = (AudioStreamBasicDescription*)outData;
                    asbd->mSampleRate = JAMEET_DRIVER_SAMPLE_RATE;
                    asbd->mFormatID = kAudioFormatLinearPCM;
                    asbd->mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
                    asbd->mBytesPerPacket = JAMEET_DRIVER_BYTES_PER_FRAME;
                    asbd->mFramesPerPacket = 1;
                    asbd->mBytesPerFrame = JAMEET_DRIVER_BYTES_PER_FRAME;
                    asbd->mChannelsPerFrame = JAMEET_DRIVER_CHANNELS;
                    asbd->mBitsPerChannel = JAMEET_DRIVER_BITS_PER_CHANNEL;
                    *outDataSize = sizeof(AudioStreamBasicDescription);
                    return kAudioHardwareNoError;
                }
                case kAudioStreamPropertyAvailableVirtualFormats:
                case kAudioStreamPropertyAvailablePhysicalFormats: {
                    if (inDataSize < sizeof(AudioStreamRangedDescription)) return kAudioHardwareBadPropertySizeError;
                    AudioStreamRangedDescription* desc = (AudioStreamRangedDescription*)outData;
                    desc->mFormat.mSampleRate = JAMEET_DRIVER_SAMPLE_RATE;
                    desc->mFormat.mFormatID = kAudioFormatLinearPCM;
                    desc->mFormat.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
                    desc->mFormat.mBytesPerPacket = JAMEET_DRIVER_BYTES_PER_FRAME;
                    desc->mFormat.mFramesPerPacket = 1;
                    desc->mFormat.mBytesPerFrame = JAMEET_DRIVER_BYTES_PER_FRAME;
                    desc->mFormat.mChannelsPerFrame = JAMEET_DRIVER_CHANNELS;
                    desc->mFormat.mBitsPerChannel = JAMEET_DRIVER_BITS_PER_CHANNEL;
                    desc->mSampleRateRange.mMinimum = JAMEET_DRIVER_SAMPLE_RATE;
                    desc->mSampleRateRange.mMaximum = JAMEET_DRIVER_SAMPLE_RATE;
                    *outDataSize = sizeof(AudioStreamRangedDescription);
                    return kAudioHardwareNoError;
                }
                default:
                    return kAudioHardwareUnknownPropertyError;
            }

        default:
            return kAudioHardwareBadObjectError;
    }
}

static OSStatus STDMETHODCALLTYPE JaMeetDriver_SetPropertyData(
    AudioServerPlugInDriverRef inDriver,
    AudioObjectID inObjectID,
    pid_t inClientPID,
    const AudioObjectPropertyAddress* inAddress,
    UInt32 inQualifierDataSize,
    const void* inQualifierData,
    UInt32 inDataSize,
    const void* inData
) {
    UNUSED_PARAM(inDriver);
    UNUSED_PARAM(inClientPID);
    UNUSED_PARAM(inQualifierDataSize);
    UNUSED_PARAM(inQualifierData);
    if (!inAddress || !inData) return kAudioHardwareIllegalOperationError;

    if (inObjectID == kObjectID_Device) {
        if (inAddress->mSelector == kAudioDevicePropertyBufferFrameSize) {
            if (inDataSize < sizeof(UInt32)) return kAudioHardwareBadPropertySizeError;
            UInt32 requestedSize = *((const UInt32*)inData);
            if (requestedSize < JAMEET_DRIVER_MIN_BUFFER_SIZE || requestedSize > JAMEET_DRIVER_MAX_BUFFER_SIZE) {
                return kAudioHardwareIllegalOperationError;
            }

            /* Use standard host configuration change mechanism when host interface is available */
            if (gHost != NULL && gHost->RequestDeviceConfigurationChange != NULL) {
                return gHost->RequestDeviceConfigurationChange(
                    gHost,
                    kObjectID_Device,
                    kChangeAction_SetBufferFrameSize,
                    (void*)(uintptr_t)requestedSize
                );
            } else {
                atomic_store_explicit(&gBufferFrameSize, requestedSize, memory_order_relaxed);
                return kAudioHardwareNoError;
            }
        }
    }

    return kAudioHardwareUnknownPropertyError;
}

/* ========================================================================= */
/* IO Operations (Real-Time Safe Path)                                       */
/* ========================================================================= */

static OSStatus STDMETHODCALLTYPE JaMeetDriver_StartIO(
    AudioServerPlugInDriverRef inDriver,
    AudioObjectID inDeviceObjectID,
    UInt32 inClientID
) {
    UNUSED_PARAM(inDriver);
    UNUSED_PARAM(inDeviceObjectID);
    UNUSED_PARAM(inClientID);

    uint32_t prev = atomic_fetch_add_explicit(&gIOState, 1, memory_order_acq_rel);
    if (prev == 0) {
        /* Recheck shared memory bridge outside the audio rendering callback */
        JaMeetDriver_TryAttachBridge();
    }

    return kAudioHardwareNoError;
}

static OSStatus STDMETHODCALLTYPE JaMeetDriver_StopIO(
    AudioServerPlugInDriverRef inDriver,
    AudioObjectID inDeviceObjectID,
    UInt32 inClientID
) {
    UNUSED_PARAM(inDriver);
    UNUSED_PARAM(inDeviceObjectID);
    UNUSED_PARAM(inClientID);

    uint32_t current = atomic_load_explicit(&gIOState, memory_order_relaxed);
    while (current > 0) {
        if (atomic_compare_exchange_weak_explicit(&gIOState, &current, current - 1, memory_order_acq_rel, memory_order_relaxed)) {
            break;
        }
    }

    return kAudioHardwareNoError;
}

static OSStatus STDMETHODCALLTYPE JaMeetDriver_GetZeroTimeStamp(
    AudioServerPlugInDriverRef inDriver,
    AudioObjectID inDeviceObjectID,
    UInt32 inClientID,
    Float64* outSampleTime,
    UInt64* outHostTime,
    UInt64* outSeed
) {
    UNUSED_PARAM(inDriver);
    UNUSED_PARAM(inDeviceObjectID);
    UNUSED_PARAM(inClientID);
    if (!outSampleTime || !outHostTime || !outSeed) return kAudioHardwareIllegalOperationError;

    uint64_t currentHostTime = mach_absolute_time();
    uint64_t currentNanos = (currentHostTime * gTimebaseInfo.numer) / gTimebaseInfo.denom;
    Float64 continuousSampleTime = ((Float64)currentNanos * JAMEET_DRIVER_SAMPLE_RATE) / 1000000000.0;

    /* Align to declared zero timestamp period */
    const Float64 period = (Float64)JAMEET_DRIVER_ZERO_TIMESTAMP_PERIOD;
    uint64_t periodIndex = (uint64_t)(continuousSampleTime / period);
    Float64 zeroSampleTime = (Float64)(periodIndex * (uint64_t)period);

    /* Compute exact host ticks when zero sample occurred */
    uint64_t zeroNanos = (uint64_t)((zeroSampleTime * 1000000000.0) / JAMEET_DRIVER_SAMPLE_RATE);
    uint64_t zeroTicks = (zeroNanos * gTimebaseInfo.denom) / gTimebaseInfo.numer;

    *outSampleTime = zeroSampleTime;
    *outHostTime = zeroTicks;
    *outSeed = gClockSeed;

    return kAudioHardwareNoError;
}

static OSStatus STDMETHODCALLTYPE JaMeetDriver_WillDoIOOperation(
    AudioServerPlugInDriverRef inDriver,
    AudioObjectID inDeviceObjectID,
    UInt32 inClientID,
    UInt32 inOperationID,
    Boolean* outWillDo,
    Boolean* outWillDoInPlace
) {
    UNUSED_PARAM(inDriver);
    UNUSED_PARAM(inDeviceObjectID);
    UNUSED_PARAM(inClientID);
    if (!outWillDo || !outWillDoInPlace) return kAudioHardwareIllegalOperationError;

    if (inOperationID == kAudioServerPlugInIOOperationReadInput) {
        *outWillDo = true;
        *outWillDoInPlace = true;
    } else {
        *outWillDo = false;
        *outWillDoInPlace = true;
    }

    return kAudioHardwareNoError;
}

static OSStatus STDMETHODCALLTYPE JaMeetDriver_BeginIOOperation(
    AudioServerPlugInDriverRef inDriver,
    AudioObjectID inDeviceObjectID,
    UInt32 inClientID,
    UInt32 inOperationID,
    UInt32 inIOBufferFrameSize,
    const AudioServerPlugInIOCycleInfo* inIOCycleInfo
) {
    UNUSED_PARAM(inDriver);
    UNUSED_PARAM(inDeviceObjectID);
    UNUSED_PARAM(inClientID);
    UNUSED_PARAM(inOperationID);
    UNUSED_PARAM(inIOBufferFrameSize);
    UNUSED_PARAM(inIOCycleInfo);
    return kAudioHardwareNoError;
}

static OSStatus STDMETHODCALLTYPE JaMeetDriver_DoIOOperation(
    AudioServerPlugInDriverRef inDriver,
    AudioObjectID inDeviceObjectID,
    AudioObjectID inStreamObjectID,
    UInt32 inClientID,
    UInt32 inOperationID,
    UInt32 inIOBufferFrameSize,
    const AudioServerPlugInIOCycleInfo* inIOCycleInfo,
    void* ioMainBuffer,
    void* ioSecondaryBuffer
) {
    UNUSED_PARAM(inDriver);
    UNUSED_PARAM(inDeviceObjectID);
    UNUSED_PARAM(inStreamObjectID);
    UNUSED_PARAM(inIOCycleInfo);

    if (inOperationID != kAudioServerPlugInIOOperationReadInput) {
        return kAudioHardwareNoError;
    }

    float* dest = (float*)ioMainBuffer;
    if (dest == NULL) {
        dest = (float*)ioSecondaryBuffer;
    }
    if (dest == NULL) {
        return kAudioHardwareNoError;
    }

    uint32_t frameCount = inIOBufferFrameSize;
    size_t totalBytes = (size_t)frameCount * JAMEET_DRIVER_CHANNELS * sizeof(float);

    /*
     * Real-Time IO Path Guarantees:
     * - Strictly non-blocking, zero locks, zero memory allocations, zero filesystem access.
     * - Dispatches exclusively to the caller's registered consumer cursor.
     * - Unknown clients receive clean digital silence (0.0f) rather than sharing a consumer.
     * - When bridge is unavailable, disconnected, or inactive: returns clean digital silence (0.0f).
     */
    JaMeetConsumer* consumer = NULL;
    for (uint32_t i = 0; i < JAMEET_DRIVER_MAX_CLIENTS; i++) {
        if (atomic_load_explicit(&gClientSlots[i].clientID, memory_order_acquire) == inClientID) {
            consumer = &gClientSlots[i].consumer;
            break;
        }
    }

    if (consumer == NULL) {
        /* Unregistered / unknown client: return clean silence */
        memset(dest, 0, totalBytes);
        return kAudioHardwareNoError;
    }

    JaMeetSharedSegment* seg = atomic_load_explicit(&gSharedSegment, memory_order_acquire);
    if (seg != NULL) {
        uint64_t nowTicks = mach_absolute_time();
        uint64_t nowNanos = (nowTicks * gTimebaseInfo.numer) / gTimebaseInfo.denom;
        uint64_t nowMs = nowNanos / 1000000ULL;

        JaMeetConsumer_ReadFrames(consumer, seg, dest, frameCount, nowMs);
    } else {
        memset(dest, 0, totalBytes);
    }

    return kAudioHardwareNoError;
}

static OSStatus STDMETHODCALLTYPE JaMeetDriver_EndIOOperation(
    AudioServerPlugInDriverRef inDriver,
    AudioObjectID inDeviceObjectID,
    UInt32 inClientID,
    UInt32 inOperationID,
    UInt32 inIOBufferFrameSize,
    const AudioServerPlugInIOCycleInfo* inIOCycleInfo
) {
    UNUSED_PARAM(inDriver);
    UNUSED_PARAM(inDeviceObjectID);
    UNUSED_PARAM(inClientID);
    UNUSED_PARAM(inOperationID);
    UNUSED_PARAM(inIOBufferFrameSize);
    UNUSED_PARAM(inIOCycleInfo);
    return kAudioHardwareNoError;
}

/* ========================================================================= */
/* Driver Interface Dispatch Table                                           */
/* ========================================================================= */

static AudioServerPlugInDriverInterface gDriverInterface = {
    NULL,
    JaMeetDriver_QueryInterface,
    JaMeetDriver_AddRef,
    JaMeetDriver_Release,
    JaMeetDriver_Initialize,
    JaMeetDriver_CreateDevice,
    JaMeetDriver_DestroyDevice,
    JaMeetDriver_AddDeviceClient,
    JaMeetDriver_RemoveDeviceClient,
    JaMeetDriver_PerformDeviceConfigurationChange,
    JaMeetDriver_AbortDeviceConfigurationChange,
    JaMeetDriver_HasProperty,
    JaMeetDriver_IsPropertySettable,
    JaMeetDriver_GetPropertyDataSize,
    JaMeetDriver_GetPropertyData,
    JaMeetDriver_SetPropertyData,
    JaMeetDriver_StartIO,
    JaMeetDriver_StopIO,
    JaMeetDriver_GetZeroTimeStamp,
    JaMeetDriver_WillDoIOOperation,
    JaMeetDriver_BeginIOOperation,
    JaMeetDriver_DoIOOperation,
    JaMeetDriver_EndIOOperation
};

static AudioServerPlugInDriverInterface* gDriverInterfacePtr = &gDriverInterface;

/* ========================================================================= */
/* Factory Entry Point                                                       */
/* ========================================================================= */

__attribute__((visibility("default")))
void* JaMeetRemote_Create(CFAllocatorRef inAllocator, CFUUIDRef inRequestedTypeUUID) {
    UNUSED_PARAM(inAllocator);
    if (!inRequestedTypeUUID) return NULL;

    if (CFEqual(inRequestedTypeUUID, kAudioServerPlugInTypeUUID)) {
        JaMeetDriver_AddRef((void*)&gDriverInterfacePtr);
        return (void*)&gDriverInterfacePtr;
    }
    return NULL;
}
