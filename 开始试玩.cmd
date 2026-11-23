@echo off
if exist "%~dp0runtime\pythonw.exe" (
    start "" "%~dp0runtime\pythonw.exe" "%~dp0tools\serve.py" --open
    exit /b
)
start "" pyw -3 "%~dp0tools\serve.py" --open
