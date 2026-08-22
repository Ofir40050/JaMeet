#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <initguid.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <avrt.h>
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

static IMMDevice* find_capture_device(IMMDeviceEnumerator* pEnumerator, const char* target) {
    if (!pEnumerator) return NULL;
    IMMDevice* pDevice = NULL;

    if (!target || strlen(target) == 0 || strcmp(target, "default") == 0) {
        if (SUCCEEDED(pEnumerator->GetDefaultAudioEndpoint(eCapture, eConsole, &pDevice))) {
            return pDevice;
        }
        return NULL;
    }

    // Try finding by exact endpoint ID string
    WCHAR wTarget[512] = {0};
    MultiByteToWideChar(CP_UTF8, 0, target, -1, wTarget, 512);

    if (SUCCEEDED(pEnumerator->GetDevice(wTarget, &pDevice)) && pDevice) {
        return pDevice;
    }

    // Try searching collection by substring or index
    IMMDeviceCollection* pCollection = NULL;
    if (SUCCEEDED(pEnumerator->EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE, &pCollection)) && pCollection) {
        UINT count = 0;
        pCollection->GetCount(&count);
        for (UINT i = 0; i < count; i++) {
            IMMDevice* pDev = NULL;
            if (SUCCEEDED(pCollection->Item(i, &pDev)) && pDev) {
                LPWSTR pstrId = NULL;
                pDev->GetId(&pstrId);
                if (pstrId) {
                    char idUtf8[512] = {0};
                    WideCharToMultiByte(CP_UTF8, 0, pstrId, -1, idUtf8, sizeof(idUtf8), NULL, NULL);
                    CoTaskMemFree(pstrId);
                    if (strstr(idUtf8, target) != NULL) {
                        pCollection->Release();
                        return pDev;
                    }
                }
                pDev->Release();
            }
        }
        pCollection->Release();
    }

    // Fallback to default
    pEnumerator->GetDefaultAudioEndpoint(eCapture, eConsole, &pDevice);
    return pDevice;
}

