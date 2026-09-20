use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

fn main() {
    println!("cargo:rerun-if-changed=../extensions/windows-thumbnail/src");
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "windows" {
        build_windows_thumbnail();
    }
    if target_os == "android" {
        // The APK ships the library stripped (see gen/android/app/build.gradle.kts),
        // so Sentry symbolicates Rust panics from the debug files CI uploads. It
        // matches them to the crashing library by build id, and the NDK linker
        // emits none by default.
        println!("cargo:rustc-link-arg=-Wl,--build-id=sha1");
    }

    propagate_sentry_dsn();
    propagate_app_version();

    // Declare the app's own (non-plugin) commands in the ACL app manifest.
    // Since tauri 2.11, IPC from remote origins is always subject to ACL
    // resolution (upstream #15266); without a manifest the app commands have
    // no ACL entries at all and remote pages get "not allowed. Plugin not
    // found". The webdriver test harness serves the vitest tester page from
    // its own port, which is a remote origin, so it needs these permissions
    // granted via capabilities (see capabilities/webdriver-remote.json).
    // With a manifest defined, LOCAL windows also resolve app commands
    // through the ACL, so capabilities/default.json must grant them too.
    // Keep this list in sync with the generate_handler! list in lib.rs.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "start_server",
            "download_file",
            "upload_file",
            "get_environment_variable",
            "get_executable_dir",
            "set_webview_info",
            "get_webview_version",
            "is_updater_disabled",
            "allow_paths_in_scopes",
            "optimize_cover_thumbnails",
            "read_dir",
            "write_backup_zip",
            "extract_backup_zip",
            "parse_epub_metadata",
            "extract_epub_cover_full",
            "parse_epub_full",
            "get_comic_page_sizes",
            "parse_mobi_metadata",
            "extract_mobi_cover_full",
            "parse_pdf_metadata",
            "render_pdf_cover",
            "auth_with_safari",
            "start_apple_sign_in",
            "set_traffic_lights",
            "set_window_title",
            "show_lookup_popover",
            "update_book_presence",
            "clear_book_presence",
            "clip_url",
            "open_web_browser",
            "fetch_web_browser_resource",
            "get_media_proxy_base",
            "set_web_browser_status",
            "extract_web_browser_archive",
            "spawn_fresh_browser",
            "verify_update_signature",
            "install_nightly_update",
            "localsend_start",
            "localsend_stop",
            "localsend_get_status",
            "localsend_list_devices",
            "localsend_announce",
            "localsend_set_discoverable",
            "localsend_is_alive",
            "localsend_respond",
            "localsend_cancel_receive",
            "localsend_send_files",
            "localsend_cancel_send",
        ]),
    ))
    .expect("failed to run tauri-build");

    if target_os == "android" {
        ensure_android_launcher_background();
        configure_local_anki_api();
    }
}

fn ensure_android_launcher_background() {
    let Some(project_dir) = env::var_os("TAURI_ANDROID_PROJECT_PATH").map(PathBuf::from) else {
        return;
    };

    let values_dir = project_dir.join("app/src/main/res/values");
    let color_file = values_dir.join("ic_launcher_background.xml");
    if color_file.is_file() {
        return;
    }

    fs::create_dir_all(&values_dir).expect("failed to create Android values resources");
    fs::write(
        color_file,
        r##"<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">#3DDC84</color>
</resources>
"##,
    )
    .expect("failed to create Android launcher background resource");
}

/// The AnkiDroid API's documented JitPack artifact is no longer published.
/// Expose the checked-out API sources as a small local Android library instead
/// so the native bridge remains buildable without a network artifact.
fn configure_local_anki_api() {
    let Some(project_dir) = env::var_os("TAURI_ANDROID_PROJECT_PATH").map(PathBuf::from) else {
        return;
    };

    println!("cargo:rerun-if-env-changed=READEST_ANKI_ANDROID_DIR");
    let default_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("../../../../Anki-Android");
    let anki_dir = env::var_os("READEST_ANKI_ANDROID_DIR")
        .map(PathBuf::from)
        .unwrap_or(default_dir);
    let api_dir = anki_dir.join("api");
    let api_source_dir = api_dir.join("src/main/java");
    if !api_dir.join("build.gradle.kts").is_file() || !api_source_dir.is_dir() {
        panic!(
            "AnkiDroid API checkout not found at {}. Set READEST_ANKI_ANDROID_DIR to the Anki-Android checkout.",
            anki_dir.display()
        );
    }
    println!("cargo:rerun-if-changed={}", api_source_dir.display());

    let api_project_dir = project_dir.join("anki-api");
    fs::create_dir_all(&api_project_dir).expect("failed to create local AnkiDroid API project");
    let api_path = gradle_path(&api_dir);
    let api_project = format!(
        r#"plugins {{
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}}

