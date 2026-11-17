//! Safe, read-mostly filesystem support for the folder workspace panel.
//!
//! The renderer never chooses a path on its own: the only way to obtain a root
//! is [`choose_workspace_folder`] (native folder picker). Every other command
//! canonicalizes the requested root and rejects anything that is not an
//! existing local directory. Children are always addressed *relative to that
//! canonical root*, are canonicalized again before mutation, and must resolve
//! to a path inside the root, so `..`, absolute paths and symlinked
//! directories cannot escape the selected folder.
//!
//! The listing walk is deliberately bounded and non-recursive in spirit:
//! directory entries only (plus supported document extensions), at most
//! [`MAX_WORKSPACE_DEPTH`] levels and [`MAX_WORKSPACE_ENTRIES`] entries.
//! It never reads file bodies and never follows symlinks (neither directory
//! nor file links), which also keeps reparse points out of the tree.

use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use crate::path_utils::canonicalize_path;

/// Hard cap on the number of entries returned for one workspace listing.
pub const MAX_WORKSPACE_ENTRIES: usize = 5_000;

/// Hard cap on directory nesting depth (root children are depth 1).
pub const MAX_WORKSPACE_DEPTH: usize = 12;

/// Document extensions the workspace tree surfaces, mirrored by the frontend.
pub const WORKSPACE_DOCUMENT_EXTENSIONS: &[&str] =
    &["md", "markdown", "mdown", "mkd", "txt", "xmd"];

/// Extensions accepted when *creating* a blank document.
///
/// `.xmd` is intentionally absent: an empty file is not a valid XMD bundle, so
/// bundle creation must keep going through the dedicated export path.
pub const WORKSPACE_CREATABLE_DOCUMENT_EXTENSIONS: &[&str] = &["md", "markdown", "txt"];

/// Fallback file name used when the user submits an empty document name.
pub const DEFAULT_WORKSPACE_DOCUMENT_NAME: &str = "default.md";

/// Conventional build/VCS directories that are never worth walking.
pub const SKIPPED_WORKSPACE_DIRECTORIES: &[&str] = &[".git", "node_modules", "target", "dist"];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    /// Root-relative path, always using forward slashes (stable in the UI).
    pub path: String,
    pub name: String,
    /// `"directory"` or `"document"`.
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceListing {
    /// Canonical root path with the Windows `\\?\` prefix removed.
    pub root: String,
    pub entries: Vec<WorkspaceEntry>,
    /// True when the walk stopped because a limit was reached.
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRenameResult {
    pub old_path: String,
    pub new_path: String,
}

/// Bounded-walk knobs. Tests use tightened limits; production uses the defaults.
#[derive(Debug, Clone)]
pub struct WorkspaceLimits {
    pub max_entries: usize,
    pub max_depth: usize,
    /// Skip dot-prefixed directories (`.git`, `.obsidian`, `.history`, ...).
    pub skip_hidden_directories: bool,
}

impl Default for WorkspaceLimits {
    fn default() -> Self {
        Self {
            max_entries: MAX_WORKSPACE_ENTRIES,
            max_depth: MAX_WORKSPACE_DEPTH,
            skip_hidden_directories: true,
        }
    }
}

struct WorkspaceRoot {
    canonical: PathBuf,
    display: String,
}

fn is_unc_path(raw: &str) -> bool {
    raw.starts_with(r"\\") || raw.starts_with("//")
}

fn display_path(path: &Path) -> String {
    canonicalize_path(path).to_string_lossy().to_string()
}

fn is_inside(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

fn is_strictly_inside(path: &Path, root: &Path) -> bool {
    path != root && path.starts_with(root)
}

/// Validates a user-selected workspace root and returns its canonical form.
fn resolve_workspace_root(root: &str) -> Result<WorkspaceRoot, String> {
    let trimmed = root.trim();
    if trimmed.is_empty() {
        return Err("工作区路径为空 / Workspace path is empty".to_string());
    }
    if is_unc_path(trimmed) {
        return Err(
            "不支持网络共享作为工作区 / Network shares are not supported as a workspace"
                .to_string(),
        );
    }
    let raw = Path::new(trimmed);
    if !raw.is_absolute() {
        return Err("工作区路径必须是绝对路径 / Workspace path must be absolute".to_string());
    }

    let canonical = fs::canonicalize(raw).map_err(|error| {
        format!(
            "工作区文件夹不存在或不可访问 / Workspace folder is not accessible ({}): {}",
            trimmed, error
        )
    })?;
    let metadata = fs::metadata(&canonical).map_err(|error| {
        format!(
            "无法读取工作区文件夹 / Cannot read workspace folder ({}): {}",
            trimmed, error
        )
    })?;
    if !metadata.is_dir() {
        return Err("工作区路径必须是文件夹 / Workspace path must be a directory".to_string());
    }

    Ok(WorkspaceRoot {
        display: display_path(&canonical),
        canonical,
    })
}

fn has_supported_extension(path: &Path, extensions: &[&str]) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lower = ext.to_ascii_lowercase();
            extensions.iter().any(|supported| *supported == lower)
        })
        .unwrap_or(false)
}

