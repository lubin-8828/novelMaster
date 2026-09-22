@echo off
rem novelMaster uninstall (Windows) - pure ASCII shell.
rem All logic and messages live in scripts/uninstall.mjs (Node).
rem See docs/design/decisions.md pitfall 4.10 for why this file must stay ASCII.
node "%~dp0scripts\uninstall.mjs"
echo.
pause
