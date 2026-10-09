@echo off
rem ===========================================================================
rem  NetRunner one-click setup (Windows 10/11).
rem  Double-click this file. It installs Node.js if needed, installs NetRunner,
rem  adds NetRunner to the Desktop and Start menu, and opens it.
rem  Safe to run again: re-running repairs the install or updates the shortcuts
rem  (for example after moving this folder).
rem
rem  Developer option:  "Setup NetRunner.cmd" --no-shortcuts
rem  installs only (no shortcuts, does not open the app).
rem ===========================================================================
setlocal EnableExtensions
title NetRunner setup
cd /d "%~dp0"

set "NO_SHORTCUTS="
if /i "%~1"=="--no-shortcuts" set "NO_SHORTCUTS=1"

echo.
echo   =============================================
echo     NETRUNNER SETUP
echo   =============================================
echo.
echo   This takes a few minutes. Leave this window open until it says DONE.
echo.

rem --- 1. Must be run from an extracted folder, not from inside the zip -------
if not exist "%~dp0package.json" goto :not_extracted
rem Opening a file inside a zip makes Windows copy it to a folder like %TEMP%\Temp1_NetRunner.zip\
echo "%~dp0" | findstr /i /r /c:"\\Temp[0-9]*_.*\.zip" >nul && goto :not_extracted

rem --- 2. Node.js 22 or newer -------------------------------------------------
echo   [1/4] Checking for Node.js...
call :find_node
if defined NODE_EXE call :node_new_enough
if defined NODE_OK goto :have_node

echo         Node.js 22 or newer is needed. Installing it now...
where winget >nul 2>nul || goto :no_winget
echo         Windows may ask for permission to install Node.js. Click Yes.
winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
set "NODE_EXE="
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE goto :node_install_failed
call :node_new_enough
if not defined NODE_OK goto :node_install_failed

:have_node
for %%D in ("%NODE_EXE%") do set "NODE_DIR=%%~dpD"
set "PATH=%NODE_DIR%;%PATH%"
<nul set /p "=        Using Node.js "
"%NODE_EXE%" --version

rem --- 3. NetRunner must be closed (its files are in use while it runs) ------
"%NODE_EXE%" -e "fetch('http://127.0.0.1:8787/api/health',{signal:AbortSignal.timeout(1500)}).then(()=>process.exit(1),()=>process.exit(0))"
if errorlevel 1 goto :app_running

rem --- 4. Install NetRunner's parts ------------------------------------------
echo.
echo   [2/4] Installing NetRunner (this is the slow part)...
call "%NODE_DIR%npm.cmd" ci --no-audit --no-fund --loglevel=error
if errorlevel 1 goto :npm_failed

rem --- 5. Settings file (keys are entered later, inside the app) -------------
echo.
echo   [3/4] Preparing settings...
if not exist ".env" copy /y ".env.example" ".env" >nul
echo         OK

rem --- 6. Desktop + Start menu shortcuts, then open the app ------------------
if defined NO_SHORTCUTS goto :done_no_shortcuts
echo.
echo   [4/4] Adding NetRunner to your Desktop and Start menu...
call "%NODE_DIR%npm.cmd" run --silent install:desktop
if errorlevel 1 goto :shortcut_failed

start "" "%SystemRoot%\System32\conhost.exe" --headless "%NODE_EXE%" --import tsx src/desktop.ts

echo.
echo   =============================================
echo     DONE. NetRunner is opening now.
echo   =============================================
echo.
echo   From now on, open it with the NetRunner icon on your Desktop
echo   or by searching "NetRunner" in the Start menu.
echo.
echo   In the app:
echo     1. Start tab: pick a template.
echo     2. AI Writer tab: paste your Gemini or Claude key.
echo        (Or choose Free Copy-Paste mode, which needs no key.)
echo     3. Press Save.
echo.
echo   Do not move or delete this folder: NetRunner runs from here.
echo   If you do move it, double-click Setup NetRunner again.
echo.
pause
exit /b 0

:done_no_shortcuts
echo.
echo   DONE (installed without shortcuts).
exit /b 0

rem ===========================================================================
rem  Helpers
rem ===========================================================================
:find_node
set "NODE_EXE="
for /f "delims=" %%N in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
exit /b 0

:node_new_enough
set "NODE_OK="
"%NODE_EXE%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" >nul 2>nul && set "NODE_OK=1"
exit /b 0

rem ===========================================================================
rem  Problems, explained in plain English
rem ===========================================================================
:not_extracted
echo   PROBLEM: this file was opened from inside the zip.
echo.
echo   1. Close this window.
echo   2. Right-click the NetRunner zip and choose "Extract All...".
echo   3. Pick a folder you will keep (for example Documents\NetRunner).
echo   4. Open the extracted folder and double-click "Setup NetRunner" there.
echo.
pause
exit /b 1

:no_winget
echo.
echo   PROBLEM: Node.js could not be installed automatically on this PC.
echo.
echo   1. Your browser will open nodejs.org. Download the "LTS" version and install it
echo      (keep clicking Next).
echo   2. Then double-click "Setup NetRunner" again.
echo.
start "" "https://nodejs.org/en/download"
pause
exit /b 1

:node_install_failed
echo.
echo   PROBLEM: Node.js did not install (maybe the permission prompt was declined).
echo.
echo   Double-click "Setup NetRunner" again and click Yes when Windows asks,
echo   or install the LTS version yourself from https://nodejs.org and then re-run this.
echo.
pause
exit /b 1

:app_running
echo.
echo   PROBLEM: NetRunner is open right now.
echo.
echo   Close the NetRunner window, wait a few seconds, then double-click
echo   "Setup NetRunner" again.
echo.
pause
exit /b 1

:npm_failed
echo.
echo   PROBLEM: installing NetRunner's parts failed (see the messages above).
echo.
echo   Check your internet connection and run "Setup NetRunner" again.
echo   If it keeps failing, send a screenshot of this window to whoever gave you NetRunner.
echo.
pause
exit /b 1

:shortcut_failed
echo.
echo   PROBLEM: NetRunner is installed, but the Desktop shortcut could not be created.
echo.
echo   Run "Setup NetRunner" again. If it keeps failing, send a screenshot of this window
echo   to whoever gave you NetRunner.
echo.
pause
exit /b 1
