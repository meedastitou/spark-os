################################################################################
#
# spark-web-proxy
#
################################################################################

SPARK_WEB_PROXY_VERSION = local
SPARK_WEB_PROXY_SITE = $(SPARKDIR)
SPARK_WEB_PROXY_SITE_METHOD = local
SPARK_WEB_PROXY_DEPENDENCIES = nodejs host-yarn
SPARK_WEB_PROXY_LICENSE = Proprietary
SPARK_WEB_PROXY_REDISTRIBUTE = NO

define SPARK_WEB_PROXY_NODEJS_LICENCES
	@$(call GET_NODEJS_LICENCES,spark-web-proxy)
endef

SPARK_WEB_PROXY_PRE_LEGAL_INFO_HOOKS += SPARK_WEB_PROXY_NODEJS_LICENCES

define SPARK_WEB_PROXY_USERS
	spark-web-proxy -1 spark-web-proxy -1 * /usr/lib/node_modules/spark-web-proxy /bin/false - Spark Web Proxy
endef

define SPARK_WEB_PROXY_CONFIGURE_CMDS
	rm -rf $(@D)/spark-web-proxy/node_modules
endef

define SPARK_WEB_PROXY_BUILD_CMDS
	(cd $(@D)/spark-web-proxy && \
			$(YARN) install --production)
endef

define SPARK_WEB_PROXY_INSTALL_TARGET_CMDS
	$(INSTALL) -m 0755 -d $(TARGET_DIR)/usr/lib/node_modules/spark-web-proxy
	rsync -au --chmod=u=rwX,go=rX \
		--delete \
		$(RSYNC_VCS_EXCLUSIONS) \
		$(@D)/spark-web-proxy/ $(TARGET_DIR)/usr/lib/node_modules/spark-web-proxy/
	ln -sf ../../usr/lib/node_modules/spark-web-proxy/spark-web-proxy \
		$(TARGET_DIR)/usr/bin/spark-web-proxy
	ln -sf ../../usr/lib/node_modules/spark-web-proxy/spark-web-proxy-start \
		$(TARGET_DIR)/usr/bin/spark-web-proxy-start
	ln -sf ../../usr/lib/node_modules/spark-web-proxy/spark-web-proxy-stop \
		$(TARGET_DIR)/usr/bin/spark-web-proxy-stop

	$(INSTALL) -D -m 0440 $(BR2_EXTERNAL_SPARK_PATH)/package/spark-web-proxy/etc.sudoers.d.spark-web-proxy \
		$(TARGET_DIR)/etc/sudoers.d/spark-web-proxy

	$(INSTALL) -D -m 0644 $(BR2_EXTERNAL_SPARK_PATH)/package/spark-web-proxy/etc.spark.spark-web-proxy \
		$(TARGET_DIR)/etc/spark/spark-web-proxy
endef

define SPARK_WEB_PROXY_INSTALL_INIT_SYSTEMD
	$(INSTALL) -D -m 0644 $(BR2_EXTERNAL_SPARK_PATH)/package/spark-web-proxy/spark-web-proxy.service \
		$(TARGET_DIR)/usr/lib/systemd/system/spark-web-proxy.service
	mkdir -p $(TARGET_DIR)/etc/systemd/system/multi-user.target.wants
	ln -fs ../../../../usr/lib/systemd/system/spark-web-proxy.service \
		$(TARGET_DIR)/etc/systemd/system/multi-user.target.wants/spark-web-proxy.service
endef

$(eval $(generic-package))
