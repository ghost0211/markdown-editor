use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Url;

pub const SUPPORTED_FILE_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "txt"];

#[derive(Default)]
pub struct PendingOpenFiles(pub Mutex<Vec<String>>);

#[derive(Debug, Serialize, Deserialize)]
pub struct OpenFileResponse {
    pub path: String,
    pub name: String,
    pub content: String,
}

/// Enqueues unique paths into the pending open files queue.
/// Performs case-insensitive deduplication on Windows and case-sensitive on other platforms.
pub fn enqueue_pending_paths(queue: &mut Vec<String>, paths: impl IntoIterator<Item = String>) {
    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }
        #[cfg(windows)]
        let is_duplicate = queue
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(trimmed));
        #[cfg(not(windows))]
        let is_duplicate = queue.iter().any(|existing| existing == trimmed);

        if !is_duplicate {
            queue.push(trimmed.to_string());
        }
    }
}

pub fn is_supported_file_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lower = ext.to_ascii_lowercase();
            SUPPORTED_FILE_EXTENSIONS
                .iter()
                .any(|&supported| supported == lower)
        })
        .unwrap_or(false)
}

pub fn canonicalize_path(p: &Path) -> PathBuf {
    if let Ok(canon) = p.canonicalize() {
        let s = canon.to_string_lossy();
        if let Some(stripped) = s.strip_prefix(r"\\?\UNC\") {
            PathBuf::from(format!(r"\\{}", stripped))
        } else if let Some(stripped) = s.strip_prefix(r"\\?\") {
            PathBuf::from(stripped)
        } else {
            canon
        }
    } else {
        p.to_path_buf()
    }
}

/// Filters command-line / single-instance arguments to existing regular files with supported extensions.
///
/// Accepts standard file paths and `file://` URLs (Windows & POSIX), decoding percent-encoded characters
/// and Unicode safely. Strictly rejects non-file URL schemes (such as http://, https://, custom://, etc.).
pub fn filter_and_normalize_paths<I, S>(args: I, base_cwd: &Path) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut results = Vec::new();
    let mut seen_keys = HashSet::new();

    for arg in args {
        let raw_arg = arg.as_ref().trim();
        if raw_arg.is_empty() || raw_arg.starts_with('-') {
            continue;
        }

        // Strip enclosing quotes if present (e.g. from Windows shell)
        let trimmed_arg = if (raw_arg.starts_with('"') && raw_arg.ends_with('"'))
            || (raw_arg.starts_with('\'') && raw_arg.ends_with('\''))
        {
            if raw_arg.len() >= 2 {
                &raw_arg[1..raw_arg.len() - 1]
            } else {
                raw_arg
            }
        } else {
            raw_arg
        };

        let trimmed_arg = trimmed_arg.trim();
        if trimmed_arg.is_empty() {
            continue;
        }

        // Determine candidate path: parse file:// URLs or fallback to filesystem path
        let candidate_path: PathBuf = if let Ok(parsed_url) = Url::parse(trimmed_arg) {
            if parsed_url.scheme().eq_ignore_ascii_case("file") {
                match parsed_url.to_file_path() {
                    Ok(p) => p,
                    Err(_) => continue,
                }
            } else if parsed_url.scheme().len() > 1 {
                // Non-file URL scheme (http, https, custom, mailto, etc.) - reject
                continue;
            } else {
                // Single-letter scheme parsed by URL parser on Windows drive paths (e.g. C:/path)
                PathBuf::from(trimmed_arg)
            }
        } else {
            PathBuf::from(trimmed_arg)
        };

        let resolved = if candidate_path.is_relative() {
            base_cwd.join(candidate_path)
        } else {
            candidate_path
        };

        if !resolved.is_file() {
            continue;
        }

        if !is_supported_file_extension(&resolved) {
            continue;
        }

        let canonical = canonicalize_path(&resolved);
        let path_str = canonical.to_string_lossy().to_string();

        #[cfg(windows)]
        let dedup_key = path_str.to_lowercase();
        #[cfg(not(windows))]
        let dedup_key = path_str.clone();

        if seen_keys.insert(dedup_key) {
            results.push(path_str);
        }
    }

    results
}

