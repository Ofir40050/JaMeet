!macro customInstall
  DetailPrint "Installing JaMeet Remote virtual audio driver..."
  nsExec::ExecToLog 'cmd.exe /c "$INSTDIR\resources\driver-windows\install-driver.cmd"'
  Pop $0
  DetailPrint "JaMeet Remote driver install returned: $0"
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "Failed to install JaMeet Remote virtual audio driver (error code $0). Please make sure to run installer with Administrator privileges."
    Abort
  ${EndIf}
!macroend

!macro customUnInstall
  DetailPrint "Uninstalling JaMeet Remote virtual audio driver..."
  nsExec::ExecToLog 'cmd.exe /c "$INSTDIR\resources\driver-windows\uninstall-driver.cmd"'
  Pop $0
  DetailPrint "JaMeet Remote driver uninstall returned: $0"
!macroend
