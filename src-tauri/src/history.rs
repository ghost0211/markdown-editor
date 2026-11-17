//! Plain-text local version history for documents.
//!
//! Layout (under the Tauri app-data directory):
//!
//! ```text
//! history/v1/<sha256(normalized document path)>/index.json
//! history/v1/<sha256(normalized document path)>/<snapshot id>.json
//! ```
//!
//! A snapshot is a complete, self-contained JSON document containing the saved
//! UTF-8 text, so a history entry never depends on the live file. Everything is
//! stored as plain text on the user's local disk; nothing is encrypted, sent
//! over the network, or committed to Git.
//!
//! The store is deliberately defensive about on-disk state:
//! - snapshot and index writes go through a temporary file in the same folder,
//!   are flushed + `fsync`ed, then atomically renamed (directory `fsync` is a
//!   best-effort extra);
//! - a corrupt or missing `index.json` is rebuilt from the snapshot files that
//!   carry a safe snapshot id inside this document's own hashed folder;
//! - malformed snapshot files are never deleted or overwritten just because
//!   they cannot be parsed;
//! - other documents' folders are only consulted for global caps when their
//!   own index is valid, so foreign data is never scanned/deleted as a guess.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Folder name below the app-data directory. The version lets a future format
/// evolve without touching existing data.
pub const HISTORY_DIR_NAME: &str = "history";
pub const HISTORY_FORMAT_VERSION: &str = "v1";
pub const INDEX_FILE_NAME: &str = "index.json";
pub const INDEX_SCHEMA_VERSION: u32 = 1;

/// Hard upper bound for one snapshot file (the JSON file itself).
pub const MAX_SNAPSHOT_BYTES: u64 = 64 * 1024 * 1024;
pub const DEFAULT_MAX_SNAPSHOTS_PER_DOCUMENT: usize = 50;
pub const DEFAULT_MAX_TOTAL_BYTES: u64 = 64 * 1024 * 1024;
/// Global snapshot count cap ("others" are pruned oldest-first as well).
pub const DEFAULT_MAX_TOTAL_SNAPSHOTS: usize = 2000;

const TEMP_FILE_PREFIX: &str = ".history-tmp-";
const MAX_SNAPSHOT_ID_LEN: usize = 128;

/// Serializes history mutations in this process. Readers use atomic files and
/// do not need the lock; writers prune several documents at once.
static HISTORY_WRITE_LOCK: Mutex<()> = Mutex::new(());

/// One captured version. `camelCase` JSON is what the frontend consumes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    /// Milliseconds since the Unix epoch.
    pub created_at: u64,
    /// The path exactly as the save target reported it (not normalized).
    pub original_path: String,
    pub title: String,
    pub content: String,
    /// UTF-8 byte length of `content`.
    pub bytes: u64,
    /// Lowercase hex SHA-256 of the UTF-8 bytes of `content`.
    pub sha256: String,
}

impl Snapshot {
    fn list_item(&self) -> HistoryListItem {
        HistoryListItem {
            id: self.id.clone(),
            created_at: self.created_at,
            original_path: self.original_path.clone(),
            title: self.title.clone(),
            bytes: self.bytes,
            sha256: self.sha256.clone(),
        }
    }
}

/// History list metadata. It intentionally never carries the document body.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryListItem {
    pub id: String,
    pub created_at: u64,
    pub original_path: String,
    pub title: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone)]
pub struct HistoryLimits {
    /// Newest N snapshots kept for one document.
    pub max_snapshots_per_document: usize,
    /// Sum of `bytes` across every indexed snapshot in the store.
    pub max_total_bytes: u64,
    /// Sum of every indexed snapshot in the store.
    pub max_total_snapshots: usize,
    /// Maximum accepted/read snapshot file size.
    pub max_snapshot_bytes: u64,
}

