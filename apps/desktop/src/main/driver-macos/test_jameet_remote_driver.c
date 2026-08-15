#include "JaMeetRemoteDriver.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include <math.h>
#include <unistd.h>
#include <sys/mman.h>
#include <mach/mach_time.h>

#define TEST_PASS() printf("  [PASS] %s\n", __func__)

/* Mock Host Interface for Configuration Changes */
static OSStatus MockHost_RequestDeviceConfigurationChange(
    AudioServerPlugInHostRef inHost,
    AudioObjectID inDeviceObjectID,
    UInt64 inChangeAction,
    void* inChangeInfo
);

static struct AudioServerPlugInHostInterface gMockHostInterface = {
    NULL,
    NULL,
    NULL,
    NULL,
    MockHost_RequestDeviceConfigurationChange
};

static AudioServerPlugInHostRef dummyHost = &gMockHostInterface;
static AudioServerPlugInDriverRef gGlobalDriverRef = NULL;

static OSStatus MockHost_RequestDeviceConfigurationChange(
    AudioServerPlugInHostRef inHost,
    AudioObjectID inDeviceObjectID,
    UInt64 inChangeAction,
    void* inChangeInfo
) {
    (void)inHost;
    if (gGlobalDriverRef != NULL && *gGlobalDriverRef != NULL) {
        return (*gGlobalDriverRef)->PerformDeviceConfigurationChange(gGlobalDriverRef, inDeviceObjectID, inChangeAction, inChangeInfo);
    }
    return kAudioHardwareNoError;
}

static uint64_t get_current_time_ms(void) {
    mach_timebase_info_data_t tb;
    mach_timebase_info(&tb);
    if (tb.denom == 0) { tb.numer = 1; tb.denom = 1; }
    return (mach_absolute_time() * tb.numer / tb.denom) / 1000000ULL;
}

/* ========================================================================= */
/* Test 1: Factory Entry Point, COM Interface & Ref Counting                 */
/* ========================================================================= */
static void test_driver_factory_and_com_lifecycle(void) {
    /* Unknown UUID must return NULL */
    CFUUIDRef unknownUUID = CFUUIDCreateFromString(kCFAllocatorDefault, CFSTR("11111111-2222-3333-4444-555555555555"));
    void* badDriver = JaMeetRemote_Create(kCFAllocatorDefault, unknownUUID);
    assert(badDriver == NULL);

    /* Factory creation must return driver ref with ref count incremented */
    AudioServerPlugInDriverRef driver = (AudioServerPlugInDriverRef)JaMeetRemote_Create(kCFAllocatorDefault, kAudioServerPlugInTypeUUID);
    assert(driver != NULL);
    assert(*driver != NULL);

    /* QueryInterface for kAudioServerPlugInDriverInterfaceUUID */
    void* queriedInterface = NULL;
    CFUUIDBytes driverUUIDBytes = CFUUIDGetUUIDBytes(kAudioServerPlugInDriverInterfaceUUID);
    HRESULT hr = (*driver)->QueryInterface(driver, driverUUIDBytes, &queriedInterface);
    assert(hr == S_OK);
    assert(queriedInterface == (void*)driver);

    /* QueryInterface for IUnknownUUID */
    void* unknownInterface = NULL;
    CFUUIDBytes unknownUUIDBytes = CFUUIDGetUUIDBytes(IUnknownUUID);
    hr = (*driver)->QueryInterface(driver, unknownUUIDBytes, &unknownInterface);
    assert(hr == S_OK);
    assert(unknownInterface == (void*)driver);

    /* QueryInterface for invalid UUID must return E_NOINTERFACE */
    void* badInterface = (void*)0xbeef;
    CFUUIDBytes badBytes = CFUUIDGetUUIDBytes(unknownUUID);
    hr = (*driver)->QueryInterface(driver, badBytes, &badInterface);
    assert(hr == E_NOINTERFACE);
    assert(badInterface == NULL);
    CFRelease(unknownUUID);

    /* Release all references */
    ULONG ref = (*driver)->Release(driver);
    assert(ref == 2);
    ref = (*driver)->Release(driver);
    assert(ref == 1);
    ref = (*driver)->Release(driver);
    assert(ref == 0);

    TEST_PASS();
}

