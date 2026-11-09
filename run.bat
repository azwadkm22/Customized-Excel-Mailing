@echo off
rem Starts the Mailing Webapp and opens it in the default browser.
cd /d "%~dp0"

set URL=http://127.0.0.1:5001

start "Mailing Webapp" cmd /c python app.py

timeout /t 2 /nobreak >nul
start "" "%URL%"
