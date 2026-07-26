#!/usr/bin/python3

import sys

def include_files(input_file):  
    with open(input_file, 'r') as f:  
        lines = f.readlines()  
  
    for line in lines:  
        if line.strip().startswith('#include "'):  
            include_file = line.split('"')[1]
            with open('src/'+include_file, 'r') as inc:  
                sys.stdout.write(inc.read())  
        else:  
            sys.stdout.write(line)  
  
# 使用示例  
include_files('src/part1_merger.uc.js') 
