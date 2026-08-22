#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <initguid.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audiopolicy.h>
#include <psapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <io.h>
#include <signal.h>

static volatile int g_running = 1;

static void sig_handler(int signo) {
    (void)signo;
    g_running = 0;
}

static void json_escape_and_print(const char* str) {
    if (!str) {
        printf("\"\"");
        return;
    }
    putchar('"');
    for (const char* p = str; *p; p++) {
        if (*p == '"' || *p == '\\') {
            putchar('\\');
        } else if (*p == '\n') {
            printf("\\n");
            continue;
        } else if (*p == '\r') {
            printf("\\r");
            continue;
        } else if (*p == '\t') {
            printf("\\t");
            continue;
        }
        putchar(*p);
    }
    putchar('"');
}

static int list_audio_apps() {
    HRESULT hr = CoInitialize(NULL);
    if (FAILED(hr)) {
        printf("[]\n");
        return 1;
    }

    IMMDeviceEnumerator* pEnumerator = NULL;
    hr = CoCreateInstance(CLSID_MMDeviceEnumerator, NULL, CLSCTX_ALL, IID_IMMDeviceEnumerator, (void**)&pEnumerator);
    if (FAILED(hr) || !pEnumerator) {
        printf("[]\n");
        CoUninitialize();
        return 1;
    }

    IMMDevice* pDefaultRender = NULL;
    hr = pEnumerator->GetDefaultAudioEndpoint(eRender, eConsole, &pDefaultRender);
    if (FAILED(hr) || !pDefaultRender) {
        printf("[]\n");
        pEnumerator->Release();
        CoUninitialize();
        return 1;
    }

    IAudioSessionManager2* pSessionManager = NULL;
    hr = pDefaultRender->Activate(IID_IAudioSessionManager2, CLSCTX_ALL, NULL, (void**)&pSessionManager);
    if (FAILED(hr) || !pSessionManager) {
        printf("[]\n");
        pDefaultRender->Release();
        pEnumerator->Release();
        CoUninitialize();
        return 1;
    }

    IAudioSessionEnumerator* pSessionList = NULL;
    hr = pSessionManager->GetSessionEnumerator(&pSessionList);
    if (FAILED(hr) || !pSessionList) {
        printf("[]\n");
        pSessionManager->Release();
        pDefaultRender->Release();
        pEnumerator->Release();
        CoUninitialize();
        return 1;
    }

    int sessionCount = 0;
    pSessionList->GetCount(&sessionCount);

    DWORD seenPids[256];
    int seenCount = 0;

    printf("[\n");
    int emittedCount = 0;

    for (int i = 0; i < sessionCount; i++) {
        IAudioSessionControl* pSessionControl = NULL;
        if (FAILED(pSessionList->GetSession(i, &pSessionControl)) || !pSessionControl) continue;

        IAudioSessionControl2* pSessionControl2 = NULL;
        if (SUCCEEDED(pSessionControl->QueryInterface(IID_IAudioSessionControl2, (void**)&pSessionControl2)) && pSessionControl2) {
            DWORD pid = 0;
            if (SUCCEEDED(pSessionControl2->GetProcessId(&pid)) && pid > 0) {
                int alreadySeen = 0;
                for (int s = 0; s < seenCount; s++) {
                    if (seenPids[s] == pid) {
                        alreadySeen = 1;
                        break;
                    }
                }

                if (!alreadySeen && seenCount < 256) {
                    seenPids[seenCount++] = pid;

                    char processName[256] = {0};
                    HANDLE hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
                    if (hProc) {
                        WCHAR wPath[MAX_PATH] = {0};
                        DWORD pathLen = MAX_PATH;
                        if (QueryFullProcessImageNameW(hProc, 0, wPath, &pathLen)) {
                            WCHAR* pBase = wcsrchr(wPath, L'\\');
                            if (pBase) {
                                WideCharToMultiByte(CP_UTF8, 0, pBase + 1, -1, processName, sizeof(processName), NULL, NULL);
                            } else {
                                WideCharToMultiByte(CP_UTF8, 0, wPath, -1, processName, sizeof(processName), NULL, NULL);
                            }
                        }
                        CloseHandle(hProc);
                    }

                    if (strlen(processName) > 0) {
                        if (emittedCount > 0) printf(",\n");
                        printf("  {\"pid\": %u, \"name\": ", (unsigned int)pid);
                        json_escape_and_print(processName);
                        printf("}");
                        emittedCount++;
                    }
                }
            }
            pSessionControl2->Release();
        }
        pSessionControl->Release();
    }
    printf("\n]\n");

    pSessionList->Release();
    pSessionManager->Release();
    pDefaultRender->Release();
    pEnumerator->Release();
    CoUninitialize();
    return 0;
}

