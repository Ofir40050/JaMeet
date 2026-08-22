!macro customInstall
  ; Automated Windows virtual audio driver installation is disabled to guarantee clean, uninterrupted desktop client installation.
  ; Driver sources, INF, and scripts remain bundled in resources/driver-windows for optional manual setup.
  DetailPrint "Skipping automated Windows virtual audio driver installation..."
!macroend

!macro customUnInstall
  DetailPrint "Cleaning up JaMeet application files..."
!macroend
