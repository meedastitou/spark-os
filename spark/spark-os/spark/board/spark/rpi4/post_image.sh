#!/bin/bash -e
source ${BR2_EXTERNAL_SPARK_PATH}/release.sh

BOARD_NAME="rpi4"
REL_DIR="${BINARIES_DIR}/spark_${BOARD_NAME}_${RELEASE}"

#create the rel dir
rm -rf "${REL_DIR}"
mkdir -p "${REL_DIR}"

# copy over files
FILELIST="rootfs.squashfs \
bcm2711-rpi-4-b.dtb \
rpi-firmware/start4.elf \
rpi-firmware/fixup4.dat \
rpi-firmware/bootcode.bin \
zImage"
for f in ${FILELIST} ; do
	rsync -a ${BINARIES_DIR}/${f} ${REL_DIR}
done

# overlays
OVERLAYLIST="i2c-rtc \
rpi-poe"
mkdir -p "${REL_DIR}/overlays"
for f in ${OVERLAYLIST} ; do
	rsync -a "${BINARIES_DIR}/rpi-firmware/overlays/${f}.dtbo" \
		"${REL_DIR}/overlays"
done

# config files
rsync -a "${BR2_EXTERNAL_SPARK_PATH}/board/spark/${BOARD_NAME}/cmdline.txt" \
	"${REL_DIR}/cmdline.txt"
rsync -a "${BR2_EXTERNAL_SPARK_PATH}/board/spark/${BOARD_NAME}/config.txt" \
	"${REL_DIR}/config.txt"

source ${BR2_EXTERNAL_SPARK_PATH}/board/spark/common/post_image.sh "$@"