/* ========================================================================= */
/* Test 2: Standard Device Buffer Properties & Configuration Changes         */
/* ========================================================================= */
static void test_driver_buffer_properties_and_configuration_changes(void) {
    AudioServerPlugInDriverRef driver = (AudioServerPlugInDriverRef)JaMeetRemote_Create(kCFAllocatorDefault, kAudioServerPlugInTypeUUID);
    assert(driver != NULL);
    gGlobalDriverRef = driver;
    (*driver)->Initialize(driver, dummyHost);

    AudioObjectPropertyAddress addr;
    memset(&addr, 0, sizeof(addr));
    addr.mScope = kAudioObjectPropertyScopeGlobal;
    addr.mElement = kAudioObjectPropertyElementMain;

    /* 1. Device buffer frame size query (default 512) */
    addr.mSelector = kAudioDevicePropertyBufferFrameSize;
    UInt32 bufSize = 0;
    UInt32 dataSize = sizeof(UInt32);
    OSStatus status = (*driver)->GetPropertyData(driver, kObjectID_Device, 0, &addr, 0, NULL, dataSize, &dataSize, &bufSize);
    assert(status == kAudioHardwareNoError);
    assert(bufSize == JAMEET_DRIVER_DEFAULT_BUFFER_SIZE);

    /* 2. Device buffer frame size settability and modification through Host mechanism */
    Boolean isSettable = false;
    status = (*driver)->IsPropertySettable(driver, kObjectID_Device, 0, &addr, &isSettable);
    assert(status == kAudioHardwareNoError);
    assert(isSettable == true);

    UInt32 newSize = 256;
    status = (*driver)->SetPropertyData(driver, kObjectID_Device, 0, &addr, 0, NULL, sizeof(UInt32), &newSize);
    assert(status == kAudioHardwareNoError);

    status = (*driver)->GetPropertyData(driver, kObjectID_Device, 0, &addr, 0, NULL, dataSize, &dataSize, &bufSize);
    assert(status == kAudioHardwareNoError);
    assert(bufSize == 256);

    /* 3. Buffer frame size range {32, 4096} */
    addr.mSelector = kAudioDevicePropertyBufferFrameSizeRange;
    AudioValueRange range;
    dataSize = sizeof(range);
    status = (*driver)->GetPropertyData(driver, kObjectID_Device, 0, &addr, 0, NULL, dataSize, &dataSize, &range);
    assert(status == kAudioHardwareNoError);
    assert(range.mMinimum == 32.0);
    assert(range.mMaximum == 4096.0);

    /* 4. Variable buffer frame sizes flag */
    addr.mSelector = kAudioDevicePropertyUsesVariableIOBufferFrameSizes;
    UInt32 usesVariable = 0;
    dataSize = sizeof(UInt32);
    status = (*driver)->GetPropertyData(driver, kObjectID_Device, 0, &addr, 0, NULL, dataSize, &dataSize, &usesVariable);
    assert(status == kAudioHardwareNoError);
    assert(usesVariable == 1);

    (*driver)->Release(driver);
    gGlobalDriverRef = NULL;
    TEST_PASS();
}

/* ========================================================================= */
/* Test 3: Period-Aligned Stable Virtual Device Clock                        */
/* ========================================================================= */
static void test_driver_period_aligned_clock(void) {
    AudioServerPlugInDriverRef driver = (AudioServerPlugInDriverRef)JaMeetRemote_Create(kCFAllocatorDefault, kAudioServerPlugInTypeUUID);
    assert(driver != NULL);
    (*driver)->Initialize(driver, dummyHost);

    Float64 sampleTime1 = 0.0;
    UInt64 hostTime1 = 0;
    UInt64 seed1 = 0;
    OSStatus status = (*driver)->GetZeroTimeStamp(driver, kObjectID_Device, 1, &sampleTime1, &hostTime1, &seed1);
    assert(status == kAudioHardwareNoError);

    /* Sample time must be an exact multiple of the declared 4096 period */
    assert(fmod(sampleTime1, (Float64)JAMEET_DRIVER_ZERO_TIMESTAMP_PERIOD) == 0.0);

    /* Immediate subsequent query within same 4096 period must return the same anchor point */
    Float64 sampleTime2 = 0.0;
    UInt64 hostTime2 = 0;
    UInt64 seed2 = 0;
    status = (*driver)->GetZeroTimeStamp(driver, kObjectID_Device, 1, &sampleTime2, &hostTime2, &seed2);
    assert(status == kAudioHardwareNoError);
    assert(sampleTime2 == sampleTime1);
    assert(hostTime2 == hostTime1);
    assert(seed2 == seed1);

    (*driver)->Release(driver);
    TEST_PASS();
}

