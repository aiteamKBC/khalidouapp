!include "LogicLib.nsh"

; Khaliduo installs per user (nsis.perMachine is false) so the internal trust
; chain goes into the current user's certificate stores. No administrator prompt
; is involved, which is what lets background updates install themselves.
!macro khaliduoAddCertificate id storeName certificateFile label
  nsExec::ExecToLog '"$SYSDIR\certutil.exe" -user -f -addstore "${storeName}" "$PLUGINSDIR\${certificateFile}"'
  Pop $0
  ${If} $0 != 0
    ; A silent run is an unattended update. A modal dialog there would hang the
    ; installer forever and leave the employee stranded on the old build, so the
    ; failure is only logged and the update carries on.
    IfSilent khaliduo_cert_warn_${id} khaliduo_cert_stop_${id}
    khaliduo_cert_warn_${id}:
      DetailPrint "Warning: the Kent Consultancy ${label} could not be trusted (certutil returned $0). Khaliduo will continue."
      Goto khaliduo_cert_done_${id}
    khaliduo_cert_stop_${id}:
      MessageBox MB_ICONSTOP|MB_OK "Khaliduo could not install the Kent Consultancy ${label}. Installation will stop." /SD IDOK
      Abort
    khaliduo_cert_done_${id}:
  ${EndIf}
!macroend

!macro customInstall
  DetailPrint "Installing Kent Consultancy internal trust certificates..."

  File /oname=$PLUGINSDIR\KentConsultancy-Internal-Root-CA.cer "${PROJECT_DIR}\release-khaliduo\trust\KentConsultancy-Internal-Root-CA.cer"
  File /oname=$PLUGINSDIR\KentConsultancy-Code-Signing-Publisher.cer "${PROJECT_DIR}\release-khaliduo\trust\KentConsultancy-Code-Signing-Publisher.cer"

  !insertmacro khaliduoAddCertificate "root" "Root" "KentConsultancy-Internal-Root-CA.cer" "root certificate"
  !insertmacro khaliduoAddCertificate "publisher" "TrustedPublisher" "KentConsultancy-Code-Signing-Publisher.cer" "software publisher"

  Delete "$PLUGINSDIR\KentConsultancy-Internal-Root-CA.cer"
  Delete "$PLUGINSDIR\KentConsultancy-Code-Signing-Publisher.cer"
  DetailPrint "Kent Consultancy trust certificates installed successfully."
!macroend
