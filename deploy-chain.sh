#!/bin/bash

build_dir="build"
flag="--no-stream-logs -o [organization_name]"
SHELL="bash -c"

if [[ $OSTYPE -eq "win32" || $OSTYPE -eq "msys" ]]; then
    echo "OS: Window"
    SHELL="wt -w 0 nt -d . cmd //K"
elif [ $OSTYPE -eq "darwin" ]; then
    echo "TODO: Add support for MacOS"
    exit 0
else
    echo "Unsupported platform ${OSTYPE}"
    exit 1
fi

while [ $# -gt 0 ]; do
    case $1 in 
        --hard-reset) 
            echo "Hard reset is enabled..."
            flag="${flag} --hard-reset"
            shift ;;
        *)
            echo "Unknown option $1"
            exit 1 ;;
    esac
done

if [ -d "$build_dir" ]; then
    echo "Build directory found ..."
else 
    echo "Build directory doesn't exist. Try compiling chain first"
    exit 0
fi

for entry in `ls $build_dir`; do

    ${SHELL} "sqd deploy -m $build_dir/$entry ${flag}"
done