/* ========================================================================= */
/* Test 4: Client Table Bounds, Unknown Clients & Independent Cursors        */
/* ========================================================================= */
static void test_client_bounds_and_independent_cursors(void) {
    AudioServerPlugInDriverRef driver = (AudioServerPlugInDriverRef)JaMeetRemote_Create(kCFAllocatorDefault, kAudioServerPlugInTypeUUID);
    assert(driver != NULL);
    (*driver)->Initialize(driver, dummyHost);

    /* 1. Fill all 32 preallocated client slots */
    for (uint32_t i = 1; i <= JAMEET_DRIVER_MAX_CLIENTS; i++) {
        AudioServerPlugInClientInfo clientInfo = { i, 1000 + (pid_t)i, false, NULL };
        OSStatus status = (*driver)->AddDeviceClient(driver, kObjectID_Device, &clientInfo);
        assert(status == kAudioHardwareNoError);
    }

    /* 2. 33rd client addition must fail cleanly without assigning unisolated state */
    AudioServerPlugInClientInfo overflowClient = { 33, 1033, false, NULL };
    OSStatus overflowStatus = (*driver)->AddDeviceClient(driver, kObjectID_Device, &overflowClient);
    assert(overflowStatus == kAudioHardwareIllegalOperationError);

    /* 3. Unknown client calling DoIOOperation receives silence */
    float ioBuffer[128 * 2];
    for (int i = 0; i < 128 * 2; i++) ioBuffer[i] = 44.0f;
    AudioServerPlugInIOCycleInfo cycleInfo;
    memset(&cycleInfo, 0, sizeof(cycleInfo));

    OSStatus ioStatus = (*driver)->DoIOOperation(
        driver, kObjectID_Device, kObjectID_Stream_Input, 999, /* unknown client 999 */
        kAudioServerPlugInIOOperationReadInput, 128, &cycleInfo, ioBuffer, NULL
    );
    assert(ioStatus == kAudioHardwareNoError);
    for (int i = 0; i < 128 * 2; i++) {
        assert(ioBuffer[i] == 0.0f);
    }

    /* 4. Clean up clients */
    for (uint32_t i = 1; i <= JAMEET_DRIVER_MAX_CLIENTS; i++) {
        AudioServerPlugInClientInfo clientInfo = { i, 1000 + (pid_t)i, false, NULL };
        (*driver)->RemoveDeviceClient(driver, kObjectID_Device, &clientInfo);
    }

    (*driver)->Release(driver);
    TEST_PASS();
}

