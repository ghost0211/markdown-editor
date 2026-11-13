use crate::path_utils::{strip_text_extensions, OpenFileResponse, PendingOpenFiles};
use crate::pdf_export::export_pdf_from_html_sync;
use crate::session_store::{clear_session_in_dir, read_session_from_dir, write_session_to_dir};
use std::fs;
use std::path::Path;
use tauri::Manager;

/// Maps a frontend theme preference onto a window theme.
/// Kept as a pure function so the mapping is unit-testable without a window.
pub(crate) fn resolve_window_theme(preference: &str) -> Option<tauri::Theme> {
    match preference.trim().to_ascii_lowercase().as_str() {
        "dark" => Some(tauri::Theme::Dark),
        "light" => Some(tauri::Theme::Light),
        _ => None,
    }
}

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

/// Reads local binary content for preview media (images inserted by
/// paste/drop). Uses the same explicit path-based command boundary as
/// read_text_file instead of enabling a global asset-protocol scope.
#[tauri::command]
pub fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("文件不存在: {}", path));
    }
    fs::read(p).map_err(|e| format!("读取二进制文件失败 ({}): {}", path, e))
}

/// Returns the file's last-modified time in milliseconds since the Unix epoch.
/// Used by the frontend to detect external modifications to open documents.
#[tauri::command]
pub fn get_file_mtime(path: String) -> Result<u64, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("文件不存在: {}", path));
    }
    let metadata = fs::metadata(p).map_err(|e| format!("获取文件信息失败 ({}): {}", path, e))?;
    let modified = metadata
        .modified()
        .map_err(|e| format!("获取文件修改时间失败 ({}): {}", path, e))?;
    let millis = modified
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("文件修改时间异常 ({}): {}", path, e))?
        .as_millis() as u64;
    Ok(millis)
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
        .add_filter(
            "Markdown / Text Files",
            &["md", "markdown", "mdown", "mkd", "txt"],
        )
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
        "html" => ("HTML 网页 (*.html)", "html", "导出 HTML 网页"),
        "svg" => ("SVG 矢量图 (*.svg)", "svg", "导出 SVG 图表"),
        "png" => ("PNG 图片 (*.png)", "png", "导出 PNG 图表"),
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
pub fn open_windows_default_apps_settings() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        match opener::open("ms-settings:defaultapps") {
            Ok(_) => Ok(()),
            Err(e) => {
                let cmd_res = std::process::Command::new("cmd")
                    .args(["/C", "start", "", "ms-settings:defaultapps"])
                    .spawn();
                match cmd_res {
                    Ok(_) => Ok(()),
                    Err(cmd_err) => Err(format!(
                        "打开 Windows 设置失败: {} (备用命令执行失败: {})",
                        e, cmd_err
                    )),
                }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("打开 Windows 默认应用设置仅支持 Windows 操作系统".to_string())
    }
}

#[tauri::command]
pub fn drain_pending_open_files(state: tauri::State<'_, PendingOpenFiles>) -> Vec<String> {
    let mut queue = state.0.lock().unwrap_or_else(|e| e.into_inner());
    queue.drain(..).collect()
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

#[tauri::command]
pub fn show_in_folder(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed.starts_with("browser://") {
        return Err("文件尚未保存到本地磁盘".to_string());
    }

    let p = Path::new(trimmed);
    if !p.exists() {
        return Err(format!("文件不存在: {}", trimmed));
    }

    #[cfg(target_os = "windows")]
    {
        let norm_path = trimmed.replace('/', "\\");
        let cmd_res = std::process::Command::new("explorer")
            .arg(format!("/select,{}", norm_path))
            .spawn();
        match cmd_res {
            Ok(_) => Ok(()),
            Err(e) => {
                if let Some(parent) = p.parent() {
                    opener::open(parent).map_err(|oe| format!("打开所在文件夹失败: {} ({})", e, oe))
                } else {
                    Err(format!("打开所在文件夹失败: {}", e))
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .args(["-R", trimmed])
            .spawn();
        match status {
            Ok(_) => Ok(()),
            Err(e) => {
                if let Some(parent) = p.parent() {
                    opener::open(parent).map_err(|oe| format!("打开所在文件夹失败: {} ({})", e, oe))
                } else {
                    Err(format!("打开所在文件夹失败: {}", e))
                }
            }
        }
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        if let Some(parent) = p.parent() {
            opener::open(parent).map_err(|oe| format!("打开所在文件夹失败: {}", oe))
        } else {
            opener::open(p).map_err(|oe| format!("打开所在文件夹失败: {}", oe))
        }
    }
}

/// Syncs the OS window theme with the in-app theme so the native title bar
/// and its native minimize/maximize/close buttons follow dark mode.
#[tauri::command]
pub fn set_window_theme(window: tauri::WebviewWindow, theme: String) -> Result<(), String> {
    window
        .set_theme(resolve_window_theme(&theme))
        .map_err(|e| format!("设置窗口主题失败: {}", e))
}

/// Reads the persisted tab session JSON from Tauri's native app-data directory.
#[tauri::command]
pub fn read_session_data(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
    read_session_from_dir(&dir)
}

/// Atomically writes the tab session JSON into Tauri's native app-data directory.
#[tauri::command]
pub fn write_session_data(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
    write_session_to_dir(&dir, &data)
}

/// Clears the persisted tab session file in Tauri's native app-data directory.
#[tauri::command]
pub fn clear_session_data(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
    clear_session_in_dir(&dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_window_theme_preference() {
        assert_eq!(resolve_window_theme("dark"), Some(tauri::Theme::Dark));
        assert_eq!(resolve_window_theme("Dark"), Some(tauri::Theme::Dark));
        assert_eq!(resolve_window_theme("  DARK "), Some(tauri::Theme::Dark));
        assert_eq!(resolve_window_theme("light"), Some(tauri::Theme::Light));
        assert_eq!(resolve_window_theme("Light"), Some(tauri::Theme::Light));
        assert_eq!(resolve_window_theme("system"), None);
        assert_eq!(resolve_window_theme(""), None);
        assert_eq!(resolve_window_theme("sepia"), None);
    }

    #[test]
    fn test_show_in_folder_validation() {
        assert!(show_in_folder("".to_string()).is_err());
        assert!(show_in_folder("   ".to_string()).is_err());
        assert!(show_in_folder("browser://test.md".to_string()).is_err());
        assert!(show_in_folder("non_existent_folder_or_file_987654.md".to_string()).is_err());
    }

    #[test]
    fn test_export_file_dialog_format_validation() {
        assert!(export_file_dialog("exe".to_string(), None).is_err());
        assert!(export_file_dialog("txt".to_string(), None).is_err());
        assert!(export_file_dialog("md".to_string(), None).is_err());
        assert!(export_file_dialog("json".to_string(), None).is_err());
        assert!(export_file_dialog("".to_string(), None).is_err());
    }

    #[test]
    fn test_open_url_protocol_security() {
        assert!(open_url("javascript:alert(1)".to_string()).is_err());
        assert!(open_url("file:///C:/Windows/System32/calc.exe".to_string()).is_err());
        assert!(open_url("data:text/html,test".to_string()).is_err());
        assert!(open_url("powershell.exe".to_string()).is_err());
        assert!(open_url("ms-settings:defaultapps".to_string()).is_err());
        assert!(open_url("".to_string()).is_err());
        assert!(open_url("   ".to_string()).is_err());
    }

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn test_open_windows_default_apps_settings_on_non_windows() {
        let res = open_windows_default_apps_settings();
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("仅支持 Windows 操作系统"));
    }
}
