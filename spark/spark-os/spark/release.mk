# Override built-in rule causing version to be updated from version.sh
%: %.sh
	@touch $^

# Include the actual version data
include $(lastword $(MAKEFILE_LIST:%.mk=%))

RELEASE="$(MAJOR).$(MINOR).$(PATCH)"
