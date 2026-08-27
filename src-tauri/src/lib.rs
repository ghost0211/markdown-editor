use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const MIN_PDF_SIZE: u64 = 64;
const PDF_POLL_INTERVAL: Duration = Duration::from_millis(100);
const PDF_MAX_WAIT_DURATION: Duration = Duration::from_secs(15);

#[derive(Debug, Serialize, Deserialize)]
pub struct OpenFileResponse {
    pub path: String,
    pub name: String,
    pub content: String,
}

fn strip_text_extensions(name: &str) -> String {
    let lower = name.to_lowercase();
    for suffix in [".md", ".markdown", ".mdown", ".txt", ".docx", ".pdf"] {
        if lower.ends_with(suffix) {
            return name[..name.len() - suffix.len()].to_string();
        }
    }
    name.to_string()
}

fn find_edge_binary() -> Option<PathBuf> {
    // 1. ProgramFiles(x86)
    if let Some(pf86) = std::env::var_os("ProgramFiles(x86)") {
        let candidate = PathBuf::from(pf86).join(r"Microsoft\Edge\Application\msedge.exe");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    // 2. ProgramFiles
    if let Some(pf) = std::env::var_os("ProgramFiles") {
        let candidate = PathBuf::from(pf).join(r"Microsoft\Edge\Application\msedge.exe");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    // 3. LOCALAPPDATA
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        let candidate =
            PathBuf::from(local_app_data).join(r"Microsoft\Edge\Application\msedge.exe");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    // 4. Hardcoded common paths on Windows
    let hardcoded = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ];
    for path_str in hardcoded {
        let p = PathBuf::from(path_str);
        if p.exists() {
            return Some(p);
        }
    }
    // 5. Look in PATH
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join("msedge.exe");
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

fn validate_pdf_file(path: &Path) -> Result<u64, String> {
    let meta = fs::metadata(path)
        .map_err(|e| format!("无法读取 PDF 文件元数据 ({}): {}", path.display(), e))?;
    let len = meta.len();
    if len < MIN_PDF_SIZE {
        return Err(format!(
            "生成的 PDF 文件过小或为空 ({} 字节): {}",
            len,
            path.display()
        ));
    }

    let mut file = fs::File::open(path)
        .map_err(|e| format!("无法打开 PDF 文件 ({}): {}", path.display(), e))?;
    let mut header = [0u8; 5];
    let bytes_read = file
        .read(&mut header)
        .map_err(|e| format!("读取 PDF 文件头失败 ({}): {}", path.display(), e))?;
    if bytes_read < 5 || &header != b"%PDF-" {
        return Err(format!(
            "PDF 文件格式校验失败: 未包含有效标识头 (%PDF-) ({})",
            path.display()
        ));
    }

    Ok(len)
}

fn export_pdf_from_html_sync(path: String, html: String) -> Result<(), String> {
    let dest_path = PathBuf::from(&path);
    if let Some(parent) = dest_path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            if let Err(e) = fs::create_dir_all(parent) {
                return Err(format!("创建目标目录失败 ({}): {}", parent.display(), e));
            }
        }
    }

    let edge_exe = find_edge_binary().ok_or_else(|| {
        "未检测到 Microsoft Edge 浏览器，无法生成 PDF。请安装 Microsoft Edge 或使用系统打印功能。".to_string()
    })?;

    // Create isolated temp directory for user data, temporary html file, and temporary pdf output
    let temp_dir = tempfile::Builder::new()
        .prefix("md_editor_pdf_export_")
        .tempdir()
        .map_err(|e| format!("创建临时工作目录失败: {}", e))?;

    let temp_html_file = temp_dir.path().join("document.html");
    fs::write(&temp_html_file, html.as_bytes())
        .map_err(|e| format!("写入临时 HTML 渲染文件失败: {}", e))?;

    let temp_pdf_file = temp_dir.path().join("generated.pdf");
    let user_data_dir = temp_dir.path().join("edge_profile");
    let print_arg = format!("--print-to-pdf={}", temp_pdf_file.to_string_lossy());
    let user_data_arg = format!("--user-data-dir={}", user_data_dir.to_string_lossy());

    let mut command = std::process::Command::new(&edge_exe);
    command
        .arg("--headless")
        .arg("--disable-gpu")
        .arg("--no-pdf-header-footer")
        .arg("--run-all-compositor-stages-before-draw")
        .arg("--virtual-time-budget=3000")
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-extensions")
        .arg(user_data_arg)
        .arg(print_arg)
        .arg(&temp_html_file);

    let output = command
        .output()
        .map_err(|e| format!("启动 Microsoft Edge 导出进程失败: {}", e))?;

    let stderr_raw = String::from_utf8_lossy(&output.stderr);
    let stderr_trimmed = stderr_raw.trim();
    let stderr_snippet = if stderr_trimmed.is_empty() {
        String::new()
    } else if stderr_trimmed.chars().count() > 400 {
        let truncated: String = stderr_trimmed.chars().take(400).collect();
        format!(" (Edge 输出: {}...)", truncated)
    } else {
        format!(" (Edge 输出: {})", stderr_trimmed)
    };

    if !output.status.success() {
        return Err(format!(
            "PDF 导出失败 (Edge 进程退出码 {:?}){}",
            output.status.code(),
            stderr_snippet
        ));
    }

    // Reliable wait & stability polling: poll temporary PDF until size >= MIN_PDF_SIZE and is stable across checks
    let start_time = Instant::now();
    let mut last_size: Option<u64> = None;
    let mut file_ready = false;

    while start_time.elapsed() < PDF_MAX_WAIT_DURATION {
        if temp_pdf_file.exists() {
            if let Ok(meta) = fs::metadata(&temp_pdf_file) {
                let current_size = meta.len();
                if current_size >= MIN_PDF_SIZE {
                    if let Some(prev_size) = last_size {
                        if prev_size == current_size {
                            file_ready = true;
                            break;
                        }
                    }
                    last_size = Some(current_size);
                }
            }
        }
        std::thread::sleep(PDF_POLL_INTERVAL);
    }

    if !file_ready {
        return Err(format!(
            "PDF 导出超时: Microsoft Edge 未能成功生成有效的临时 PDF 文件{}",
            stderr_snippet
        ));
    }

    // Validate the generated temporary PDF file
    validate_pdf_file(&temp_pdf_file)?;

    // Safely copy temporary PDF to destination path (handles Chinese/spaces/special paths natively via Rust)
    if let Some(parent) = dest_path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("创建目标目录失败 ({}): {}", parent.display(), e))?;
        }
    }

    fs::copy(&temp_pdf_file, &dest_path)
        .map_err(|e| format!("保存 PDF 到目标路径失败 ({}): {}", dest_path.display(), e))?;

    // Post-copy verification on target file
    validate_pdf_file(&dest_path)
        .map_err(|e| format!("目标 PDF 文件校验失败 ({}): {}", dest_path.display(), e))?;

    Ok(())
}

