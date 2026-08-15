#include "JaMeetRemoteDriver.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include <math.h>
#include <unistd.h>
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
/* Test 1: Factory Entry Point & Interface Discovery                        */
/* ========================================================================= */
static void test_driver_factory_and_com(void) {
    /* Request with unknown UUID must return NULL */
    CFUUIDRef unknownUUID = CFUUIDCreateFromString(kCFAllocatorDefault, CFSTR("00000000-0000-0000-0000-000000000000"));
    void* badDriver = JaMeetRemote_Create(kCFAllocatorDefault, unknownUUID);
    assert(badDriver == NULL);
    CFRelease(unknownUUID);

    /* Request with kAudioServerPlugInTypeUUID must return valid driver ref */
    AudioServerPlugInDriverRef driver = (AudioServerPlugInDriverRef)JaMeetRemote_Create(kCFAllocatorDefault, kAudioServerPlugInTypeUUID);
    assert(driver != NULL);
    assert(*driver != NULL);

    /* Test AddRef and Release */
    ULONG ref = (*driver)->AddRef(driver);
    assert(ref >= 2);
    ref = (*driver)->Release(driver);
    assert(ref >= 1);

    /* Initialize Driver */
    OSStatus status = (*driver)->Initialize(driver, dummyHost);
    assert(status == kAudioHardwareNoError);

    TEST_PASS();
}