impl Default for HistoryLimits {
    fn default() -> Self {
        Self {
            max_snapshots_per_document: DEFAULT_MAX_SNAPSHOTS_PER_DOCUMENT,
            max_total_bytes: DEFAULT_MAX_TOTAL_BYTES,
            max_total_snapshots: DEFAULT_MAX_TOTAL_SNAPSHOTS,
            max_snapshot_bytes: MAX_SNAPSHOT_BYTES,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryIndex {
    version: u32,
    snapshots: Vec<HistoryListItem>,
}

impl HistoryIndex {
    fn new(snapshots: Vec<HistoryListItem>) -> Self {
        Self {
            version: INDEX_SCHEMA_VERSION,
            snapshots,
        }
    }
}

/// Local, plain-text version history rooted at `app_data_dir/history/v1`.
#[derive(Debug, Clone)]
pub struct HistoryStore {
    root: PathBuf,
    limits: HistoryLimits,
}

impl HistoryStore {
    /// Creates a store below the Tauri application data directory.
    pub fn new(app_data_dir: &Path) -> Self {
        Self::with_root(
            app_data_dir
                .join(HISTORY_DIR_NAME)
                .join(HISTORY_FORMAT_VERSION),
        )
    }

    pub fn with_root(root: PathBuf) -> Self {
        Self::with_limits(root, HistoryLimits::default())
    }

    pub fn with_limits(root: PathBuf, limits: HistoryLimits) -> Self {
        Self { root, limits }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn limits(&self) -> &HistoryLimits {
        &self.limits
    }

    /// Captures `content` as a new version of `original_path`.
    ///
    /// Returns `Ok(false)` when the snapshot is deliberately skipped:
    /// - the content is byte-for-byte identical to the newest stored version
    ///   (consecutive duplicate; non-consecutive duplicates are kept);
    /// - the content exceeds the per-snapshot size limit.
    ///
    /// History is only ever additive here: an existing snapshot file is never
    /// overwritten, even if it is malformed. Errors are returned instead.
    pub fn capture(&self, original_path: &str, content: &str, title: &str) -> Result<bool, String> {
        let normalized = normalize_document_path(original_path);
        if normalized.is_empty() {
            return Err("文档路径为空，无法保存历史版本".to_string());
        }
        let content_bytes = content.len() as u64;
        if content_bytes > self.limits.max_snapshot_bytes {
            return Ok(false);
        }

        let _guard = HISTORY_WRITE_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        let document_dir = self.root.join(sha256_hex(normalized.as_bytes()));
        fs::create_dir_all(&document_dir)
            .map_err(|error| format!("创建历史版本目录失败: {}", error))?;

        let mut entries = self.load_entries(&document_dir)?;
        let sha256 = sha256_hex(content.as_bytes());
        if entries.first().is_some_and(|latest| {
            latest.sha256.eq_ignore_ascii_case(&sha256) && latest.bytes == content_bytes
        }) {
            return Ok(false);
        }

        let created_at = now_millis();
        let mut id = new_snapshot_id(created_at);
        for _ in 0..16 {
            if !snapshot_path(&document_dir, &id).exists() {
                break;
            }
            id = new_snapshot_id(created_at);
        }
        let snapshot_file = snapshot_path(&document_dir, &id);
        if snapshot_file.exists() {
            return Err("无法生成唯一的历史版本 ID".to_string());
        }

        let snapshot = Snapshot {
            id: id.clone(),
            created_at,
            original_path: original_path.to_string(),
            title: title.to_string(),
            content: content.to_string(),
            bytes: content_bytes,
            sha256,
        };
        let bytes = serde_json::to_vec(&snapshot)
            .map_err(|error| format!("序列化历史版本失败: {}", error))?;
        // Never replace a file at this path: it is either our own unique id or
        // a collision, and a collision must not destroy existing snapshot data.
        write_atomic(&document_dir, &snapshot_file, &bytes, false)?;
        entries.push(snapshot.list_item());
        sort_newest_first(&mut entries);
        self.write_index(&document_dir, &entries)?;

        self.prune_document(&document_dir, entries)?;
        self.prune_global()?;
        Ok(true)
    }

    /// Lists snapshot metadata for a document, newest first, without bodies.
    pub fn list(&self, original_path: &str) -> Result<Vec<HistoryListItem>, String> {
        let normalized = normalize_document_path(original_path);
        if normalized.is_empty() {
            return Err("文档路径为空，无法读取历史版本".to_string());
        }
        let document_dir = self.root.join(sha256_hex(normalized.as_bytes()));
        if !document_dir.is_dir() {
            return Ok(Vec::new());
        }

        let _guard = HISTORY_WRITE_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.load_entries(&document_dir)
    }

    /// Reads one snapshot body by exact id.
    ///
    /// The id must be a single safe file name component; path separators and
    /// traversal are rejected before touching the filesystem. Files larger than
    /// the configured limit (64 MiB by default) are rejected from metadata,
    /// before loading their contents.
    pub fn read(&self, original_path: &str, id: &str) -> Result<String, String> {
        if !is_safe_snapshot_id(id) {
            return Err("无效的历史版本 ID".to_string());
        }
        let normalized = normalize_document_path(original_path);
        if normalized.is_empty() {
            return Err("文档路径为空，无法读取历史版本".to_string());
        }
        let document_dir = self.root.join(sha256_hex(normalized.as_bytes()));
        let file = snapshot_path(&document_dir, id);
        if !file.is_file() {
            return Err("历史版本不存在或已被清理".to_string());
        }
        let bytes = read_bounded(&file, self.limits.max_snapshot_bytes)?;
        let snapshot: Snapshot = serde_json::from_slice(&bytes)
            .map_err(|error| format!("历史版本数据损坏: {}", error))?;
        if snapshot.id != id {
            return Err("历史版本数据损坏：ID 不匹配".to_string());
        }
        let content = snapshot.content.as_bytes();
        if snapshot.bytes != content.len() as u64 || snapshot.sha256 != sha256_hex(content) {
            return Err("历史版本数据损坏：内容校验失败".to_string());
        }
        Ok(snapshot.content)
    }

    // ------------------------------------------------------------------
    // Index / repair helpers
    // ------------------------------------------------------------------

    /// Loads index entries, repairing a missing/corrupt index from this
    /// document's own safe snapshot files. Malformed snapshot files are kept on
    /// disk but are not invented into the index.
    fn load_entries(&self, document_dir: &Path) -> Result<Vec<HistoryListItem>, String> {
        let index_path = document_dir.join(INDEX_FILE_NAME);
        let index_exists = index_path.is_file();
        let mut changed = false;

        let mut entries = match read_index_file(document_dir) {
            Some(index) => {
                let original_len = index.snapshots.len();
                let mut seen = HashSet::new();
                let mut kept = Vec::with_capacity(original_len);
                for entry in index.snapshots {
                    if !is_safe_snapshot_id(&entry.id) || !seen.insert(entry.id.clone()) {
                        changed = true;
                        continue;
                    }
                    if !snapshot_path(document_dir, &entry.id).is_file() {
                        changed = true;
                        continue;
                    }
                    kept.push(entry);
                }
                if kept.len() != original_len {
                    changed = true;
                }
                kept
            }
            None => {
                // Missing index for a fresh document is normal; a present but
                // unreadable one is repaired from the snapshot files below.
                changed = index_exists;
                Vec::new()
            }
        };

        if adopt_orphan_snapshots(document_dir, &mut entries, self.limits.max_snapshot_bytes)? {
            changed = true;
        }
        sort_newest_first(&mut entries);

        if changed {
            // Repair is best effort: a read-only folder must not make history
            // unreadable just because the index could not be rewritten.
            let _ = self.write_index(document_dir, &entries);
        }
        Ok(entries)
    }

    fn write_index(&self, document_dir: &Path, entries: &[HistoryListItem]) -> Result<(), String> {
        let mut sorted = entries.to_vec();
        sort_newest_first(&mut sorted);
        let index = HistoryIndex::new(sorted);
        let bytes =
            serde_json::to_vec(&index).map_err(|error| format!("序列化历史索引失败: {}", error))?;
        write_atomic(
            document_dir,
            &document_dir.join(INDEX_FILE_NAME),
            &bytes,
            true,
        )
    }

    // ------------------------------------------------------------------
    // Pruning
    // ------------------------------------------------------------------

    fn prune_document(
        &self,
        document_dir: &Path,
        mut entries: Vec<HistoryListItem>,
    ) -> Result<(), String> {
        sort_newest_first(&mut entries);
        let keep = self.limits.max_snapshots_per_document;
        let mut kept = Vec::with_capacity(entries.len().min(keep));
        for (position, entry) in entries.into_iter().enumerate() {
            if position < keep {
                kept.push(entry);
            } else if !delete_snapshot_if_intact(document_dir, &entry.id) {
                // The file is malformed, unreadable or could not be removed.
                // Preserve metadata rather than silently forgetting it.
                kept.push(entry);
            }
        }
        sort_newest_first(&mut kept);
        self.write_index(document_dir, &kept)
    }

    /// Enforces the store-wide byte and count caps. Other documents are only
    /// considered when their own index is valid; a corrupt index means "leave
    /// that folder alone" rather than "scan and delete whatever is there".
    fn prune_global(&self) -> Result<(), String> {
        if !self.root.is_dir() {
            return Ok(());
        }

        let mut documents: Vec<(PathBuf, Vec<HistoryListItem>)> = Vec::new();
        let read_dir = match fs::read_dir(&self.root) {
            Ok(read_dir) => read_dir,
            Err(_) => return Ok(()),
        };
        for entry in read_dir.flatten() {
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };
            if !file_type.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if !is_document_key(&name) {
                continue;
            }
            let document_dir = entry.path();
            let Some(index) = read_index_file(&document_dir) else {
                // Corrupt/missing index: never guess about foreign data.
                continue;
            };
            let mut entries: Vec<HistoryListItem> = index
                .snapshots
                .into_iter()
                .filter(|item| {
                    is_safe_snapshot_id(&item.id)
                        && snapshot_path(&document_dir, &item.id).is_file()
                })
                .collect();
            sort_newest_first(&mut entries);
            if !entries.is_empty() {
                documents.push((document_dir, entries));
            }
        }

        let total_bytes: u64 = documents
            .iter()
            .flat_map(|(_, entries)| entries.iter())
            .map(|entry| entry.bytes)
            .sum();
        let total_count: usize = documents.iter().map(|(_, entries)| entries.len()).sum();
        if total_bytes <= self.limits.max_total_bytes
            && total_count <= self.limits.max_total_snapshots
        {
            return Ok(());
        }

        // Oldest first across every consulted document.
        let mut order: Vec<(usize, usize)> = documents
            .iter()
            .enumerate()
            .flat_map(|(document_index, (_, entries))| {
                (0..entries.len()).map(move |entry_index| (document_index, entry_index))
            })
            .collect();
        order.sort_by(|&(left_doc, left_entry), &(right_doc, right_entry)| {
            let left = &documents[left_doc].1[left_entry];
            let right = &documents[right_doc].1[right_entry];
            left.created_at
                .cmp(&right.created_at)
                .then_with(|| left.id.cmp(&right.id))
        });

        let mut bytes_over = total_bytes.saturating_sub(self.limits.max_total_bytes);
        let mut count_over = total_count.saturating_sub(self.limits.max_total_snapshots);
        let mut remove: HashSet<(usize, String)> = HashSet::new();
        for (document_index, entry_index) in order {
            if bytes_over == 0 && count_over == 0 {
                break;
            }
            let entry = &documents[document_index].1[entry_index];
            remove.insert((document_index, entry.id.clone()));
            bytes_over = bytes_over.saturating_sub(entry.bytes);
            count_over = count_over.saturating_sub(1);
        }

        for (document_index, (document_dir, entries)) in documents.iter().enumerate() {
            let mut kept = Vec::with_capacity(entries.len());
            let mut changed = false;
            for entry in entries {
                if remove.contains(&(document_index, entry.id.clone()))
                    && delete_snapshot_if_intact(document_dir, &entry.id)
                {
                    changed = true;
                } else {
                    kept.push(entry.clone());
                }
            }
            if changed {
                let _ = self.write_index(document_dir, &kept);
            }
        }
        Ok(())
    }
}

// ----------------------------------------------------------------------
// Tauri commands
// ----------------------------------------------------------------------

fn store_for(app: &tauri::AppHandle) -> Result<HistoryStore, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取应用数据目录: {}", error))?;
    Ok(HistoryStore::new(&dir))
}

/// Captures the text that was just successfully written. Returns whether a new
/// snapshot was stored (false for a consecutive duplicate or oversized text).
#[tauri::command]
pub async fn record_document_history(
    app: tauri::AppHandle,
    path: String,
    content: String,
    title: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = store_for(&app)?;
        store.capture(&path, &content, &title)
    })
    .await
    .map_err(|error| format!("历史版本保存任务失败: {}", error))?
}

