#!/bin/bash

mkdir -p dist
rm dist/* 
# gpp src/aboutProcesses.js > dist/aboutProcesses.js
./include.py > dist/aboutProcesses.js
