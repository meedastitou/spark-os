################################################################################
#
# spark-service-client
#
################################################################################

SPARK_SERVICE_CLIENT_VERSION = local
SPARK_SERVICE_CLIENT_SITE = $(SPARKDIR)
SPARK_SERVICE_CLIENT_SITE_METHOD = local
SPARK_SERVICE_CLIENT_DEPENDENCIES = nodejs host-yarn
SPARK_SERVICE_CLIENT_LICENSE = Proprietary
SPARK_SERVICE_CLIENT_REDISTRIBUTE = NO

define SPARK_SERVICE_CLIENT_NODEJS_LICENCES
	@$(call GET_NODEJS_LICENCES,spark-service-client)
endef

SPARK_SERVICE_CLIENT_PRE_LEGAL_INFO_HOOKS += SPARK_SERVICE_CLIENT_NODEJS_LICENCES

define SPARK_SERVICE_CLIENT_USERS
	spark-service-client -1 spark-service-client -1 * /usr/lib/node_modules/spark-service-client /bin/false host-admins - Spark Service Client
endef

define SPARK_SERVICE_CLIENT_CONFIGURE_CMDS
	rm -rf $(@D)/spark-service-client/node_modules
endef

define SPARK_SERVICE_CLIENT_BUILD_CMDS
	(cd $(@D)/spark-service-client && \
			$(YARN) install --production)
endef

define SPARK_SERVICE_CLIENT_INSTALL_TARGET_CMDS
	$(INSTALL) -m 0755 -d $(TARGET_DIR)/usr/lib/node_modules/spark-service-client
	rsync -au --chmod=u=rwX,go=rX \
		--delete \
		$(RSYNC_VCS_EXCLUSIONS) \
		$(@D)/spark-service-client/ $(TARGET_DIR)/usr/lib/node_modules/spark-service-client/
	ln -sf ../../usr/lib/node_modules/spark-service-client/bin/spark-service-client \
		$(TARGET_DIR)/usr/bin/spark-service-client

	$(INSTALL) -D -m 0644 $(BR2_EXTERNAL_SPARK_PATH)/package/spark-service-client/etc.spark.spark-service-client \
		$(TARGET_DIR)/etc/spark/spark-service-client

	$(INSTALL) -D -m 0440 $(BR2_EXTERNAL_SPARK_PATH)/package/spark-service-client/etc.sudoers.d.spark-service-client \
		$(TARGET_DIR)/etc/sudoers.d/spark-service-client
endef

define SPARK_SERVICE_CLIENT_INSTALL_INIT_SYSTEMD
	$(INSTALL) -D -m 0644 $(BR2_EXTERNAL_SPARK_PATH)/package/spark-service-client/spark-service-client.service \
		$(TARGET_DIR)/usr/lib/systemd/system/spark-service-client.service
	mkdir -p $(TARGET_DIR)/etc/systemd/system/multi-user.target.wants
	ln -fs ../../../../usr/lib/systemd/system/spark-service-client.service \
		$(TARGET_DIR)/etc/systemd/system/multi-user.target.wants/spark-service-client.service
endef

$(eval $(generic-package))
