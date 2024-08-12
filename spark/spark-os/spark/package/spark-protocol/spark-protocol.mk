################################################################################
#
# spark-protocol
#
################################################################################

SPARK_PROTOCOL_VERSION = local
SPARK_PROTOCOL_SITE = $(SPARKDIR)
SPARK_PROTOCOL_SITE_METHOD = local
SPARK_PROTOCOL_INSTALL_STAGING = YES
SPARK_PROTOCOL_DEPENDENCIES = nodejs host-yarn
SPARK_PROTOCOL_LICENSE = Proprietary
SPARK_PROTOCOL_REDISTRIBUTE = NO

SPARK_PROTOCOL_MODULES = \
	$(addprefix file://$(@D)/, $(call qstrip, $(BR2_PACKAGE_SPARK_PROTOCOL_MODULES)))

define SPARK_PROTOCOL_NODEJS_LICENCES
	@$(call GET_NODEJS_LICENCES,spark-protocol)
endef

SPARK_PROTOCOL_PRE_LEGAL_INFO_HOOKS += SPARK_PROTOCOL_NODEJS_LICENCES

define SPARK_PROTOCOL_USERS
	spark-protocol -1 spark-protocol -1 * /usr/lib/node_modules/spark-protocol /bin/false connman-users,cert-admins Spark Protocol
endef

define SPARK_PROTOCOL_PERMISSIONS
	/var/lib/spark/logs d 0750 spark-protocol spark-protocol - - - - -
endef

# Only call YARN if there's something to install.
ifneq ($(SPARK_PROTOCOL_MODULES),)
define SPARK_PROTOCOL_INSTALL_MODULES
	(cd $(@D)/spark-protocol && \
		$(YARN) add $(SPARK_PROTOCOL_MODULES))
endef
endif

define SPARK_PROTOCOL_BUILD_CMDS
	#Install the spark-protocol-modules
	$(SPARK_PROTOCOL_INSTALL_MODULES)

	(cd $(@D)/spark-protocol && \
		$(YARN) install --production)

	#Remove unwanted files
	$(BR2_EXTERNAL_SPARK_PATH)/cleanup-node_modules.sh $(@D)/spark-protocol $(TARGET_READELF) $(BR2_READELF_ARCH_NAME)
endef

define SPARK_PROTOCOL_INSTALL_STAGING_CMDS
	$(INSTALL) -m 0755 -d $(STAGING_DIR)/usr/lib/node_modules/spark-protocol
	rsync -au --chmod=u=rwX,go=rX \
		--delete \
		$(RSYNC_VCS_EXCLUSIONS) \
		$(@D)/spark-protocol/ $(STAGING_DIR)/usr/lib/node_modules/spark-protocol/
endef

define SPARK_PROTOCOL_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0644 $(BR2_EXTERNAL_SPARK_PATH)/package/spark-protocol/etc.spark.spark-protocol \
		$(TARGET_DIR)/etc/spark/spark-protocol

	$(INSTALL) -D -m 0440 $(BR2_EXTERNAL_SPARK_PATH)/package/spark-protocol/etc.sudoers.d.spark-protocol \
		$(TARGET_DIR)/etc/sudoers.d/spark-protocol

	$(INSTALL) -D -m 0644 $(BR2_EXTERNAL_SPARK_PATH)/package/spark-protocol/spark-protocol.pkla \
		$(TARGET_DIR)/etc/polkit-1/localauthority/55-spark.d/10-spark-protocol.pkla

	$(INSTALL) -D -m 0755 $(BR2_EXTERNAL_SPARK_PATH)/package/spark-protocol/usr.sbin.spark-protocol-prestart \
		$(TARGET_DIR)/usr/sbin/spark-protocol-prestart

	$(INSTALL) -m 0755 -d $(TARGET_DIR)/usr/lib/node_modules/spark-protocol
	rsync -au --chmod=u=rwX,go=rX \
		--delete \
		$(RSYNC_VCS_EXCLUSIONS) \
		$(@D)/spark-protocol/ $(TARGET_DIR)/usr/lib/node_modules/spark-protocol/
	ln -sf ../../usr/lib/node_modules/spark-protocol/bin/spark-protocol \
		$(TARGET_DIR)/usr/bin/spark-protocol
endef

define SPARK_PROTOCOL_INSTALL_INIT_SYSTEMD
	$(INSTALL) -D -m 0644 $(BR2_EXTERNAL_SPARK_PATH)/package/spark-protocol/spark-protocol.service \
		$(TARGET_DIR)/usr/lib/systemd/system/spark-protocol.service
	mkdir -p $(TARGET_DIR)/etc/systemd/system/multi-user.target.wants
	ln -fs ../../../../usr/lib/systemd/system/spark-protocol.service \
		$(TARGET_DIR)/etc/systemd/system/multi-user.target.wants/spark-protocol.service
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