#[tauri::command]
pub async fn list_document_history(
    app: tauri::AppHandle,
    path: String,
) -> Result<Vec<HistoryListItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = store_for(&app)?;
        store.list(&path)
    })
    .await
    .map_err(|error| format!("历史版本列表任务失败: {}", error))?
}

#[tauri::command]
pub async fn read_document_snapshot(
    app: tauri::AppHandle,
    path: String,
    id: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = store_for(&app)?;
        store.read(&path, &id)
    })
    .await
    .map_err(|error| format!("历史版本读取任务失败: {}", error))?
}

// ----------------------------------------------------------------------
// Pure path / hash / file helpers
// ----------------------------------------------------------------------

/// Normalizes a document path into the stable identity used for the hashed
/// folder: slash direction, duplicate separators, trailing slash and letter
/// case (the desktop app targets Windows). Empty input stays empty.
pub fn normalize_document_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let is_unc = trimmed.starts_with("\\\\") || trimmed.starts_with("//");
    let mut normalized = trimmed.replace('\\', "/");
    while normalized.contains("//") {
        normalized = normalized.replace("//", "/");
    }
    if is_unc {
        // `\\server\share` and `//server/share` are the same location.
        normalized = format!("/{}", normalized);
    }
    if normalized.len() > 1 && normalized.ends_with('/') {
        let is_drive_root =
            normalized.len() == 3 && normalized.as_bytes()[1] == b':' && normalized.ends_with('/');
        if !is_drive_root {
            while normalized.ends_with('/') && normalized.len() > 1 {
                normalized.pop();
            }
        }
    }
    normalized.to_lowercase()
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn snapshot_path(document_dir: &Path, id: &str) -> PathBuf {
    document_dir.join(format!("{}.json", id))
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

static NEXT_SNAPSHOT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn new_snapshot_id(created_at: u64) -> String {
    let sequence = NEXT_SNAPSHOT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.subsec_nanos())
        .unwrap_or(0);
    // Zero-padded timestamp first so lexical order matches creation order.
    format!("{:013}-{:09}-{:06}", created_at, nanos, sequence)
}

