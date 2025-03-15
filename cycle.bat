@echo off
:loop
echo Restarting bot...
npx pm2 kill
timeout /t 5 /nobreak
npx pm2 start pm2-process.json
npx pm2 logs

:: Wait for 24 hours (86400 seconds)
timeout /t 86400 /nobreak
goto loop 