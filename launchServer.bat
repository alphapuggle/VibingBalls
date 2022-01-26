@echo off
:start
cls
echo Gamemodes:
echo 0: FFA
echo 1: TEAMS (WIP)
echo.
set /p gamemode= Enter Gamemode: 
echo %gamemode%
:restart
cls
node server.js %gamemode%
if %errorlevel% == 2 (
    goto restart
)
pause
goto start