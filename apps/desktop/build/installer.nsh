!macro customInstall
  DetailPrint "Installing JaMeet Remote virtual audio driver..."
  nsExec::ExecToLog 'cmd.exe /c "$INSTDIR\resources\driver-windows\install-driver.cmd"'
  Pop $0
  DetailPrint "JaMeet Remote driver install returned: $0"
!macroend

!macro customUnInstall
  DetailPrint "Uninstalling JaMeet Remote virtual audio driver..."
  nsExec::ExecToLog 'cmd.exe /c "$INSTDIR\resources\driver-windows\uninstall-driver.cmd"'
  Pop $0
  DetailPrint "JaMeet Remote driver uninstall returned: $0"
!macroend
