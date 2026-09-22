@echo off
rem novelMaster install (Windows) - pure ASCII shell.
rem All logic and messages live in scripts/install.mjs (Node).
rem See docs/design/decisions.md pitfall 4.10 for why this file must stay ASCII.
node "%~dp0scripts\install.mjs"
echo.
pause
