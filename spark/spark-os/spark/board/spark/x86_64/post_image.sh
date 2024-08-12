#!/bin/bash -e
source ${BR2_EXTERNAL_SPARK_PATH}/release.sh

BOARD_NAME="x86_64"
REL_DIR="${BINARIES_DIR}/spark_${BOARD_NAME}_${RELEASE}"

#create the rel dir
rm -rf "${REL_DIR}"
mkdir -p "${REL_DIR}"

rsync -a "${BR2_EXTERNAL_SPARK_PATH}/board/spark/${BOARD_NAME}/syslinux.cfg" \
    "${REL_DIR}/syslinux.cfg"
rsync -a "${BINARIES_DIR}/rootfs.squashfs" "${REL_DIR}"
rsync -a "${BINARIES_DIR}/bzImage" "${REL_DIR}"

source ${BR2_EXTERNAL_SPARK_PATH}/board/spark/common/post_image.sh "$@"
