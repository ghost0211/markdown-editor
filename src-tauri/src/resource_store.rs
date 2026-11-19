//! User-selected resource export and non-destructive creation of local assets.
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    sync::{Mutex, OnceLock},
};
use tauri::ipc::{InvokeBody, Request};

const MAX_RESOURCE_BYTES: usize = 32 * 1024 * 1024;
const MAX_PENDING_BYTES: usize = 128 * 1024 * 1024;
struct CreatedResource {
    path: PathBuf,
    bytes: Vec<u8>,
}
static CREATED: OnceLock<Mutex<HashMap<String, CreatedResource>>> = OnceLock::new();
static NEXT_RECEIPT: AtomicU64 = AtomicU64::new(1);
fn created_resources() -> &'static Mutex<HashMap<String, CreatedResource>> {
    CREATED.get_or_init(|| Mutex::new(HashMap::new()))
}

fn decode_resource_frame(frame: &[u8]) -> Result<(&Path, &[u8]), String> {
    let header: [u8; 4] = frame
        .get(..4)
        .ok_or("Invalid resource frame")?
        .try_into()
        .map_err(|_| "Invalid resource frame")?;
    let length = u32::from_le_bytes(header) as usize;
    if length == 0 || length > 32768 {
        return Err("Invalid resource path length".into());
    }
    let path = std::str::from_utf8(frame.get(4..4 + length).ok_or("Invalid resource path")?)
        .map_err(|_| "Invalid resource path encoding")?;
    if path.replace('\\', "/").starts_with("//") {
        return Err("不支持网络共享资源 / Network share resources are not supported".into());
    }
    let data = frame.get(4 + length..).ok_or("Invalid resource data")?;
    Ok((Path::new(path), data))
}

fn write_resource_frame(frame: &[u8], create_new: bool) -> Result<Option<String>, String> {
    let (target, data) = decode_resource_frame(frame)?;
    if data.len() > MAX_RESOURCE_BYTES {
        return Err("资源超过 32 MiB / Resource exceeds 32 MiB".into());
    }
    let parent = target
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    if create_new {
        let mut created = created_resources()
            .lock()
            .map_err(|error| error.to_string())?;
        if created
            .values()
            .map(|value| value.bytes.len())
            .sum::<usize>()
            + data.len()
            > MAX_PENDING_BYTES
            || created.len() >= 2048
        {
            return Err("Too many pending resources; finish the current conversion first".into());
        }
        // Never overwrite an existing asset, even when a generated name collides.
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target)
            .map_err(|error| error.to_string())?;
        if let Err(error) = file.write_all(data).and_then(|()| file.sync_all()) {
            drop(file);
            let _ = fs::remove_file(target); // Only the new file created by this call.
            return Err(error.to_string());
        }
        let receipt = format!(
            "{}-{}",
            std::process::id(),
            NEXT_RECEIPT.fetch_add(1, Ordering::Relaxed)
        );
        created.insert(
            receipt.clone(),
            CreatedResource {
                path: std::path::absolute(target).map_err(|error| error.to_string())?,
                bytes: data.to_vec(),
            },
        );
        Ok(Some(receipt))
    } else {
        // Write a user-selected destination atomically, retaining its old bytes
        // if the temporary file cannot be fully written and committed.
        let mut temporary =
            tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
        temporary
            .write_all(data)
            .and_then(|()| temporary.as_file().sync_all())
            .map_err(|error| error.to_string())?;
        temporary
            .persist(target)
            .map_err(|error| error.error.to_string())?;
        Ok(None)
    }
}

