#include <CoreAudio/CoreAudio.h>
#include <AudioToolbox/AudioToolbox.h>
#include <CoreFoundation/CoreFoundation.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>

static volatile int g_running = 1;

static void sig_handler(int signo) {
    (void)signo;
    g_running = 0;
}

typedef struct {
    AudioComponentInstance audioUnit;
    UInt32 totalChannels;
    AudioBufferList* bufferList;
    Float32* renderBuffer;
    UInt32 maxFrames;
} CaptureContext;

static int get_channel_count(AudioDeviceID dev) {
    AudioObjectPropertyAddress addr = {
        kAudioDevicePropertyStreamConfiguration,
        kAudioDevicePropertyScopeInput,
        kAudioObjectPropertyElementMain
    };
    UInt32 propSize = 0;
    if (AudioObjectGetPropertyDataSize(dev, &addr, 0, NULL, &propSize) != noErr || propSize == 0) {
        return 0;
    }
    AudioBufferList* bufferList = (AudioBufferList*)malloc(propSize);
    if (!bufferList) return 0;
    if (AudioObjectGetPropertyData(dev, &addr, 0, NULL, &propSize, bufferList) != noErr) {
        free(bufferList);
        return 0;
    }
    int totalChannels = 0;
    for (UInt32 i = 0; i < bufferList->mNumberBuffers; i++) {
        totalChannels += bufferList->mBuffers[i].mNumberChannels;
    }
    free(bufferList);
    return totalChannels;
}

static AudioDeviceID find_device_id(const char* target) {
    UInt32 propSize = 0;
    AudioObjectPropertyAddress addr = {
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &addr, 0, NULL, &propSize) != noErr) {
        return 0;
    }
    int deviceCount = propSize / sizeof(AudioDeviceID);
    AudioDeviceID* devices = (AudioDeviceID*)malloc(propSize);
    if (!devices) return 0;
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &addr, 0, NULL, &propSize, devices) != noErr) {
        free(devices);
        return 0;
    }

    AudioDeviceID defaultInput = 0;
    UInt32 idSize = sizeof(AudioDeviceID);
    AudioObjectPropertyAddress inAddr = {
        kAudioHardwarePropertyDefaultInputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    AudioObjectGetPropertyData(kAudioObjectSystemObject, &inAddr, 0, NULL, &idSize, &defaultInput);

    if (!target || strlen(target) == 0 || strcmp(target, "default") == 0) {
        free(devices);
        return defaultInput;
    }

    // Try numeric ID
    char* endptr = NULL;
    unsigned long numId = strtoul(target, &endptr, 10);
    if (endptr && *endptr == '\0' && numId > 0) {
        for (int i = 0; i < deviceCount; i++) {
            if (devices[i] == (AudioDeviceID)numId) {
                free(devices);
                return (AudioDeviceID)numId;
            }
        }
    }

    // Try UID or Name match
    for (int i = 0; i < deviceCount; i++) {
        AudioDeviceID dev = devices[i];
        char uidBuf[256] = {0};
        CFStringRef uidString = NULL;
        UInt32 uidSize = sizeof(CFStringRef);
        AudioObjectPropertyAddress uidAddr = {
            kAudioDevicePropertyDeviceUID,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain
        };
        if (AudioObjectGetPropertyData(dev, &uidAddr, 0, NULL, &uidSize, &uidString) == noErr && uidString) {
            CFStringGetCString(uidString, uidBuf, sizeof(uidBuf), kCFStringEncodingUTF8);
            CFRelease(uidString);
        }
        if (strcmp(uidBuf, target) == 0) {
            free(devices);
            return dev;
        }

        char nameBuf[256] = {0};
        UInt32 nameSize = sizeof(nameBuf);
        AudioObjectPropertyAddress nameAddr = {
            kAudioDevicePropertyDeviceName,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain
        };
        AudioObjectGetPropertyData(dev, &nameAddr, 0, NULL, &nameSize, nameBuf);
        if (strcasestr(nameBuf, target) != NULL || strcasestr(target, nameBuf) != NULL) {
            free(devices);
            return dev;
        }
    }

    free(devices);
    return defaultInput;
}

