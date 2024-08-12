#!/bin/bash -e
TARGET_DIR=$1
TOPDIR=$PWD
BUILT=$(date -u -Isec)

source ${BR2_EXTERNAL_SPARK_PATH}/release.sh
echo "RELEASE=${RELEASE}" > ${TARGET_DIR}/etc/spark-release
echo "BUILT=${BUILT}" >> ${TARGET_DIR}/etc/spark-release
echo "RELEASE=${RELEASE}"

RELEASE_FULL=${RELEASE}$(${TOPDIR}/support/scripts/setlocalversion)
echo "RELEASE_FULL=${RELEASE_FULL}"

echo "NAME=Spark" > ${TARGET_DIR}/etc/os-release
echo "VERSION=${RELEASE_FULL}" >> ${TARGET_DIR}/etc/os-release
echo "ID=spark" >> ${TARGET_DIR}/etc/os-release
echo "VERSION_ID=${RELEASE}" >> ${TARGET_DIR}/etc/os-release
echo "PRETTY_NAME=\"Spark ${RELEASE}\"" >> ${TARGET_DIR}/etc/os-release

#Update the message of the day
sed -i \
    -e "s/Release:.*/Release: ${RELEASE}/" \
    -e "s/Built:.*/Built: ${BUILT}/" \
    ${TARGET_DIR}/etc/motd

#Create mount point for boot
mkdir -p ${TARGET_DIR}/boot

#Remove unwanted files
find ${TARGET_DIR}/usr/lib/node_modules \
    \( -name ".deps" -o -name "obj.target" -o -name "test" -o -name "tests" -o -name "example" -o -name "examples" \) \
    -exec rm -rf '{}' \; 2> /dev/null || true

#Clean up direcotries that will be mounted tmpfs
rm -rf ${TARGET_DIR}/tmp ${TARGET_DIR}/run ${TARGET_DIR}/var/tmp
install -d -m 1777 ${TARGET_DIR}/tmp
install -d -m 1777 ${TARGET_DIR}/var/tmp
install -d -m 0755 ${TARGET_DIR}/run
