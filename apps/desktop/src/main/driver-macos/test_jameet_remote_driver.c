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

static AudioServerPlugInHostRef dummyHost = (AudioServerPlugInHostRef)0x1000;

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
/* Test 2: Standard Device Buffer Properties & Hierarchy                     */
/* ========================================================================= */
static void test_driver_buffer_properties_and_hierarchy(void) {
    AudioServerPlugInDriverRef driver = (AudioServerPlugInDriverRef)JaMeetRemote_Create(kCFAllocatorDefault, kAudioServerPlugInTypeUUID);
    assert(driver != NULL);
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

    /* 2. Device buffer frame size settability and modification */
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
/* Test 4: Multiple Independent Core Audio Clients (No Cursor Stealing)      */
/* ========================================================================= */
static void test_multiple_independent_clients(void) {
    /* 1. Setup Phase 1 Producer on POSIX SHM */
    JaMeetTransportConfig prodCfg = JaMeetTransportConfig_Default(true, false);
    JaMeetTransport* prodTransport = JaMeetTransport_OpenPosixShmConfig(&prodCfg);
    assert(prodTransport != NULL);

    JaMeetSharedSegment* seg = JaMeetTransport_GetSegment(prodTransport);
    assert(seg != NULL);

    JaMeetProducer producer;
    JaMeetProducer_InitNew(&producer, seg, 9999ULL, getpid());

    /* 2. Setup Driver */
    AudioServerPlugInDriverRef driver = (AudioServerPlugInDriverRef)JaMeetRemote_Create(kCFAllocatorDefault, kAudioServerPlugInTypeUUID);
    assert(driver != NULL);
    (*driver)->Initialize(driver, dummyHost);

    /* 3. Register two independent clients: Client A (101) and Client B (102) */
    AudioServerPlugInClientInfo clientA = { 101, 1001, false, NULL };
    AudioServerPlugInClientInfo clientB = { 102, 1002, false, NULL };

    OSStatus status = (*driver)->AddDeviceClient(driver, kObjectID_Device, &clientA);
    assert(status == kAudioHardwareNoError);
    status = (*driver)->AddDeviceClient(driver, kObjectID_Device, &clientB);
    assert(status == kAudioHardwareNoError);

    (*driver)->StartIO(driver, kObjectID_Device, 101);
    (*driver)->StartIO(driver, kObjectID_Device, 102);

    /* 4. Write 256 frames of audio data */
    float pcm[256 * 2];
    for (int i = 0; i < 256; i++) {
        pcm[i * 2 + 0] = (float)(i + 1) * 3.0f;
        pcm[i * 2 + 1] = (float)(i + 1) * 4.0f;
    }
    uint64_t nowMs = get_current_time_ms();
    JaMeetProducer_WriteFrames(&producer, pcm, 256, true, nowMs);

    /* 5. Client A reads 256 frames */
    float bufferA[256 * 2];
    memset(bufferA, 0, sizeof(bufferA));
    AudioServerPlugInIOCycleInfo cycleInfo;
    memset(&cycleInfo, 0, sizeof(cycleInfo));

    status = (*driver)->DoIOOperation(
        driver, kObjectID_Device, kObjectID_Stream_Input, 101,
        kAudioServerPlugInIOOperationReadInput, 256, &cycleInfo, bufferA, NULL
    );
    assert(status == kAudioHardwareNoError);

    /* 6. Client B reads 256 frames: must also receive all 256 frames without interference! */
    float bufferB[256 * 2];
    memset(bufferB, 0, sizeof(bufferB));

    status = (*driver)->DoIOOperation(
        driver, kObjectID_Device, kObjectID_Stream_Input, 102,
        kAudioServerPlugInIOOperationReadInput, 256, &cycleInfo, bufferB, NULL
    );
    assert(status == kAudioHardwareNoError);

    /* Verify both clients received identical PCM data */
    for (int i = 0; i < 256; i++) {
        assert(fabsf(bufferA[i * 2 + 0] - pcm[i * 2 + 0]) < 1e-5f);
        assert(fabsf(bufferA[i * 2 + 1] - pcm[i * 2 + 1]) < 1e-5f);

        assert(fabsf(bufferB[i * 2 + 0] - pcm[i * 2 + 0]) < 1e-5f);
        assert(fabsf(bufferB[i * 2 + 1] - pcm[i * 2 + 1]) < 1e-5f);
    }

    /* 7. Teardown */
    (*driver)->StopIO(driver, kObjectID_Device, 101);
    (*driver)->StopIO(driver, kObjectID_Device, 102);
    (*driver)->RemoveDeviceClient(driver, kObjectID_Device, &clientA);
    (*driver)->RemoveDeviceClient(driver, kObjectID_Device, &clientB);
    (*driver)->Release(driver);

    JaMeetTransport_Close(prodTransport, true);
    TEST_PASS();
}

/* ========================================================================= */
/* Test 5: Out-of-Band Reconnection on Late Bridge Startup                   */
/* ========================================================================= */
static void test_out_of_band_reconnection(void) {
    /* 1. Ensure any lingering SHM from previous tests is unlinked so bridge starts completely offline */
    shm_unlink(JAMEET_DEFAULT_SHM_NAME);

    /* Initialize driver while bridge is NOT running */
    AudioServerPlugInDriverRef driver = (AudioServerPlugInDriverRef)JaMeetRemote_Create(kCFAllocatorDefault, kAudioServerPlugInTypeUUID);
    assert(driver != NULL);
    (*driver)->Initialize(driver, dummyHost);

    AudioServerPlugInClientInfo client = { 201, 2001, false, NULL };
    (*driver)->AddDeviceClient(driver, kObjectID_Device, &client);
    (*driver)->StartIO(driver, kObjectID_Device, 201);

    /* Real-time IO callback outputs silence */
    float ioBuffer[256 * 2];
    for (int i = 0; i < 256 * 2; i++) ioBuffer[i] = 77.0f;
    AudioServerPlugInIOCycleInfo cycleInfo;
    memset(&cycleInfo, 0, sizeof(cycleInfo));

    OSStatus status = (*driver)->DoIOOperation(
        driver, kObjectID_Device, kObjectID_Stream_Input, 201,
        kAudioServerPlugInIOOperationReadInput, 256, &cycleInfo, ioBuffer, NULL
    );
    assert(status == kAudioHardwareNoError);
    for (int i = 0; i < 256 * 2; i++) assert(ioBuffer[i] == 0.0f);

    /* 2. Producer starts late and writes audio */
    JaMeetTransportConfig prodCfg = JaMeetTransportConfig_Default(true, false);
    JaMeetTransport* prodTransport = JaMeetTransport_OpenPosixShmConfig(&prodCfg);
    assert(prodTransport != NULL);

    JaMeetSharedSegment* seg = JaMeetTransport_GetSegment(prodTransport);
    assert(seg != NULL);

    JaMeetProducer producer;
    JaMeetProducer_InitNew(&producer, seg, 7777ULL, getpid());

    float pcm[256 * 2];
    for (int i = 0; i < 256 * 2; i++) pcm[i] = 12.5f;
    uint64_t nowMs = get_current_time_ms();
    JaMeetProducer_WriteFrames(&producer, pcm, 256, true, nowMs);

    /* 3. Out-of-band reconnection triggers on client addition / StartIO */
    AudioServerPlugInClientInfo client2 = { 202, 2002, false, NULL };
    (*driver)->AddDeviceClient(driver, kObjectID_Device, &client2);
    (*driver)->StartIO(driver, kObjectID_Device, 202);

    /* 4. Real-time IO now reads audio cleanly */
    memset(ioBuffer, 0, sizeof(ioBuffer));
    status = (*driver)->DoIOOperation(
        driver, kObjectID_Device, kObjectID_Stream_Input, 202,
        kAudioServerPlugInIOOperationReadInput, 256, &cycleInfo, ioBuffer, NULL
    );
    assert(status == kAudioHardwareNoError);
    for (int i = 0; i < 256 * 2; i++) {
        assert(fabsf(ioBuffer[i] - 12.5f) < 1e-5f);
    }

    (*driver)->StopIO(driver, kObjectID_Device, 201);
    (*driver)->StopIO(driver, kObjectID_Device, 202);
    (*driver)->RemoveDeviceClient(driver, kObjectID_Device, &client);
    (*driver)->RemoveDeviceClient(driver, kObjectID_Device, &client2);
    (*driver)->Release(driver);

    JaMeetTransport_Close(prodTransport, true);
    TEST_PASS();
}

int main(void) {
    shm_unlink(JAMEET_DEFAULT_SHM_NAME);
    printf("Running macOS JaMeet Remote AudioServerPlugIn Test Suite...\n");
    test_driver_factory_and_com_lifecycle();
    test_driver_buffer_properties_and_hierarchy();
    test_driver_period_aligned_clock();
    test_multiple_independent_clients();
    test_out_of_band_reconnection();
    shm_unlink(JAMEET_DEFAULT_SHM_NAME);
    printf("All Phase 2 AudioServerPlugIn Tests Passed Successfully!\n");
    return 0;
}
