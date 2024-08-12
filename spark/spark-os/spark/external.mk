SPARKDIR=$(TOPDIR)/../..

define GET_NODEJS_LICENCES
	@$(call MESSAGE,"Finding nodejs licences for $(1)")
	@(cd $(TARGET_DIR)/usr/lib/node_modules/$(1) && \
		which license-checker >/dev/null 2>&1 || (echo "Error: license-checker missing.  Install using npm install -g license-checker" && false) && \
		license-checker --customPath $(BR2_EXTERNAL_SPARK_PATH)/customFormat.json --relativeLicensePath --csv --out $(BASE_DIR)/legal-info/$(1)-licenses.csv && \
		for i in $$(license-checker --relativeLicensePath|grep licenseFile|awk '{print $$4}') ; do \
			$(INSTALL) -m 0644 -D $$i $(BASE_DIR)/legal-info/licenses/$(1)/$$i ; \
		done )
endef

include $(sort $(wildcard $(BR2_EXTERNAL_SPARK_PATH)/package/*.mk))
include $(sort $(wildcard $(BR2_EXTERNAL_SPARK_PATH)/package/*/*.mk))
