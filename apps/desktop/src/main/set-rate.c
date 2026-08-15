#include <CoreAudio/CoreAudio.h>
#include <CoreFoundation/CoreFoundation.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int get_channel_count(AudioDeviceID dev, AudioObjectPropertyScope scope) {
    AudioObjectPropertyAddress addr = {
        kAudioDevicePropertyStreamConfiguration,
        scope,
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

void json_escape_and_print(const char* str) {
    putchar('"');
    for (const char* p = str; *p; p++) {
        if (*p == '"' || *p == '\\') {
            putchar('\\');
        }
        putchar(*p);
    }
    putchar('"');
}

void print_channel_names_json(AudioDeviceID dev, AudioObjectPropertyScope scope, int totalChannels) {
    putchar('[');
    for (int ch = 1; ch <= totalChannels; ch++) {
        char nameBuf[128] = {0};
        AudioObjectPropertyAddress chNameAddr = {
            kAudioDevicePropertyChannelNameCFString,
            scope,
            (UInt32)ch
        };
        CFStringRef chName = NULL;
        UInt32 chNameSize = sizeof(CFStringRef);
        OSStatus err = AudioObjectGetPropertyData(dev, &chNameAddr, 0, NULL, &chNameSize, &chName);
        if (err == noErr && chName) {
            CFStringGetCString(chName, nameBuf, sizeof(nameBuf), kCFStringEncodingUTF8);
            CFRelease(chName);
        } else {
            AudioObjectPropertyAddress elNameAddr = {
                kAudioObjectPropertyElementName,
                scope,
                (UInt32)ch
            };
            CFStringRef elName = NULL;
            UInt32 elNameSize = sizeof(CFStringRef);
            err = AudioObjectGetPropertyData(dev, &elNameAddr, 0, NULL, &elNameSize, &elName);
            if (err == noErr && elName) {
                CFStringGetCString(elName, nameBuf, sizeof(nameBuf), kCFStringEncodingUTF8);
                CFRelease(elName);
            }
        }
        json_escape_and_print(nameBuf);
        if (ch < totalChannels) printf(", ");
    }
    putchar(']');
}

int list_devices_json() {
    UInt32 propSize = 0;
    AudioObjectPropertyAddress addr = { kAudioHardwarePropertyDevices, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &addr, 0, NULL, &propSize) != noErr) {
        printf("[]\n");
        return 1;
    }
    int deviceCount = propSize / sizeof(AudioDeviceID);
    AudioDeviceID* devices = (AudioDeviceID*)malloc(propSize);
    if (!devices) {
        printf("[]\n");
        return 1;
    }
    AudioObjectGetPropertyData(kAudioObjectSystemObject, &addr, 0, NULL, &propSize, devices);

    AudioDeviceID defaultInput = 0, defaultOutput = 0;
    UInt32 idSize = sizeof(AudioDeviceID);
    AudioObjectPropertyAddress inAddr = { kAudioHardwarePropertyDefaultInputDevice, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
    AudioObjectGetPropertyData(kAudioObjectSystemObject, &inAddr, 0, NULL, &idSize, &defaultInput);
    AudioObjectPropertyAddress outAddr = { kAudioHardwarePropertyDefaultOutputDevice, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
    AudioObjectGetPropertyData(kAudioObjectSystemObject, &outAddr, 0, NULL, &idSize, &defaultOutput);

    printf("[\n");
    for (int i = 0; i < deviceCount; i++) {
        AudioDeviceID dev = devices[i];
        char nameBuf[256] = {0};
        UInt32 nameSize = sizeof(nameBuf);
        AudioObjectPropertyAddress nameAddr = { kAudioDevicePropertyDeviceName, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
        AudioObjectGetPropertyData(dev, &nameAddr, 0, NULL, &nameSize, nameBuf);

        char uidBuf[256] = {0};
        CFStringRef uidString = NULL;
        UInt32 uidSize = sizeof(CFStringRef);
        AudioObjectPropertyAddress uidAddr = { kAudioDevicePropertyDeviceUID, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
        if (AudioObjectGetPropertyData(dev, &uidAddr, 0, NULL, &uidSize, &uidString) == noErr && uidString) {
            CFStringGetCString(uidString, uidBuf, sizeof(uidBuf), kCFStringEncodingUTF8);
            CFRelease(uidString);
        }

        int inCh = get_channel_count(dev, kAudioDevicePropertyScopeInput);
        int outCh = get_channel_count(dev, kAudioDevicePropertyScopeOutput);

        double sampleRate = 0;
        UInt32 rateSize = sizeof(sampleRate);
        AudioObjectPropertyAddress rateAddr = { kAudioDevicePropertyNominalSampleRate, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
        AudioObjectGetPropertyData(dev, &rateAddr, 0, NULL, &rateSize, &sampleRate);

        printf("  {\"id\": %u, \"name\": \"%s\", \"uid\": \"%s\", \"inputChannels\": %d, \"outputChannels\": %d, \"sampleRate\": %.0f, \"defaultInput\": %s, \"defaultOutput\": %s, \"inputChannelNames\": ",
            dev, nameBuf, uidBuf, inCh, outCh, sampleRate, (dev == defaultInput) ? "true" : "false", (dev == defaultOutput) ? "true" : "false");
        print_channel_names_json(dev, kAudioDevicePropertyScopeInput, inCh);
        printf(", \"outputChannelNames\": ");
        print_channel_names_json(dev, kAudioDevicePropertyScopeOutput, outCh);
        printf("}%s\n", (i == deviceCount - 1) ? "" : ",");
    }
    printf("]\n");
    free(devices);
    return 0;
}

int set_sample_rate(double targetRate, const char* matchName) {
    UInt32 propSize = 0;
    AudioObjectPropertyAddress addr = {
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &addr, 0, NULL, &propSize) != noErr) return 1;
    int deviceCount = propSize / sizeof(AudioDeviceID);
    AudioDeviceID* devices = (AudioDeviceID*)malloc(propSize);
    if (!devices) return 1;
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &addr, 0, NULL, &propSize, devices) != noErr) {
        free(devices);
        return 1;
    }

    AudioDeviceID defaultInput = 0, defaultOutput = 0;
    UInt32 idSize = sizeof(AudioDeviceID);
    AudioObjectPropertyAddress inAddr = { kAudioHardwarePropertyDefaultInputDevice, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
    AudioObjectGetPropertyData(kAudioObjectSystemObject, &inAddr, 0, NULL, &idSize, &defaultInput);
    AudioObjectPropertyAddress outAddr = { kAudioHardwarePropertyDefaultOutputDevice, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
    AudioObjectGetPropertyData(kAudioObjectSystemObject, &outAddr, 0, NULL, &idSize, &defaultOutput);

    int changed = 0;
    for (int i = 0; i < deviceCount; i++) {
        AudioDeviceID dev = devices[i];
        char nameBuf[256] = {0};
        UInt32 nameSize = sizeof(nameBuf);
        AudioObjectPropertyAddress nameAddr = { kAudioDevicePropertyDeviceName, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
        AudioObjectGetPropertyData(dev, &nameAddr, 0, NULL, &nameSize, nameBuf);

        int match = 0;
        if (matchName && strlen(matchName) > 0) {
            if (strcasestr(nameBuf, matchName) != NULL) match = 1;
        } else {
            if (dev == defaultInput || dev == defaultOutput) match = 1;
        }

        if (match) {
            AudioObjectPropertyAddress rateAddr = {
                kAudioDevicePropertyNominalSampleRate,
                kAudioObjectPropertyScopeGlobal,
                kAudioObjectPropertyElementMain
            };
            double currentRate = 0;
            UInt32 rateSize = sizeof(currentRate);
            AudioObjectGetPropertyData(dev, &rateAddr, 0, NULL, &rateSize, &currentRate);

            OSStatus setStatus = AudioObjectSetPropertyData(dev, &rateAddr, 0, NULL, sizeof(targetRate), &targetRate);
            if (setStatus == noErr) {
                printf("Set '%s' (ID %u) from %.0f Hz to %.0f Hz\n", nameBuf, dev, currentRate, targetRate);
                changed++;
            }
        }
    }
    free(devices);
    return changed > 0 ? 0 : 1;
}

int set_input_volume(float volume) {
    if (volume < 0.0f) volume = 0.0f;
    if (volume > 1.0f) volume = 1.0f;

    AudioDeviceID defaultInput = 0;
    UInt32 idSize = sizeof(AudioDeviceID);
    AudioObjectPropertyAddress inAddr = { kAudioHardwarePropertyDefaultInputDevice, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &inAddr, 0, NULL, &idSize, &defaultInput) != noErr) return 1;

    AudioObjectPropertyAddress volAddr = {
        kAudioDevicePropertyVolumeScalar,
        kAudioDevicePropertyScopeInput,
        kAudioObjectPropertyElementMain
    };
    OSStatus status = AudioObjectSetPropertyData(defaultInput, &volAddr, 0, NULL, sizeof(volume), &volume);
    if (status != noErr) {
        AudioObjectPropertyAddress ch1Addr = {
            kAudioDevicePropertyVolumeScalar,
            kAudioDevicePropertyScopeInput,
            1
        };
        status = AudioObjectSetPropertyData(defaultInput, &ch1Addr, 0, NULL, sizeof(volume), &volume);
    }
    printf("Set input device %u volume to %.2f (status: %d)\n", defaultInput, volume, (int)status);
    return status == noErr ? 0 : 1;
}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        printf("Usage:\n  set-rate <sample_rate_hz> [device_name]\n  set-rate volume <0.0-1.0>\n  set-rate devices\n");
        return 1;
    }

    if (strcmp(argv[1], "devices") == 0 || strcmp(argv[1], "list") == 0) {
        return list_devices_json();
    }

    if (strcmp(argv[1], "volume") == 0 && argc >= 3) {
        float vol = atof(argv[2]);
        return set_input_volume(vol);
    }

    double rate = atof(argv[1]);
    const char* match = (argc >= 3) ? argv[2] : NULL;
    return set_sample_rate(rate, match);
}
