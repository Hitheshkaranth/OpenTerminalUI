@echo off
setlocal
set "PROJECT_ROOT=%~dp0.."
set "PATH=%PROJECT_ROOT%\.forge\bin;%PATH%"
forge.exe %*
exit /b %ERRORLEVEL%