/* ========================================================================= */
/* Test 5: Background Discovery for Already Running Client                   */
/* ========================================================================= */
static void test_background_discovery_for_running_client(void) {
    shm_unlink(JAMEET_DEFAULT_SHM_NAME);

    /* 1. Initialize driver while bridge is NOT running */
    AudioServerPlugInDriverRef driver = (AudioServerPlugInDriverRef)JaMeetRemote_Create(kCFAllocatorDefault, kAudioServerPlugInTypeUUID);
    assert(driver != NULL);
    (*driver)->Initialize(driver, dummyHost);

    AudioServerPlugInClientInfo client = { 501, 5001, false, NULL };
    (*driver)->AddDeviceClient(driver, kObjectID_Device, &client);
    (*driver)->StartIO(driver, kObjectID_Device, 501);

    /* Real-time IO callback outputs silence initially */
    float ioBuffer[256 * 2];
    for (int i = 0; i < 256 * 2; i++) ioBuffer[i] = 77.0f;
    AudioServerPlugInIOCycleInfo cycleInfo;
    memset(&cycleInfo, 0, sizeof(cycleInfo));

    OSStatus status = (*driver)->DoIOOperation(
        driver, kObjectID_Device, kObjectID_Stream_Input, 501,
        kAudioServerPlugInIOOperationReadInput, 256, &cycleInfo, ioBuffer, NULL
    );
    assert(status == kAudioHardwareNoError);
    for (int i = 0; i < 256 * 2; i++) assert(ioBuffer[i] == 0.0f);

    /* 2. Producer starts up later while Client 501 is actively running IO */
    JaMeetTransportConfig prodCfg = JaMeetTransportConfig_Default(true, false);
    JaMeetTransport* prodTransport = JaMeetTransport_OpenPosixShmConfig(&prodCfg);
    assert(prodTransport != NULL);

    JaMeetSharedSegment* seg = JaMeetTransport_GetSegment(prodTransport);
    assert(seg != NULL);

    JaMeetProducer producer;
    JaMeetProducer_InitNew(&producer, seg, 8888ULL, getpid());

    float pcm[256 * 2];
    for (int i = 0; i < 256 * 2; i++) pcm[i] = 25.0f;
    uint64_t nowMs = get_current_time_ms();
    JaMeetProducer_WriteFrames(&producer, pcm, 256, true, nowMs);

    /* 3. Sleep 150 ms to allow background discovery worker to connect outside RT path */
    usleep(150000);

    /* 4. Client 501 calls DoIOOperation without restarting IO or adding new client */
    memset(ioBuffer, 0, sizeof(ioBuffer));
    status = (*driver)->DoIOOperation(
        driver, kObjectID_Device, kObjectID_Stream_Input, 501,
        kAudioServerPlugInIOOperationReadInput, 256, &cycleInfo, ioBuffer, NULL
    );
    assert(status == kAudioHardwareNoError);
    for (int i = 0; i < 256 * 2; i++) {
        assert(fabsf(ioBuffer[i] - 25.0f) < 1e-5f);
    }

    (*driver)->StopIO(driver, kObjectID_Device, 501);
    (*driver)->RemoveDeviceClient(driver, kObjectID_Device, &client);
    (*driver)->Release(driver);

    JaMeetTransport_Close(prodTransport, true);
    TEST_PASS();
}

