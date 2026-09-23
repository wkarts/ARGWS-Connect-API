Unicode true
RequestExecutionLevel user
CRCCheck force
SetCompressor /SOLID lzma
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "${BUILD_DIR}\build.nsh"
Name "Connect|API - Find Hub Auth"
OutFile "${BUILD_DIR}\${EXT_EXE}"
InstallDir "$LOCALAPPDATA\ARGWS\ConnectFindHubAuth"
Icon "${BUILD_DIR}\connect-findhub.ico"
UninstallIcon "${BUILD_DIR}\connect-findhub.ico"
VIProductVersion "${EXT_VERSION_NUM}"
VIAddVersionKey /LANG=1046 "ProductName" "Connect|API - Find Hub Auth"
VIAddVersionKey /LANG=1046 "FileDescription" "Instalador por usuário da extensão Find Hub Auth"
VIAddVersionKey /LANG=1046 "FileVersion" "${EXT_VERSION}"
VIAddVersionKey /LANG=1046 "LegalCopyright" "ARGWS"
Var Dialog
Var BrowserChoice
Var BrowserExe
Var BrowserScheme
Var BrowserSelect
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Extensão Find Hub Auth ${EXT_VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Instala ou atualiza os arquivos da extensão em uma pasta fixa do seu usuário.$\r$\n$\r$\nO Chrome/Edge exige sua confirmação: na primeira instalação, ative Modo do desenvolvedor e escolha Carregar sem compactação; nas atualizações, clique em Recarregar.$\r$\n$\r$\nNão altera políticas, perfis, permissões ou sessões do navegador. Não instala serviços e não solicita senha Google.$\r$\n$\r$\nEste binário não tem assinatura Authenticode. Não desative as proteções do Windows para executá-lo."
!insertmacro MUI_PAGE_WELCOME
Page custom BrowserPage BrowserLeave
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "Arquivos da extensão preparados"
!define MUI_FINISHPAGE_TEXT "A instalação dos arquivos foi concluída; a extensão ainda precisa ser habilitada/recarregada pelo navegador.$\r$\n$\r$\nPasta para Carregar sem compactação:$\r$\n$INSTDIR\extension$\r$\n$\r$\nVersão ${EXT_VERSION}. O instalador não confirma login no Google."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Abrir navegador e pasta para concluir a instalação"
!define MUI_FINISHPAGE_RUN_FUNCTION OpenBrowser
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"
Function .onInit
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\ARGWS.FindHubAuth.Setup") p .r0 ?e'
  Pop $1
  ${If} $1 == 183
    MessageBox MB_ICONSTOP "Outra instalação Find Hub Auth já está em execução." /SD IDOK
    SetErrorLevel 4
    Quit
  ${EndIf}
  SetShellVarContext current
  StrCpy $BrowserChoice "Google Chrome"
  StrCpy $INSTDIR "$LOCALAPPDATA\ARGWS\ConnectFindHubAuth"
FunctionEnd
Function BrowserPage
  nsDialogs::Create 1018
  Pop $Dialog
  ${NSD_CreateLabel} 0 0 100% 45u "Selecione onde concluir a instalação. Compatibilidade inicial: Chrome e Edge de computador. Outros navegadores Chromium dependem das APIs e políticas de cada fabricante."
  Pop $0
  ${NSD_CreateDropList} 0 50u 100% 80u ""
  Pop $BrowserSelect
  ${NSD_CB_AddString} $BrowserSelect "Google Chrome"
  ${NSD_CB_AddString} $BrowserSelect "Microsoft Edge"
  ${NSD_CB_AddString} $BrowserSelect "Outro Chromium (abrir instruções)"
  ${NSD_CB_SelectString} $BrowserSelect "Google Chrome"
  ${NSD_CreateLabel} 0 87u 100% 55u "A etapa final é manual por segurança do navegador. Atualizações substituem somente a pasta desta extensão; o ID permanece o mesmo. Mantenha os arquivos nesta pasta após carregar a extensão."
  Pop $0
  nsDialogs::Show
FunctionEnd
Function BrowserLeave
  ${NSD_GetText} $BrowserSelect $BrowserChoice
FunctionEnd
Function OpenBrowser
  StrCpy $BrowserExe ""
  ${If} $BrowserChoice == "Google Chrome"
    StrCpy $BrowserScheme "chrome://extensions/"
    ReadRegStr $BrowserExe HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" ""
    ${If} $BrowserExe == ""
      ReadRegStr $BrowserExe HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" ""
    ${EndIf}
    ${If} $BrowserExe == ""
      StrCpy $BrowserExe "$PROGRAMFILES64\Google\Chrome\Application\chrome.exe"
    ${EndIf}
  ${ElseIf} $BrowserChoice == "Microsoft Edge"
    StrCpy $BrowserScheme "edge://extensions/"
    ReadRegStr $BrowserExe HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe" ""
    ${If} $BrowserExe == ""
      StrCpy $BrowserExe "$PROGRAMFILES32\Microsoft\Edge\Application\msedge.exe"
    ${EndIf}
  ${EndIf}
  IfFileExists "$BrowserExe" 0 guide
    Exec '$\"$BrowserExe$\" $\"$BrowserScheme$\"'
  guide:
  ExecShell "open" "$INSTDIR\GUIA.html"
  ExecShell "open" "$INSTDIR\extension"
FunctionEnd
Section "Instalar/atualizar"
  SetShellVarContext current
  StrCpy $INSTDIR "$LOCALAPPDATA\ARGWS\ConnectFindHubAuth"
  IfFileExists "$INSTDIR\extension\*.*" 0 stage
    IfFileExists "$INSTDIR\installed-by-connect.json" stage 0
    MessageBox MB_ICONSTOP "A pasta já existe sem marcador deste instalador. Nenhum arquivo foi alterado." /SD IDOK
    SetErrorLevel 2
    Quit
  stage:
  IfFileExists "$INSTDIR\.previous\*.*" 0 proceed
    MessageBox MB_ICONSTOP "Há um backup de instalação pendente em .previous. Preserve-o e revise os arquivos antes de tentar novamente." /SD IDOK
    SetErrorLevel 3
    Quit
  proceed:
  ClearErrors
  SetOutPath "$INSTDIR\.stage"
  File "${SOURCE_DIR}\manifest.json"
  File "${SOURCE_DIR}\policy.js"
  File "${SOURCE_DIR}\background.js"
  File "${SOURCE_DIR}\vault-page.js"
  File "${SOURCE_DIR}\vault-relay.js"
  File "${SOURCE_DIR}\approve.html"
  File "${SOURCE_DIR}\approve.js"
  File "${SOURCE_DIR}\approve.css"
  File "${SOURCE_DIR}\README.md"
  SetOutPath "$INSTDIR\.stage\icons"
  File "${SOURCE_DIR}\icons\*.png"
  IfErrors failstage
  SetOutPath "$INSTDIR"
  IfFileExists "$INSTDIR\extension\*.*" 0 promote
    Rename "$INSTDIR\extension" "$INSTDIR\.previous"
    IfErrors failstage
  promote:
  ClearErrors
  Rename "$INSTDIR\.stage" "$INSTDIR\extension"
  IfErrors rollback
  ClearErrors
  File /oname=installed-by-connect.json "${BUILD_DIR}\extension-release.json"
  File /oname=GUIA.html "${SOURCE_DIR}\installer\guide.html"
  File /oname=icon.png "${SOURCE_DIR}\icons\icon-128.png"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  IfErrors rollback
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ConnectFindHubAuth" "DisplayName" "Connect|API - Find Hub Auth (arquivos da extensão)"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ConnectFindHubAuth" "DisplayVersion" "${EXT_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ConnectFindHubAuth" "Publisher" "ARGWS"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ConnectFindHubAuth" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ConnectFindHubAuth" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ConnectFindHubAuth" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ConnectFindHubAuth" "NoRepair" 1
  CreateDirectory "$SMPROGRAMS\ARGWS"
  CreateShortcut "$SMPROGRAMS\ARGWS\Find Hub Auth - Instruções.lnk" "$INSTDIR\GUIA.html"
  RMDir /r "$INSTDIR\.previous"
  SetErrorLevel 0
  Goto done
  rollback:
    RMDir /r "$INSTDIR\extension"
    Rename "$INSTDIR\.previous" "$INSTDIR\extension"
  failstage:
    RMDir /r "$INSTDIR\.stage"
    MessageBox MB_ICONSTOP "Não foi possível atualizar os arquivos. A versão anterior foi preservada quando disponível. Feche as abas da extensão e tente novamente. Não apague o backup .previous." /SD IDOK
    SetErrorLevel 1
    Quit
  done:
SectionEnd
Section "Uninstall"
  SetShellVarContext current
  IfFileExists "$INSTDIR\installed-by-connect.json" 0 unend
    RMDir /r "$INSTDIR\extension"
    Delete "$INSTDIR\GUIA.html"
    Delete "$INSTDIR\icon.png"
    Delete "$INSTDIR\installed-by-connect.json"
    Delete "$INSTDIR\Uninstall.exe"
    Delete "$SMPROGRAMS\ARGWS\Find Hub Auth - Instruções.lnk"
    RMDir "$SMPROGRAMS\ARGWS"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ConnectFindHubAuth"
    RMDir "$INSTDIR"
  unend:
SectionEnd
