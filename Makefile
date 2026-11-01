UUID := frostwave@rohitsunil1102.github.io
BUILD_DIR := build
ZIP := $(BUILD_DIR)/$(UUID).shell-extension.zip
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: all pack install uninstall test lint clean

all: pack

# The zip to upload to extensions.gnome.org
pack:
	mkdir -p $(BUILD_DIR)
	gnome-extensions pack src --force --out-dir=$(BUILD_DIR) \
		--extra-source=lib --extra-source=icons

# Install for the current user; log out and back in to load it on Wayland
install: pack
	gnome-extensions install --force $(ZIP)
	glib-compile-schemas $(INSTALL_DIR)/schemas

uninstall:
	gnome-extensions uninstall $(UUID)

# Runs the extension in a headless GNOME Shell with a mock player
test:
	tests/run-headless.sh

lint:
	npx eslint@9 .

clean:
	rm -rf $(BUILD_DIR)