static OSStatus InputRenderCallback(
    void* inRefCon,
    AudioUnitRenderActionFlags* ioActionFlags,
    const AudioTimeStamp* inTimeStamp,
    UInt32 inBusNumber,
    UInt32 inNumberFrames,
    AudioBufferList* ioData
) {
    (void)ioData;
    CaptureContext* ctx = (CaptureContext*)inRefCon;
    if (!ctx || inNumberFrames == 0) return noErr;

    ctx->bufferList->mNumberBuffers = 1;
    ctx->bufferList->mBuffers[0].mNumberChannels = ctx->totalChannels;
    ctx->bufferList->mBuffers[0].mDataByteSize = inNumberFrames * ctx->totalChannels * sizeof(Float32);
    ctx->bufferList->mBuffers[0].mData = ctx->renderBuffer;

    OSStatus status = AudioUnitRender(
        ctx->audioUnit,
        ioActionFlags,
        inTimeStamp,
        inBusNumber,
        inNumberFrames,
        ctx->bufferList
    );

    if (status == noErr && ctx->bufferList->mBuffers[0].mData) {
        // Packet Header: UInt32 totalChannels, UInt32 frameCount
        UInt32 header[2];
        header[0] = ctx->totalChannels;
        header[1] = inNumberFrames;

        fwrite(header, sizeof(UInt32), 2, stdout);
        fwrite(ctx->bufferList->mBuffers[0].mData, sizeof(Float32), inNumberFrames * ctx->totalChannels, stdout);
        fflush(stdout);
    }

    return noErr;
}