mod commands {
    use super::*;

    #[tauri::command]
    pub fn read_text_file(path: String) -> Result<String, String> {
        let p = Path::new(&path);
        if !p.exists() {
            return Err(format!("文件不存在: {}", path));
        }
        match fs::read_to_string(p) {
            Ok(content) => Ok(content),
            Err(e) => {
                if e.kind() == std::io::ErrorKind::InvalidData {
                    Err(format!("文件编码错误，请确保文件为 UTF-8 文本格式: {}", e))
                } else {
                    Err(format!("读取文件失败 ({}): {}", path, e))
                }
            }
        }
    }

    #[tauri::command]
    pub fn write_text_file(path: String, content: String) -> Result<(), String> {
        let p = Path::new(&path);
        if let Some(parent) = p.parent() {
            if !parent.as_os_str().is_empty() && !parent.exists() {
                if let Err(e) = fs::create_dir_all(parent) {
                    return Err(format!("创建目录失败: {}", e));
                }
            }
        }
        match fs::write(p, content.as_bytes()) {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("保存文件失败 ({}): {}", path, e)),
        }
    }

    #[tauri::command]
    pub fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
        let p = Path::new(&path);
        if let Some(parent) = p.parent() {
            if !parent.as_os_str().is_empty() && !parent.exists() {
                if let Err(e) = fs::create_dir_all(parent) {
                    return Err(format!("创建目录失败: {}", e));
                }
            }
        }
        match fs::write(p, &data) {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("保存二进制文件失败 ({}): {}", path, e)),
        }
    }

    #[tauri::command]
    pub fn open_file_dialog() -> Result<Option<OpenFileResponse>, String> {
        let file = rfd::FileDialog::new()
            .add_filter("Markdown / Text Files", &["md", "markdown", "mdown", "txt"])
            .add_filter("All Files", &["*"])
            .set_title("打开 Markdown 文档")
            .pick_file();

        match file {
            Some(path_buf) => {
                let path_str = path_buf.to_string_lossy().to_string();
                let file_name = path_buf
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "Untitled.md".to_string());

                match fs::read_to_string(&path_buf) {
                    Ok(content) => Ok(Some(OpenFileResponse {
                        path: path_str,
                        name: file_name,
                        content,
                    })),
                    Err(e) => {
                        if e.kind() == std::io::ErrorKind::InvalidData {
                            Err(format!("文件编码不是有效的 UTF-8 编码: {}", e))
                        } else {
                            Err(format!("无法读取所选文件: {}", e))
                        }
                    }
                }
            }
            None => Ok(None),
        }
    }

    #[tauri::command]
    pub fn save_file_dialog(default_name: Option<String>) -> Result<Option<String>, String> {
        let file_name = default_name.unwrap_or_else(|| "未命名.md".to_string());

        let dialog = rfd::FileDialog::new()
            .add_filter("Markdown File (*.md)", &["md"])
            .add_filter("Text File (*.txt)", &["txt"])
            .add_filter("All Files", &["*"])
            .set_title("保存 Markdown 文档")
            .set_file_name(&file_name);

        match dialog.save_file() {
            Some(path_buf) => Ok(Some(path_buf.to_string_lossy().to_string())),
            None => Ok(None),
        }
    }

    #[tauri::command]
    pub fn export_file_dialog(
        format: String,
        default_name: Option<String>,
    ) -> Result<Option<String>, String> {
        let lower_format = format.to_lowercase();
        let (filter_name, ext, title) = match lower_format.as_str() {
            "docx" => ("Word 文档 (*.docx)", "docx", "导出 Word 文档"),
            "pdf" => ("PDF 文档 (*.pdf)", "pdf", "导出 PDF 文档"),
            _ => return Err(format!("不支持的导出格式: {}", format)),
        };

        let base_name = default_name.unwrap_or_else(|| "未命名".to_string());
        let stripped = strip_text_extensions(&base_name);
        let final_default_name = if stripped.to_lowercase().ends_with(&format!(".{}", ext)) {
            stripped
        } else {
            format!("{}.{}", stripped, ext)
        };

        let dialog = rfd::FileDialog::new()
            .add_filter(filter_name, &[ext])
            .set_title(title)
            .set_file_name(&final_default_name);

        match dialog.save_file() {
            Some(path_buf) => {
                let mut final_path = path_buf;
                let current_ext = final_path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("");
                if !current_ext.eq_ignore_ascii_case(ext) {
                    final_path.set_extension(ext);
                }
                Ok(Some(final_path.to_string_lossy().to_string()))
            }
            None => Ok(None),
        }
    }

    #[tauri::command]
    pub async fn export_pdf_from_html(path: String, html: String) -> Result<(), String> {
        tauri::async_runtime::spawn_blocking(move || export_pdf_from_html_sync(path, html))
            .await
            .map_err(|e| format!("后台导出任务执行失败: {}", e))?
    }

    #[tauri::command]
    pub fn open_url(url: String) -> Result<(), String> {
        let trimmed = url.trim();
        if !trimmed.starts_with("http://")
            && !trimmed.starts_with("https://")
            && !trimmed.starts_with("mailto:")
        {
            return Err("仅支持打开 Web 与邮件链接 (http/https/mailto)".to_string());
        }
        match opener::open(trimmed) {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("打开链接失败: {}", e)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_text_extensions() {
        assert_eq!(strip_text_extensions("document.md"), "document");
        assert_eq!(strip_text_extensions("document.markdown"), "document");
        assert_eq!(strip_text_extensions("document.txt"), "document");
        assert_eq!(strip_text_extensions("document.docx"), "document");
        assert_eq!(strip_text_extensions("document.pdf"), "document");
        assert_eq!(strip_text_extensions("archive.tar.gz"), "archive.tar.gz");
        assert_eq!(strip_text_extensions("notes.v1.MD"), "notes.v1");
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_find_edge_binary() {
        let edge = find_edge_binary();
        assert!(
            edge.is_some(),
            "Edge should be detected on this Windows test machine"
        );
    }

    #[test]
    fn test_validate_pdf_file() {
        let temp_dir = tempfile::Builder::new()
            .prefix("md_editor_validate_test_")
            .tempdir()
            .unwrap();

        // 1. Valid PDF file
        let valid_pdf = temp_dir.path().join("valid.pdf");
        let mut valid_content = b"%PDF-1.4\n".to_vec();
        valid_content.extend_from_slice(&[0u8; 100]);
        fs::write(&valid_pdf, &valid_content).unwrap();
        assert!(validate_pdf_file(&valid_pdf).is_ok());

        // 2. Too small file
        let small_pdf = temp_dir.path().join("small.pdf");
        fs::write(&small_pdf, b"%PDF-").unwrap();
        assert!(validate_pdf_file(&small_pdf).is_err());

        // 3. Invalid header file
        let invalid_pdf = temp_dir.path().join("invalid.pdf");
        let mut invalid_content = b"NOT_A_PDF_HEADER".to_vec();
        invalid_content.extend_from_slice(&[0u8; 100]);
        fs::write(&invalid_pdf, &invalid_content).unwrap();
        assert!(validate_pdf_file(&invalid_pdf).is_err());

        // 4. Non-existent file
        let non_existent = temp_dir.path().join("does_not_exist.pdf");
        assert!(validate_pdf_file(&non_existent).is_err());
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_export_pdf_with_chinese_and_spaces_path() {
        if find_edge_binary().is_none() {
            println!("Edge binary not found, skipping PDF export integration test");
            return;
        }

        let test_temp_dir = tempfile::Builder::new()
            .prefix("md_editor_test_export_")
            .tempdir()
            .expect("创建测试临时目录失败");

        // Subdirectory with Chinese characters and spaces
        let target_dir = test_temp_dir.path().join("中文 测试 目录");
        let target_pdf = target_dir.join("导出 验收 报告.pdf");

        let sample_html = r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>集成测试导出文档</title>
<style>
body { font-family: sans-serif; padding: 24px; color: #1e293b; }
h1 { color: #2563eb; border-bottom: 2px solid #e2e8f0; }
p { line-height: 1.6; }
</style>
</head>
<body>
<h1>集成测试文档标题</h1>
<p>这是一段包含<strong>中文</strong>和<em>格式化内容</em>的测试 HTML，用于验证 PDF 导出到包含空格与中文的路径。</p>
<ul>
  <li>测试项 1: 中文路径支持</li>
  <li>测试项 2: 空格路径支持</li>
  <li>测试项 3: PDF 标识头有效性</li>
</ul>
</body>
</html>"#;

        let result = export_pdf_from_html_sync(
            target_pdf.to_string_lossy().to_string(),
            sample_html.to_string(),
        );

        assert!(
            result.is_ok(),
            "export_pdf_from_html_sync 失败: {:?}",
            result.err()
        );

        assert!(
            target_pdf.exists(),
            "目标 PDF 文件应当存在于指定目标路径: {}",
            target_pdf.display()
        );

        let meta = fs::metadata(&target_pdf).expect("获取目标 PDF 元数据失败");
        assert!(
            meta.len() > 1000,
            "PDF 文件长度应大于 1000 字节，实际为 {}",
            meta.len()
        );

        let mut file = fs::File::open(&target_pdf).expect("无法打开生成的 PDF 文件");
        let mut header = [0u8; 5];
        file.read_exact(&mut header).expect("无法读取 PDF 文件头");
        assert_eq!(&header, b"%PDF-", "目标 PDF 文件必须以 %PDF- 标识头开头");
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_export_pdf_overwrite_existing_file() {
        if find_edge_binary().is_none() {
            println!("Edge binary not found, skipping PDF export integration test");
            return;
        }

        let test_temp_dir = tempfile::Builder::new()
            .prefix("md_editor_test_overwrite_")
            .tempdir()
            .expect("创建测试临时目录失败");

        let target_pdf = test_temp_dir.path().join("覆盖 测试.pdf");
        // Pre-create a dummy file
        fs::write(&target_pdf, b"DUMMY_OLD_CONTENT_NOT_A_PDF").expect("写入初始旧文件失败");

        let sample_html = r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>覆盖测试</title></head>
<body><h1>覆盖写入测试成功</h1></body>
</html>"#;

        let result = export_pdf_from_html_sync(
            target_pdf.to_string_lossy().to_string(),
            sample_html.to_string(),
        );

        assert!(result.is_ok(), "覆盖导出应当成功: {:?}", result.err());
        assert!(target_pdf.exists());

        let mut file = fs::File::open(&target_pdf).expect("无法打开生成的 PDF 文件");
        let mut header = [0u8; 5];
        file.read_exact(&mut header).expect("无法读取 PDF 文件头");
        assert_eq!(&header, b"%PDF-", "覆盖后的目标文件必须是合法 PDF");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::read_text_file,
            commands::write_text_file,
            commands::write_binary_file,
            commands::open_file_dialog,
            commands::save_file_dialog,
            commands::export_file_dialog,
            commands::export_pdf_from_html,
            commands::open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
