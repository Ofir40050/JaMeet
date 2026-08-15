#ifndef JAMEET_REMOTE_DRIVER_H
#define JAMEET_REMOTE_DRIVER_H

#include <CoreFoundation/CoreFoundation.h>
#include <CoreAudio/AudioServerPlugIn.h>
#include "../bridge/jameet_remote_abi.h"
#include "../bridge/jameet_remote_bridge.h"
#include "../bridge/jameet_remote_transport.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Standard Plug-In and Device Identifiers */
#define JAMEET_DRIVER_NAME                  "JaMeet Remote"
#define JAMEET_DEVICE_NAME                  "JaMeet Remote"
#define JAMEET_MANUFACTURER_NAME            "JaMeet"
#define JAMEET_DEVICE_UID                   "JaMeet_Remote_Audio_Device_UID"
#define JAMEET_MODEL_UID                    "JaMeet_Remote_Audio_Model_UID"
#define JAMEET_BUNDLE_ID                    "com.jameet.audio.driver.JaMeetRemote"

/* Fixed Audio Configuration for Phase 2 */
#define JAMEET_DRIVER_SAMPLE_RATE           48000.0
#define JAMEET_DRIVER_CHANNELS              2U
#define JAMEET_DRIVER_BITS_PER_CHANNEL      32U
#define JAMEET_DRIVER_BYTES_PER_FRAME       (JAMEET_DRIVER_CHANNELS * sizeof(Float32))
#define JAMEET_DRIVER_DEFAULT_BUFFER_SIZE   512U
#define JAMEET_DRIVER_MIN_BUFFER_SIZE       32U
#define JAMEET_DRIVER_MAX_BUFFER_SIZE       4096U

/* Core Audio Object IDs within this plug-in */
enum {
    kObjectID_PlugIn        = 1,
    kObjectID_Device        = 2,
    kObjectID_Stream_Input  = 3
};

/**
 * Main CFPlugIn factory entry point exported by the driver bundle.
 */
void* JaMeetRemote_Create(CFAllocatorRef inAllocator, CFUUIDRef inRequestedTypeUUID);

#ifdef __cplusplus
}
#endif

#endif /* JAMEET_REMOTE_DRIVER_H */
