#!/bin/bash

mkdir -p dist
rm dist/* 
./include.py > dist/taskmonitor_part1.uc.js
cp src/taskmonitor_part2.uc.js dist/
cp src/taskmonitor_part3_clearMemoryPeriodically.uc.js dist/taskmonitor_part3_clearMemoryPeriodically.uc.js
