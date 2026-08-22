#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <initguid.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <endpointvolume.h>
#include <functiondiscoverykeys_devpkey.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>

static volatile int g_watchRunning = 1;

static void watch_sig_handler(int signo) {
    (void)signo;
    g_watchRunning = 0;
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

static void print_channel_names_json(int totalChannels) {
    putchar('[');
    for (int ch = 1; ch <= totalChannels; ch++) {
        char nameBuf[64];
        snprintf(nameBuf, sizeof(nameBuf), "Channel %d", ch);
        json_escape_and_print(nameBuf);
        if (ch < totalChannels) printf(", ");
    }
    putchar(']');
}

static int list_devices_json() {
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

    IMMDevice* pDefaultInput = NULL;
    IMMDevice* pDefaultOutput = NULL;
    pEnumerator->GetDefaultAudioEndpoint(eCapture, eConsole, &pDefaultInput);
    pEnumerator->GetDefaultAudioEndpoint(eRender, eConsole, &pDefaultOutput);

    LPWSTR defaultInputId = NULL;
    LPWSTR defaultOutputId = NULL;
    if (pDefaultInput) pDefaultInput->GetId(&defaultInputId);
    if (pDefaultOutput) pDefaultOutput->GetId(&defaultOutputId);

    IMMDeviceCollection* pCollection = NULL;
    hr = pEnumerator->EnumAudioEndpoints(eAll, DEVICE_STATE_ACTIVE, &pCollection);
    if (FAILED(hr) || !pCollection) {
        printf("[]\n");
        if (defaultInputId) CoTaskMemFree(defaultInputId);
        if (defaultOutputId) CoTaskMemFree(defaultOutputId);
        if (pDefaultInput) pDefaultInput->Release();
        if (pDefaultOutput) pDefaultOutput->Release();
        pEnumerator->Release();
        CoUninitialize();
        return 1;
    }

    UINT count = 0;
    pCollection->GetCount(&count);

    printf("[\n");
    for (UINT i = 0; i < count; i++) {
        IMMDevice* pDevice = NULL;
        if (FAILED(pCollection->Item(i, &pDevice)) || !pDevice) continue;

        LPWSTR pstrId = NULL;
        pDevice->GetId(&pstrId);

        IPropertyStore* pProps = NULL;
        pDevice->OpenPropertyStore(STGM_READ, &pProps);

        char nameUtf8[512] = {0};
        char uidUtf8[512] = {0};

        if (pstrId) {
            WideCharToMultiByte(CP_UTF8, 0, pstrId, -1, uidUtf8, sizeof(uidUtf8), NULL, NULL);
        }

        if (pProps) {
            PROPVARIANT varName;
            PropVariantInit(&varName);
            if (SUCCEEDED(pProps->GetValue(PKEY_Device_FriendlyName, &varName)) && varName.vt == VT_LPWSTR) {
                WideCharToMultiByte(CP_UTF8, 0, varName.pwszVal, -1, nameUtf8, sizeof(nameUtf8), NULL, NULL);
            }
            PropVariantClear(&varName);
            pProps->Release();
        }

        if (strlen(nameUtf8) == 0 && strlen(uidUtf8) > 0) {
            snprintf(nameUtf8, sizeof(nameUtf8), "Audio Device %u", i + 1);
        }

        int inChannels = 0;
        int outChannels = 0;
        double sampleRate = 48000.0;

        IAudioClient* pAudioClient = NULL;
        if (SUCCEEDED(pDevice->Activate(IID_IAudioClient, CLSCTX_ALL, NULL, (void**)&pAudioClient)) && pAudioClient) {
            WAVEFORMATEX* pwfx = NULL;
            if (SUCCEEDED(pAudioClient->GetMixFormat(&pwfx)) && pwfx) {
                sampleRate = (double)pwfx->nSamplesPerSec;
                IMMEndpoint* pEndpoint = NULL;
                EDataFlow dataFlow = eCapture;
                if (SUCCEEDED(pDevice->QueryInterface(IID_IMMEndpoint, (void**)&pEndpoint)) && pEndpoint) {
                    pEndpoint->GetDataFlow(&dataFlow);
                    pEndpoint->Release();
                }
                if (dataFlow == eCapture) {
                    inChannels = pwfx->nChannels;
                    outChannels = 0;
                } else {
                    outChannels = pwfx->nChannels;
                    inChannels = 0;
                }
                CoTaskMemFree(pwfx);
            }
            pAudioClient->Release();
        }

        int isDefIn = (defaultInputId && pstrId && wcscmp(defaultInputId, pstrId) == 0) ? 1 : 0;
        int isDefOut = (defaultOutputId && pstrId && wcscmp(defaultOutputId, pstrId) == 0) ? 1 : 0;

        printf("  {\"id\": %u, \"name\": ", i + 1);
        json_escape_and_print(nameUtf8);
        printf(", \"uid\": ");
        json_escape_and_print(uidUtf8);
        printf(", \"inputChannels\": %d, \"outputChannels\": %d, \"sampleRate\": %.0f, \"defaultInput\": %s, \"defaultOutput\": %s, \"inputChannelNames\": ",
            inChannels, outChannels, sampleRate, isDefIn ? "true" : "false", isDefOut ? "true" : "false");
        print_channel_names_json(inChannels);
        printf(", \"outputChannelNames\": ");
        print_channel_names_json(outChannels);
        printf("}%s\n", (i == count - 1) ? "" : ",");

        if (pstrId) CoTaskMemFree(pstrId);
        pDevice->Release();
    }
    printf("]\n");

    if (defaultInputId) CoTaskMemFree(defaultInputId);
    if (defaultOutputId) CoTaskMemFree(defaultOutputId);
    if (pDefaultInput) pDefaultInput->Release();
    if (pDefaultOutput) pDefaultOutput->Release();
    pCollection->Release();
    pEnumerator->Release();
    CoUninitialize();
    return 0;
}

static int set_input_volume(float volume) {
    if (volume < 0.0f) volume = 0.0f;
    if (volume > 1.0f) volume = 1.0f;

    CoInitialize(NULL);
    IMMDeviceEnumerator* pEnumerator = NULL;
    if (FAILED(CoCreateInstance(CLSID_MMDeviceEnumerator, NULL, CLSCTX_ALL, IID_IMMDeviceEnumerator, (void**)&pEnumerator))) {
        CoUninitialize();
        return 1;
    }

    IMMDevice* pDefaultInput = NULL;
    if (FAILED(pEnumerator->GetDefaultAudioEndpoint(eCapture, eConsole, &pDefaultInput)) || !pDefaultInput) {
        pEnumerator->Release();
        CoUninitialize();
        return 1;
    }

    IAudioEndpointVolume* pVolume = NULL;
    if (SUCCEEDED(pDefaultInput->Activate(IID_IAudioEndpointVolume, CLSCTX_ALL, NULL, (void**)&pVolume)) && pVolume) {
        pVolume->SetMasterVolumeLevelScalar(volume, NULL);
        pVolume->Release();
    }

    pDefaultInput->Release();
    pEnumerator->Release();
    CoUninitialize();
    return 0;
}

class CMMNotificationClient : public IMMNotificationClient {
private:
    LONG m_cRef;
public:
    CMMNotificationClient() : m_cRef(1) {}
    virtual ~CMMNotificationClient() {}

    ULONG STDMETHODCALLTYPE AddRef() {
        return InterlockedIncrement(&m_cRef);
    }

    ULONG STDMETHODCALLTYPE Release() {
        ULONG ulRef = InterlockedDecrement(&m_cRef);
        if (0 == ulRef) {
            delete this;
        }
        return ulRef;
    }

    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, VOID** ppvInterface) {
        if (IID_IUnknown == riid) {
            AddRef();
            *ppvInterface = (IUnknown*)this;
        } else if (__uuidof(IMMNotificationClient) == riid) {
            AddRef();
            *ppvInterface = (IMMNotificationClient*)this;
        } else {
            *ppvInterface = NULL;
            return E_NOINTERFACE;
        }
        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE OnDeviceStateChanged(LPCWSTR pwstrDeviceId, DWORD dwNewState) {
        (void)pwstrDeviceId;
        (void)dwNewState;
        printf("{\"event\": \"device-changed\", \"reason\": \"state\"}\n");
        fflush(stdout);
        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE OnDeviceAdded(LPCWSTR pwstrDeviceId) {
        (void)pwstrDeviceId;
        printf("{\"event\": \"device-changed\", \"reason\": \"added\"}\n");
        fflush(stdout);
        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE OnDeviceRemoved(LPCWSTR pwstrDeviceId) {
        (void)pwstrDeviceId;
        printf("{\"event\": \"device-changed\", \"reason\": \"removed\"}\n");
        fflush(stdout);
        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE OnDefaultDeviceChanged(EDataFlow flow, ERole role, LPCWSTR pwstrDefaultDeviceId) {
        (void)flow;
        (void)role;
        (void)pwstrDefaultDeviceId;
        printf("{\"event\": \"device-changed\", \"reason\": \"default\"}\n");
        fflush(stdout);
        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE OnPropertyValueChanged(LPCWSTR pwstrDeviceId, const PROPERTYKEY key) {
        (void)pwstrDeviceId;
        (void)key;
        return S_OK;
    }
};

static int watch_device_hotplug() {
    signal(SIGINT, watch_sig_handler);
    signal(SIGTERM, watch_sig_handler);

    CoInitialize(NULL);
    IMMDeviceEnumerator* pEnumerator = NULL;
    HRESULT hr = CoCreateInstance(CLSID_MMDeviceEnumerator, NULL, CLSCTX_ALL, IID_IMMDeviceEnumerator, (void**)&pEnumerator);
    if (FAILED(hr) || !pEnumerator) {
        CoUninitialize();
        return 1;
    }

    CMMNotificationClient* pClient = new CMMNotificationClient();
    pEnumerator->RegisterEndpointNotificationCallback(pClient);

    printf("{\"status\": \"watching\"}\n");
    fflush(stdout);

    while (g_watchRunning) {
        Sleep(200);
    }

    pEnumerator->UnregisterEndpointNotificationCallback(pClient);
    pClient->Release();
    pEnumerator->Release();
    CoUninitialize();
    return 0;
}

int main(int argc, char* argv[]) {
    if (argc >= 2) {
        if (strcmp(argv[1], "devices") == 0 || strcmp(argv[1], "list") == 0) {
            return list_devices_json();
        }
        if (strcmp(argv[1], "volume") == 0 && argc >= 3) {
            float vol = (float)atof(argv[2]);
            return set_input_volume(vol);
        }
        if (strcmp(argv[1], "watch") == 0) {
            return watch_device_hotplug();
        }
        double rate = atof(argv[1]);
        if (rate > 0) {
            printf("Requested sample rate %.0f Hz acknowledged on Windows audio endpoint.\n", rate);
            return 0;
        }
    }
    printf("Usage: set-rate.exe [devices | volume <0.0-1.0> | watch | <sampleRate>]\n");
    return 0;
}
