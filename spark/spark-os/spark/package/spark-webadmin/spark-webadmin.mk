################################################################################
#
# spark-webadmin
#
################################################################################

SPARK_WEBADMIN_VERSION = local
SPARK_WEBADMIN_SITE = $(SPARKDIR)
SPARK_WEBADMIN_SITE_METHOD = local
SPARK_WEBADMIN_INSTALL_STAGING = YES
SPARK_WEBADMIN_DEPENDENCIES = nodejs host-yarn
SPARK_WEBADMIN_LICENSE = Proprietary
SPARK_WEBADMIN_REDISTRIBUTE = NO

define SPARK_WEBADMIN_NODEJS_LICENCES
	@$(call GET_NODEJS_LICENCES,spark-webadmin)
endef

SPARK_WEBADMIN_PRE_LEGAL_INFO_HOOKS += SPARK_WEBADMIN_NODEJS_LICENCES

define SPARK_WEBADMIN_USERS
	spark-webadmin -1 spark-webadmin -1 * /usr/lib/node_modules/spark-webadmin /bin/false - Spark Webadmin
endef

define SPARK_WEBADMIN_BUILD_CMDS
	(cd $(@D)/spark-webadmin && \
		$(YARN) install && \
		$(HOST_CONFIGURE_OPTS) ./node_modules/.bin/grunt)

	(cd $(@D)/spark-webadmin/dist/prod && \
		$(YARN) install --production)

	#Remove unwanted files
	$(BR2_EXTERNAL_SPARK_PATH)/cleanup-node_modules.sh $(@D)/spark-webadmin/dist/prod $(TARGET_READELF) $(BR2_READELF_ARCH_NAME)
endef

define SPARK_WEBADMIN_INSTALL_STAGING_CMDS
	$(INSTALL) -m 0755 -d $(STAGING_DIR)/usr/lib/node_modules/spark-webadmin
	rsync -au --chmod=u=rwX,go=rX \
		--delete \
		$(RSYNC_VCS_EXCLUSIONS) \
		$(@D)/spark-webadmin/dist/prod/ $(STAGING_DIR)/usr/lib/node_modules/spark-webadmin/
endef

define SPARK_WEBADMIN_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0644 $(BR2_EXTERNAL_SPARK_PATH)/package/spark-webadmin/etc.spark.spark-webadmin \
		$(TARGET_DIR)/etc/spark/spark-webadmin

	$(INSTALL) -D -m 0440 $(BR2_EXTERNAL_SPARK_PATH)/package/spark-webadmin/etc.sudoers.d.spark-webadmin \
		$(TARGET_DIR)/etc/sudoers.d/spark-webadmin

	$(INSTALL) -D -m 0755 $(BR2_EXTERNAL_SPARK_PATH)/package/spark-webadmin/usr.sbin.spark-shutdown \
		$(TARGET_DIR)/usr/sbin/spark-shutdown

	$(INSTALL) -m 0755 -d $(TARGET_DIR)/usr/lib/node_modules/spark-webadmin
	rsync -au --chmod=u=rwX,go=rX \
		--delete \
		$(RSYNC_VCS_EXCLUSIONS) \
		$(@D)/spark-webadmin/dist/prod/ $(TARGET_DIR)/usr/lib/node_modules/spark-webadmin/
	ln -sf ../../usr/lib/node_modules/spark-webadmin/bin/spark-webadmin \
		$(TARGET_DIR)/usr/bin/spark-webadmin
endef

define SPARK_WEBADMIN_INSTALL_INIT_SYSTEMD
	$(INSTALL) -D -m 0644 $(BR2_EXTERNAL_SPARK_PATH)/package/spark-webadmin/spark-webadmin.service \
		$(TARGET_DIR)/usr/lib/systemd/system/spark-webadmin.service
	mkdir -p $(TARGET_DIR)/etc/systemd/system/multi-user.target.wants
	ln -fs ../../../../usr/lib/systemd/system/spark-webadmin.service \
		$(TARGET_DIR)/etc/systemd/system/multi-user.target.wants/spark-webadmin.service
endef

#Override the rsyn rule so we can apply some exclusions
$(BUILD_DIR)/%/.stamp_rsynced:
	@$(call MESSAGE,"Syncing from source dir $(SRCDIR)")
	rsync -au --chmod=u=rwX,go=rX $(RSYNC_VCS_EXCLUSIONS) \
		--exclude spark-buildroot/ \
		--exclude spark-os/ \
		--exclude node_modules/ \
		--exclude bower_components/ \
		$(call qstrip,$(SRCDIR))/ $(@D)
	$(Q)touch $@

$(eval $(generic-package))