android {{
    namespace = "com.ichi2.anki.api"
    compileSdk = 36

    defaultConfig {{
        minSdk = 21
        buildConfigField("String", "READ_WRITE_PERMISSION", "\"com.ichi2.anki.permission.READ_WRITE_DATABASE\"")
        buildConfigField("String", "AUTHORITY", "\"com.ichi2.anki.flashcards\"")
    }}

    buildFeatures {{
        buildConfig = true
    }}

    kotlinOptions {{
        jvmTarget = "1.8"
    }}

    sourceSets["main"].java.srcDir("{api_path}/src/main/java")
    sourceSets["main"].res.srcDir("{api_path}/src/main/res")
    sourceSets["main"].manifest.srcFile("{api_path}/src/main/AndroidManifest.xml")
}}

dependencies {{
    implementation("androidx.annotation:annotation:1.7.1")
}}
"#
    );
    fs::write(api_project_dir.join("build.gradle.kts"), api_project)
        .expect("failed to write local AnkiDroid API project");

    let settings_path = project_dir.join("tauri.settings.gradle");
    let mut settings =
        fs::read_to_string(&settings_path).expect("failed to read generated Android settings");
    if !settings.contains("include ':anki-api'") {
        settings.push_str(&format!(
            "include ':anki-api'\nproject(':anki-api').projectDir = new File({})\n",
            gradle_string(&api_project_dir)
        ));
        fs::write(&settings_path, settings).expect("failed to add local AnkiDroid API project");
    }

    let app_gradle_path = project_dir.join("app/tauri.build.gradle.kts");
    let mut app_gradle = fs::read_to_string(&app_gradle_path)
        .expect("failed to read generated Android dependencies");
    if !app_gradle.contains("implementation(project(\":anki-api\"))") {
        let insert_at = app_gradle
            .rfind("\n}")
            .expect("generated Android dependencies have no closing brace");
        app_gradle.insert_str(insert_at, "\n  implementation(project(\":anki-api\"))");
        fs::write(app_gradle_path, app_gradle)
            .expect("failed to add local AnkiDroid API dependency");
    }
}

fn gradle_string(path: &Path) -> String {
    format!("\"{}\"", gradle_path(path))
}

fn gradle_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
}

/// Bake the app version from `package.json` into the crate as `READEST_APP_VERSION`
/// (read back via `option_env!`). Sentry keys its release/environment off this
/// rather than `CARGO_PKG_VERSION`, because the crate version in `Cargo.toml` is
/// not kept in sync with the app version (and only `package.json` carries the
/// nightly `-YYYYMMDDHH` stamp). Absent/unparseable => unset, so the Rust code
/// falls back to the crate version.
fn propagate_app_version() {
    let package_json = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("..")
        .join("package.json");
    println!("cargo:rerun-if-changed={}", package_json.display());

    if let Some(version) = read_json_string_field(&package_json, "version") {
        println!("cargo:rustc-env=READEST_APP_VERSION={version}");
    }
}

