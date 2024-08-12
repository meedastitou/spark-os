################################################################################
#
# spark-hardware
#
################################################################################

SPARK_HARDWARE_VERSION = local
SPARK_HARDWARE_SITE = $(SPARKDIR)
SPARK_HARDWARE_SITE_METHOD = local
SPARK_HARDWARE_INSTALL_STAGING = YES
SPARK_HARDWARE_DEPENDENCIES = nodejs libusb host-yarn
SPARK_HARDWARE_LICENSE = Proprietary
SPARK_HARDWARE_REDISTRIBUTE = NO

SPARK_HARDWARE_MODULES = \
	$(addprefix file://$(@D)/, $(call qstrip, $(BR2_PACKAGE_SPARK_HARDWARE_MODULES)))

define SPARK_HARDWARE_NODEJS_LICENCES
	@$(call GET_NODEJS_LICENCES,spark-hardware)
endef

SPARK_HARDWARE_PRE_LEGAL_INFO_HOOKS += SPARK_HARDWARE_NODEJS_LICENCES

define SPARK_HARDWARE_USERS
	spark-hardware -1 spark-hardware -1 * /usr/lib/node_modules/spark-hardware /bin/false i2c,gpio,dialout,input,storage Spark Hardware
endef

# Only call YARN if there's something to install.
ifneq ($(SPARK_HARDWARE_MODULES),)
define SPARK_HARDWARE_INSTALL_MODULES
	(cd $(@D)/spark-hardware && \
		npm_config_use_system_libusb=true \
			$(YARN) add $(SPARK_HARDWARE_MODULES))
endef
endif

define SPARK_HARDWARE_BUILD_CMDS
	#Install the spark-hardware-modules
	$(SPARK_HARDWARE_INSTALL_MODULES)

	(cd $(@D)/spark-hardware && \
		npm_config_use_system_libusb=true \
			$(YARN) install --production --ignore-engines)

	#Remove unwanted files
	$(BR2_EXTERNAL_SPARK_PATH)/cleanup-node_modules.sh $(@D)/spark-hardware $(TARGET_READELF) $(BR2_READELF_ARCH_NAME)
endef

define SPARK_HARDWARE_INSTALL_STAGING_CMDS
	$(INSTALL) -m 0755 -d $(STAGING_DIR)/usr/lib/node_modules/spark-hardware
	rsync -au --chmod=u=rwX,go=rX \
		--delete \
		$(RSYNC_VCS_EXCLUSIONS) \
		$(@D)/spark-hardware/ $(STAGING_DIR)/usr/lib/node_modules/spark-hardware/
endef

define SPARK_HARDWARE_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0644 $(BR2_EXTERNAL_SPARK_PATH)/package/spark-hardware/etc.spark.spark-hardware \
		$(TARGET_DIR)/etc/spark/spark-hardware

	$(INSTALL) -D -m 0755 $(BR2_EXTERNAL_SPARK_PATH)/package/spark-hardware/usr.sbin.spark-hardware-prestart \
		$(TARGET_DIR)/usr/sbin/spark-hardware-prestart

	$(INSTALL) -m 0755 -d $(TARGET_DIR)/usr/lib/node_modules/spark-hardware
	rsync -au --chmod=u=rwX,go=rX \
		--delete \
		$(RSYNC_VCS_EXCLUSIONS) \
		$(@D)/spark-hardware/ $(TARGET_DIR)/usr/lib/node_modules/spark-hardware/
	ln -sf ../../usr/lib/node_modules/spark-hardware/bin/spark-hardware \
		$(TARGET_DIR)/usr/bin/spark-hardware
endef

define SPARK_HARDWARE_INSTALL_INIT_SYSTEMD
	$(INSTALL) -D -m 0644 $(BR2_EXTERNAL_SPARK_PATH)/package/spark-hardware/spark-hardware.service \
		$(TARGET_DIR)/usr/lib/systemd/system/spark-hardware.service
	mkdir -p $(TARGET_DIR)/etc/systemd/system/multi-user.target.wants
	ln -fs ../../../../usr/lib/systemd/system/spark-hardware.service \
		$(TARGET_DIR)/etc/systemd/system/multi-user.target.wants/spark-hardware.service
endef

#Override the rsyn rule so we can apply some exclusions
$(BUILD_DIR)/%/.stamp_rsynced:
	@$(call MESSAGE,"Syncing from source dir $(SRCDIR)")
	rsync -au --chmod=u=rwX,go=rX $(RSYNC_VCS_EXCLUSIONS) \
		--exclude spark-buildroot/ \
		--exclude spark-os/ \
		--exclude node_modules/ \
		$(call qstrip,$(SRCDIR))/ $(@D)
	$(Q)touch $@

$(eval $(generic-package))