/* ========================================================================= */
/* Test 2: PlugIn Object & Device Hierarchy Verification                     */
/* ========================================================================= */
static void test_driver_properties_and_hierarchy(void) {
    AudioServerPlugInDriverRef driver = (AudioServerPlugInDriverRef)JaMeetRemote_Create(kCFAllocatorDefault, kAudioServerPlugInTypeUUID);
    assert(driver != NULL);

    AudioObjectPropertyAddress addr;
    memset(&addr, 0, sizeof(addr));
    addr.mScope = kAudioObjectPropertyScopeGlobal;
    addr.mElement = kAudioObjectPropertyElementMain;

    /* 1. Device List from PlugIn */
    addr.mSelector = kAudioPlugInPropertyDeviceList;
    UInt32 size = 0;
    OSStatus status = (*driver)->GetPropertyDataSize(driver, kObjectID_PlugIn, 0, &addr, 0, NULL, &size);
    assert(status == kAudioHardwareNoError);
    assert(size == sizeof(AudioObjectID));

    AudioObjectID deviceID = 0;
    status = (*driver)->GetPropertyData(driver, kObjectID_PlugIn, 0, &addr, 0, NULL, size, &size, &deviceID);
    assert(status == kAudioHardwareNoError);
    assert(deviceID == kObjectID_Device);

    /* 2. Device Name */
    addr.mSelector = kAudioObjectPropertyName;
    CFStringRef name = NULL;
    size = sizeof(CFStringRef);
    status = (*driver)->GetPropertyData(driver, kObjectID_Device, 0, &addr, 0, NULL, size, &size, &name);
    assert(status == kAudioHardwareNoError);
    assert(name != NULL);
    assert(CFStringCompare(name, CFSTR(JAMEET_DEVICE_NAME), 0) == kCFCompareEqualTo);

    /* 3. Device UID and Model UID */
    addr.mSelector = kAudioDevicePropertyDeviceUID;
    CFStringRef devUID = NULL;
    status = (*driver)->GetPropertyData(driver, kObjectID_Device, 0, &addr, 0, NULL, size, &size, &devUID);
    assert(status == kAudioHardwareNoError);
    assert(CFStringCompare(devUID, CFSTR(JAMEET_DEVICE_UID), 0) == kCFCompareEqualTo);

    addr.mSelector = kAudioDevicePropertyModelUID;
    CFStringRef modelUID = NULL;
    status = (*driver)->GetPropertyData(driver, kObjectID_Device, 0, &addr, 0, NULL, size, &size, &modelUID);
    assert(status == kAudioHardwareNoError);
    assert(CFStringCompare(modelUID, CFSTR(JAMEET_MODEL_UID), 0) == kCFCompareEqualTo);

    /* 4. Stream List: Input scope must return 1 stream, Output scope must return 0 streams */
    addr.mSelector = kAudioDevicePropertyStreams;
    addr.mScope = kAudioObjectPropertyScopeInput;
    status = (*driver)->GetPropertyDataSize(driver, kObjectID_Device, 0, &addr, 0, NULL, &size);
    assert(status == kAudioHardwareNoError);
    assert(size == sizeof(AudioObjectID));

    AudioObjectID streamID = 0;
    status = (*driver)->GetPropertyData(driver, kObjectID_Device, 0, &addr, 0, NULL, size, &size, &streamID);
    assert(status == kAudioHardwareNoError);
    assert(streamID == kObjectID_Stream_Input);

    addr.mScope = kAudioObjectPropertyScopeOutput;
    status = (*driver)->GetPropertyDataSize(driver, kObjectID_Device, 0, &addr, 0, NULL, &size);
    assert(status == kAudioHardwareNoError);
    assert(size == 0); /* Input device only! Zero output streams */

    /* 5. Nominal Sample Rate must be 48000.0 */
    addr.mScope = kAudioObjectPropertyScopeGlobal;
    addr.mSelector = kAudioDevicePropertyNominalSampleRate;
    Float64 sampleRate = 0.0;
    size = sizeof(Float64);
    status = (*driver)->GetPropertyData(driver, kObjectID_Device, 0, &addr, 0, NULL, size, &size, &sampleRate);
    assert(status == kAudioHardwareNoError);
    assert(sampleRate == 48000.0);

    /* 6. Stream Format (48 kHz Float32 2 Channels) */
    addr.mSelector = kAudioStreamPropertyVirtualFormat;
    AudioStreamBasicDescription asbd;
    memset(&asbd, 0, sizeof(asbd));
    size = sizeof(asbd);
    status = (*driver)->GetPropertyData(driver, kObjectID_Stream_Input, 0, &addr, 0, NULL, size, &size, &asbd);
    assert(status == kAudioHardwareNoError);
    assert(asbd.mSampleRate == 48000.0);
    assert(asbd.mFormatID == kAudioFormatLinearPCM);
    assert((asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0);
    assert(asbd.mChannelsPerFrame == 2);
    assert(asbd.mBitsPerChannel == 32);
    assert(asbd.mBytesPerFrame == 8);

    TEST_PASS();
}

/* ========================================================================= */
/* Test 3: Virtual Device Clock (GetZeroTimeStamp) Monotonicity              */
/* ========================================================================= */
static void test_driver_clock_monotonicity(void) {
    AudioServerPlugInDriverRef driver = (AudioServerPlugInDriverRef)JaMeetRemote_Create(kCFAllocatorDefault, kAudioServerPlugInTypeUUID);
    assert(driver != NULL);
    (*driver)->Initialize(driver, dummyHost);

    Float64 sampleTime1 = 0.0;
    UInt64 hostTime1 = 0;
    UInt64 seed1 = 0;
    OSStatus status = (*driver)->GetZeroTimeStamp(driver, kObjectID_Device, 1, &sampleTime1, &hostTime1, &seed1);
    assert(status == kAudioHardwareNoError);
    assert(hostTime1 > 0);

    usleep(5000); /* 5 ms sleep */

    Float64 sampleTime2 = 0.0;
    UInt64 hostTime2 = 0;
    UInt64 seed2 = 0;
    status = (*driver)->GetZeroTimeStamp(driver, kObjectID_Device, 1, &sampleTime2, &hostTime2, &seed2);
    assert(status == kAudioHardwareNoError);
    assert(hostTime2 > hostTime1);
    assert(sampleTime2 > sampleTime1);
    assert(seed2 == seed1);

    TEST_PASS();
}

/* ========================================================================= */
/* Test 4: Real-Time IO Path Silence on Inactive/Disconnected Bridge         */
/* ========================================================================= */
static void test_driver_io_silence_on_disconnected_bridge(void) {
    AudioServerPlugInDriverRef driver = (AudioServerPlugInDriverRef)JaMeetRemote_Create(kCFAllocatorDefault, kAudioServerPlugInTypeUUID);
    assert(driver != NULL);
    (*driver)->Initialize(driver, dummyHost);

    Boolean willDo = false;
    Boolean willDoInPlace = false;
    OSStatus status = (*driver)->WillDoIOOperation(
        driver, kObjectID_Device, 1, kAudioServerPlugInIOOperationReadInput, &willDo, &willDoInPlace
    );
    assert(status == kAudioHardwareNoError);
    assert(willDo == true);

    status = (*driver)->StartIO(driver, kObjectID_Device, 1);
    assert(status == kAudioHardwareNoError);

    float ioBuffer[512 * 2];
    for (int i = 0; i < 512 * 2; i++) ioBuffer[i] = 99.0f;

    AudioServerPlugInIOCycleInfo cycleInfo;
    memset(&cycleInfo, 0, sizeof(cycleInfo));

    status = (*driver)->DoIOOperation(
        driver, kObjectID_Device, kObjectID_Stream_Input, 1,
        kAudioServerPlugInIOOperationReadInput, 512, &cycleInfo, ioBuffer, NULL
    );
    assert(status == kAudioHardwareNoError);

    /* Must be clean silence (0.0f) */
    for (int i = 0; i < 512 * 2; i++) {
        assert(ioBuffer[i] == 0.0f);
    }

    status = (*driver)->StopIO(driver, kObjectID_Device, 1);
    assert(status == kAudioHardwareNoError);

    TEST_PASS();
}

/* ========================================================================= */
/* Test 5: End-to-End Audio Ingestion from Phase 1 Bridge Producer           */
/* ========================================================================= */
static void test_driver_io_audio_from_producer(void) {
    /* 1. Setup Phase 1 Producer on default POSIX SHM */
    JaMeetTransportConfig prodCfg = JaMeetTransportConfig_Default(true, false);
    JaMeetTransport* prodTransport = JaMeetTransport_OpenPosixShmConfig(&prodCfg);
    assert(prodTransport != NULL);

    JaMeetSharedSegment* seg = JaMeetTransport_GetSegment(prodTransport);
    assert(seg != NULL);

    JaMeetProducer producer;
    JaMeetProducer_InitNew(&producer, seg, 12345ULL, getpid());

    uint64_t nowMs = get_current_time_ms();

    /* Write 512 frames of recognizable audio with current timestamp */
    float pcm[512 * 2];
    for (int i = 0; i < 512; i++) {
        pcm[i * 2 + 0] = (float)(i + 1) * 0.1f;
        pcm[i * 2 + 1] = (float)(i + 1) * 0.2f;
    }
    JaMeetProducer_WriteFrames(&producer, pcm, 512, true, nowMs);

    /* 2. AudioServerPlugIn connects and reads */
    AudioServerPlugInDriverRef driver = (AudioServerPlugInDriverRef)JaMeetRemote_Create(kCFAllocatorDefault, kAudioServerPlugInTypeUUID);
    assert(driver != NULL);
    (*driver)->Initialize(driver, dummyHost);
    (*driver)->StartIO(driver, kObjectID_Device, 1);

    float ioBuffer[512 * 2];
    memset(ioBuffer, 0, sizeof(ioBuffer));

    AudioServerPlugInIOCycleInfo cycleInfo;
    memset(&cycleInfo, 0, sizeof(cycleInfo));

    OSStatus status = (*driver)->DoIOOperation(
        driver, kObjectID_Device, kObjectID_Stream_Input, 1,
        kAudioServerPlugInIOOperationReadInput, 512, &cycleInfo, ioBuffer, NULL
    );
    assert(status == kAudioHardwareNoError);

    /* Verify audio samples match producer output */
    for (int i = 0; i < 512; i++) {
        assert(fabsf(ioBuffer[i * 2 + 0] - pcm[i * 2 + 0]) < 1e-5f);
        assert(fabsf(ioBuffer[i * 2 + 1] - pcm[i * 2 + 1]) < 1e-5f);
    }

    (*driver)->StopIO(driver, kObjectID_Device, 1);
    (*driver)->Release(driver);

    JaMeetTransport_Close(prodTransport, true); /* Unlink SHM */

    TEST_PASS();
}

int main(void) {
    printf("Running macOS JaMeet Remote AudioServerPlugIn Test Suite...\n");
    test_driver_factory_and_com();
    test_driver_properties_and_hierarchy();
    test_driver_clock_monotonicity();
    test_driver_io_silence_on_disconnected_bridge();
    test_driver_io_audio_from_producer();
    printf("All Phase 2 AudioServerPlugIn Tests Passed Successfully!\n");
    return 0;
}
