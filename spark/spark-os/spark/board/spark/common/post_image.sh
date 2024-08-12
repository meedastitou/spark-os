#!/bin/bash -e
source ${BR2_EXTERNAL_SPARK_PATH}/release.sh

LINUX_DIR=$2
GENIMAGE_CFG="${BR2_EXTERNAL_SPARK_PATH}/board/spark/${BOARD_NAME}/genimage.cfg"
GENIMAGE_TMP="${BUILD_DIR}/genimage.tmp"

# initramfs
echo "Creating initramfs ..."
rm -f "${REL_DIR}/initramfs.cpio.xz"
rm -rf "${BUILD_DIR}/initramfs.tmp"
mkdir -p "${BUILD_DIR}/initramfs.tmp"

LD_LINUX=$(basename ${TARGET_DIR}/lib/ld-linux-*)
sed -e "s/__LD_LINUX__/${LD_LINUX}/g" \
	"${BR2_EXTERNAL_SPARK_PATH}/board/spark/common/initramfs/initramfs_list" \
	> "${BUILD_DIR}/initramfs.tmp/initramfs_list"

# gen_initramfs_list was moved from scripts to usr
# after about kernel 4.18.0 so test which one exists
if [ -x "${LINUX_DIR}/usr/gen_initramfs_list.sh" ] ; then
	GEN_INITRAMFS_LIST="./usr/gen_initramfs_list.sh"
elif [ -x "${LINUX_DIR}/usr/gen_initramfs.sh" ] ; then
	GEN_INITRAMFS_LIST="./usr/gen_initramfs.sh"
else
	GEN_INITRAMFS_LIST="./scripts/gen_initramfs_list.sh"
fi

cd ${LINUX_DIR} &&	\
	${GEN_INITRAMFS_LIST} \
	-o "${REL_DIR}/initramfs.cpio.xz" \
	"${BUILD_DIR}/initramfs.tmp/initramfs_list"

MKIMAGE=${HOST_DIR}/usr/bin/mkimage
if [ -x ${MKIMAGE} ] && [ ! -z ${MKIMAGE_ARCH+x} ] ; then
	echo "Creating initramfs (uboot) ..."
	${MKIMAGE} -A ${MKIMAGE_ARCH} -T ramdisk -C none \
		-d "${REL_DIR}/initramfs.cpio.xz" "${REL_DIR}/initramfs.cpio.uboot"
	rm -f "${REL_DIR}/initramfs.cpio.xz"
fi

# include the spark-release file
cp -a ${TARGET_DIR}/etc/spark-release ${REL_DIR}/spark-release

# create sdcard.img
echo "Creating sd card image ..."
rm -f ${BINARIES_DIR}/rel
ln -s ${REL_DIR} ${BINARIES_DIR}/rel
rm -rf "${GENIMAGE_TMP}"
MTOOLS_SKIP_CHECK=1 genimage \
  --rootpath "${TARGET_DIR}" \
  --tmppath "${GENIMAGE_TMP}" \
  --inputpath "${BINARIES_DIR}" \
  --outputpath "${BINARIES_DIR}" \
  --config "${GENIMAGE_CFG}"

# create release zip files
(
	cd ${BINARIES_DIR}

	echo "Creating spark_${BOARD_NAME}_${RELEASE}.zip ..."
	rm -f "${BINARIES_DIR}/spark_${BOARD_NAME}_${RELEASE}.zip"
	zip -q -r "${BINARIES_DIR}/spark_${BOARD_NAME}_${RELEASE}.zip" "spark_${BOARD_NAME}_${RELEASE}"

	echo "Creating spark_${BOARD_NAME}_${RELEASE}_sdcard.img.zip ..."
	mv sdcard.img "spark_${BOARD_NAME}_${RELEASE}_sdcard.img"
	rm -f "${BINARIES_DIR}/spark_${BOARD_NAME}_${RELEASE}_sdcard.img.zip"
	zip -q -r "${BINARIES_DIR}/spark_${BOARD_NAME}_${RELEASE}_sdcard.img.zip" "spark_${BOARD_NAME}_${RELEASE}_sdcard.img"
)