int main(int argc, char* argv[]) {
    signal(SIGINT, sig_handler);
    signal(SIGTERM, sig_handler);

    // Set binary mode for stdout to prevent CRLF corruption
    _setmode(_fileno(stdout), _O_BINARY);

    const char* targetDevice = (argc >= 2) ? argv[1] : "default";

    // Elevate audio engine thread to MMCSS Pro Audio real-time priority
    DWORD taskIndex = 0;
    HANDLE hMmcss = AvSetMmThreadCharacteristicsW(L"Pro Audio", &taskIndex);
    if (!hMmcss) {
        hMmcss = AvSetMmThreadCharacteristicsW(L"Audio", &taskIndex);
    }

    HRESULT hr = CoInitialize(NULL);
    if (FAILED(hr)) {
        fprintf(stderr, "[HardwareAudioCapture-Win] CoInitialize failed\n");
        return 1;
    }

    IMMDeviceEnumerator* pEnumerator = NULL;
    hr = CoCreateInstance(CLSID_MMDeviceEnumerator, NULL, CLSCTX_ALL, IID_IMMDeviceEnumerator, (void**)&pEnumerator);
    if (FAILED(hr) || !pEnumerator) {
        fprintf(stderr, "[HardwareAudioCapture-Win] Failed to create MMDeviceEnumerator\n");
        CoUninitialize();
        return 1;
    }

    IMMDevice* pDevice = find_capture_device(pEnumerator, targetDevice);
    if (!pDevice) {
        fprintf(stderr, "[HardwareAudioCapture-Win] No capture device found for '%s'\n", targetDevice);
        pEnumerator->Release();
        CoUninitialize();
        return 1;
    }

    IAudioClient* pAudioClient = NULL;
    hr = pDevice->Activate(IID_IAudioClient, CLSCTX_ALL, NULL, (void**)&pAudioClient);
    if (FAILED(hr) || !pAudioClient) {
        fprintf(stderr, "[HardwareAudioCapture-Win] Failed to activate IAudioClient (0x%08X)\n", (unsigned int)hr);
        pDevice->Release();
        pEnumerator->Release();
        CoUninitialize();
        return 1;
    }

    WAVEFORMATEX* pwfx = NULL;
    hr = pAudioClient->GetMixFormat(&pwfx);
    if (FAILED(hr) || !pwfx) {
        fprintf(stderr, "[HardwareAudioCapture-Win] Failed to get mix format\n");
        pAudioClient->Release();
        pDevice->Release();
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

    // Query device periodicity for ultra-low latency pro-audio buffer configuration
    REFERENCE_TIME hnsDefaultPeriod = 100000;
    REFERENCE_TIME hnsMinPeriod = 50000;
    pAudioClient->GetDevicePeriod(&hnsDefaultPeriod, &hnsMinPeriod);

    REFERENCE_TIME hnsBufferDuration = (hnsMinPeriod > 0 && hnsMinPeriod <= 100000) ? hnsMinPeriod * 2 : 100000; // 5-10ms

    fprintf(stderr, "[HardwareAudioCapture-Win] Capturing %d channels @ %d Hz (%d-bit %s, period %.1fms)\n",
        channels, sampleRate, bitsPerSample, isFloat ? "Float" : "PCM", (double)hnsBufferDuration / 10000.0);

    DWORD streamFlags = AUDCLNT_STREAMFLAGS_EVENTCALLBACK;

    hr = pAudioClient->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        streamFlags,
        hnsBufferDuration,
        0,
        pwfx,
        NULL
    );

    HANDLE hAudioEvent = CreateEvent(NULL, FALSE, FALSE, NULL);
    if (SUCCEEDED(hr)) {
        pAudioClient->SetEventHandle(hAudioEvent);
    } else {
        // Fallback without event callback if specific audio driver doesn't support event mode
        hr = pAudioClient->Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            0,
            hnsBufferDuration,
            0,
            pwfx,
            NULL
        );
        if (FAILED(hr)) {
            fprintf(stderr, "[HardwareAudioCapture-Win] IAudioClient::Initialize failed (0x%08X)\n", (unsigned int)hr);
            CoTaskMemFree(pwfx);
            pAudioClient->Release();
            pDevice->Release();
            pEnumerator->Release();
            CloseHandle(hAudioEvent);
            CoUninitialize();
            return 1;
        }
    }

    IAudioCaptureClient* pCaptureClient = NULL;
    hr = pAudioClient->GetService(IID_IAudioCaptureClient, (void**)&pCaptureClient);
    if (FAILED(hr) || !pCaptureClient) {
        fprintf(stderr, "[HardwareAudioCapture-Win] Failed to get IAudioCaptureClient\n");
        CoTaskMemFree(pwfx);
        pAudioClient->Release();
        pDevice->Release();
        pEnumerator->Release();
        CloseHandle(hAudioEvent);
        CoUninitialize();
        return 1;
    }

    hr = pAudioClient->Start();
    if (FAILED(hr)) {
        fprintf(stderr, "[HardwareAudioCapture-Win] Failed to start audio client\n");
        pCaptureClient->Release();
        CoTaskMemFree(pwfx);
        pAudioClient->Release();
        pDevice->Release();
        pEnumerator->Release();
        CloseHandle(hAudioEvent);
        CoUninitialize();
        return 1;
    }

    const size_t maxFrames = 4096;
    float* floatBuffer = (float*)malloc(maxFrames * channels * sizeof(float));

    while (g_running) {
        if (hAudioEvent) {
            DWORD waitRes = WaitForSingleObject(hAudioEvent, 20);
            if (waitRes == WAIT_TIMEOUT && !g_running) break;
        }

        UINT32 packetLength = 0;
        hr = pCaptureClient->GetNextPacketSize(&packetLength);
        if (FAILED(hr)) break;

        if (packetLength == 0) {
            if (!hAudioEvent) Sleep(2);
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

                // Write 8-byte standard header: [uint32 totalChannels, uint32 frameCount]
                uint32_t header[2];
                header[0] = (uint32_t)channels;
                header[1] = (uint32_t)numFramesAvailable;

                size_t written = fwrite(header, sizeof(uint32_t), 2, stdout);
                if (written < 2) {
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
    pDevice->Release();
    pEnumerator->Release();
    if (hAudioEvent) CloseHandle(hAudioEvent);
    if (hMmcss) AvRevertMmThreadCharacteristics(hMmcss);
    CoUninitialize();
    return 0;
}
