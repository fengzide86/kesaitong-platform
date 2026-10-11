@echo off
setlocal EnableExtensions
chcp 65001 >nul

cd /d "%~dp0"
set "PROJECT_ROOT=%~dp0.."
set "VENV_DIR=%PROJECT_ROOT%\venv"
set "PYTHON=%VENV_DIR%\Scripts\python.exe"
if defined TOOLBOX_PYTHON set "PYTHON=%TOOLBOX_PYTHON%"
set "PIP=%VENV_DIR%\Scripts\pip.exe"
if not defined TOOLBOX_RUNTIME_DIR set "TOOLBOX_RUNTIME_DIR=%LOCALAPPDATA%\AmazonToolboxData"

rem This launcher is the explicit local development profile. Internal/release
rem builds continue to use the remote FastAPI service and never bundle this backend.
set "APP_ENV=development"
set "TOOL_EXECUTION_MODE=demo"
set "AI_SUPPORT_MODE=rules"
set "BUNDLED_BACKEND_ENABLED=false"
if not defined PYTHONUTF8 set "PYTHONUTF8=1"
if not defined PYTHONIOENCODING set "PYTHONIOENCODING=utf-8"

echo ============================================
echo   Amazon Toolbox - Local Backend
echo ============================================

if defined TOOLBOX_PYTHON (
    "%PYTHON%" --version >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] TOOLBOX_PYTHON is not runnable. No replacement environment was created.
        goto :failed
    )
)

if not exist "%PYTHON%" (
    where py >nul 2>&1
    if not errorlevel 1 (
        echo [INFO] Creating Python virtual environment...
        py -3.12 -m venv "%VENV_DIR%"
    ) else (
        where python >nul 2>&1
        if errorlevel 1 (
            echo [ERROR] Python 3.12 was not found.
            goto :failed
        )
        echo [INFO] Creating Python virtual environment...
        python -c "import sys; assert sys.version_info[:2] == (3, 12), 'Python 3.12 is required'"
        if errorlevel 1 goto :failed
        python -m venv "%VENV_DIR%"
    )
    if errorlevel 1 goto :failed
)

"%PYTHON%" -c "import sys; assert sys.version_info[:2] == (3, 12), 'Use a separate Python 3.12 environment; existing environments will not be modified'"
if errorlevel 1 goto :failed

if not exist "%TOOLBOX_RUNTIME_DIR%" (
    mkdir "%TOOLBOX_RUNTIME_DIR%"
    if errorlevel 1 goto :failed
)

rem Import the complete application so an old or partially installed venv is
rem repaired whenever a newly required runtime dependency is missing.
"%PYTHON%" -c "import main" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Installing backend dependencies...
    "%PYTHON%" -m pip install -c constraints-py312.txt -r requirements.txt
    if errorlevel 1 goto :failed
)

"%PYTHON%" -m pip check >nul 2>&1
if errorlevel 1 (
    echo [INFO] Repairing inconsistent backend dependencies...
    "%PYTHON%" -m pip install -c constraints-py312.txt -r requirements.txt
    if errorlevel 1 goto :failed
    "%PYTHON%" -m pip check >nul 2>&1
    if errorlevel 1 goto :failed
)

set "DEBUG=false"
echo [INFO] Runtime data: %TOOLBOX_RUNTIME_DIR%
echo [INFO] Backend URL: http://localhost:8000
echo.
"%PYTHON%" main.py
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo [INFO] Backend stopped with exit code %EXIT_CODE%.
if not defined TOOLBOX_NO_PAUSE pause
exit /b %EXIT_CODE%

:failed
echo [ERROR] Local backend could not be started.
if not defined TOOLBOX_NO_PAUSE pause
exit /b 1