/// Read a top-level `"key": "value"` string from a JSON file without pulling in a
/// JSON parser. Returns the first match; `None` if the file/key is absent or the
/// value is empty. `package.json`'s own `"version"` is the first `"version"` key.
fn read_json_string_field(path: &Path, key: &str) -> Option<String> {
    let contents = fs::read_to_string(path).ok()?;
    let needle = format!("\"{key}\"");
    for line in contents.lines() {
        let Some(rest) = line.trim_start().strip_prefix(&needle) else {
            continue;
        };
        let value = rest
            .trim_start()
            .strip_prefix(':')?
            .trim()
            .trim_end_matches(',')
            .trim()
            .trim_matches('"');
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

/// Bake the Sentry DSN into the crate at build time via `cargo:rustc-env`, so
/// `option_env!("SENTRY_DSN")` (and, on iOS, the `readest_sentry_dsn` FFI) sees
/// it. Precedence: an existing `SENTRY_DSN` in the environment (CI secret / shell
/// export) wins; otherwise fall back to the gitignored `.env.local`, then `.env`,
/// at the app root. Absent everywhere => unset, so reporting stays disabled for
/// local and fork builds. `rerun-if-*` makes cargo recompile when the value or
/// the dotenv files change (avoiding a stale baked-in value).
///
/// Debug builds never bake a DSN, whatever the environment or the dotenv files
/// say. `tauri dev` and `tauri ios dev` serve the app from the dev server, which
/// puts the page on a different origin than Tauri's IPC custom protocol, so every
/// report the injected `@sentry/browser` sends over that bridge fails -- and each
/// failure logs an error that Sentry turns into another report, which spins until
/// the WebView is too busy to render. The DSN is cleared rather than merely left
/// unset because `option_env!` would otherwise still see a `SENTRY_DSN` exported
/// in the developer's shell.
fn propagate_sentry_dsn() {
    println!("cargo:rerun-if-env-changed=SENTRY_DSN");
    let app_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("..");
    let env_local = app_dir.join(".env.local");
    let env_file = app_dir.join(".env");
    println!("cargo:rerun-if-changed={}", env_local.display());
    println!("cargo:rerun-if-changed={}", env_file.display());

    if env::var("PROFILE").as_deref() != Ok("release") {
        println!("cargo:rustc-env=SENTRY_DSN=");
        return;
    }

    let dsn = env::var("SENTRY_DSN")
        .ok()
        .filter(|v| !v.is_empty())
        .or_else(|| read_env_value(&env_local, "SENTRY_DSN"))
        .or_else(|| read_env_value(&env_file, "SENTRY_DSN"));

    if let Some(dsn) = dsn {
        println!("cargo:rustc-env=SENTRY_DSN={dsn}");
    }
}

/// Read a single `KEY=value` from a dotenv-style file, skipping blank lines and
/// `#` comments and stripping surrounding quotes. `None` if the file/key is
/// absent or the value is empty.
fn read_env_value(path: &Path, key: &str) -> Option<String> {
    let contents = fs::read_to_string(path).ok()?;
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(value) = line
            .strip_prefix(key)
            .and_then(|rest| rest.trim_start().strip_prefix('='))
        {
            let value = value.trim().trim_matches(|c| c == '"' || c == '\'');
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

fn build_windows_thumbnail() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let dll_crate_dir = manifest_dir
        .join("..")
        .join("extensions")
        .join("windows-thumbnail");
    let dll_crate_manifest = dll_crate_dir.join("Cargo.toml");
    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".into());

    let mut cmd = Command::new(env::var("CARGO").unwrap_or("cargo".into()));
    cmd.arg("build")
        .arg("--package")
        .arg("windows_thumbnail")
        .arg("--manifest-path")
        .arg(&dll_crate_manifest);

    if profile == "release" {
        cmd.arg("--release");
    }

    let target_triple = env::var("TARGET").unwrap_or_default();
    let host_triple = env::var("HOST").unwrap_or_default();
    if !target_triple.is_empty() && target_triple != host_triple {
        cmd.arg("--target").arg(&target_triple);
    }

    let status = cmd
        .status()
        .expect("Failed to run cargo build for windows_thumbnail");
    if !status.success() {
        panic!("Failed to build windows_thumbnail DLL");
    }

    let dll_name = "windows_thumbnail.dll";
    let candidate_paths = [
        dll_crate_dir.join("target").join(&profile).join(dll_name),
        dll_crate_dir
            .join("target")
            .join(&target_triple)
            .join(&profile)
            .join(dll_name),
    ];

    let dll_src = candidate_paths
        .iter()
        .find(|p| p.exists())
        .expect("Failed to find built windows_thumbnail DLL");

    let dll_dest = &dll_crate_dir.join("target").join(dll_name);

    fs::copy(dll_src, dll_dest).expect("Failed to copy windows_thumbnail DLL");
    println!("cargo:rerun-if-changed={}", dll_dest.display());
}
