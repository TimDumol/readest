#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
app_root="$(cd -- "$script_dir/.." && pwd)"

build_mode="${READEST_ANDROID_BUILD_MODE:-debug}"
target="${READEST_ANDROID_TARGET:-aarch64}"

# Keep local debug installs visibly distinct from a store build. This is
# especially useful when Android accepts an APK with the same semver/version
# code and leaves an older WebView bundle running.
android_version_suffix=""
if [[ "$build_mode" == debug ]]; then
  if [[ -v READEST_ANDROID_DEV_VERSION_SUFFIX ]]; then
    android_version_suffix="$READEST_ANDROID_DEV_VERSION_SUFFIX"
  else
    android_version_suffix="-dev$(date -u +%Y%m%d%H%M%S)"
  fi
fi

if [[ -n "$android_version_suffix" && ! "$android_version_suffix" =~ ^-[0-9A-Za-z.-]+$ ]]; then
  printf '%s\n' 'READEST_ANDROID_DEV_VERSION_SUFFIX must be a semver prerelease suffix such as -dev20260920230000.' >&2
  exit 2
fi

case "$build_mode" in
  debug|release)
    ;;
  *)
    printf '%s\n' 'READEST_ANDROID_BUILD_MODE must be debug or release.' >&2
    exit 2
    ;;
esac

if ! command -v pnpm >/dev/null 2>&1; then
  printf '%s\n' 'pnpm is required to build the Android app.' >&2
  exit 1
fi

default_android_sdk="/home/$(id -un)/Android/Sdk"
android_sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$default_android_sdk}}"
if [[ ! -d "$android_sdk" ]]; then
  printf '%s\n' 'ANDROID_HOME or ANDROID_SDK_ROOT must point to an Android SDK.' >&2
  exit 1
fi

if ! command -v java >/dev/null 2>&1 || ! command -v javac >/dev/null 2>&1; then
  printf '%s\n' 'a JDK (java and javac) is required to build the Android APK.' >&2
  exit 1
fi

case "$build_mode" in
  debug)
    build_flag=(--debug)
    apk_name='readest-android-debug.apk'
    output_suffix='debug'
    ;;
  release)
    build_flag=()
    apk_name='readest-android-release.apk'
    output_suffix='release'
    ;;
esac

apk_output="${READEST_ANDROID_APK:-$app_root/dist/$apk_name}"
if [[ "$apk_output" != /* ]]; then
  apk_output="$app_root/$apk_output"
fi
mkdir -p "$(dirname -- "$apk_output")"

cd "$app_root"
unset NO_COLOR FORCE_COLOR
export ANDROID_HOME="$android_sdk"
export ANDROID_SDK_ROOT="$android_sdk"

base_version="$(node -p "require('./package.json').version")"
tauri_config_override=""
if [[ -n "$android_version_suffix" ]]; then
  tauri_config_override="{\"version\":\"${base_version}${android_version_suffix}\"}"
  printf 'Using Android development version %s%s\n' "$base_version" "$android_version_suffix"
fi

repo_root="$(cd -- "$app_root/../.." && pwd)"
if ! command -v git >/dev/null 2>&1; then
  printf '%s\n' 'git is required to initialize the workspace submodules.' >&2
  exit 1
fi
printf '%s\n' 'Ensuring workspace submodules are initialized...'
git -C "$repo_root" submodule update --init -- \
  packages/foliate-js \
  packages/simplecc-wasm \
  packages/tauri \
  packages/qcms \
  packages/js-mdict \
  apps/readest-app/src-tauri/plugins/tauri-plugin-turso \
  apps/readest-app/src-tauri/plugins/tauri-plugin-webview-upgrade
anki_android_dir="${READEST_ANKI_ANDROID_DIR:-$app_root/../../../Anki-Android}"
if [[ ! -d "$anki_android_dir/api/src/main/java" ]]; then
  printf 'AnkiDroid API checkout not found at %s. Set READEST_ANKI_ANDROID_DIR.\n' "$anki_android_dir" >&2
  exit 1
fi
export READEST_ANKI_ANDROID_DIR="$anki_android_dir"

printf '%s\n' 'Preparing web assets required by the Android bundle...'
pnpm setup-vendors

printf 'Building Readest Android APK (%s, %s)...\n' "$build_mode" "$target"
build_started_at="$(date +%s)"
build_args=("${build_flag[@]}" -t "$target")
if [[ -n "$tauri_config_override" ]]; then
  build_args+=(--config "$tauri_config_override")
fi
pnpm exec dotenv -v KEEP_SOURCEMAPS=1 -e .env.tauri -- \
  pnpm tauri android build "${build_args[@]}" -- --features devtools

apk_source="$(find "$app_root/src-tauri/gen/android/app/build/outputs/apk" \
  -type f -name "*-${output_suffix}.apk" -newermt "@${build_started_at}" \
  -printf '%T@ %p\n' | sort -nr | sed -n '1s/^[^ ]* //p')"
if [[ -z "$apk_source" ]]; then
  printf '%s\n' 'Android build completed, but no fresh APK was found.' >&2
  exit 1
fi

if [[ "$apk_source" != "$apk_output" ]]; then
  cp "$apk_source" "$apk_output"
fi
printf 'Built APK at %s\n' "$apk_output"
