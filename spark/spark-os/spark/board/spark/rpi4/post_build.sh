#!/bin/bash -e
TARGET_DIR=$1

source ${BR2_EXTERNAL_SPARK_PATH}/board/spark/common/post_build.sh "$@"

echo "ARCH=rpi4" >> ${TARGET_DIR}/etc/spark-release
