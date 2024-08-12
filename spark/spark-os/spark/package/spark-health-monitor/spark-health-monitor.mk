################################################################################
#
# spark-health-monitor
#
################################################################################

SPARK_HEALTH_MONITOR_VERSION = local
SPARK_HEALTH_MONITOR_SITE = $(SPARKDIR)
SPARK_HEALTH_MONITOR_SITE_METHOD = local
SPARK_HEALTH_MONITOR_INSTALL_STAGING = YES
SPARK_HEALTH_MONITOR_DEPENDENCIES = nodejs host-yarn
SPARK_HEALTH_MONITOR_LICENSE = Proprietary
SPARK_HEALTH_MONITOR_REDISTRIBUTE = NO

define SPARK_HEALTH_MONITOR_NODEJS_LICENCES
	@$(call GET_NODEJS_LICENCES,spark-health-monitor)
endef

SPARK_HEALTH_MONITOR_PRE_LEGAL_INFO_HOOKS += SPARK_HEALTH_MONITOR_NODEJS_LICENCES

define SPARK_HEALTH_MONITOR_USERS
	spark-health-monitor -1 spark-health-monitor -1 * /usr/lib/node_modules/spark-health-monitor /bin/false - Spark Health Monitor
endef

define SPARK_HEALTH_MONITOR_CONFIGURE_CMDS
	rm -rf $(@D)/spark-health-monitor/node_modules
endef

define SPARK_HEALTH_MONITOR_BUILD_CMDS
	(cd $(@D)/spark-health-monitor && \
			$(YARN) install --production)
endef

define SPARK_HEALTH_MONITOR_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0644 $(BR2_EXTERNAL_SPARK_PATH)/package/spark-health-monitor/etc.spark.spark-health-monitor \
		$(TARGET_DIR)/etc/spark/spark-health-monitor

	$(INSTALL) -m 0755 -d $(TARGET_DIR)/usr/lib/node_modules/spark-health-monitor
	rsync -au --chmod=u=rwX,go=rX \
		--delete \
		$(RSYNC_VCS_EXCLUSIONS) \
		$(@D)/spark-health-monitor/ $(TARGET_DIR)/usr/lib/node_modules/spark-health-monitor/
	ln -sf ../../usr/lib/node_modules/spark-health-monitor/bin/spark-health-monitor \
		$(TARGET_DIR)/usr/bin/spark-health-monitor
endef

define SPARK_HEALTH_MONITOR_INSTALL_INIT_SYSTEMD
	$(INSTALL) -D -m 0644 $(BR2_EXTERNAL_SPARK_PATH)/package/spark-health-monitor/spark-health-monitor.service \
		$(TARGET_DIR)/usr/lib/systemd/system/spark-health-monitor.service
	mkdir -p $(TARGET_DIR)/etc/systemd/system/multi-user.target.wants
	ln -fs ../../../../usr/lib/systemd/system/spark-health-monitor.service \
		$(TARGET_DIR)/etc/systemd/system/multi-user.target.wants/spark-health-monitor.service
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
