#!/bin/bash

skip_db_file=false
while [ $# -gt 0 ]; do
    case $1 in 
        -h | --help) 
            echo "Supported flags"
            echo "--skip-db-file : Skip generation of DB migration file"
            exit 0
            shift ;;
       --skip-db-file)
            skip_db_file=true
            shift ;;
        *)
            echo "Unknown option $1"
            exit 1 ;;
    esac
done

sqd codegen

sqd build

if [ "$skip_db_file" = false ]; then 
    echo "Make sure Docker is running ... "
    sqd up
    sqd migration:generate
else 
    echo "Skipping generation of DB Migration File"
fi

sqd typegen
