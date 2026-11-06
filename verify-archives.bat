@echo off
setlocal

set VERSION=0.3.3
set DIST_DIR=executas\speakup-ai\dist\speakup-ai\%VERSION%

echo.
echo === SpeakUp AI Archive Verification (v%VERSION%) ===
echo.
echo Checking directory: %DIST_DIR%
echo.

if not exist "%DIST_DIR%" (
    echo ERROR: Directory %DIST_DIR% does not exist.
    echo Download the archives from the GitHub Release first.
    exit /b 1
)

set ALL_FOUND=1

for %%A in (
    speakup-ai-%VERSION%-darwin-arm64.tar.gz
    speakup-ai-%VERSION%-darwin-x86_64.tar.gz
    speakup-ai-%VERSION%-linux-x86_64.tar.gz
    speakup-ai-%VERSION%-windows-x86_64.zip
) do (
    if exist "%DIST_DIR%\%%A" (
        echo [OK] %%A
        certutil -hashfile "%DIST_DIR%\%%A" SHA256 2>nul | findstr /v "hash certutil"
    ) else (
        echo [MISSING] %%A
        set ALL_FOUND=0
    )
)

echo.
if "%ALL_FOUND%"=="1" (
    echo All 4 archives found. Compare SHA-256 values above with the .sha256 files from the Release.
    echo.
    echo Next steps:
    echo   1. In executas\speakup-ai\executa.json, change "active": "local" to "active": "binary"
    echo   2. Run: anna-app validate --strict
    echo   3. Run: anna-app apps publish
    echo   4. Run: anna-app apps submit-review speakup-ai
) else (
    echo Some archives are missing. Download them from the GitHub Release page.
)

endlocal