fn is_document_file(path: &Path) -> bool {
    has_supported_extension(path, WORKSPACE_DOCUMENT_EXTENSIONS)
}

/// Rejects anything that is not a single, portable file/folder name.
fn validate_entry_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("名称不能为空 / Name cannot be empty".to_string());
    }
    if name != trimmed {
        return Err("名称不能以空格开头或结尾 / Name cannot start or end with a space".to_string());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("名称不能是 . 或 .. / Name cannot be '.' or '..'".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("名称不能包含路径分隔符 / Name cannot contain path separators".to_string());
    }
    if trimmed.chars().any(|ch| ch.is_control()) {
        return Err("名称不能包含控制字符 / Name cannot contain control characters".to_string());
    }
    // Characters that are illegal on Windows (also covers drive/ADS colons).
    if trimmed
        .chars()
        .any(|ch| matches!(ch, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
    {
        return Err(
            "名称包含 Windows 不允许的字符 / Name contains characters that are invalid on Windows"
                .to_string(),
        );
    }
    if trimmed.ends_with('.') || trimmed.ends_with(' ') {
        return Err("名称不能以点或空格结尾 / Name cannot end with a dot or space".to_string());
    }
    if trimmed.chars().count() > 255 {
        return Err("名称过长 / Name is too long".to_string());
    }
    if is_windows_reserved_name(trimmed) {
        return Err(
            "名称是 Windows 保留设备名 / Name is a reserved Windows device name".to_string(),
        );
    }
    Ok(trimmed.to_string())
}

fn is_windows_reserved_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit())
}

/// Normalizes a document name, appending `.md` when no extension was typed.
fn normalize_document_name(name: &str) -> Result<String, String> {
    let mut normalized = validate_entry_name(name)?;
    match Path::new(&normalized)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
    {
        Some(ext)
            if WORKSPACE_CREATABLE_DOCUMENT_EXTENSIONS
                .iter()
                .any(|supported| *supported == ext) =>
        {
            Ok(normalized)
        }
        Some(_) => Err(
            "仅支持创建 .md、.markdown、.txt 文档 / Only .md, .markdown and .txt documents can be created"
                .to_string(),
        ),
        None => {
            normalized.push_str(".md");
            Ok(normalized)
        }
    }
}

