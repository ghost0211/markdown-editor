//! Narrow, read-only HTTP(S) image loader for XMD export. Native networking
//! avoids loosening the webview CSP or relying on third-party CORS headers.
use reqwest::{redirect, Client, Url};
use serde::Serialize;
use std::time::Duration;
use std::{fs, io::Read, path::Path};
use tauri::ipc::{InvokeBody, Request, Response};

const MAX_RESOURCE_BYTES: usize = 32 * 1024 * 1024;

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

fn local_resource_bytes(path: &str) -> Result<Vec<u8>, String> {
    let normalized = path.replace('\\', "/");
    if normalized.starts_with("//") || normalized.starts_with("/??/") {
        return Err("不支持网络共享资源 / Network share resources are not supported".into());
    }
    let file = fs::File::open(path).map_err(|e| format!("读取资源失败 / Cannot read resource: {e}"))?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("资源不是常规文件 / Resource is not a regular file".into());
    }
    validate_resource_size(metadata.len())?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    // Enforce the limit even if the file grows between stat and read.
    file.take(MAX_RESOURCE_BYTES as u64 + 1)
        .read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    validate_resource_size(bytes.len() as u64)?;
    Ok(bytes)
}

#[tauri::command]
pub fn read_xmd_resource(path: String) -> Result<Response, String> {
    local_resource_bytes(&path).map(Response::new)
}

fn write_xmd_frame(frame: &[u8]) -> Result<(), String> {
    let length_bytes: [u8; 4] = frame.get(..4).ok_or("Invalid XMD frame")?
        .try_into().map_err(|_| "Invalid XMD frame")?;
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
    let target = Path::new(path);
    if let Some(parent) = target.parent().filter(|p| !p.as_os_str().is_empty()) {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(target, payload).map_err(|e| format!("写入 XMD 失败 / Cannot write XMD: {e}"))
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
        for path in ["//attacker.example/share/pic.png", r"\\attacker.example\share\pic.png", r"\\?\UNC\attacker\pic.png"] {
            assert!(local_resource_bytes(path).unwrap_err().contains("Network share"));
        }
        let file = tempfile::NamedTempFile::new().unwrap();
        file.as_file().set_len(64 * 1024 * 1024).unwrap();
        assert!(local_resource_bytes(file.path().to_str().unwrap()).unwrap_err().contains("32 MiB"));
        file.as_file().set_len(3).unwrap();
        assert_eq!(local_resource_bytes(file.path().to_str().unwrap()).unwrap().len(), 3);
    }

    #[test]
    fn writes_raw_xmd_frames_without_number_array_serialization() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("测试.xmd");
        let path_bytes = path.to_str().unwrap().as_bytes();
        let mut frame = (path_bytes.len() as u32).to_le_bytes().to_vec();
        frame.extend_from_slice(path_bytes);
        frame.extend_from_slice(b"PK\x03\x04test");
        write_xmd_frame(&frame).unwrap();
        assert_eq!(fs::read(path).unwrap(), b"PK\x03\x04test");
        assert!(write_xmd_frame(b"bad").is_err());
    }

    #[test]
    fn only_accepts_http_images_without_url_credentials() {
        for value in ["https://example.com/image.png", "http://127.0.0.1/image.png"] {
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
            stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut request = [0; 4096];
            let size = stream.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..size]).to_lowercase();
            assert!(!request.contains("authorization:"));
            assert!(!request.contains("cookie:"));
            assert!(!request.contains("referer:"));
            stream.write_all(response.as_bytes()).unwrap();
        });
        let result = tauri::async_runtime::block_on(fetch_xmd_image(format!("http://{address}/image")));
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
