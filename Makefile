VERSION ?= 152.0.4
RELEASE ?= beta.28

UNAME_ARCH := $(shell uname -m)
ifeq ($(UNAME_ARCH),arm64)
  ARCH ?= aarch64
else
  ARCH ?= $(UNAME_ARCH)
endif

ifeq ($(ARCH),aarch64)
  CAMOUFOX_ARCH := arm64
else
  CAMOUFOX_ARCH := x86_64
endif

IMAGE := camofox-browser:$(VERSION)-$(ARCH)

.PHONY: build build-arm64 build-x86 up down reset

## Build the self-contained Bun + Camoufox image.
build:
	docker build \
	  --build-arg ARCH=$(CAMOUFOX_ARCH) \
	  --build-arg CAMOUFOX_VERSION=$(VERSION) \
	  --build-arg CAMOUFOX_RELEASE=$(RELEASE) \
	  -t $(IMAGE) .

build-arm64:
	$(MAKE) build ARCH=aarch64

build-x86:
	$(MAKE) build ARCH=x86_64

up:
	@if ! docker image inspect $(IMAGE) > /dev/null 2>&1; then \
	  $(MAKE) build; \
	fi
	docker run -d --restart unless-stopped --name camofox-browser --shm-size=2g \
	  -p 127.0.0.1:9377:9377 -p 127.0.0.1:6080:6080 \
	  -e CAMOFOX_ACCESS_KEY -e CAMOFOX_API_KEY -e CAMOFOX_ADMIN_KEY \
	  -v camofox-data:/root/.camofox \
	  $(IMAGE)

down:
	docker stop camofox-browser && docker rm camofox-browser

reset:
	-docker stop camofox-browser 2>/dev/null
	-docker rm camofox-browser 2>/dev/null
	-docker rmi $(IMAGE) 2>/dev/null
	$(MAKE) build
