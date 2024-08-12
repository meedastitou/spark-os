BUILDROOT_VERSION=2018.02.12

SPARKOS_DIR=$(PWD)
TOPDIR=$(SPARKOS_DIR)/buildroot
BR2_EXTERNAL=$(SPARKOS_DIR)/spark
OUTPUT_DIR=$(SPARKOS_DIR)/output
REL_DIR=$(SPARKOS_DIR)/rel
DL_DIR=$(SPARKOS_DIR)/dl
BOARDS_DIR=$(BR2_EXTERNAL)/board/spark/
BOARDS=$(filter-out %common,$(patsubst $(BOARDS_DIR)/%,%,$(wildcard $(BOARDS_DIR)/*)))

include $(BR2_EXTERNAL)/release.mk

ifneq ($(BR2_DL_DIR),)
DL_DIR := $(BR2_DL_DIR)
else
DL_DIR := $(SPARKOS_DIR)/dl
endif

.PHONY: all
all: $(BOARDS)

.PHONY: clean
clean:
	for i in $(patsubst %,$(OUTPUT_DIR)/spark_%,$(BOARDS)) ; do rm -rf $$i ; done
	rmdir $(OUTPUT_DIR) 2>/dev/null || true
	rm -rf buildroot

.PHONY: config
config: $(patsubst %,%_config,$(BOARDS))

.PHONY: source
source: $(patsubst %,%_source,$(BOARDS))

.PHONY: legal-info
legal-info: $(patsubst %,%_legal-info,$(BOARDS))

.PHONY: help
help:
	@printf 'Spark OS Release $(RELEASE) using Buildroot $(BUILDROOT_VERSION)\n'
	@printf '=====================================================\n\n'
	@printf 'all                  - build all platforms\n'
	@printf 'clean                - clean all platform builds\n'
	@printf 'config               - generate all platforms config\n'
	@printf 'legal-info           - generate all platforms legal info\n'
	@printf 'source               - download source packages only\n\n'
	@$(foreach board,$(BOARDS),\
		printf "%-20s - build %s\\n" $(board) $(board);\
		printf "%-20s - clean the %s build\\n" $(board)_clean $(board);\
		printf "%-20s - generate config for %s\\n" $(board)_config $(board);\
		printf "%-20s - generate legal info for %s\\n" $(board)_legal-info $(board);\
		printf "%-20s - download source packages fror for %s\\n\\n" $(board)_source $(board);)

buildroot: $(DL_DIR)/buildroot-$(BUILDROOT_VERSION).tar.bz2
	rm -rf buildroot-$(BUILDROOT_VERSION) buildroot
	tar -xf $(DL_DIR)/buildroot-$(BUILDROOT_VERSION).tar.bz2
	for p in buildroot-patches/*.patch ; do if [ -e $$p ] ; then echo "Applying $$p:" ; patch -d buildroot-$(BUILDROOT_VERSION) -p1 < $$p ; fi ; done
	mv buildroot-$(BUILDROOT_VERSION) buildroot
	touch buildroot

$(DL_DIR)/buildroot-$(BUILDROOT_VERSION).tar.bz2:
	rm -f $@.tmp
	mkdir -p $(DL_DIR)
	wget https://buildroot.org/downloads/buildroot-$(BUILDROOT_VERSION).tar.bz2 -O $@.tmp
	mv $@.tmp $@

define RULE_TEMPLATE
# $(1) - board
$(1): $(REL_DIR)/spark_$(1)_$(RELEASE).zip \
	$(REL_DIR)/spark_$(1)_$(RELEASE)_sdcard.img.zip

$(REL_DIR)/spark_$(1)_$(RELEASE).zip: $(OUTPUT_DIR)/spark_$(1)/images/spark_$(1)_$(RELEASE).zip
	mkdir -p $(REL_DIR)
	cp $(OUTPUT_DIR)/spark_$(1)/images/spark_$(1)_$(RELEASE).zip $(REL_DIR)/spark_$(1)_$(RELEASE).zip

$(REL_DIR)/spark_$(1)_$(RELEASE)_sdcard.img.zip: $(OUTPUT_DIR)/spark_$(1)/images/spark_$(1)_$(RELEASE)_sdcard.img.zip
	mkdir -p $(REL_DIR)
	cp $(OUTPUT_DIR)/spark_$(1)/images/spark_$(1)_$(RELEASE)_sdcard.img.zip $(REL_DIR)/spark_$(1)_$(RELEASE)_sdcard.img.zip

$(OUTPUT_DIR)/spark_$(1)/images/spark_$(1)_$(RELEASE).zip: $(OUTPUT_DIR)/spark_$(1)/images/zImage
$(OUTPUT_DIR)/spark_$(1)/images/spark_$(1)_$(RELEASE)_sdcard.img.zip: $(OUTPUT_DIR)/spark_$(1)/images/zImage

.PHONY: $(OUTPUT_DIR)/spark_$(1)/images/zImage
$(OUTPUT_DIR)/spark_$(1)/images/zImage: $(OUTPUT_DIR)/spark_$(1)/.config
	$(MAKE) -C $(OUTPUT_DIR)/spark_$(1) BR2_DL_DIR=$(DL_DIR)

$(1)_config: $(OUTPUT_DIR)/spark_$(1)/.config

$(OUTPUT_DIR)/spark_$(1)/.config: buildroot $(BR2_EXTERNAL)/configs/spark_$(1)_defconfig
	mkdir -p $(OUTPUT_DIR)/spark_$(1)
	cd $(OUTPUT_DIR)/spark_$(1) ;\
		BR2_EXTERNAL=$(BR2_EXTERNAL) $(MAKE) O=$(OUTPUT_DIR)/spark_$(1) -C $(TOPDIR) spark_$(1)_defconfig;

$(1)_legal-info: $(OUTPUT_DIR)/spark_$(1)/images/zImage
	$(MAKE) -C $(OUTPUT_DIR)/spark_$(1) BR2_DL_DIR=$(DL_DIR) legal-info

$(1)_source: $(OUTPUT_DIR)/spark_$(1)/.config
	$(MAKE) -C $(OUTPUT_DIR)/spark_$(1) BR2_DL_DIR=$(DL_DIR) source

.PHONY: $(1)_clean
$(1)_clean:
	rm -rf $(OUTPUT_DIR)/spark_$(1)
endef

# create rules for each board
$(foreach board,$(BOARDS),$(eval $(call RULE_TEMPLATE,$(board))))
