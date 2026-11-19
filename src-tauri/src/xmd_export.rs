//! Narrow, read-only HTTP(S) image loader for XMD export. Native networking
//! avoids loosening the webview CSP or relying on third-party CORS headers.
use reqwest::{redirect, Client, Url};
use serde::Serialize;
use std::io::Write;
use std::time::Duration;
use std::{fs, io::Read, path::Path};
use tauri::ipc::{InvokeBody, Request, Response};

const MAX_RESOURCE_BYTES: usize = 32 * 1024 * 1024;
/// Largest `.xmd` accepted for reading: 128 MiB of content plus ZIP overhead.
const MAX_XMD_DOCUMENT_BYTES: u64 = 136 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XmdImageResponse {
    data: Vec<u8>,
    content_type: String,
}

fn validate_image_url(url: &Url) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("只支持 HTTP(S) 图片 / Only HTTP(S) image URLs are supported".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("不支持带凭据的图片 URL / Image URL credentials are not supported".into());
    }
    Ok(())
}

fn validate_resource_size(size: u64) -> Result<(), String> {
    if size > MAX_RESOURCE_BYTES as u64 {
        return Err("图片超过 32 MiB / Image exceeds 32 MiB".into());
    }
    Ok(())
}

fn read_bounded_file(path: &str, maximum: u64) -> Result<Vec<u8>, String> {
    let file =
        fs::File::open(path).map_err(|e| format!("读取资源失败 / Cannot read resource: {e}"))?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("资源不是常规文件 / Resource is not a regular file".into());
    }
    if metadata.len() > maximum {
        return Err("资源超过大小上限 / Resource exceeds size limit".into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(maximum + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > maximum {
        return Err("资源超过大小上限 / Resource exceeds size limit".into());
    }
    Ok(bytes)
}

fn local_resource_bytes(path: &str) -> Result<Vec<u8>, String> {
    let normalized = path.replace('\\', "/");
    if normalized.starts_with("//") || normalized.starts_with("/??/") {
        return Err("不支持网络共享资源 / Network share resources are not supported".into());
    }
    read_bounded_file(path, MAX_RESOURCE_BYTES as u64).map_err(|error| {
        if error.contains("size limit") {
            "图片超过 32 MiB / Image exceeds 32 MiB".into()
        } else {
            error
        }
    })
}

#[tauri::command]
pub fn read_xmd_document(path: String) -> Result<Response, String> {
    // 128 MiB decompressed body plus bounded ZIP headers and compression slack.
    read_bounded_file(&path, MAX_XMD_DOCUMENT_BYTES).map(Response::new)
}

#[tauri::command]
pub async fn read_document_outline_source(path: String) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let normalized = path.replace('\\', "/");
        if normalized.starts_with("//") || normalized.starts_with("/??/") {
            return Err("不支持网络共享文档 / Network share documents are not supported".into());
        }
        let source = std::path::Path::new(&path);
        let extension = source
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !source.is_absolute()
            || !crate::workspace::WORKSPACE_DOCUMENT_EXTENSIONS.contains(&extension.as_str())
        {
            return Err("不支持的目标文档 / Unsupported target document".into());
        }
        let canonical = fs::canonicalize(source).map_err(|error| error.to_string())?;
        let canonical = crate::path_utils::canonicalize_path(&canonical);
        let canonical = canonical.to_string_lossy();
        if canonical.replace('\\', "/").starts_with("//") {
            return Err("不支持网络共享文档 / Network share documents are not supported".into());
        }
        let metadata = fs::metadata(&*canonical).map_err(|error| error.to_string())?;
        if !metadata.is_file() {
            return Err("目标不是常规文件 / Target is not a regular file".into());
        }
        read_bounded_file(&canonical, 2 * 1024 * 1024).map(Response::new)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn read_xmd_resource(path: String) -> Result<Response, String> {
    local_resource_bytes(&path).map(Response::new)
}

/// Replaces `target` with `payload` without ever truncating an existing file.
///
/// The bytes are written and fsynced into a temporary file in the destination
/// directory first; only then is it atomically renamed over the target. A
/// failure while creating, writing or syncing the temporary file leaves the
/// previous package untouched, and the temporary file is removed by `tempfile`.
/// The rename happens on the same volume (same directory), so a concurrently
/// running reader never observes a half-written ZIP.
fn write_xmd_atomically(target: &Path, payload: &[u8]) -> Result<(), String> {
    let parent = target.parent().filter(|path| !path.as_os_str().is_empty());
    if let Some(parent) = parent {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建 XMD 目录失败 / Cannot create XMD directory: {error}"))?;
    }
    let directory = parent.unwrap_or_else(|| Path::new("."));
    let mut temporary = tempfile::Builder::new()
        .prefix(".xmd-")
        .suffix(".tmp")
        .tempfile_in(directory)
        .map_err(|error| {
            format!("创建 XMD 临时文件失败 / Cannot create temporary XMD file: {error}")
        })?;
    temporary.write_all(payload).map_err(|error| {
        format!("写入 XMD 临时文件失败 / Cannot write temporary XMD file: {error}")
    })?;
    temporary.as_file_mut().flush().map_err(|error| {
        format!("刷新 XMD 临时文件失败 / Cannot flush temporary XMD file: {error}")
    })?;
    // Flush file data to the device before the rename, otherwise a crash could
    // leave the new directory entry pointing at incomplete contents.
    temporary.as_file().sync_all().map_err(|error| {
        format!("同步 XMD 临时文件失败 / Cannot sync temporary XMD file: {error}")
    })?;
    temporary
        .persist(target)
        .map_err(|error| format!("写入 XMD 失败 / Cannot write XMD: {}", error.error))?;
    // Best effort on Unix: make the rename itself durable. Windows persists the
    // directory entry as part of the replace operation.
    #[cfg(unix)]
    {
        if let Ok(directory) = fs::File::open(directory) {
            let _ = directory.sync_all();
        }
    }
    Ok(())
}

fn write_xmd_frame(frame: &[u8]) -> Result<(), String> {
    let length_bytes: [u8; 4] = frame
        .get(..4)
        .ok_or("Invalid XMD frame")?
        .try_into()
        .map_err(|_| "Invalid XMD frame")?;
    let length = u32::from_le_bytes(length_bytes) as usize;
    if length == 0 || length > 32768 {
        return Err("Invalid XMD path length".into());
    }
    let path = std::str::from_utf8(frame.get(4..4 + length).ok_or("Invalid XMD path")?)
        .map_err(|_| "Invalid XMD path encoding")?;
    if !path.to_ascii_lowercase().ends_with(".xmd") {
        return Err("XMD destination must end in .xmd".into());
    }
    let payload = frame.get(4 + length..).ok_or("Invalid XMD payload")?;
    if !payload.starts_with(b"PK\x03\x04") {
        return Err("XMD payload must be a ZIP archive".into());
    }
    write_xmd_atomically(Path::new(path), payload)
}

#[tauri::command]
pub fn write_xmd_file(request: Request<'_>) -> Result<(), String> {
    match request.body() {
        InvokeBody::Raw(frame) => write_xmd_frame(frame),
        _ => Err("Expected binary XMD frame".into()),
    }
}

#[tauri::command]
pub async fn fetch_xmd_image(url: String) -> Result<XmdImageResponse, String> {
    let parsed = Url::parse(&url).map_err(|e| format!("无效图片 URL / Invalid image URL: {e}"))?;
    validate_image_url(&parsed)?;
    // The updater uses the same provider, but may not have run yet. Installing
    // it here is idempotent and safe when several exports start concurrently.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = Client::builder()
        .referer(false)
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .redirect(redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.error("Too many redirects");
            }
            match validate_image_url(attempt.url()) {
                Ok(()) => attempt.follow(),
                Err(error) => attempt.error(error),
            }
        }))
        .build()
        .map_err(|e| format!("无法创建图片下载请求 / Cannot create image request: {e}"))?;
    // No cookies, Authorization or Referer are supplied by the application.
    let mut response = client
        .get(parsed)
        .header(reqwest::header::ACCEPT, "image/*")
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|e| format!("图片下载失败 / Image download failed: {e}"))?;
    if let Some(size) = response.content_length() {
        validate_resource_size(size)?;
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if !content_type.starts_with("image/") {
        return Err("资源不是图片 / Resource does not have an image Content-Type".into());
    }
    let mut data = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("图片下载中断 / Image download interrupted: {e}"))?
    {
        validate_resource_size((data.len() + chunk.len()) as u64)?;
        data.extend_from_slice(&chunk);
    }
    Ok(XmdImageResponse { data, content_type })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_shares_and_oversized_files_before_reading() {
        for path in [
            "//attacker.example/share/pic.png",
            r"\\attacker.example\share\pic.png",
            r"\\?\UNC\attacker\pic.png",
        ] {
            assert!(local_resource_bytes(path)
                .unwrap_err()
                .contains("Network share"));
        }
        let file = tempfile::NamedTempFile::new().unwrap();
        file.as_file().set_len(64 * 1024 * 1024).unwrap();
        assert!(local_resource_bytes(file.path().to_str().unwrap())
            .unwrap_err()
            .contains("32 MiB"));
        file.as_file().set_len(3).unwrap();
        assert_eq!(
            local_resource_bytes(file.path().to_str().unwrap())
                .unwrap()
                .len(),
            3
        );
    }

    fn frame_for(path: &Path, payload: &[u8]) -> Vec<u8> {
        let path = path.to_str().unwrap().as_bytes();
        let mut frame = (path.len() as u32).to_le_bytes().to_vec();
        frame.extend_from_slice(path);
        frame.extend_from_slice(payload);
        frame
    }

    fn directory_entries(path: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(path)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn writes_raw_xmd_frames_without_number_array_serialization() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("测试.xmd");
        write_xmd_frame(&frame_for(&path, b"PK\x03\x04test")).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"PK\x03\x04test");
        assert!(write_xmd_frame(b"bad").is_err());
    }

    #[test]
    fn atomically_replaces_an_existing_package_and_removes_temporary_files() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("document.xmd");
        write_xmd_frame(&frame_for(&path, b"PK\x03\x04old package")).unwrap();

        write_xmd_frame(&frame_for(&path, b"PK\x03\x04new package")).unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"PK\x03\x04new package");
        assert_eq!(directory_entries(directory.path()), vec!["document.xmd"]);
    }

    #[test]
    fn accepts_only_zip_local_file_headers() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("header.xmd");
        write_xmd_frame(&frame_for(&path, b"PK\x03\x04rest")).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"PK\x03\x04rest");

        for payload in [
            b"PK\x05\x06".as_slice(), // empty archive / end-of-central-directory
            b"PK\x01\x02".as_slice(), // central directory
            b"not a zip".as_slice(),
        ] {
            assert!(write_xmd_frame(&frame_for(&path, payload)).is_err());
        }
        // Rejected payloads never touch the package that is already on disk.
        assert_eq!(fs::read(&path).unwrap(), b"PK\x03\x04rest");
    }

    #[cfg(windows)]
    #[test]
    fn failed_replacement_keeps_the_previous_package() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("locked.xmd");
        write_xmd_frame(&frame_for(&path, b"PK\x03\x04original")).unwrap();

        // A read-only destination cannot be replaced by MoveFileExW, which is
        // what tempfile uses on Windows. The already saved package must survive.
        let original_permissions = fs::metadata(&path).unwrap().permissions();
        let mut permissions = original_permissions.clone();
        permissions.set_readonly(true);
        fs::set_permissions(&path, permissions).unwrap();

        let result = write_xmd_frame(&frame_for(&path, b"PK\x03\x04replacement"));

        fs::set_permissions(&path, original_permissions).unwrap();

        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"PK\x03\x04original");
        assert_eq!(directory_entries(directory.path()), vec!["locked.xmd"]);
    }

    #[cfg(unix)]
    #[test]
    fn failed_temporary_file_creation_keeps_the_previous_package() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let folder = directory.path().join("readonly");
        fs::create_dir(&folder).unwrap();
        let path = folder.join("document.xmd");
        write_xmd_frame(&frame_for(&path, b"PK\x03\x04original")).unwrap();

        fs::set_permissions(&folder, fs::Permissions::from_mode(0o555)).unwrap();
        // Running as root bypasses directory permissions; skip instead of
        // asserting platform behavior the process cannot observe.
        let writable = fs::File::create(folder.join("probe")).is_ok();
        if writable {
            fs::set_permissions(&folder, fs::Permissions::from_mode(0o755)).unwrap();
            return;
        }

        let result = write_xmd_frame(&frame_for(&path, b"PK\x03\x04replacement"));
        fs::set_permissions(&folder, fs::Permissions::from_mode(0o755)).unwrap();

        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"PK\x03\x04original");
        assert_eq!(directory_entries(&folder), vec!["document.xmd"]);
    }

    #[test]
    fn document_read_limit_matches_the_128_mib_content_cap() {
        assert_eq!(MAX_XMD_DOCUMENT_BYTES, 136 * 1024 * 1024);
        let file = tempfile::NamedTempFile::new().unwrap();
        file.as_file().set_len(MAX_XMD_DOCUMENT_BYTES + 1).unwrap();
        // The metadata check rejects the oversized file before reading it.
        let error =
            read_bounded_file(file.path().to_str().unwrap(), MAX_XMD_DOCUMENT_BYTES).unwrap_err();
        assert!(error.contains("size limit"));
    }

    #[test]
    fn only_accepts_http_images_without_url_credentials() {
        for value in [
            "https://example.com/image.png",
            "http://127.0.0.1/image.png",
        ] {
            assert!(validate_image_url(&Url::parse(value).unwrap()).is_ok());
        }
        for value in [
            "file:///C:/secret.png",
            "data:image/png;base64,AAAA",
            "ftp://example.com/image.png",
            "https://user:secret@example.com/image.png",
        ] {
            assert!(validate_image_url(&Url::parse(value).unwrap()).is_err());
        }
    }

    fn fetch_test_response(response: String) -> Result<XmdImageResponse, String> {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = [0; 4096];
            let size = stream.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..size]).to_lowercase();
            assert!(!request.contains("authorization:"));
            assert!(!request.contains("cookie:"));
            assert!(!request.contains("referer:"));
            stream.write_all(response.as_bytes()).unwrap();
        });
        let result =
            tauri::async_runtime::block_on(fetch_xmd_image(format!("http://{address}/image")));
        server.join().unwrap();
        result
    }

    #[test]
    fn downloads_image_bytes_and_preserves_content_type() {
        let response = fetch_test_response(
            "HTTP/1.1 200 OK\r\nContent-Type: image/svg+xml; charset=utf-8\r\nContent-Length: 6\r\nConnection: close\r\n\r\n<svg/>".into(),
        ).unwrap();
        assert_eq!(response.data, b"<svg/>");
        assert_eq!(response.content_type, "image/svg+xml");
    }

    #[test]
    fn refuses_http_errors_non_images_and_oversized_downloads() {
        for response in [
            "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string(),
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string(),
            format!("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", MAX_RESOURCE_BYTES + 1),
        ] {
            assert!(fetch_test_response(response).is_err());
        }
    }

    #[test]
    fn refuses_non_http_redirects() {
        let result = fetch_test_response(
            "HTTP/1.1 302 Found\r\nLocation: file:///C:/secret.png\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn enforces_download_byte_limit() {
        assert!(validate_resource_size(MAX_RESOURCE_BYTES as u64).is_ok());
        assert!(validate_resource_size(MAX_RESOURCE_BYTES as u64 + 1).is_err());
    }
}
