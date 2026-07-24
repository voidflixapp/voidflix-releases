; ==================== VOIDFLIX NSIS CUSTOMIZATION ====================
; Included by electron-builder during the NSIS installer build.
; Adds: custom branding strings, watch history preservation on uninstall.
; ======================================================================

; Custom installer header text
!define MUI_WELCOMEPAGE_TITLE       "Welcome to Voidflix"
!define MUI_WELCOMEPAGE_TEXT        "Voidflix will be installed on your computer.$\n$\nThis includes the movie and TV browser, retro game emulator, and Discord integration.$\n$\nClick Next to continue."
!define MUI_FINISHPAGE_TITLE        "Voidflix is Ready"
!define MUI_FINISHPAGE_TEXT         "Voidflix has been installed.$\nClick Finish to launch it now."

; Keep user data (watch history, settings) on uninstall — only remove app files
!macro customUnInstall
    ; Intentionally empty — watch_progress and settings live in
    ; %APPDATA%\Voidflix and are preserved across reinstalls.
    ; Users can clear them manually from Settings > Clear Data inside the app.
!macroend

; No-op customInstall — electron-builder handles the rest
!macro customInstall
!macroend