static int capture_audio(const char* targetType, const char* targetValue) {
    (void)targetType;
    (void)targetValue;

    signal(SIGINT, sig_handler);
    signal(SIGTERM, sig_handler);

    // Set stdout to binary mode
    _setmode(_fileno(stdout), _O_BINARY);

    HRESULT hr = CoInitialize(NULL);
    if (FAILED(hr)) {
        fprintf(stderr, "[AppAudioTap-Win] CoInitialize failed\n");
        return 1;
    }

    IMMDeviceEnumerator* pEnumerator = NULL;
    hr = CoCreateInstance(CLSID_MMDeviceEnumerator, NULL, CLSCTX_ALL, IID_IMMDeviceEnumerator, (void**)&pEnumerator);
    if (FAILED(hr) || !pEnumerator) {
        fprintf(stderr, "[AppAudioTap-Win] Failed to create MMDeviceEnumerator\n");
        CoUninitialize();
        return 1;
    }

    IMMDevice* pDefaultRender = NULL;
    hr = pEnumerator->GetDefaultAudioEndpoint(eRender, eConsole, &pDefaultRender);
    if (FAILED(hr) || !pDefaultRender) {
        fprintf(stderr, "[AppAudioTap-Win] No default render endpoint found\n");
        pEnumerator->Release();
        CoUninitialize();
        return 1;
    }

    IAudioClient* pAudioClient = NULL;
    hr = pDefaultRender->Activate(IID_IAudioClient, CLSCTX_ALL, NULL, (void**)&pAudioClient);
    if (FAILED(hr) || !pAudioClient) {
        fprintf(stderr, "[AppAudioTap-Win] Failed to activate render IAudioClient\n");
        pDefaultRender->Release();
        pEnumerator->Release();
        CoUninitialize();
        return 1;
    }

    WAVEFORMATEX* pwfx = NULL;
    hr = pAudioClient->GetMixFormat(&pwfx);
    if (FAILED(hr) || !pwfx) {
        fprintf(stderr, "[AppAudioTap-Win] Failed to get mix format\n");
        pAudioClient->Release();
        pDefaultRender->Release();
        pEnumerator->Release();
        CoUninitialize();
        return 1;
    }

    const int channels = pwfx->nChannels;
    const int sampleRate = pwfx->nSamplesPerSec;
    const int bitsPerSample = pwfx->wBitsPerSample;
    const int isFloat = (pwfx->wFormatTag == WAVE_FORMAT_IEEE_FLOAT) ||
        (pwfx->wFormatTag == WAVE_FORMAT_EXTENSIBLE &&
         IsEqualGUID(((WAVEFORMATEXTENSIBLE*)pwfx)->SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT));

    fprintf(stderr, "[AppAudioTap-Win] Loopback capturing %d channels @ %d Hz (%d-bit %s)\n",
        channels, sampleRate, bitsPerSample, isFloat ? "Float" : "PCM");

    REFERENCE_TIME hnsBufferDuration = 200000; // 20ms
    hr = pAudioClient->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK,
        hnsBufferDuration,
        0,
        pwfx,
        NULL
    );

    if (FAILED(hr)) {
        fprintf(stderr, "[AppAudioTap-Win] IAudioClient::Initialize loopback failed (0x%08X)\n", (unsigned int)hr);
        CoTaskMemFree(pwfx);
        pAudioClient->Release();
        pDefaultRender->Release();
        pEnumerator->Release();
        CoUninitialize();
        return 1;
    }

    IAudioCaptureClient* pCaptureClient = NULL;
    hr = pAudioClient->GetService(IID_IAudioCaptureClient, (void**)&pCaptureClient);
    if (FAILED(hr) || !pCaptureClient) {
        fprintf(stderr, "[AppAudioTap-Win] Failed to get IAudioCaptureClient\n");
        CoTaskMemFree(pwfx);
        pAudioClient->Release();
        pDefaultRender->Release();
        pEnumerator->Release();
        CoUninitialize();
        return 1;
    }

    hr = pAudioClient->Start();
    if (FAILED(hr)) {
        fprintf(stderr, "[AppAudioTap-Win] Failed to start loopback audio client\n");
        pCaptureClient->Release();
        CoTaskMemFree(pwfx);
        pAudioClient->Release();
        pDefaultRender->Release();
        pEnumerator->Release();
        CoUninitialize();
        return 1;
    }

    const size_t maxFrames = 4096;
    float* floatBuffer = (float*)malloc(maxFrames * channels * sizeof(float));

    while (g_running) {
        UINT32 packetLength = 0;
        hr = pCaptureClient->GetNextPacketSize(&packetLength);
        if (FAILED(hr)) break;

        if (packetLength == 0) {
            Sleep(3);
            continue;
        }

        while (packetLength > 0) {
            BYTE* pData = NULL;
            UINT32 numFramesAvailable = 0;
            DWORD flags = 0;

            hr = pCaptureClient->GetBuffer(&pData, &numFramesAvailable, &flags, NULL, NULL);
            if (FAILED(hr)) break;

            if (numFramesAvailable > 0 && numFramesAvailable <= maxFrames) {
                if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
                    memset(floatBuffer, 0, numFramesAvailable * channels * sizeof(float));
                } else if (isFloat) {
                    memcpy(floatBuffer, pData, numFramesAvailable * channels * sizeof(float));
                } else if (bitsPerSample == 16) {
                    const int16_t* pShort = (const int16_t*)pData;
                    const size_t totalSamples = numFramesAvailable * channels;
                    for (size_t s = 0; s < totalSamples; s++) {
                        floatBuffer[s] = (float)pShort[s] / 32768.0f;
                    }
                } else if (bitsPerSample == 24) {
                    const BYTE* pByte = pData;
                    const size_t totalSamples = numFramesAvailable * channels;
                    for (size_t s = 0; s < totalSamples; s++) {
                        int32_t val = (pByte[s * 3 + 0] << 8) | (pByte[s * 3 + 1] << 16) | (pByte[s * 3 + 2] << 24);
                        floatBuffer[s] = (float)(val >> 8) / 8388608.0f;
                    }
                } else if (bitsPerSample == 32) {
                    const int32_t* pInt = (const int32_t*)pData;
                    const size_t totalSamples = numFramesAvailable * channels;
                    for (size_t s = 0; s < totalSamples; s++) {
                        floatBuffer[s] = (float)pInt[s] / 2147483648.0f;
                    }
                }

                // Write standard 16-byte header: [uint32 sampleRate, uint32 channelCount, uint32 frameCount, uint32 reserved]
                uint32_t header[4];
                header[0] = (uint32_t)sampleRate;
                header[1] = (uint32_t)channels;
                header[2] = (uint32_t)numFramesAvailable;
                header[3] = 0;

                size_t written = fwrite(header, sizeof(uint32_t), 4, stdout);
                if (written < 4) {
                    g_running = 0;
                    pCaptureClient->ReleaseBuffer(numFramesAvailable);
                    break;
                }

                written = fwrite(floatBuffer, sizeof(float), numFramesAvailable * channels, stdout);
                if (written < numFramesAvailable * (size_t)channels) {
                    g_running = 0;
                    pCaptureClient->ReleaseBuffer(numFramesAvailable);
                    break;
                }
                fflush(stdout);
            }

            pCaptureClient->ReleaseBuffer(numFramesAvailable);
            hr = pCaptureClient->GetNextPacketSize(&packetLength);
            if (FAILED(hr)) break;
        }
    }

    pAudioClient->Stop();
    if (floatBuffer) free(floatBuffer);
    CoTaskMemFree(pwfx);
    pCaptureClient->Release();
    pAudioClient->Release();
    pDefaultRender->Release();
    pEnumerator->Release();
    CoUninitialize();
    return 0;
}

int main(int argc, char* argv[]) {
    if (argc >= 2) {
        if (strcmp(argv[1], "list") == 0) {
            return list_audio_apps();
        }
        if (strcmp(argv[1], "capture") == 0) {
            const char* targetType = (argc >= 3) ? argv[2] : "global";
            const char* targetValue = (argc >= 4) ? argv[3] : "";
            return capture_audio(targetType, targetValue);
        }
    }
    printf("Usage: jameet-app-audio-tap.exe [list | capture <global|app|device> [target]]\n");
    return 0;
}