fn is_safe_snapshot_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_SNAPSHOT_ID_LEN
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn is_document_key(name: &str) -> bool {
    name.len() == 64 && name.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn sort_newest_first(entries: &mut [HistoryListItem]) {
    entries.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| right.id.cmp(&left.id))
    });
}

fn read_index_file(document_dir: &Path) -> Option<HistoryIndex> {
    // Even a corrupt index must not cause an unbounded allocation.
    let bytes = read_bounded(&document_dir.join(INDEX_FILE_NAME), 16 * 1024 * 1024).ok()?;
    let index: HistoryIndex = serde_json::from_slice(&bytes).ok()?;
    if index.version != INDEX_SCHEMA_VERSION {
        return None;
    }
    Some(index)
}

/// Adds valid snapshot files that exist on disk but are missing from the index.
/// Malformed files are preserved untouched and simply not listed.
fn adopt_orphan_snapshots(
    document_dir: &Path,
    entries: &mut Vec<HistoryListItem>,
    max_snapshot_bytes: u64,
) -> Result<bool, String> {
    let read_dir = match fs::read_dir(document_dir) {
        Ok(read_dir) => read_dir,
        Err(_) => return Ok(false),
    };
    let mut known: HashSet<String> = entries.iter().map(|entry| entry.id.clone()).collect();
    let mut added = false;
    for entry in read_dir.flatten() {
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.starts_with(TEMP_FILE_PREFIX) {
            // Leftovers from an interrupted atomic write; only our prefix is
            // removed, never user files.
            let _ = fs::remove_file(entry.path());
            continue;
        }
        if file_name == INDEX_FILE_NAME {
            continue;
        }
        let Some(stem) = file_name.strip_suffix(".json") else {
            continue;
        };
        if !is_safe_snapshot_id(stem) || known.contains(stem) {
            continue;
        }
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        if !file_type.is_file() {
            continue;
        }
        let bytes = match read_bounded(&entry.path(), max_snapshot_bytes) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        let snapshot: Snapshot = match serde_json::from_slice(&bytes) {
            Ok(snapshot) => snapshot,
            Err(_) => continue,
        };
        if snapshot.id != stem {
            continue;
        }
        let recomputed = sha256_hex(snapshot.content.as_bytes());
        known.insert(stem.to_string());
        entries.push(HistoryListItem {
            id: stem.to_string(),
            created_at: snapshot.created_at,
            original_path: snapshot.original_path,
            title: snapshot.title,
            bytes: snapshot.content.len() as u64,
            sha256: recomputed,
        });
        added = true;
    }
    Ok(added)
}

