################################################################################
#
# ca-certificates-te
#
################################################################################

CA_CERTIFICATES_TE_VERSION = 737ab42f87ffd4526f49bdaf3cf227f30fda9dcf
CA_CERTIFICATES_TE_SITE = https://makemake.tycoelectronics.com/stash/scm/iotlabs/te-certs.git
CA_CERTIFICATES_TE_SITE_METHOD = git
CA_CERTIFICATES_TE_DEPENDENCIES = ca-certificates
CA_CERTIFICATES_TE_LICENSE = Proprietary
CA_CERTIFICATES_TE_REDISTRIBUTE = NO

define CA_CERTIFICATES_TE_BUILD_CMDS
		$(TARGET_MAKE_ENV) $(MAKE) -C $(@D) verify
endef

define CA_CERTIFICATES_TE_INSTALL_TARGET_CMDS
		rm -rf $(TARGET_DIR)/usr/share/ca-certificates/te
		$(TARGET_MAKE_ENV) $(MAKE) -C $(@D) install \
			DESTDIR=$(TARGET_DIR)/usr/share/ca-certificates/te

		# Remove any existing certificates under /etc/ssl/certs
		rm -f  $(TARGET_DIR)/etc/ssl/certs/*

		# Create symlinks to certificates under /etc/ssl/certs
		# and generate the bundle
		cd $(TARGET_DIR) ;\
		for i in `find usr/share/ca-certificates -name "*.crt" | LC_COLLATE=C sort` ; do \
			ln -sf ../../../$$i etc/ssl/certs/`basename $${i} .crt`.pem ;\
			cat $$i ;\
		done >$(@D)/ca-certificates.crt

		# Create symlinks to the certificates by their hash values
		$(HOST_DIR)/bin/c_rehash $(TARGET_DIR)/etc/ssl/certs

		# Install the certificates bundle
		$(INSTALL) -D -m 644 $(@D)/ca-certificates.crt \
			$(TARGET_DIR)/etc/ssl/certs/ca-certificates.crt
endef

$(eval $(generic-package))
