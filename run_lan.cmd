@echo off
setlocal

set "ROOT=C:\Users\hithe\Documents\SIDE_QUESTS\Trade_Screens"

echo Starting backend on 0.0.0.0:8010...
start "Trade_Screens Backend (LAN)" cmd /k "cd /d %ROOT% && python -m uvicorn backend.main:app --host 0.0.0.0 --port 8010"

echo Starting frontend on 0.0.0.0:5173...
start "Trade_Screens Frontend (LAN)" cmd /k "cd /d %ROOT%\frontend && set VITE_PROXY_TARGET=http://127.0.0.1:8010 && npm run dev -- --host 0.0.0.0 --port 5173 --strictPort"

echo.
echo Open from this PC: http://127.0.0.1:5173
echo Open from LAN device: http://YOUR_PC_IP:5173
echo.
echo To find your PC IP, run: ipconfig
echo.
echo If LAN devices cannot connect, allow inbound firewall for ports 5173 and 8010.

endlocal