fn read_bounded(path: &Path, max_bytes: u64) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("读取历史版本信息失败 ({}): {}", path.display(), error))?;
    if !metadata.is_file() {
        return Err("历史版本不是常规文件".to_string());
    }
    if metadata.len() > max_bytes {
        return Err(format!(
            "历史版本超过 {} MiB 限制",
            max_bytes / (1024 * 1024)
        ));
    }
    let file = File::open(path)
        .map_err(|error| format!("打开历史版本失败 ({}): {}", path.display(), error))?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("读取历史版本失败 ({}): {}", path.display(), error))?;
    if bytes.len() as u64 > max_bytes {
        return Err(format!(
            "历史版本超过 {} MiB 限制",
            max_bytes / (1024 * 1024)
        ));
    }
    Ok(bytes)
}

/// True only when the snapshot parses and its id matches. Used before pruning so
/// a malformed/foreign file is preserved even if the index references it.
fn snapshot_is_intact(document_dir: &Path, id: &str) -> bool {
    let path = snapshot_path(document_dir, id);
    let Ok(metadata) = fs::metadata(&path) else {
        return false;
    };
    if metadata.len() > MAX_SNAPSHOT_BYTES {
        return false;
    }
    let Ok(bytes) = fs::read(&path) else {
        return false;
    };
    serde_json::from_slice::<Snapshot>(&bytes)
        .map(|snapshot| {
            snapshot.id == id
                && snapshot.bytes == snapshot.content.len() as u64
                && snapshot.sha256 == sha256_hex(snapshot.content.as_bytes())
        })
        .unwrap_or(false)
}

