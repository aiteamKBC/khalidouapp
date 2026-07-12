!include "LogicLib.nsh"

!macro customInstall
  DetailPrint "Installing Kent Consultancy internal trust certificates..."

  File /oname=$PLUGINSDIR\KentConsultancy-Internal-Root-CA.cer "${PROJECT_DIR}\installer\trust\KentConsultancy-Internal-Root-CA.cer"
  File /oname=$PLUGINSDIR\KentConsultancy-Code-Signing-Publisher.cer "${PROJECT_DIR}\installer\trust\KentConsultancy-Code-Signing-Publisher.cer"

  ExecWait '"$SYSDIR\certutil.exe" -f -addstore "Root" "$PLUGINSDIR\KentConsultancy-Internal-Root-CA.cer"' $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "Khaliduo could not install the Kent Consultancy root certificate. Installation will stop."
    Abort
  ${EndIf}

  ExecWait '"$SYSDIR\certutil.exe" -f -addstore "TrustedPublisher" "$PLUGINSDIR\KentConsultancy-Code-Signing-Publisher.cer"' $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "Khaliduo could not trust the Kent Consultancy software publisher. Installation will stop."
    Abort
  ${EndIf}

  Delete "$PLUGINSDIR\KentConsultancy-Internal-Root-CA.cer"
  Delete "$PLUGINSDIR\KentConsultancy-Code-Signing-Publisher.cer"
  DetailPrint "Kent Consultancy trust certificates installed successfully."
!macroend