/// Receipts refer only to files created by this process; no deletion path is
/// accepted from the frontend. An externally changed/replaced file is retained.
#[tauri::command]
pub fn settle_created_resource_files(receipts: Vec<String>, discard: bool) -> Result<(), String> {
    let mut created = created_resources()
        .lock()
        .map_err(|error| error.to_string())?;
    let mut failed = false;
    for receipt in receipts {
        if let Some(resource) = created.remove(&receipt) {
            if discard {
                let metadata = fs::symlink_metadata(&resource.path);
                if metadata.as_ref().is_ok_and(|value| {
                    value.file_type().is_file() && value.len() == resource.bytes.len() as u64
                }) && fs::read(&resource.path).is_ok_and(|bytes| bytes == resource.bytes)
                {
                    failed |= fs::remove_file(&resource.path).is_err();
                }
            }
        }
    }
    if failed {
        Err("Some newly created files could not be rolled back".into())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn export_resource_file(request: Request<'_>) -> Result<(), String> {
    match request.body() {
        InvokeBody::Raw(frame) => write_resource_frame(frame, false).map(|_| ()),
        _ => Err("Expected binary resource frame".into()),
    }
}

#[tauri::command]
pub fn create_resource_file(request: Request<'_>) -> Result<Option<String>, String> {
    match request.body() {
        InvokeBody::Raw(frame) => write_resource_frame(frame, true),
        _ => Err("Expected binary resource frame".into()),
    }
}

#[tauri::command]
pub fn write_new_export_file(request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(frame) = request.body() else {
        return Err("Expected binary export frame".into());
    };
    let (target, data) = decode_resource_frame(frame)?;
    let extension = target.extension().and_then(|extension| extension.to_str());
    if !target.is_absolute() || !matches!(extension, Some("docx" | "html")) {
        return Err("无效的导出文件 / Invalid export file".into());
    }
    crate::pdf_export::write_new_export(target, data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(path: &Path, data: &[u8]) -> Vec<u8> {
        let name = path.to_str().unwrap().as_bytes();
        let mut bytes = (name.len() as u32).to_le_bytes().to_vec();
        bytes.extend_from_slice(name);
        bytes.extend_from_slice(data);
        bytes
    }

    #[test]
    fn creates_assets_without_overwriting_existing_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("assets/image.png");
        let receipt = write_resource_frame(&frame(&target, b"original"), true)
            .unwrap()
            .unwrap();
        assert!(write_resource_frame(&frame(&target, b"replacement"), true).is_err());
        assert_eq!(fs::read(target).unwrap(), b"original");
        settle_created_resource_files(vec![receipt], false).unwrap();
    }

    #[test]
    fn rollback_removes_only_unchanged_files_created_by_this_operation() {
        let directory = tempfile::tempdir().unwrap();
        let unchanged = directory.path().join("new.png");
        let changed = directory.path().join("changed.png");
        let first = write_resource_frame(&frame(&unchanged, b"original"), true)
            .unwrap()
            .unwrap();
        let second = write_resource_frame(&frame(&changed, b"original"), true)
            .unwrap()
            .unwrap();
        fs::write(&changed, b"external").unwrap();
        settle_created_resource_files(vec![first, second, "unknown".into()], true).unwrap();
        assert!(!unchanged.exists());
        assert_eq!(fs::read(changed).unwrap(), b"external");
    }

    #[test]
    fn exports_and_atomically_replaces_arbitrary_attachment_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("attachment.xmd");
        write_resource_frame(&frame(&target, b"first"), false).unwrap();
        write_resource_frame(&frame(&target, b"replacement"), false).unwrap();
        assert_eq!(fs::read(target).unwrap(), b"replacement");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn rejects_malformed_frames_and_shared_paths() {
        assert!(write_resource_frame(&[], true).is_err());
        assert!(write_resource_frame(&[0; 4], true).is_err());
        assert!(
            write_resource_frame(&frame(Path::new("//server/share/a.png"), b"data"), true).is_err()
        );
        let mut oversized = frame(Path::new("unused.png"), b"");
        oversized.resize(oversized.len() + MAX_RESOURCE_BYTES + 1, 0);
        assert!(write_resource_frame(&oversized, false).is_err());
    }
}