/// Resolves a root-relative parent path to an existing directory inside root.
fn resolve_workspace_dir(root: &WorkspaceRoot, parent: &str) -> Result<PathBuf, String> {
    let rel = parent.trim();
    let candidate = if rel.is_empty() {
        root.canonical.clone()
    } else {
        root.canonical.join(rel)
    };

    let canonical = fs::canonicalize(&candidate).map_err(|error| {
        format!(
            "目标文件夹不存在 / Target folder does not exist ({}): {}",
            rel, error
        )
    })?;
    if !is_inside(&canonical, &root.canonical) {
        return Err("路径超出工作区范围 / Path is outside the workspace".to_string());
    }
    let metadata = fs::metadata(&canonical)
        .map_err(|error| format!("无法读取目标文件夹 / Cannot read target folder: {}", error))?;
    if !metadata.is_dir() {
        return Err("目标路径不是文件夹 / Target path is not a directory".to_string());
    }
    Ok(canonical)
}

struct ScanChild {
    name: String,
    path: PathBuf,
    is_directory: bool,
}

fn read_sorted_children(dir: &Path) -> Vec<ScanChild> {
    let read_dir = match fs::read_dir(dir) {
        Ok(read_dir) => read_dir,
        // Unreadable directories are simply hidden from the tree.
        Err(_) => return Vec::new(),
    };

    let mut children = Vec::new();
    for entry in read_dir.flatten() {
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        // Symlinks (to files or directories) are never followed nor listed.
        if file_type.is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.is_empty() {
            continue;
        }
        children.push(ScanChild {
            name,
            path: entry.path(),
            is_directory: file_type.is_dir(),
        });
    }

    // Deterministic UI order: directories first, then case-insensitive name.
    children.sort_by(|left, right| {
        right
            .is_directory
            .cmp(&left.is_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
    children
}

fn should_skip_directory(name: &str, limits: &WorkspaceLimits) -> bool {
    if SKIPPED_WORKSPACE_DIRECTORIES
        .iter()
        .any(|skipped| skipped.eq_ignore_ascii_case(name))
    {
        return true;
    }
    limits.skip_hidden_directories && name.starts_with('.')
}

fn push_entry(
    entry: WorkspaceEntry,
    limits: &WorkspaceLimits,
    entries: &mut Vec<WorkspaceEntry>,
    truncated: &mut bool,
) -> bool {
    if entries.len() >= limits.max_entries {
        *truncated = true;
        return false;
    }
    entries.push(entry);
    true
}

fn walk_directory(
    dir: &Path,
    rel_prefix: &str,
    depth: usize,
    limits: &WorkspaceLimits,
    entries: &mut Vec<WorkspaceEntry>,
    truncated: &mut bool,
) {
    if *truncated || depth > limits.max_depth {
        return;
    }

    for child in read_sorted_children(dir) {
        if *truncated {
            return;
        }

        let rel_path = if rel_prefix.is_empty() {
            child.name.clone()
        } else {
            format!("{}/{}", rel_prefix, child.name)
        };

        if child.is_directory {
            if should_skip_directory(&child.name, limits) {
                continue;
            }
            let accepted = push_entry(
                WorkspaceEntry {
                    path: rel_path.clone(),
                    name: child.name.clone(),
                    kind: "directory".to_string(),
                },
                limits,
                entries,
                truncated,
            );
            if !accepted {
                return;
            }
            if depth < limits.max_depth {
                walk_directory(
                    &child.path,
                    &rel_path,
                    depth + 1,
                    limits,
                    entries,
                    truncated,
                );
            }
        } else if is_document_file(&child.path) {
            let accepted = push_entry(
                WorkspaceEntry {
                    path: rel_path,
                    name: child.name,
                    kind: "document".to_string(),
                },
                limits,
                entries,
                truncated,
            );
            if !accepted {
                return;
            }
        }
    }
}

/// Lists a workspace, using the production limits.
pub fn list_workspace_with_limits(
    root: &str,
    limits: &WorkspaceLimits,
) -> Result<WorkspaceListing, String> {
    let resolved = resolve_workspace_root(root)?;
    let mut entries = Vec::new();
    let mut truncated = false;

    walk_directory(
        &resolved.canonical,
        "",
        1,
        limits,
        &mut entries,
        &mut truncated,
    );

    Ok(WorkspaceListing {
        root: resolved.display,
        entries,
        truncated,
    })
}

/// Opens the native folder picker and returns the canonical selected folder.
#[tauri::command]
pub fn choose_workspace_folder() -> Result<Option<String>, String> {
    let picked = rfd::FileDialog::new()
        .set_title("选择工作区文件夹 / Choose Workspace Folder")
        .pick_folder();

    match picked {
        Some(folder) => {
            let root = resolve_workspace_root(&folder.to_string_lossy())?;
            Ok(Some(root.display))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn list_workspace(root: String) -> Result<WorkspaceListing, String> {
    list_workspace_with_limits(&root, &WorkspaceLimits::default())
}

#[tauri::command]
pub fn create_workspace_document(
    root: String,
    parent: String,
    name: String,
) -> Result<String, String> {
    let root = resolve_workspace_root(&root)?;
    let directory = resolve_workspace_dir(&root, &parent)?;
    // Whitespace-only input means "just create the default document".
    let requested_name = if name.trim().is_empty() {
        DEFAULT_WORKSPACE_DOCUMENT_NAME.to_string()
    } else {
        name
    };
    let file_name = normalize_document_name(&requested_name)?;
    let target = directory.join(&file_name);

    // `create_new` is the no-overwrite guarantee at the filesystem level: it
    // fails atomically when the name is already taken, instead of truncating.
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
    {
        Ok(file) => {
            drop(file);
            Ok(display_path(&target))
        }
        Err(error) if error.kind() == ErrorKind::AlreadyExists => Err(format!(
            "已存在同名文件或文件夹 / An entry with this name already exists: {}",
            file_name
        )),
        Err(error) => Err(format!(
            "创建文档失败 / Could not create document ({}): {}",
            file_name, error
        )),
    }
}

#[tauri::command]
pub fn create_workspace_folder(
    root: String,
    parent: String,
    name: String,
) -> Result<String, String> {
    let root = resolve_workspace_root(&root)?;
    let directory = resolve_workspace_dir(&root, &parent)?;
    let folder_name = validate_entry_name(&name)?;
    let target = directory.join(&folder_name);

    // `create_dir` (not `create_dir_all`) fails when the target exists, so a
    // folder is never merged into or overwritten by an existing one.
    match fs::create_dir(&target) {
        Ok(()) => Ok(display_path(&target)),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => Err(format!(
            "已存在同名文件或文件夹 / An entry with this name already exists: {}",
            folder_name
        )),
        Err(error) => Err(format!(
            "创建文件夹失败 / Could not create folder ({}): {}",
            folder_name, error
        )),
    }
}

#[tauri::command]
pub fn rename_workspace_path(
    root: String,
    path: String,
    new_parent: Option<String>,
    new_name: String,
) -> Result<WorkspaceRenameResult, String> {
    let root = resolve_workspace_root(&root)?;
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("要重命名的路径为空 / Path to rename is empty".to_string());
    }

    let source = fs::canonicalize(trimmed_path).map_err(|error| {
        format!(
            "要重命名的文件或文件夹不存在 / Source path does not exist ({}): {}",
            trimmed_path, error
        )
    })?;
    if source == root.canonical {
        return Err("不能重命名工作区根目录 / The workspace root cannot be renamed".to_string());
    }
    if !is_strictly_inside(&source, &root.canonical) {
        return Err("路径超出工作区范围 / Path is outside the workspace".to_string());
    }

    let new_name = validate_entry_name(&new_name)?;
    let parent_dir = match new_parent.as_deref().map(str::trim) {
        Some(parent) if !parent.is_empty() => resolve_workspace_dir(&root, parent)?,
        _ => source
            .parent()
            .ok_or_else(|| {
                "无法确定源文件的父文件夹 / Cannot resolve the source parent".to_string()
            })?
            .to_path_buf(),
    };
    if !is_inside(&parent_dir, &root.canonical) {
        return Err("路径超出工作区范围 / Path is outside the workspace".to_string());
    }

    let target = parent_dir.join(&new_name);
    let old_display = display_path(&source);
    if target == source {
        // Nothing to move: report the canonical paths without touching disk.
        return Ok(WorkspaceRenameResult {
            old_path: old_display.clone(),
            new_path: old_display,
        });
    }

    if source.is_dir() && target.starts_with(&source) {
        return Err(
            "不能把文件夹移动到它自身的子目录中 / A folder cannot be moved into its own subfolder"
                .to_string(),
        );
    }

    // No overwrite: a pre-existing target is rejected. The only tolerated hit
    // is the source itself (case-only rename on case-insensitive filesystems).
    if fs::symlink_metadata(&target).is_ok() {
        let is_same_file = fs::canonicalize(&target)
            .map(|existing| existing == source)
            .unwrap_or(false);
        if !is_same_file {
            return Err(format!(
                "目标已存在，不会覆盖 / Target already exists and will not be overwritten: {}",
                new_name
            ));
        }
    }

    // A single `rename` call on the same volume keeps the move atomic and
    // never copies a body; failure leaves the source untouched.
    fs::rename(&source, &target).map_err(|error| {
        format!(
            "重命名失败 / Rename failed ({} -> {}): {}",
            new_name,
            parent_dir.to_string_lossy(),
            error
        )
    })?;

    Ok(WorkspaceRenameResult {
        old_path: old_display,
        new_path: display_path(&target),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_workspace() -> tempfile::TempDir {
        tempfile::Builder::new()
            .prefix("md_editor_workspace_test_")
            .tempdir()
            .unwrap()
    }

    fn write_file(root: &Path, rel: &str, content: &str) {
        let path = root.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn make_dir(root: &Path, rel: &str) {
        fs::create_dir_all(root.join(rel)).unwrap();
    }

    fn entry_paths(listing: &WorkspaceListing) -> Vec<&str> {
        listing
            .entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect()
    }

    fn find_entry<'a>(listing: &'a WorkspaceListing, path: &str) -> &'a WorkspaceEntry {
        listing
            .entries
            .iter()
            .find(|entry| entry.path == path)
            .unwrap_or_else(|| panic!("missing workspace entry: {path}"))
    }

    #[test]
    fn test_list_workspace_collects_directories_and_supported_documents_only() {
        let temp = temp_workspace();
        let root = temp.path();
        write_file(root, "notes.md", "# Notes");
        write_file(root, "readme.markdown", "# Readme");
        write_file(root, "plain.txt", "text");
        write_file(root, "sub/nested.mdown", "nested");
        write_file(root, "sub/deeper/page.mkd", "page");
        write_file(root, "sub/image.png", "not a document");
        write_file(root, "sub/archive.zip", "not a document");
        make_dir(root, "empty-folder");

        let listing =
            list_workspace_with_limits(root.to_str().unwrap(), &WorkspaceLimits::default())
                .unwrap();

        assert!(!listing.truncated);
        assert_eq!(
            entry_paths(&listing),
            vec![
                "empty-folder",
                "sub",
                "sub/deeper",
                "sub/deeper/page.mkd",
                "sub/nested.mdown",
                "notes.md",
                "plain.txt",
                "readme.markdown",
            ]
        );
        assert_eq!(find_entry(&listing, "sub").kind, "directory");
        assert_eq!(find_entry(&listing, "notes.md").kind, "document");
        assert_eq!(find_entry(&listing, "notes.md").name, "notes.md");
        assert_eq!(listing.root, display_path(&fs::canonicalize(root).unwrap()));
    }

    #[test]
    fn test_list_workspace_skips_vcs_build_and_hidden_directories() {
        let temp = temp_workspace();
        let root = temp.path();
        write_file(root, "visible.md", "# visible");
        write_file(root, ".git/config.md", "# git");
        write_file(root, ".hidden/secret.md", "# hidden");
        write_file(root, "node_modules/pkg/readme.md", "# pkg");
        write_file(root, "target/generated.md", "# generated");
        write_file(root, "dist/bundle.md", "# bundle");
        write_file(root, "SOURCE/build.md", "# build");

        let listing =
            list_workspace_with_limits(root.to_str().unwrap(), &WorkspaceLimits::default())
                .unwrap();

        assert_eq!(
            entry_paths(&listing),
            vec!["SOURCE", "SOURCE/build.md", "visible.md"]
        );
        for skipped in [".git", ".hidden", "node_modules", "target", "dist"] {
            assert!(
                listing
                    .entries
                    .iter()
                    .all(|entry| !entry.path.starts_with(skipped)),
                "workspace listing must not expose {skipped}"
            );
        }
    }

    #[test]
    fn test_list_workspace_rejects_missing_root_and_file_root() {
        let temp = temp_workspace();
        let missing = temp.path().join("does-not-exist");
        let error =
            list_workspace_with_limits(missing.to_str().unwrap(), &WorkspaceLimits::default())
                .unwrap_err();
        assert!(error.contains("不可访问") || error.contains("not accessible"));

        let file = temp.path().join("notes.md");
        fs::write(&file, "# file").unwrap();
        let error = list_workspace_with_limits(file.to_str().unwrap(), &WorkspaceLimits::default())
            .unwrap_err();
        assert!(error.contains("文件夹") || error.contains("directory"));

        let relative_error =
            list_workspace_with_limits("relative/folder", &WorkspaceLimits::default()).unwrap_err();
        assert!(relative_error.contains("绝对路径") || relative_error.contains("absolute"));
    }

    #[test]
    fn test_list_workspace_respects_depth_limit() {
        let temp = temp_workspace();
        let root = temp.path();
        write_file(root, "level1/level2/level3/level4/deep.md", "# deep");
        write_file(root, "level1/shallow.md", "# shallow");

        let limits = WorkspaceLimits {
            max_depth: 2,
            ..WorkspaceLimits::default()
        };
        let listing = list_workspace_with_limits(root.to_str().unwrap(), &limits).unwrap();

        assert_eq!(
            entry_paths(&listing),
            vec!["level1", "level1/level2", "level1/shallow.md"]
        );
        assert!(!listing.truncated);
    }

    #[test]
    fn test_list_workspace_truncates_at_custom_entry_limit() {
        let temp = temp_workspace();
        let root = temp.path();
        for index in 0..6 {
            write_file(root, &format!("doc-{index}.md"), "# doc");
        }

        let limits = WorkspaceLimits {
            max_entries: 3,
            ..WorkspaceLimits::default()
        };
        let listing = list_workspace_with_limits(root.to_str().unwrap(), &limits).unwrap();

        assert!(listing.truncated);
        assert_eq!(listing.entries.len(), 3);
        assert_eq!(
            entry_paths(&listing),
            vec!["doc-0.md", "doc-1.md", "doc-2.md"]
        );

        // Exactly at the limit is not truncation.
        let exact = WorkspaceLimits {
            max_entries: 6,
            ..WorkspaceLimits::default()
        };
        let listing = list_workspace_with_limits(root.to_str().unwrap(), &exact).unwrap();
        assert!(!listing.truncated);
        assert_eq!(listing.entries.len(), 6);
    }

    #[test]
    fn test_create_workspace_document_defaults_extension_and_never_overwrites() {
        let temp = temp_workspace();
        let root = temp.path();
        make_dir(root, "notes");

        let created = create_workspace_document(
            root.to_str().unwrap().to_string(),
            String::new(),
            "about".to_string(),
        )
        .unwrap();
        assert_eq!(created, display_path(&root.join("about.md")));
        assert_eq!(fs::read_to_string(root.join("about.md")).unwrap(), "");

        let first = create_workspace_document(
            root.to_str().unwrap().to_string(),
            "notes".to_string(),
            "todo.markdown".to_string(),
        )
        .unwrap();
        assert_eq!(first, display_path(&root.join("notes/todo.markdown")));
        assert!(root.join("notes/todo.markdown").is_file());

        let collision = create_workspace_document(
            root.to_str().unwrap().to_string(),
            "notes".to_string(),
            "todo.markdown".to_string(),
        )
        .unwrap_err();
        assert!(collision.contains("已存在") || collision.contains("already exists"));
        // The pre-existing file is untouched by the failed creation.
        assert_eq!(
            fs::read_to_string(root.join("notes/todo.markdown")).unwrap(),
            ""
        );

        let empty_name = create_workspace_document(
            root.to_str().unwrap().to_string(),
            String::new(),
            "   ".to_string(),
        )
        .unwrap();
        assert_eq!(
            empty_name,
            display_path(&root.join(DEFAULT_WORKSPACE_DOCUMENT_NAME))
        );

        let unsupported = create_workspace_document(
            root.to_str().unwrap().to_string(),
            String::new(),
            "payload.exe".to_string(),
        )
        .unwrap_err();
        assert!(unsupported.contains(".md") || unsupported.contains("Only"));

        let escape = create_workspace_document(
            root.to_str().unwrap().to_string(),
            "../outside".to_string(),
            "escape.md".to_string(),
        )
        .unwrap_err();
        assert!(!escape.is_empty());
        assert!(!root.join("../outside/escape.md").exists());
    }

    #[test]
    fn test_create_workspace_folder_validates_name_and_never_overwrites() {
        let temp = temp_workspace();
        let root = temp.path();
        write_file(root, "existing.md", "# existing");

        let created = create_workspace_folder(
            root.to_str().unwrap().to_string(),
            String::new(),
            "drafts".to_string(),
        )
        .unwrap();
        assert_eq!(created, display_path(&root.join("drafts")));
        assert!(root.join("drafts").is_dir());

        let collision = create_workspace_folder(
            root.to_str().unwrap().to_string(),
            String::new(),
            "drafts".to_string(),
        )
        .unwrap_err();
        assert!(collision.contains("已存在") || collision.contains("already exists"));

        for invalid in ["", "..", "a/b", "CON", "ends.", "ends ", "bad:name"] {
            let error = create_workspace_folder(
                root.to_str().unwrap().to_string(),
                String::new(),
                invalid.to_string(),
            )
            .unwrap_err();
            assert!(!error.is_empty(), "expected rejection for {invalid:?}");
        }
    }

    #[test]
    fn test_rename_same_folder_keeps_content_and_reports_both_paths() {
        let temp = temp_workspace();
        let root = temp.path();
        write_file(root, "notes/draft.md", "# draft content");

        // Resolve the expected strings while both names still exist, so the
        // canonical form does not depend on post-rename path lookups.
        let old_display = display_path(&root.join("notes").join("draft.md"));
        let new_display = display_path(&root.join("notes").join("final.md"));

        let result = rename_workspace_path(
            root.to_str().unwrap().to_string(),
            root.join("notes/draft.md").to_str().unwrap().to_string(),
            None,
            "final.md".to_string(),
        )
        .unwrap();

        assert_eq!(result.old_path, old_display);
        assert_eq!(result.new_path, new_display);
        assert!(!root.join("notes/draft.md").exists());
        assert_eq!(
            fs::read_to_string(root.join("notes/final.md")).unwrap(),
            "# draft content"
        );

        // Same parent + same name is a no-op, not a failed move.
        let noop = rename_workspace_path(
            root.to_str().unwrap().to_string(),
            root.join("notes/final.md").to_str().unwrap().to_string(),
            None,
            "final.md".to_string(),
        )
        .unwrap();
        assert_eq!(noop.old_path, noop.new_path);
        assert!(root.join("notes/final.md").is_file());
    }

    #[test]
    fn test_rename_moves_directory_within_root() {
        let temp = temp_workspace();
        let root = temp.path();
        write_file(root, "archive/old/inside.md", "# inside");
        make_dir(root, "inbox");

        let result = rename_workspace_path(
            root.to_str().unwrap().to_string(),
            root.join("archive/old").to_str().unwrap().to_string(),
            Some("inbox".to_string()),
            "moved".to_string(),
        )
        .unwrap();

        assert_eq!(result.new_path, display_path(&root.join("inbox/moved")));
        assert!(root.join("inbox/moved/inside.md").is_file());
        assert!(!root.join("archive/old").exists());
    }

    #[test]
    fn test_rename_rejects_overwrite_cycles_root_and_outside_paths() {
        let temp = temp_workspace();
        let root = temp.path();
        write_file(root, "a.md", "a");
        write_file(root, "b.md", "b");
        make_dir(root, "folder/child");
        let root_string = root.to_str().unwrap().to_string();

        // Existing target is never overwritten.
        let overwrite = rename_workspace_path(
            root_string.clone(),
            root.join("a.md").to_str().unwrap().to_string(),
            None,
            "b.md".to_string(),
        )
        .unwrap_err();
        assert!(overwrite.contains("不会覆盖") || overwrite.contains("overwritten"));
        assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "a");
        assert_eq!(fs::read_to_string(root.join("b.md")).unwrap(), "b");

        // A directory cannot be moved into its own descendant.
        let cycle = rename_workspace_path(
            root_string.clone(),
            root.join("folder").to_str().unwrap().to_string(),
            Some("folder/child".to_string()),
            "looped".to_string(),
        )
        .unwrap_err();
        assert!(cycle.contains("子目录") || cycle.contains("subfolder"));
        assert!(root.join("folder/child").is_dir());

        // The root itself cannot be renamed.
        let root_rename = rename_workspace_path(
            root_string.clone(),
            root_string.clone(),
            None,
            "renamed-root".to_string(),
        )
        .unwrap_err();
        assert!(root_rename.contains("根目录") || root_rename.contains("root"));

        // A sibling outside the workspace is not a valid source or parent.
        let outside = temp_workspace();
        fs::write(outside.path().join("outside.md"), "outside").unwrap();
        let outside_error = rename_workspace_path(
            root_string.clone(),
            outside
                .path()
                .join("outside.md")
                .to_str()
                .unwrap()
                .to_string(),
            None,
            "stolen.md".to_string(),
        )
        .unwrap_err();
        assert!(outside_error.contains("超出工作区") || outside_error.contains("outside"));
        assert!(outside.path().join("outside.md").is_file());

        // Name validation still applies.
        let invalid = rename_workspace_path(
            root_string,
            root.join("a.md").to_str().unwrap().to_string(),
            None,
            "../escape.md".to_string(),
        )
        .unwrap_err();
        assert!(invalid.contains("分隔符") || invalid.contains("separator"));
    }

    #[cfg(unix)]
    #[test]
    fn test_list_workspace_does_not_follow_symlinked_directories() {
        use std::os::unix::fs::symlink;

        let temp = temp_workspace();
        let root = temp.path();
        let outside = temp_workspace();
        write_file(outside.path(), "outside.md", "# outside");
        write_file(root, "inside.md", "# inside");
        symlink(outside.path(), root.join("linked")).unwrap();

        let listing =
            list_workspace_with_limits(root.to_str().unwrap(), &WorkspaceLimits::default())
                .unwrap();

        assert_eq!(entry_paths(&listing), vec!["inside.md"]);
        assert!(!listing.entries.iter().any(|entry| entry.path == "linked"));
    }
}