/* ========================================================================= */
/* Test 6: CoreAudio HAL Device & Stream Property Compliance                 */
/* ========================================================================= */
static void test_driver_coreaudio_hal_property_compliance(void) {
    AudioServerPlugInDriverRef driver = (AudioServerPlugInDriverRef)JaMeetRemote_Create(kCFAllocatorDefault, kAudioServerPlugInTypeUUID);
    assert(driver != NULL);
    (*driver)->Initialize(driver, dummyHost);

    AudioObjectPropertyAddress addr;
    memset(&addr, 0, sizeof(addr));
    addr.mScope = kAudioObjectPropertyScopeGlobal;
    addr.mElement = kAudioObjectPropertyElementMain;

    /* 1. PlugIn Owned Objects & Device List */
    addr.mSelector = kAudioObjectPropertyOwnedObjects;
    UInt32 dataSize = 0;
    OSStatus status = (*driver)->GetPropertyDataSize(driver, kObjectID_PlugIn, 0, &addr, 0, NULL, &dataSize);
    assert(status == kAudioHardwareNoError);
    assert(dataSize == sizeof(AudioObjectID));

    AudioObjectID plugInOwned = 0;
    status = (*driver)->GetPropertyData(driver, kObjectID_PlugIn, 0, &addr, 0, NULL, dataSize, &dataSize, &plugInOwned);
    assert(status == kAudioHardwareNoError);
    assert(plugInOwned == kObjectID_Device);

    /* 2. Device Owned Objects with and without class qualifier */
    addr.mSelector = kAudioObjectPropertyOwnedObjects;
    status = (*driver)->GetPropertyDataSize(driver, kObjectID_Device, 0, &addr, 0, NULL, &dataSize);
    assert(status == kAudioHardwareNoError);
    assert(dataSize == sizeof(AudioObjectID));

    AudioObjectID devOwned = 0;
    status = (*driver)->GetPropertyData(driver, kObjectID_Device, 0, &addr, 0, NULL, dataSize, &dataSize, &devOwned);
    assert(status == kAudioHardwareNoError);
    assert(devOwned == kObjectID_Stream_Input);

    /* Qualifier: kAudioStreamClassID */
    AudioClassID streamClass = kAudioStreamClassID;
    status = (*driver)->GetPropertyDataSize(driver, kObjectID_Device, 0, &addr, sizeof(AudioClassID), &streamClass, &dataSize);
    assert(status == kAudioHardwareNoError);
    assert(dataSize == sizeof(AudioObjectID));

    /* Qualifier: kAudioControlClassID (device has 0 controls) */
    AudioClassID controlClass = kAudioControlClassID;
    status = (*driver)->GetPropertyDataSize(driver, kObjectID_Device, 0, &addr, sizeof(AudioClassID), &controlClass, &dataSize);
    assert(status == kAudioHardwareNoError);
    assert(dataSize == 0);

    /* 3. Device Related Devices & Control List */
    addr.mSelector = kAudioDevicePropertyRelatedDevices;
    status = (*driver)->GetPropertyDataSize(driver, kObjectID_Device, 0, &addr, 0, NULL, &dataSize);
    assert(status == kAudioHardwareNoError);
    assert(dataSize == sizeof(AudioObjectID));

    addr.mSelector = kAudioObjectPropertyControlList;
    status = (*driver)->GetPropertyDataSize(driver, kObjectID_Device, 0, &addr, 0, NULL, &dataSize);
    assert(status == kAudioHardwareNoError);
    assert(dataSize == 0);

    /* 4. Preferred Channel Layout & Preferred Channels for Stereo Scope Isolation */
    addr.mSelector = kAudioDevicePropertyPreferredChannelLayout;
    addr.mScope = kAudioObjectPropertyScopeInput;
    status = (*driver)->GetPropertyDataSize(driver, kObjectID_Device, 0, &addr, 0, NULL, &dataSize);
    assert(status == kAudioHardwareNoError);
    assert(dataSize == sizeof(AudioChannelLayout));

    AudioChannelLayout layout;
    status = (*driver)->GetPropertyData(driver, kObjectID_Device, 0, &addr, 0, NULL, dataSize, &dataSize, &layout);
    assert(status == kAudioHardwareNoError);
    assert(layout.mChannelLayoutTag == kAudioChannelLayoutTag_Stereo);

    /* Output scope on input-only device must not return valid layout */
    addr.mScope = kAudioObjectPropertyScopeOutput;
    Boolean hasOutLayout = (*driver)->HasProperty(driver, kObjectID_Device, 0, &addr);
    assert(hasOutLayout == false);
    status = (*driver)->GetPropertyDataSize(driver, kObjectID_Device, 0, &addr, 0, NULL, &dataSize);
    assert(status == kAudioHardwareUnknownPropertyError);

    /* 5. Device Default Capability Scope Checking */
    addr.mSelector = kAudioDevicePropertyDeviceCanBeDefaultDevice;
    addr.mScope = kAudioObjectPropertyScopeInput;
    UInt32 canBeDefault = 0;
    dataSize = sizeof(UInt32);
    status = (*driver)->GetPropertyData(driver, kObjectID_Device, 0, &addr, 0, NULL, dataSize, &dataSize, &canBeDefault);
    assert(status == kAudioHardwareNoError);
    assert(canBeDefault == 1);

    addr.mScope = kAudioObjectPropertyScopeOutput;
    status = (*driver)->GetPropertyData(driver, kObjectID_Device, 0, &addr, 0, NULL, dataSize, &dataSize, &canBeDefault);
    assert(status == kAudioHardwareNoError);
    assert(canBeDefault == 0);

    /* 6. Channel Element Names */
    addr.mSelector = kAudioObjectPropertyElementName;
    addr.mScope = kAudioObjectPropertyScopeGlobal;
    addr.mElement = 1;
    CFStringRef leftName = NULL;
    dataSize = sizeof(CFStringRef);
    status = (*driver)->GetPropertyData(driver, kObjectID_Device, 0, &addr, 0, NULL, dataSize, &dataSize, &leftName);
    assert(status == kAudioHardwareNoError);
    assert(leftName != NULL);
    assert(CFStringCompare(leftName, CFSTR("Left"), 0) == kCFCompareEqualTo);
    CFRelease(leftName);

    (*driver)->Release(driver);
    TEST_PASS();
}

int main(void) {
    shm_unlink(JAMEET_DEFAULT_SHM_NAME);
    printf("Running macOS JaMeet Remote AudioServerPlugIn Test Suite...\n");
    test_driver_factory_and_com_lifecycle();
    test_driver_buffer_properties_and_configuration_changes();
    test_driver_period_aligned_clock();
    test_client_bounds_and_independent_cursors();
    test_background_discovery_for_running_client();
    test_driver_coreaudio_hal_property_compliance();
    shm_unlink(JAMEET_DEFAULT_SHM_NAME);
    printf("All Phase 2 AudioServerPlugIn Tests Passed Successfully!\n");
    return 0;
}