pub fn strip_text_extensions(name: &str) -> String {
    let lower = name.to_lowercase();
    for suffix in [
        ".md",
        ".markdown",
        ".mdown",
        ".mkd",
        ".txt",
        ".docx",
        ".pdf",
        ".html",
        ".htm",
        ".svg",
        ".png",
    ] {
        if lower.ends_with(suffix) {
            return name[..name.len() - suffix.len()].to_string();
        }
    }
    name.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_is_supported_file_extension() {
        assert!(is_supported_file_extension(Path::new("test.md")));
        assert!(is_supported_file_extension(Path::new("test.markdown")));
        assert!(is_supported_file_extension(Path::new("test.mdown")));
        assert!(is_supported_file_extension(Path::new("test.mkd")));
        assert!(is_supported_file_extension(Path::new("test.txt")));
        assert!(is_supported_file_extension(Path::new("test.MD")));
        assert!(is_supported_file_extension(Path::new("test.MarkDown")));
        assert!(is_supported_file_extension(Path::new("test.TXT")));

        assert!(!is_supported_file_extension(Path::new("test.docx")));
        assert!(!is_supported_file_extension(Path::new("test.pdf")));
        assert!(!is_supported_file_extension(Path::new("test.exe")));
        assert!(!is_supported_file_extension(Path::new("test.rs")));
        assert!(!is_supported_file_extension(Path::new("test.json")));
        assert!(!is_supported_file_extension(Path::new("test")));
    }

    #[test]
    fn test_filter_and_normalize_paths() {
        let temp_dir = tempfile::Builder::new()
            .prefix("md_editor_test_filter_")
            .tempdir()
            .unwrap();
        let base_cwd = temp_dir.path();

        let doc1 = base_cwd.join("doc1.md");
        let doc2 = base_cwd.join("doc2.txt");
        let doc3 = base_cwd.join("doc3.markdown");
        let invalid_ext = base_cwd.join("image.png");
        let sub_dir = base_cwd.join("subfolder");

        fs::write(&doc1, "# Doc 1").unwrap();
        fs::write(&doc2, "Doc 2 text").unwrap();
        fs::write(&doc3, "# Doc 3").unwrap();
        fs::write(&invalid_ext, b"fake png").unwrap();
        fs::create_dir(&sub_dir).unwrap();

        let args = vec![
            "--flag".to_string(),
            "-v".to_string(),
            "".to_string(),
            "   ".to_string(),
            "non_existent.md".to_string(),
            "doc1.md".to_string(),
            format!("\"{}\"", doc1.to_string_lossy()),
            doc2.to_string_lossy().to_string(),
            "doc3.markdown".to_string(),
            "image.png".to_string(),
            "subfolder".to_string(),
        ];

        let filtered = filter_and_normalize_paths(args, base_cwd);
        assert_eq!(
            filtered.len(),
            3,
            "Should only have doc1, doc2, and doc3 (deduplicated)"
        );

        let doc1_canon = canonicalize_path(&doc1).to_string_lossy().to_string();
        let doc2_canon = canonicalize_path(&doc2).to_string_lossy().to_string();
        let doc3_canon = canonicalize_path(&doc3).to_string_lossy().to_string();

        assert_eq!(filtered[0], doc1_canon);
        assert_eq!(filtered[1], doc2_canon);
        assert_eq!(filtered[2], doc3_canon);
    }

    #[test]
    fn test_filter_and_normalize_paths_file_urls_and_security() {
        let temp_dir = tempfile::Builder::new()
            .prefix("md_editor_test_urls_")
            .tempdir()
            .unwrap();
        let base_cwd = temp_dir.path();

        let regular_doc = base_cwd.join("regular.md");
        let spaced_dir = base_cwd.join("folder with spaces");
        fs::create_dir(&spaced_dir).unwrap();
        let spaced_doc = spaced_dir.join("spaced file.markdown");

        let unicode_dir = base_cwd.join("中文 目录");
        fs::create_dir(&unicode_dir).unwrap();
        let unicode_doc = unicode_dir.join("测试 文档.md");

        fs::write(&regular_doc, "# Regular").unwrap();
        fs::write(&spaced_doc, "# Spaced").unwrap();
        fs::write(&unicode_doc, "# Unicode").unwrap();

        let regular_url = Url::from_file_path(&regular_doc).unwrap().to_string();
        let spaced_url = Url::from_file_path(&spaced_doc).unwrap().to_string();
        let unicode_url = Url::from_file_path(&unicode_doc).unwrap().to_string();

        assert!(spaced_url.contains("%20"));

        let args = vec![
            "regular.md".to_string(),
            regular_url,
            spaced_url,
            unicode_url,
            unicode_doc.to_string_lossy().to_string(),
            "https://example.com/remote.md".to_string(),
            "http://localhost:8080/notes.txt".to_string(),
            "custom-app://open/notes.md".to_string(),
            "mailto:user@example.com".to_string(),
            "file:///C:/non_existent_folder/missing.md".to_string(),
            "file:///C:/image.png".to_string(),
        ];

        let filtered = filter_and_normalize_paths(args, base_cwd);

        assert_eq!(
            filtered.len(),
            3,
            "Should contain exactly 3 normalized files (regular, spaced, unicode)"
        );

        let regular_canon = canonicalize_path(&regular_doc)
            .to_string_lossy()
            .to_string();
        let spaced_canon = canonicalize_path(&spaced_doc).to_string_lossy().to_string();
        let unicode_canon = canonicalize_path(&unicode_doc)
            .to_string_lossy()
            .to_string();

        assert_eq!(filtered[0], regular_canon);
        assert_eq!(filtered[1], spaced_canon);
        assert_eq!(filtered[2], unicode_canon);
    }

    #[test]
    fn test_pending_open_files_queue_and_drain() {
        let mut queue = Vec::new();
        enqueue_pending_paths(
            &mut queue,
            vec![
                "C:\\path\\doc1.md".to_string(),
                "C:\\path\\doc2.txt".to_string(),
            ],
        );

        let pending = PendingOpenFiles(Mutex::new(queue));

        {
            let mut q = pending.0.lock().unwrap();
            enqueue_pending_paths(
                &mut q,
                vec![
                    "c:\\path\\DOC1.MD".to_string(),
                    "C:\\path\\doc3.markdown".to_string(),
                    "".to_string(),
                    "   ".to_string(),
                ],
            );
        }

        let mut q = pending.0.lock().unwrap();
        let drained: Vec<String> = q.drain(..).collect();

        #[cfg(windows)]
        {
            assert_eq!(drained.len(), 3);
            assert_eq!(drained[0], "C:\\path\\doc1.md");
            assert_eq!(drained[1], "C:\\path\\doc2.txt");
            assert_eq!(drained[2], "C:\\path\\doc3.markdown");
        }
        #[cfg(not(windows))]
        {
            assert_eq!(drained.len(), 4);
            assert_eq!(drained[0], "C:\\path\\doc1.md");
            assert_eq!(drained[1], "C:\\path\\doc2.txt");
            assert_eq!(drained[2], "c:\\path\\DOC1.MD");
            assert_eq!(drained[3], "C:\\path\\doc3.markdown");
        }

        let drained_again: Vec<String> = q.drain(..).collect();
        assert!(drained_again.is_empty());
    }

    #[test]
    fn test_enqueue_pending_paths_deduplication() {
        let mut queue = Vec::new();

        enqueue_pending_paths(
            &mut queue,
            vec![
                "C:\\Notes\\Report.md".to_string(),
                "C:\\Notes\\Data.txt".to_string(),
            ],
        );
        assert_eq!(queue.len(), 2);

        enqueue_pending_paths(
            &mut queue,
            vec![
                "c:\\notes\\report.md".to_string(),
                "C:\\NOTES\\DATA.TXT".to_string(),
                "C:\\Notes\\NewDoc.markdown".to_string(),
            ],
        );

        #[cfg(windows)]
        {
            assert_eq!(queue.len(), 3);
            assert_eq!(queue[0], "C:\\Notes\\Report.md");
            assert_eq!(queue[1], "C:\\Notes\\Data.txt");
            assert_eq!(queue[2], "C:\\Notes\\NewDoc.markdown");
        }

        #[cfg(not(windows))]
        {
            assert_eq!(queue.len(), 5);
        }
    }

    #[test]
    fn test_strip_text_extensions() {
        assert_eq!(strip_text_extensions("document.md"), "document");
        assert_eq!(strip_text_extensions("document.markdown"), "document");
        assert_eq!(strip_text_extensions("document.mdown"), "document");
        assert_eq!(strip_text_extensions("document.mkd"), "document");
        assert_eq!(strip_text_extensions("document.MKD"), "document");
        assert_eq!(strip_text_extensions("document.txt"), "document");
        assert_eq!(strip_text_extensions("document.docx"), "document");
        assert_eq!(strip_text_extensions("document.pdf"), "document");
        assert_eq!(strip_text_extensions("document.html"), "document");
        assert_eq!(strip_text_extensions("document.htm"), "document");
        assert_eq!(strip_text_extensions("diagram.svg"), "diagram");
        assert_eq!(strip_text_extensions("diagram.PNG"), "diagram");
        assert_eq!(strip_text_extensions("archive.tar.gz"), "archive.tar.gz");
        assert_eq!(strip_text_extensions("notes.v1.MD"), "notes.v1");
        assert_eq!(strip_text_extensions("page.v2.HTML"), "page.v2");
    }

    #[test]
    fn test_canonicalize_path_prefix_stripping() {
        let dummy = PathBuf::from(r"\\?\C:\Users\test.md");
        let res = canonicalize_path(&dummy);
        assert!(!res.to_string_lossy().is_empty());
    }

    #[test]
    fn test_supported_file_extensions_list() {
        assert_eq!(
            SUPPORTED_FILE_EXTENSIONS,
            &["md", "markdown", "mdown", "mkd", "txt"]
        );
    }

    #[test]
    fn test_pending_open_files_poison_recovery() {
        let pending = PendingOpenFiles(Mutex::new(vec!["C:\\file1.md".to_string()]));
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = pending.0.lock().unwrap();
            panic!("intentional poison for testing");
        }));

        assert!(pending.0.is_poisoned());

        let mut queue = pending.0.lock().unwrap_or_else(|e| e.into_inner());
        enqueue_pending_paths(&mut queue, vec!["C:\\file2.md".to_string()]);
        let drained: Vec<String> = queue.drain(..).collect();
        assert_eq!(drained.len(), 2);
        assert_eq!(drained[0], "C:\\file1.md");
        assert_eq!(drained[1], "C:\\file2.md");
    }
}
