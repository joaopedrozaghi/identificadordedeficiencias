@echo off
REM Inicia o Ollama usando so o processador (a GTX 1650 de 4 GB nao comporta o llama3.1:8b)
set CUDA_VISIBLE_DEVICES=-1
ollama serve
