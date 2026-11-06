//! Tiny versioned JSON file store with atomic writes. Each store owns one file under the
//! app's data dir; a corrupt file is moved aside (never silently overwritten).

use crate::error::AppResult;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Deserialize)]
struct Envelope<T> {
    #[allow(dead_code)] // read for future migrations
    version: u32,
    items: Vec<T>,
}

#[derive(Serialize)]
struct EnvelopeRef<'a, T> {
    version: u32,
    items: &'a [T],
}

pub const CURRENT_VERSION: u32 = 1;

pub fn load<T: DeserializeOwned>(path: &Path) -> AppResult<Vec<T>> {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    match serde_json::from_str::<Envelope<T>>(&raw) {
        Ok(env) => Ok(env.items),
        Err(err) => {
            let aside = path.with_extension(format!(
                "corrupt-{}.json",
                chrono::Utc::now().format("%Y%m%d%H%M%S")
            ));
            log::error!(
                "{} is malformed ({err}); moved to {}",
                path.display(),
                aside.display()
            );
            fs::rename(path, &aside)?;
            Ok(Vec::new())
        }
    }
}

pub fn save<T: Serialize>(path: &Path, items: &[T]) -> AppResult<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let env = EnvelopeRef {
        version: CURRENT_VERSION,
        items,
    };
    let tmp: PathBuf = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(&env)?)?;
    // `rename` replaces the destination atomically on both NTFS and APFS.
    fs::rename(&tmp, path)?;
    Ok(())
}
