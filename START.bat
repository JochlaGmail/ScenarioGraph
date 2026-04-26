@echo off
title Entscheidungsbaum - Starter
setlocal

echo.
echo  +--------------------------------------------------+
echo  ^|        Entscheidungsbaum -- Starter              ^|
echo  +--------------------------------------------------+
echo.

:: 1. Node.js pruefen
node --version >nul 2>&1
if %errorlevel% equ 0 goto :NODE_OK

echo  Node.js nicht gefunden -- wird jetzt automatisch installiert...
echo.

:: 2. winget pruefen (Windows 10/11 eingebaut)
winget --version >nul 2>&1
if %errorlevel% equ 0 goto :INSTALL_WINGET

:: 3. Fallback: kein winget vorhanden
echo  Automatische Installation nicht moeglich.
echo  Windows-Paketmanager (winget) nicht gefunden (Windows zu alt?).
echo.
echo  Bitte manuell installieren:
echo    1. https://nodejs.org wird jetzt im Browser geoeffnet
echo    2. Klicke auf den gruenen "LTS"-Button und installiere die Datei
echo    3. Starte danach diese Datei erneut
echo.
start "" "https://nodejs.org"
pause
exit /b 1

:: 4. Installation via winget
:INSTALL_WINGET
echo  Installiere Node.js LTS via Windows-Paketmanager (winget)...
echo  Bitte warte -- das kann 1-2 Minuten dauern.
echo.
winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
if %errorlevel% neq 0 (
    echo.
    echo  Installation fehlgeschlagen oder abgebrochen.
    echo  Bitte manuell von https://nodejs.org installieren.
    echo.
    start "" "https://nodejs.org"
    pause
    exit /b 1
)

echo.
echo  Node.js wurde installiert. Suche node.exe...
echo.

:: 5. PATH neu aufbauen nach Installation

:: Versuch 1: Standardpfad 64-Bit
if exist "%ProgramFiles%\nodejs\node.exe" (
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
    goto :CHECK_NODE
)

:: Versuch 2: Standardpfad 32-Bit
if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
    set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
    goto :CHECK_NODE
)

:: Versuch 3: PATH aus der Windows-Registry neu einlesen
echo  Standardpfade nicht gefunden -- lese PATH aus Registry...
for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%b"
for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USR_PATH=%%b"
if defined SYS_PATH (
    if defined USR_PATH (
        set "PATH=%SYS_PATH%;%USR_PATH%"
    ) else (
        set "PATH=%SYS_PATH%"
    )
)

:CHECK_NODE
node --version >nul 2>&1
if %errorlevel% equ 0 goto :NODE_OK

:: 6. Alle Versuche gescheitert
echo  Node.js wurde installiert, aber kann in dieser Sitzung nicht gefunden werden.
echo.
echo  Bitte dieses Fenster schliessen und START.bat erneut doppelklicken.
echo  (Windows muss den neuen Installationspfad einmalig neu laden.)
echo.
pause
exit /b 0

:: 7. Node.js bereit -- JSONbin-Key pruefen falls noetig -- Server starten
:NODE_OK
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo  Node.js %NODE_VER% bereit.
echo.

:: Pruefen ob JSONbin-Modus aktiv ist
for /f "tokens=*" %%l in ('findstr /i "true" "%~dp0configSettings.json" 2^>nul') do set JSONBIN_ACTIVE=1
if defined JSONBIN_ACTIVE (
    if not defined JSONBIN_API_KEY (
        echo  HINWEIS: configSettings.json hat useJsonBin: true,
        echo  aber die Umgebungsvariable JSONBIN_API_KEY ist nicht gesetzt.
        echo.
        echo  So setzt du die Variable in Windows:
        echo    1. Startmenue oeffnen, nach "Umgebungsvariablen" suchen
        echo    2. "Systemumgebungsvariablen bearbeiten" oeffnen
        echo    3. Unter "Benutzervariablen" auf "Neu" klicken
        echo    4. Name:  JSONBIN_API_KEY
        echo    5. Wert:  dein API-Key von jsonbin.io
        echo    6. Mit OK bestaetigen und diese Datei neu starten
        echo.
        pause
        exit /b 1
    )
)

echo  Server startet...
echo.
echo  Spielansicht : http://localhost:3000/index.html
echo  Graph-Editor : http://localhost:3000/editor.html
echo.
echo  Dieses Fenster offen lassen! Schliessen = Server stoppt.
echo  ----------------------------------------------------------

timeout /t 2 /nobreak >nul
start "" "http://localhost:3000/index.html"

node "%~dp0server.js"

echo.
echo  Server wurde beendet.
pause
endlocal
