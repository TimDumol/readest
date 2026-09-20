#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
app_root="$(cd -- "$script_dir/.." && pwd)"
application_id="${READEST_ANDROID_PACKAGE:-com.bilingify.readest}"

usage() {
  printf '%s\n' \
    'Usage: ./scripts/install-android.sh [--phone] [--release] [--replace] [--build-only] [--install-only]' \
    '' \
    'Builds a Readest APK, installs it on one connected Android target, and launches it.' \
    '' \
    'Options:' \
    '  --phone                 Ignore emulators when selecting a target' \
    '  --release               Build a release APK instead of the debug APK' \
    '  --replace               Uninstall a conflicting existing package before installing' \
    '  --build-only            Build the APK without requiring an ADB device' \
    '  --install-only          Install the existing APK without rebuilding' \
    '' \
    'Environment:' \
    '  READEST_ANDROID_APK       APK path (default: dist/readest-android-debug.apk)' \
    '  READEST_ANDROID_BUILD_MODE  debug or release (default: debug)' \
    '  READEST_ANDROID_TARGET    Tauri target (default: aarch64)' \
    '  READEST_ANDROID_PACKAGE   Android application ID' \
    '  READEST_ANDROID_DEVICE    ADB serial when several targets are connected' \
    '  READEST_ADB               ADB executable path' \
    '  ANDROID_SERIAL            Standard ADB serial override'
}

phone_only=0
replace_existing=0
build_only=0
install_only=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --phone)
      phone_only=1
      ;;
    --release)
      export READEST_ANDROID_BUILD_MODE=release
      ;;
    --replace)
      replace_existing=1
      ;;
    --build-only)
      build_only=1
      ;;
    --install-only)
      install_only=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [[ "$build_only" == 1 && "$install_only" == 1 ]]; then
  printf '%s\n' '--build-only and --install-only cannot be used together.' >&2
  exit 2
fi

build_mode="${READEST_ANDROID_BUILD_MODE:-debug}"
case "$build_mode" in
  debug|release)
    ;;
  *)
    printf '%s\n' 'READEST_ANDROID_BUILD_MODE must be debug or release.' >&2
    exit 2
    ;;
esac

if [[ -n "${READEST_ANDROID_APK:-}" ]]; then
  apk_path="$READEST_ANDROID_APK"
elif [[ "$build_mode" == release ]]; then
  apk_path="$app_root/dist/readest-android-release.apk"
else
  apk_path="$app_root/dist/readest-android-debug.apk"
fi
if [[ "$apk_path" != /* ]]; then
  apk_path="$app_root/$apk_path"
fi

if [[ "$build_only" == 1 ]]; then
  "$script_dir/build-android.sh"
  exit 0
fi

android_sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/home/$(id -un)/Android/Sdk}}"
adb_bin="${READEST_ADB:-}"
if [[ -z "$adb_bin" && -x "$android_sdk/platform-tools/adb" ]]; then
  adb_bin="$android_sdk/platform-tools/adb"
fi
if [[ -z "$adb_bin" ]]; then
  adb_bin="$(command -v adb || true)"
fi
if [[ -z "$adb_bin" ]]; then
  printf '%s\n' 'adb is required. Install Android platform-tools or set READEST_ADB.' >&2
  exit 1
fi

is_emulator() {
  local serial="$1"
  local qemu

  if [[ "$serial" == emulator-* ]]; then
    return 0
  fi
  qemu="$("$adb_bin" -s "$serial" shell getprop ro.kernel.qemu 2>/dev/null | tr -d '\r' || true)"
  [[ "$qemu" == 1 ]]
}

"$adb_bin" start-server >/dev/null
mapfile -t connected_devices < <("$adb_bin" devices | awk 'NR > 1 && $2 == "device" { print $1 }')
if [[ "$phone_only" == 1 ]]; then
  phone_devices=()
  for device in "${connected_devices[@]}"; do
    if ! is_emulator "$device"; then
      phone_devices+=("$device")
    fi
  done
  connected_devices=("${phone_devices[@]}")
fi

target_device="${READEST_ANDROID_DEVICE:-${ANDROID_SERIAL:-}}"
if [[ -z "$target_device" ]]; then
  case "${#connected_devices[@]}" in
    0)
      if [[ "$phone_only" == 1 ]]; then
        printf '%s\n' 'No physical Android device is connected.' >&2
      else
        printf '%s\n' 'No Android device or emulator is connected.' >&2
      fi
      exit 1
      ;;
    1)
      target_device="${connected_devices[0]}"
      ;;
    *)
      printf '%s\n' 'More than one Android target is connected; set READEST_ANDROID_DEVICE.' >&2
      printf 'Connected targets: %s\n' "${connected_devices[*]}" >&2
      exit 1
      ;;
  esac
fi

device_state="$("$adb_bin" -s "$target_device" get-state 2>/dev/null || true)"
if [[ "$device_state" != device ]]; then
  printf '%s\n' "Android target '$target_device' is not ready (state: ${device_state:-unknown})." >&2
  exit 1
fi

if [[ "$phone_only" == 1 ]] && is_emulator "$target_device"; then
  printf '%s\n' "Android target '$target_device' is an emulator, but --phone was specified." >&2
  exit 1
fi

if [[ "$install_only" == 0 ]]; then
  "$script_dir/build-android.sh"
fi
if [[ ! -f "$apk_path" ]]; then
  printf '%s\n' "Android APK not found at $apk_path." >&2
  printf '%s\n' 'Build it first or omit --install-only.' >&2
  exit 1
fi

printf 'Installing %s on %s...\n' "$apk_path" "$target_device"
install_apk() {
  if is_emulator "$target_device"; then
    "$adb_bin" -s "$target_device" install -r "$apk_path"
  else
    "$adb_bin" -s "$target_device" install --no-streaming -r "$apk_path"
  fi
}

install_output=""
if ! install_output="$(install_apk 2>&1)"; then
  printf '%s\n' "$install_output" >&2
  if [[ "$replace_existing" != 1 ]] || [[ "$install_output" != *INSTALL_FAILED_UPDATE_INCOMPATIBLE* ]]; then
    exit 1
  fi

  printf 'Removing the existing %s package before reinstalling...\n' "$application_id" >&2
  "$adb_bin" -s "$target_device" uninstall "$application_id"
  install_output="$(install_apk 2>&1)" || {
    printf '%s\n' "$install_output" >&2
    exit 1
  }
fi

if [[ -n "$install_output" ]]; then
  printf '%s\n' "$install_output"
fi

printf 'Launching %s...\n' "$application_id"
"$adb_bin" -s "$target_device" shell monkey -p "$application_id" -c android.intent.category.LAUNCHER 1 >/dev/null
printf 'Readest launched on %s.\n' "$target_device"