fn delete_snapshot_if_intact(document_dir: &Path, id: &str) -> bool {
    if !snapshot_is_intact(document_dir, id) {
        return false;
    }
    match fs::remove_file(snapshot_path(document_dir, id)) {
        Ok(()) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Err(_) => false,
    }
}

fn write_atomic(
    directory: &Path,
    target: &Path,
    bytes: &[u8],
    replace: bool,
) -> Result<(), String> {
    let mut temporary = tempfile::Builder::new()
        .prefix(TEMP_FILE_PREFIX)
        .suffix(".tmp")
        .tempfile_in(directory)
        .map_err(|error| format!("创建历史版本临时文件失败: {}", error))?;
    temporary
        .write_all(bytes)
        .map_err(|error| format!("写入历史版本失败: {}", error))?;
    temporary
        .flush()
        .map_err(|error| format!("刷新历史版本失败: {}", error))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("同步历史版本失败: {}", error))?;

    if replace {
        temporary
            .persist(target)
            .map_err(|error| format!("提交历史索引失败: {}", error.error))?;
    } else {
        temporary
            .persist_noclobber(target)
            .map_err(|error| format!("提交历史版本失败: {}", error.error))?;
    }
    sync_directory(directory);
    Ok(())
}

/// Best-effort directory fsync so a rename is durable where the platform
/// supports opening a directory (Windows does not, and that is fine).
fn sync_directory(directory: &Path) {
    #[cfg(unix)]
    {
        if let Ok(handle) = File::open(directory) {
            let _ = handle.sync_all();
        }
    }
    #[cfg(not(unix))]
    {
        let _ = directory;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_store(root: &Path) -> HistoryStore {
        HistoryStore::with_root(root.join("history").join("v1"))
    }

    fn limited_store(root: &Path, limits: HistoryLimits) -> HistoryStore {
        HistoryStore::with_limits(root.join("history").join("v1"), limits)
    }

    fn document_dir(store: &HistoryStore, path: &str) -> PathBuf {
        store
            .root()
            .join(sha256_hex(normalize_document_path(path).as_bytes()))
    }

    fn json_files(directory: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(directory)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name.ends_with(".json"))
            .collect();
        names.sort();
        names
    }

    #[test]
    fn captures_unicode_snapshot_with_exact_sha256_and_reads_it_back() {
        let directory = tempfile::tempdir().unwrap();
        let store = test_store(directory.path());
        let path = r"C:\笔记\项目 文档.md";
        let content = "# 标题 🚀\n\n中文内容 with emoji 🐍\r\n第二行";

        assert!(store.capture(path, content, "项目 文档.md").unwrap());

        let entries = store.list(path).unwrap();
        assert_eq!(entries.len(), 1);
        let entry = &entries[0];
        assert_eq!(entry.original_path, path);
        assert_eq!(entry.title, "项目 文档.md");
        assert_eq!(entry.bytes, content.len() as u64);
        assert_eq!(entry.sha256, sha256_hex(content.as_bytes()));
        assert_eq!(entry.sha256.len(), 64);
        assert_eq!(store.read(path, &entry.id).unwrap(), content);

        // The index and snapshot live below the hashed document folder.
        let dir = document_dir(&store, path);
        assert!(dir.join(INDEX_FILE_NAME).is_file());
        assert!(dir.join(format!("{}.json", entry.id)).is_file());
        // No temporary files remain after atomic commits.
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|item| {
                item.file_name()
                    .to_string_lossy()
                    .starts_with(TEMP_FILE_PREFIX)
            })
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn skips_only_consecutive_duplicate_content() {
        let directory = tempfile::tempdir().unwrap();
        let store = test_store(directory.path());
        let path = r"C:\docs\notes.md";

        assert!(store.capture(path, "version one", "notes.md").unwrap());
        assert!(!store.capture(path, "version one", "notes.md").unwrap());
        assert!(store.capture(path, "version two", "notes.md").unwrap());
        // Non-consecutive duplicate is a legitimate new version.
        assert!(store.capture(path, "version one", "notes.md").unwrap());

        let entries = store.list(path).unwrap();
        assert_eq!(entries.len(), 3);
        assert_eq!(store.read(path, &entries[0].id).unwrap(), "version one");
        assert_eq!(store.read(path, &entries[1].id).unwrap(), "version two");
        assert_eq!(store.read(path, &entries[2].id).unwrap(), "version one");
    }

    #[test]
    fn prunes_oldest_snapshots_at_the_per_document_cap() {
        let directory = tempfile::tempdir().unwrap();
        let store = limited_store(
            directory.path(),
            HistoryLimits {
                max_snapshots_per_document: 3,
                ..HistoryLimits::default()
            },
        );
        let path = r"C:\docs\notes.md";
        for index in 0..5 {
            assert!(store
                .capture(path, &format!("content-{index}"), "notes.md")
                .unwrap());
        }

        let entries = store.list(path).unwrap();
        assert_eq!(entries.len(), 3);
        let bodies: Vec<String> = entries
            .iter()
            .map(|entry| store.read(path, &entry.id).unwrap())
            .collect();
        assert_eq!(bodies, vec!["content-4", "content-3", "content-2"]);
        let files = json_files(&document_dir(&store, path));
        // index.json + the three surviving snapshots; the two oldest bodies
        // (and their files) were removed.
        assert_eq!(files.len(), 4);
    }

    #[test]
    fn enforces_store_wide_byte_cap_across_documents() {
        let directory = tempfile::tempdir().unwrap();
        let store = limited_store(
            directory.path(),
            HistoryLimits {
                max_total_bytes: 10,
                max_total_snapshots: 100,
                ..HistoryLimits::default()
            },
        );
        assert!(store.capture(r"C:\docs\a.md", "12345", "a.md").unwrap());
        assert!(store.capture(r"C:\docs\b.md", "67890", "b.md").unwrap());
        assert!(store.capture(r"C:\docs\c.md", "abcde", "c.md").unwrap());

        let total: u64 = [r"C:\docs\a.md", r"C:\docs\b.md", r"C:\docs\c.md"]
            .iter()
            .flat_map(|path| store.list(path).unwrap())
            .map(|entry| entry.bytes)
            .sum();
        assert!(total <= 10, "total bytes should be pruned, got {total}");
        // Oldest document version was removed first.
        assert!(store.list(r"C:\docs\a.md").unwrap().is_empty());
        assert_eq!(store.list(r"C:\docs\c.md").unwrap().len(), 1);
    }

    #[test]
    fn enforces_store_wide_snapshot_count_cap() {
        let directory = tempfile::tempdir().unwrap();
        let store = limited_store(
            directory.path(),
            HistoryLimits {
                max_total_snapshots: 2,
                ..HistoryLimits::default()
            },
        );
        assert!(store.capture(r"C:\docs\a.md", "a1", "a.md").unwrap());
        assert!(store.capture(r"C:\docs\b.md", "b1", "b.md").unwrap());
        assert!(store.capture(r"C:\docs\c.md", "c1", "c.md").unwrap());

        let total: usize = [r"C:\docs\a.md", r"C:\docs\b.md", r"C:\docs\c.md"]
            .iter()
            .map(|path| store.list(path).unwrap().len())
            .sum();
        assert_eq!(total, 2);
        assert!(store.list(r"C:\docs\a.md").unwrap().is_empty());
    }

    #[test]
    fn repairs_corrupt_index_and_preserves_existing_snapshots() {
        let directory = tempfile::tempdir().unwrap();
        let store = test_store(directory.path());
        let path = r"C:\docs\notes.md";
        assert!(store.capture(path, "first", "notes.md").unwrap());
        assert!(store.capture(path, "second", "notes.md").unwrap());
        let document_dir = document_dir(&store, path);
        let before = json_files(&document_dir);
        assert_eq!(before.len(), 3);

        fs::write(document_dir.join(INDEX_FILE_NAME), b"{not valid json").unwrap();

        let entries = store.list(path).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].title, "notes.md");
        assert_eq!(store.read(path, &entries[0].id).unwrap(), "second");
        // The repaired index is valid again.
        let repaired = read_index_file(&document_dir).expect("index should be repaired");
        assert_eq!(repaired.snapshots.len(), 2);
        // No snapshot file was removed by the repair.
        assert_eq!(json_files(&document_dir).len(), before.len());
    }

    #[test]
    fn preserves_malformed_snapshot_file_but_does_not_silently_overwrite_it() {
        let directory = tempfile::tempdir().unwrap();
        let store = test_store(directory.path());
        let path = r"C:\docs\notes.md";
        let document_dir = document_dir(&store, path);
        fs::create_dir_all(&document_dir).unwrap();
        let malformed_id = "9999999999999-000000000-000000";
        let malformed_path = document_dir.join(format!("{}.json", malformed_id));
        fs::write(&malformed_path, b"{\"broken\":").unwrap();

        assert!(store.capture(path, "healthy", "notes.md").unwrap());
        let entries = store.list(path).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].sha256, sha256_hex(b"healthy"));
        assert_eq!(fs::read(&malformed_path).unwrap(), b"{\"broken\":");
        assert!(store.read(path, malformed_id).is_err());

        // A capture never reuses/overwrites the malformed known id.
        assert!(store.capture(path, "another", "notes.md").unwrap());
        assert_eq!(fs::read(&malformed_path).unwrap(), b"{\"broken\":");
    }

    #[test]
    fn rejects_unsafe_ids_and_oversized_snapshot_reads() {
        let directory = tempfile::tempdir().unwrap();
        let store = limited_store(
            directory.path(),
            HistoryLimits {
                max_snapshot_bytes: 256,
                ..HistoryLimits::default()
            },
        );
        let path = r"C:\docs\notes.md";
        assert!(store.capture(path, "small", "notes.md").unwrap());
        let id = store.list(path).unwrap()[0].id.clone();

        for unsafe_id in ["../escape", r"..\escape", "", "with/slash", "with.dot"] {
            assert!(
                store.read(path, unsafe_id).is_err(),
                "unsafe id must be rejected: {unsafe_id:?}"
            );
        }

        let document_dir = document_dir(&store, path);
        let oversized = format!("{}.json", "8888888888888-000000000-000000");
        fs::write(document_dir.join(&oversized), vec![b'x'; 512]).unwrap();
        let error = store
            .read(path, "8888888888888-000000000-000000")
            .unwrap_err();
        assert!(error.contains("限制"), "unexpected error: {error}");
        assert_eq!(store.read(path, &id).unwrap(), "small");
    }

    #[test]
    fn normalizes_paths_and_hashes_the_normalized_form() {
        let canonical = normalize_document_path(r"C:\Docs\Notes.md");
        assert_eq!(canonical, "c:/docs/notes.md");
        assert_eq!(
            normalize_document_path("C:/Docs//Notes.md/"),
            "c:/docs/notes.md"
        );
        assert_eq!(
            normalize_document_path(r"\\Server\Share\a.md"),
            "//server/share/a.md"
        );
        assert_eq!(sha256_hex(canonical.as_bytes()).len(), 64);

        let directory = tempfile::tempdir().unwrap();
        let store = test_store(directory.path());
        assert!(store.capture(r"C:\Docs\Notes.md", "x", "Notes.md").unwrap());
        assert_eq!(store.list("c:/docs/notes.md").unwrap().len(), 1);
    }

    #[test]
    fn orphan_valid_snapshot_is_adopted_without_touching_malformed_files() {
        let directory = tempfile::tempdir().unwrap();
        let store = test_store(directory.path());
        let path = r"C:\docs\notes.md";
        let document_dir = document_dir(&store, path);
        fs::create_dir_all(&document_dir).unwrap();

        let orphan_id = "7777777777777-000000000-000000";
        let orphan = Snapshot {
            id: orphan_id.to_string(),
            created_at: 1_700_000_000_000,
            original_path: path.to_string(),
            title: "notes.md".to_string(),
            content: "orphan".to_string(),
            bytes: 6,
            sha256: sha256_hex(b"orphan"),
        };
        fs::write(
            document_dir.join(format!("{}.json", orphan_id)),
            serde_json::to_vec(&orphan).unwrap(),
        )
        .unwrap();

        let entries = store.list(path).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, orphan_id);
        assert_eq!(store.read(path, orphan_id).unwrap(), "orphan");
    }

    #[test]
    fn rejects_tampered_snapshot_body_and_keeps_it_for_diagnostics() {
        let directory = tempfile::tempdir().unwrap();
        let store = test_store(directory.path());
        let path = r"C:\docs\notes.md";
        store.capture(path, "trusted", "notes.md").unwrap();
        let entry = store.list(path).unwrap().remove(0);
        let snapshot_path = document_dir(&store, path).join(format!("{}.json", entry.id));
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&snapshot_path).unwrap()).unwrap();
        value["content"] = serde_json::Value::String("tampered".into());
        fs::write(&snapshot_path, serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(store.read(path, &entry.id).unwrap_err().contains("校验"));
        assert_eq!(store.list(path).unwrap().len(), 1);
        assert!(snapshot_path.is_file());
    }

    #[test]
    fn capture_skips_content_above_the_snapshot_limit() {
        let directory = tempfile::tempdir().unwrap();
        let store = limited_store(
            directory.path(),
            HistoryLimits {
                max_snapshot_bytes: 8,
                ..HistoryLimits::default()
            },
        );
        let path = r"C:\docs\notes.md";
        assert!(!store.capture(path, "123456789", "notes.md").unwrap());
        assert!(store.capture(path, "12345678", "notes.md").unwrap());
        assert_eq!(store.list(path).unwrap().len(), 1);
    }
}
