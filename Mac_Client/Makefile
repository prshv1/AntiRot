APP_NAME := Antirot
EXECUTABLE := Antirot
APP_DIR := dist/$(APP_NAME).app
DMG_PATH := dist/$(APP_NAME).dmg
ICON_SOURCE_DIR := ../Browser_Client/icons
ICONSET_DIR := Resources/AppIcon.iconset
ICON_PATH := Resources/AppIcon.icns

.PHONY: build icon app dmg clean

build:
	swift build -c release

icon:
	rm -rf "$(ICONSET_DIR)"
	mkdir -p "$(ICONSET_DIR)"
	cp "$(ICON_SOURCE_DIR)/icon16.png" "$(ICONSET_DIR)/icon_16x16.png"
	sips -z 32 32 "$(ICON_SOURCE_DIR)/icon128.png" --out "$(ICONSET_DIR)/icon_16x16@2x.png" >/dev/null
	sips -z 32 32 "$(ICON_SOURCE_DIR)/icon128.png" --out "$(ICONSET_DIR)/icon_32x32.png" >/dev/null
	sips -z 64 64 "$(ICON_SOURCE_DIR)/icon128.png" --out "$(ICONSET_DIR)/icon_32x32@2x.png" >/dev/null
	cp "$(ICON_SOURCE_DIR)/icon128.png" "$(ICONSET_DIR)/icon_128x128.png"
	sips -z 256 256 "$(ICON_SOURCE_DIR)/icon128.png" --out "$(ICONSET_DIR)/icon_128x128@2x.png" >/dev/null
	sips -z 256 256 "$(ICON_SOURCE_DIR)/icon128.png" --out "$(ICONSET_DIR)/icon_256x256.png" >/dev/null
	sips -z 512 512 "$(ICON_SOURCE_DIR)/icon128.png" --out "$(ICONSET_DIR)/icon_256x256@2x.png" >/dev/null
	sips -z 512 512 "$(ICON_SOURCE_DIR)/icon128.png" --out "$(ICONSET_DIR)/icon_512x512.png" >/dev/null
	sips -z 1024 1024 "$(ICON_SOURCE_DIR)/icon128.png" --out "$(ICONSET_DIR)/icon_512x512@2x.png" >/dev/null
	iconutil -c icns "$(ICONSET_DIR)" -o "$(ICON_PATH)"
	rm -rf "$(ICONSET_DIR)"

app: icon build
	rm -rf "dist"
	mkdir -p "$(APP_DIR)/Contents/MacOS"
	mkdir -p "$(APP_DIR)/Contents/Resources"
	cp ".build/release/$(EXECUTABLE)" "$(APP_DIR)/Contents/MacOS/$(EXECUTABLE)"
	cp "Resources/Info.plist" "$(APP_DIR)/Contents/Info.plist"
	cp "$(ICON_PATH)" "$(APP_DIR)/Contents/Resources/AppIcon.icns"
	codesign --force --deep --sign - "$(APP_DIR)"

dmg: app
	hdiutil create -volname "$(APP_NAME)" -srcfolder "$(APP_DIR)" -ov -format UDZO "$(DMG_PATH)"

clean:
	rm -rf .build dist "$(ICONSET_DIR)" "$(ICON_PATH)"
