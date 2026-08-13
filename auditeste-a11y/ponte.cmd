@echo off
rem Sobe a ponte do Audi Print. Deixe esta janela aberta enquanto usa os
rem botoes de scan e de cenarios.
rem
rem Para os cenarios de teste por IA, crie um arquivo chave.txt nesta mesma
rem pasta contendo apenas a sua chave da NVIDIA (nvapi-...). Ele fica
rem fora do git. O .env tambem e lido automaticamente.

cd /d "%~dp0"

if exist chave.txt (
  set /p AGENTE_API_KEY=<chave.txt
) else (
  echo.
  echo   Sem chave.txt nesta pasta: a ponte tenta o .env.
  echo   Para habilitar, crie chave.txt com a chave NVIDIA (nvapi-...) ou o .env.
  echo.
)

node servidor.js
echo.
echo A ponte parou. Feche esta janela ou rode de novo.
pause
