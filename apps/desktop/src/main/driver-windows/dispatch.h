#ifndef JAMEET_REMOTE_DRIVER_DISPATCH_H
#define JAMEET_REMOTE_DRIVER_DISPATCH_H

#ifdef _WIN32
#include <ntddk.h>
#include <portcls.h>
#else
#include <stdint.h>
#include <stdbool.h>
#endif

#include "../bridge/jameet_remote_abi.h"
#include "../bridge/jameet_remote_win32_ioctl.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Initialize kernel-owned shared section and map permanent kernel view.
 */
NTSTATUS JaMeetDispatch_InitSection(void);

/**
 * Teardown kernel shared section and unmap views.
 */
void JaMeetDispatch_TeardownSection(void);

/**
 * Install PortCls dispatch wrappers on DriverObject while preserving PortCls internal handlers.
 */
NTSTATUS JaMeetDispatch_InstallPortClsHooks(PDRIVER_OBJECT DriverObject);

/**
 * Get the permanent kernel-mapped shared segment pointer (for real-time WaveRT engine).
 */
JaMeetSharedSegment* JaMeetDispatch_GetKernelSharedSegment(void);

#ifdef __cplusplus
}
#endif

#endif /* JAMEET_REMOTE_DRIVER_DISPATCH_H */
