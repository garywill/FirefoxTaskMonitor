#!/usr/bin/python3

def include_files(input_file, output_file):  
    with open(input_file, 'r') as f:  
        lines = f.readlines()  
  
    with open(output_file, 'w') as out:  
        for line in lines:  
            if line.strip().startswith('#include "'):  
                include_file = line.split('"')[1]
                with open('src/'+include_file, 'r') as inc:  
                    out.write(inc.read())  
            else:  
                out.write(line)  
  
# 使用示例  
include_files('src/aboutProcesses.js', '/dev/stdout') 