int capture_device(AudioDeviceID devID) {
    if (devID == 0) {
        fprintf(stderr, "No valid audio device found for capture.\n");
        return 1;
    }

    char nameBuf[256] = {0};
    UInt32 nameSize = sizeof(nameBuf);
    AudioObjectPropertyAddress nameAddr = {
        kAudioDevicePropertyDeviceName,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    AudioObjectGetPropertyData(devID, &nameAddr, 0, NULL, &nameSize, nameBuf);

    int totalChannels = get_channel_count(devID);
    if (totalChannels <= 0) {
        fprintf(stderr, "Audio device '%s' (ID %u) has 0 input channels.\n", nameBuf, devID);
        return 1;
    }
    if (totalChannels > 32) totalChannels = 32;

    fprintf(stderr, "[CoreAudioCapture] Starting capture on '%s' (ID %u, %d physical channels, 48kHz Float32)\n",
        nameBuf, devID, totalChannels);

    AudioComponentDescription desc;
    desc.componentType = kAudioUnitType_Output;
    desc.componentSubType = kAudioUnitSubType_HALOutput;
    desc.componentManufacturer = kAudioUnitManufacturer_Apple;
    desc.componentFlags = 0;
    desc.componentFlagsMask = 0;

    AudioComponent comp = AudioComponentFindNext(NULL, &desc);
    if (!comp) {
        fprintf(stderr, "Failed to find HAL Output component.\n");
        return 1;
    }

    AudioComponentInstance audioUnit;
    OSStatus status = AudioComponentInstanceNew(comp, &audioUnit);
    if (status != noErr) {
        fprintf(stderr, "Failed to create AUHAL instance (status: %d).\n", (int)status);
        return 1;
    }

    // Enable Input on Element 1
    UInt32 enableIO = 1;
    status = AudioUnitSetProperty(audioUnit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Input, 1, &enableIO, sizeof(enableIO));
    if (status != noErr) {
        fprintf(stderr, "Failed to enable Input on AUHAL (status: %d).\n", (int)status);
        AudioComponentInstanceDispose(audioUnit);
        return 1;
    }

    // Disable Output on Element 0
    UInt32 disableIO = 0;
    AudioUnitSetProperty(audioUnit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Output, 0, &disableIO, sizeof(disableIO));

    // Set current device
    status = AudioUnitSetProperty(audioUnit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &devID, sizeof(devID));
    if (status != noErr) {
        fprintf(stderr, "Failed to set AUHAL device to %u (status: %d).\n", devID, (int)status);
        AudioComponentInstanceDispose(audioUnit);
        return 1;
    }

    // Configure client format on Element 1 Output: Float32 Interleaved, totalChannels, 48000 Hz
    AudioStreamBasicDescription clientFormat;
    memset(&clientFormat, 0, sizeof(clientFormat));
    clientFormat.mSampleRate = 48000.0;
    clientFormat.mFormatID = kAudioFormatLinearPCM;
    clientFormat.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
    clientFormat.mChannelsPerFrame = totalChannels;
    clientFormat.mBitsPerChannel = 32;
    clientFormat.mBytesPerFrame = 4 * totalChannels;
    clientFormat.mBytesPerPacket = 4 * totalChannels;
    clientFormat.mFramesPerPacket = 1;

    status = AudioUnitSetProperty(
        audioUnit,
        kAudioUnitProperty_StreamFormat,
        kAudioUnitScope_Output,
        1,
        &clientFormat,
        sizeof(clientFormat)
    );
    if (status != noErr) {
        fprintf(stderr, "Failed to set stream format on AUHAL (status: %d).\n", (int)status);
        AudioComponentInstanceDispose(audioUnit);
        return 1;
    }

    // Allocate render buffer
    UInt32 maxFrames = 4096;
    CaptureContext ctx;
    ctx.audioUnit = audioUnit;
    ctx.totalChannels = totalChannels;
    ctx.maxFrames = maxFrames;
    ctx.renderBuffer = (Float32*)malloc(maxFrames * totalChannels * sizeof(Float32));
    ctx.bufferList = (AudioBufferList*)malloc(sizeof(AudioBufferList) + sizeof(AudioBuffer));

    AURenderCallbackStruct callbackStruct;
    callbackStruct.inputProc = InputRenderCallback;
    callbackStruct.inputProcRefCon = &ctx;

    status = AudioUnitSetProperty(
        audioUnit,
        kAudioOutputUnitProperty_SetInputCallback,
        kAudioUnitScope_Global,
        0,
        &callbackStruct,
        sizeof(callbackStruct)
    );
    if (status != noErr) {
        fprintf(stderr, "Failed to set input callback on AUHAL (status: %d).\n", (int)status);
        free(ctx.renderBuffer);
        free(ctx.bufferList);
        AudioComponentInstanceDispose(audioUnit);
        return 1;
    }

    status = AudioUnitInitialize(audioUnit);
    if (status != noErr) {
        fprintf(stderr, "Failed to initialize AUHAL (status: %d).\n", (int)status);
        free(ctx.renderBuffer);
        free(ctx.bufferList);
        AudioComponentInstanceDispose(audioUnit);
        return 1;
    }

    status = AudioOutputUnitStart(audioUnit);
    if (status != noErr) {
        fprintf(stderr, "Failed to start AUHAL (status: %d).\n", (int)status);
        AudioUnitUninitialize(audioUnit);
        free(ctx.renderBuffer);
        free(ctx.bufferList);
        AudioComponentInstanceDispose(audioUnit);
        return 1;
    }

    fprintf(stderr, "[CoreAudioCapture] AUHAL capture running smoothly. Streaming discrete audio frames.\n");

    signal(SIGINT, sig_handler);
    signal(SIGTERM, sig_handler);

    while (g_running) {
        usleep(50000); // 50ms
    }

    fprintf(stderr, "[CoreAudioCapture] Stopping capture...\n");
    AudioOutputUnitStop(audioUnit);
    AudioUnitUninitialize(audioUnit);
    AudioComponentInstanceDispose(audioUnit);
    free(ctx.renderBuffer);
    free(ctx.bufferList);
    fprintf(stderr, "[CoreAudioCapture] Stopped.\n");
    return 0;
}

int main(int argc, char* argv[]) {
    const char* targetDevice = (argc >= 2) ? argv[1] : "default";
    AudioDeviceID devID = find_device_id(targetDevice);
    return capture_device(devID);
}
