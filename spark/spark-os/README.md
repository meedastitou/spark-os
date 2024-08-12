# Spark OS

Spark OS is based on [buildroot](https://buildroot.org/). Building Spark OS will produce all the firmware necessary to run Spark on a chosen platform. The Spark OS has the following component:

1. A cross compile toolchain
2. Linux kernel
3. rootfs.squashfs, squashfs based read-only root filesystem
4. initramfs, mounts rootfs.squashfs and overlays a read write tmpfs
5. The sd card or usb flash drive is mounted as `/boot`
6. Once the system is booted `/boot/data.ext4` is mounted to `/data` for persistent storage
7. All the parts of the Spark software stack are contained in the rootfs.squashfs

# Building

To build Spark OS for all platforms type

```
make
```

To build for only one platform specify that platforms name, for example to build only for the rpi3 type

```
make rpi3
```

The built firmware will end up in the `rel` directory. The output from the build will be located in `output/spark-<platform>`

# Updating

To update Spark OS to the latest version of buildroot consider the following steps

1. Update the buildroot version in the Makefile

2. run `make buildroot` which will download the new buildroot version and apply the patches from the `buildroot-patches` directory. This step is likely to initially fail as the patches will need to be adjusted. You will need to examine the patches and decided what changes are needed. Some patches can simple be deleted because the fix is now already in buildroot. Other patches will need to be updated. To update a patch try:

    1. git clone buildroot
    2. check out the old version of buildroot
    3. `git checkout -b spark` to create a spark branch
    4. `git am ../buildroot-patches/*` to apply all the patches
    5. `git rebase master` to update and fix the patches as you go
    6. Once done use `git format-patch` to export the updated patches can copy them back to the `buildroot-patches` directory
    7. finally repeat the `make buildroot` to confirm the pacthes now work

If this does not work, you may need to consider recreating the patch again.

At this point you should have the `buildroot-patches` directory updates and `make buildroot` works

3. type `make source` to download all the new packages
4. next we need to adjust the config files if needed

    1. type `make rpi4_config`
    2. `cd output/spark_rpi4/`
    3. `make menuconfig`
    4. in the menu check for any legacy options which need fixing. Changing buildroot versions can change which packages get included, check the correct packages are included
    5. save and exit the menu
    6. `make savedefconfig` to save the updated config
    7. at this point you can use git diff to check if the config updated
    8. for raspberry pi builds make the kernel version the same the the kernel version in `buildroot/configs/raspberrypi_defconfig`. This the `BR2_LINUX_KERNEL_CUSTOM_TARBALL_LOCATION` config option
    9. repeat these steps for all the supported platforms

At this point the config files for all the platforms should have been updated if needed

5. If connman has been updated you may need to correct the patches in `spark/board/spark/common/patches/connman/`. If the patches are wrong connman may fail to build. You can find the connman source code at <https://git.kernel.org/pub/scm/network/connman/connman.git>

6. finally build the code and test it on the target platforms

# Authors

[Martin Bark](mailto:martin.bark@te.com)
