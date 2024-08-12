################################################################################
#
# spark-mqtt-broker
#
################################################################################

SPARK_MQTT_BROKER_VERSION = local
SPARK_MQTT_BROKER_SITE = $(SPARKDIR)
SPARK_MQTT_BROKER_SITE_METHOD = local
SPARK_MQTT_BROKER_INSTALL_STAGING = YES
SPARK_MQTT_BROKER_DEPENDENCIES = nodejs host-yarn
SPARK_MQTT_BROKER_LICENSE = Proprietary
SPARK_MQTT_BROKER_REDISTRIBUTE = NO

define SPARK_MQTT_BROKER_NODEJS_LICENCES
	@$(call GET_NODEJS_LICENCES,spark-mqtt-broker)
endef

SPARK_MQTT_BROKER_PRE_LEGAL_INFO_HOOKS += SPARK_MQTT_BROKER_NODEJS_LICENCES

define SPARK_MQTT_BROKER_USERS
	spark-mqtt-broker -1 spark-mqtt-broker -1 * /usr/lib/node_modules/spark-mqtt-broker /bin/false - Spark MQTT Broker
endef

define SPARK_MQTT_BROKER_CONFIGURE_CMDS
	rm -rf $(@D)/spark-mqtt-broker/node_modules
endef

define SPARK_MQTT_BROKER_BUILD_CMDS
	(cd $(@D)/spark-mqtt-broker && \
			$(YARN) install --production)
endef

define SPARK_MQTT_BROKER_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0644 $(BR2_EXTERNAL_SPARK_PATH)/package/spark-mqtt-broker/etc.spark.spark-mqtt-broker \
		$(TARGET_DIR)/etc/spark/spark-mqtt-broker

	$(INSTALL) -m 0755 -d $(TARGET_DIR)/usr/lib/node_modules/spark-mqtt-broker
	rsync -au --chmod=u=rwX,go=rX \
		--delete \
		$(RSYNC_VCS_EXCLUSIONS) \
		$(@D)/spark-mqtt-broker/ $(TARGET_DIR)/usr/lib/node_modules/spark-mqtt-broker/
	ln -sf ../../usr/lib/node_modules/spark-mqtt-broker/bin/spark-mqtt-broker \
		$(TARGET_DIR)/usr/bin/spark-mqtt-broker
endef

define SPARK_MQTT_BROKER_INSTALL_INIT_SYSTEMD
	$(INSTALL) -D -m 0644 $(BR2_EXTERNAL_SPARK_PATH)/package/spark-mqtt-broker/spark-mqtt-broker.service \
		$(TARGET_DIR)/usr/lib/systemd/system/spark-mqtt-broker.service
	mkdir -p $(TARGET_DIR)/etc/systemd/system/multi-user.target.wants
	ln -fs ../../../../usr/lib/systemd/system/spark-mqtt-broker.service \
		$(TARGET_DIR)/etc/systemd/system/multi-user.target.wants/spark-mqtt-broker.service
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
