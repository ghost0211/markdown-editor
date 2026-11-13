use std::fs;
use std::io::Write;
use std::path::Path;

pub const SESSION_FILE_NAME: &str = "session_v1.json";

/// Reads the persisted session JSON string from the given app-data directory.
/// Returns `Ok(None)` if no session file exists yet or if the file is empty.
pub fn read_session_from_dir(dir: &Path) -> Result<Option<String>, String> {
    let file_path = dir.join(SESSION_FILE_NAME);
    if !file_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("读取会话存储失败 ({}): {}", file_path.display(), e))?;

    if content.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(content))
    }
}

/// Atomically writes the session JSON string to `session_v1.json` inside `dir`.
///
/// Writes to a temporary file in the same directory first and atomically
/// replaces the target file via `NamedTempFile::persist`, preventing truncated
/// or corrupted session files if the application exits mid-write. Supports
/// multi-megabyte drafts without browser `localStorage` quota limits.
pub fn write_session_to_dir(dir: &Path, data: &str) -> Result<(), String> {
    if !dir.exists() {
        fs::create_dir_all(dir)
            .map_err(|e| format!("创建应用数据目录失败 ({}): {}", dir.display(), e))?;
    }

    let target_path = dir.join(SESSION_FILE_NAME);
    let mut temp_file = tempfile::Builder::new()
        .prefix("session_tmp_")
        .suffix(".json")
        .tempfile_in(dir)
        .map_err(|e| format!("创建临时会话文件失败 ({}): {}", dir.display(), e))?;

    temp_file
        .write_all(data.as_bytes())
        .map_err(|e| format!("写入临时会话数据失败: {}", e))?;
    temp_file
        .flush()
        .map_err(|e| format!("刷新临时会话数据失败: {}", e))?;

    temp_file
        .persist(&target_path)
        .map_err(|e| format!("提交会话文件失败 ({}): {}", target_path.display(), e.error))?;

    Ok(())
}

/// Deletes `session_v1.json` inside `dir` if present.
pub fn clear_session_in_dir(dir: &Path) -> Result<(), String> {
    let file_path = dir.join(SESSION_FILE_NAME);
    if !file_path.exists() {
        return Ok(());
    }
    match fs::remove_file(&file_path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("清理会话文件失败 ({}): {}", file_path.display(), e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_missing_session_returns_none() {
        let temp_dir = tempfile::tempdir().unwrap();
        let res = read_session_from_dir(temp_dir.path()).unwrap();
        assert_eq!(res, None);
    }

    #[test]
    fn test_write_and_atomic_overwrite_session() {
        let temp_dir = tempfile::tempdir().unwrap();
        let nested_dir = temp_dir.path().join("nested_app_data");

        let first_payload = r#"{"version":1,"activeTabId":"tab-1","tabs":[{"id":"tab-1","title":"笔记.md","content":"第一版内容"}]}"#;
        write_session_to_dir(&nested_dir, first_payload).unwrap();

        let read_first = read_session_from_dir(&nested_dir).unwrap();
        assert_eq!(read_first.as_deref(), Some(first_payload));

        // Atomic overwrite on existing file (critical on Windows)
        let second_payload = r#"{"version":1,"activeTabId":"tab-2","tabs":[{"id":"tab-2","title":"更新.md","content":"第二版内容"}]}"#;
        write_session_to_dir(&nested_dir, second_payload).unwrap();

        let read_second = read_session_from_dir(&nested_dir).unwrap();
        assert_eq!(read_second.as_deref(), Some(second_payload));

        // Ensure no leftover temporary files remain in nested_dir
        let entries: Vec<_> = fs::read_dir(&nested_dir)
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].file_name(), SESSION_FILE_NAME);
    }

    #[test]
    fn test_large_multi_megabyte_session_exceeding_localstorage_quota() {
        let temp_dir = tempfile::tempdir().unwrap();
        // ~6.5 MB payload — well past the 5 MB WebView localStorage ceiling
        let large_body = "# 大型草稿\n\n".to_string() + &"这是一段长文本测试内容。\n".repeat(180_000);
        assert!(large_body.len() > 6 * 1024 * 1024);

        let payload = serde_json::json!({
            "version": 1,
            "activeTabId": "big-tab",
            "tabs": [{
                "id": "big-tab",
                "title": "6MB草稿.md",
                "content": large_body,
            }]
        })
        .to_string();

        write_session_to_dir(temp_dir.path(), &payload).unwrap();
        let loaded = read_session_from_dir(temp_dir.path()).unwrap().unwrap();
        assert_eq!(loaded.len(), payload.len());
        assert_eq!(loaded, payload);
    }

    #[test]
    fn test_clear_session_in_dir() {
        let temp_dir = tempfile::tempdir().unwrap();
        write_session_to_dir(temp_dir.path(), r#"{"version":1}"#).unwrap();
        assert!(read_session_from_dir(temp_dir.path()).unwrap().is_some());

        clear_session_in_dir(temp_dir.path()).unwrap();
        assert_eq!(read_session_from_dir(temp_dir.path()).unwrap(), None);

        // Idempotent when called again
        clear_session_in_dir(temp_dir.path()).unwrap();
    }
}
