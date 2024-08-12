include spark-os/spark/release.mk

RELDIR?=./release
TESTDIRS=$(patsubst %/dockertest,%,$(wildcard spark-*/dockertest) $(wildcard node-*/dockertest))
ARCHS=rpi3 rpi4 x86_64

.PHONY: release
release: manual os

$(RELDIR)/$(RELEASE):
	mkdir -p "$(RELDIR)/$(RELEASE)"

.PHONY: manual
manual:	$(RELDIR)/$(RELEASE)
	(cd spark-manual && ./dockerbuild)
	cp spark-manual/dist/pdf/*.pdf "$(RELDIR)/$(RELEASE)/."

.PHONY: os
os: $(patsubst %,spark-os-%,$(ARCHS))

.PHONY: spark-os-setup
spark-os-setup:
	(cd spark-os && ./dockerbuild make source)

define OS_RULE_TEMPLATE
# $(1) - architecture
spark-os-$(1): $(RELDIR)/$(RELEASE)/spark_$(1)_$(RELEASE)*.zip

.PHONY: $(RELDIR)/$(RELEASE)/spark_$(1)_$(RELEASE)*.zip
$(RELDIR)/$(RELEASE)/spark_$(1)_$(RELEASE)*.zip: $(RELDIR)/$(RELEASE)
	(cd spark-os && PROJECT_NAME=spark-os-$(1) ./dockerbuild make $(1))
	cp spark-os/rel/spark_$(1)_$(RELEASE)*.zip "$(RELDIR)/$(RELEASE)/."
endef

$(foreach a,$(ARCHS),$(eval $(call OS_RULE_TEMPLATE,$(a))))

.PHONY: test
test: $(patsubst %,%-test,$(TESTDIRS))
	if ! git diff --quiet ; then \
		echo -e "\nError: uncommited changes\n" ;\
		git status ;\
		exit 1 ;\
	fi ;\

define TEST_RULE_TEMPLATE
# $(1) - test directory
.PHONY: $(1)-test
$(1)-test:
	(cd $(1) && ./dockertest)
endef

$(foreach d,$(TESTDIRS),$(eval $(call TEST_RULE_TEMPLATE,$(d))))
