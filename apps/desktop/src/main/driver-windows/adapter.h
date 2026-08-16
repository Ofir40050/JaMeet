#ifndef JAMEET_REMOTE_ADAPTER_H
#define JAMEET_REMOTE_ADAPTER_H

#ifdef _WIN32
#include <ntddk.h>
#include <portcls.h>
#endif

#ifdef __cplusplus
extern "C" {
#endif

#ifdef _WIN32
DRIVER_INITIALIZE DriverEntry;
DRIVER_ADD_DEVICE AddDevice;
#endif

#ifdef __cplusplus
}
#endif

#endif /* JAMEET_REMOTE_ADAPTER_H */
