//! Host folders. A folder is a `/`-separated path stored on each host's `group`
//! (`Production/EU`); empty folders live in `folders.json`. Renaming or moving a folder
//! rewrites every path under it, and deleting one moves its contents up a level, so hosts
//! are never lost by reorganizing.

use super::{Hive, Host, HostStore};
use crate::{
    error::{AppError, AppResult},
    store,
};
use std::collections::BTreeSet;

const MAX_DEPTH: usize = 8;
const MAX_NAME: usize = 64;

/// Trims every segment: `" Prod / EU "` → `"Prod/EU"`. Rejects empty or over-long names.
pub fn normalize(path: &str) -> AppResult<String> {
    let parts: Vec<&str> = path.split('/').map(str::trim).collect();
    if parts.iter().any(|p| p.is_empty()) {
        return Err(AppError::Invalid(
            "Folder names can't be empty or contain “/”.".into(),
        ));
    }
    if parts.len() > MAX_DEPTH {
        return Err(AppError::Invalid(format!(
            "Folders can be nested up to {MAX_DEPTH} levels deep."
        )));
    }
    if parts.iter().any(|p| p.chars().count() > MAX_NAME) {
        return Err(AppError::Invalid(format!(
            "Folder names can be up to {MAX_NAME} characters."
        )));
    }
    Ok(parts.join("/"))
}

/// Like `normalize`, with empty meaning the top level.
pub fn normalize_opt(path: Option<&str>) -> AppResult<Option<String>> {
    match path.map(str::trim) {
        None | Some("") => Ok(None),
        Some(p) => normalize(p).map(Some),
    }
}

/// `path` is `folder` itself or somewhere inside it.
pub fn within(path: &str, folder: &str) -> bool {
    path == folder
        || path
            .strip_prefix(folder)
            .is_some_and(|rest| rest.starts_with('/'))
}

pub fn parent(path: &str) -> Option<&str> {
    path.rsplit_once('/').map(|(p, _)| p)
}

/// Re-roots `path` (inside `from`) under `to`; `to = None` means the top level.
fn rebase(path: &str, from: &str, to: Option<&str>) -> Option<String> {
    let rest = &path[from.len()..]; // "" or "/child…"
    match (to, rest.strip_prefix('/')) {
        (Some(to), _) => Some(format!("{to}{rest}")),
        (None, Some(child)) => Some(child.to_string()),
        (None, None) => None,
    }
}

/// The next free position at the end of a folder.
pub fn next_order(hosts: &[Host], group: Option<&str>) -> i64 {
    hosts
        .iter()
        .filter(|h| h.group.as_deref() == group)
        .map(|h| h.order + 1)
        .max()
        .unwrap_or(0)
}

fn with_ancestors(set: &mut BTreeSet<String>, path: &str) {
    let mut p = Some(path);
    while let Some(cur) = p {
        set.insert(cur.to_string());
        p = parent(cur);
    }
}

impl HostStore {
    /// Hosts plus every folder path, A→Z (parents before their children).
    pub fn hive(&self) -> Hive {
        let hosts = self.list();
        let mut set = BTreeSet::new();
        for f in self.folders.lock().unwrap().iter() {
            with_ancestors(&mut set, f);
        }
        for g in hosts.iter().filter_map(|h| h.group.as_deref()) {
            with_ancestors(&mut set, g);
        }
        Hive {
            hosts,
            folders: set.into_iter().collect(),
        }
    }

    pub fn create_folder(&self, path: &str) -> AppResult<Hive> {
        let path = normalize(path)?;
        {
            let mut folders = self.folders.lock().unwrap();
            if !folders.contains(&path) {
                folders.push(path);
                folders.sort();
                store::save(&self.folders_path, &folders)?;
            }
        }
        Ok(self.hive())
    }

    /// Renames a folder (same parent) or moves it (new parent), with everything inside.
    pub fn move_folder(&self, from: &str, to: &str) -> AppResult<Hive> {
        let from = normalize(from)?;
        let to = normalize(to)?;
        if from == to {
            return Ok(self.hive());
        }
        if within(&to, &from) {
            return Err(AppError::Invalid(
                "A folder can't be moved inside itself.".into(),
            ));
        }
        if self.hive().folders.contains(&to) {
            return Err(AppError::Invalid(format!(
                "There's already a folder called “{to}”."
            )));
        }
        self.rewrite(|path| {
            if within(path, &from) {
                rebase(path, &from, Some(&to)).map(Some)
            } else {
                None
            }
        })
    }

    /// Deletes a folder. Its hosts and subfolders move up to its parent.
    pub fn delete_folder(&self, path: &str) -> AppResult<Hive> {
        let path = normalize(path)?;
        let up = parent(&path).map(str::to_string);
        self.rewrite(|p| {
            if within(p, &path) {
                Some(rebase(p, &path, up.as_deref()))
            } else {
                None
            }
        })
    }

    /// Applies a path change to every host and stored folder. `change` returns `None` to
    /// leave a path alone, or `Some(new)` where `new = None` is the top level.
    fn rewrite(&self, change: impl Fn(&str) -> Option<Option<String>>) -> AppResult<Hive> {
        {
            let mut hosts = self.hosts.lock().unwrap();
            let mut touched = false;
            for h in hosts.iter_mut() {
                if let Some(new) = h.group.as_deref().and_then(&change) {
                    h.group = new;
                    touched = true;
                }
            }
            if touched {
                store::save(&self.path, &hosts)?;
            }
        }
        {
            let mut folders = self.folders.lock().unwrap();
            let next: BTreeSet<String> = folders
                .iter()
                .filter_map(|f| match change(f) {
                    None => Some(f.clone()),
                    Some(new) => new,
                })
                .collect();
            *folders = next.into_iter().collect();
            store::save(&self.folders_path, &folders)?;
        }
        Ok(self.hive())
    }

    /// Moves hosts into `folder` (`None` = top level), placed before `before` (or at the
    /// end), and renumbers that folder so drag-and-drop order sticks.
    pub fn move_hosts(
        &self,
        ids: &[String],
        folder: Option<&str>,
        before: Option<&str>,
    ) -> AppResult<Hive> {
        let folder = normalize_opt(folder)?;
        {
            let mut hosts = self.hosts.lock().unwrap();
            for h in hosts.iter_mut().filter(|h| ids.contains(&h.id)) {
                h.group = folder.clone();
            }
            let mut siblings: Vec<usize> = (0..hosts.len())
                .filter(|&i| hosts[i].group == folder && !ids.contains(&hosts[i].id))
                .collect();
            siblings.sort_by(|&a, &b| {
                let (a, b) = (&hosts[a], &hosts[b]);
                a.order
                    .cmp(&b.order)
                    .then_with(|| a.label.to_lowercase().cmp(&b.label.to_lowercase()))
            });
            let moving: Vec<usize> = ids
                .iter()
                .filter_map(|id| hosts.iter().position(|h| &h.id == id))
                .collect();
            let at = before
                .and_then(|b| siblings.iter().position(|&i| hosts[i].id == b))
                .unwrap_or(siblings.len());
            siblings.splice(at..at, moving);
            for (n, &i) in siblings.iter().enumerate() {
                hosts[i].order = n as i64;
            }
            store::save(&self.path, &hosts)?;
        }
        Ok(self.hive())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hosts::{AuthMethod, Protocol, SecretFlags};
    use std::path::PathBuf;

    fn host(id: &str, group: Option<&str>, order: i64) -> Host {
        Host {
            id: id.into(),
            protocol: Protocol::Ssh,
            label: id.into(),
            hostname: "h".into(),
            port: 22,
            username: "u".into(),
            auth: AuthMethod::Password,
            group: group.map(Into::into),
            order,
            tags: vec![],
            color: "honey".into(),
            icon: None,
            notes: None,
            favorite: false,
            saved_secrets: SecretFlags::default(),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            last_connected_at: None,
        }
    }

    fn store_with(hosts: Vec<Host>) -> HostStore {
        let dir: PathBuf =
            std::env::temp_dir().join(format!("termbee-test-{}", uuid::Uuid::new_v4()));
        let s = HostStore::open(dir.join("hosts.json"), dir.join("folders.json")).unwrap();
        *s.hosts.lock().unwrap() = hosts;
        s
    }

    fn group_of(hive: &Hive, id: &str) -> Option<String> {
        hive.hosts
            .iter()
            .find(|h| h.id == id)
            .unwrap()
            .group
            .clone()
    }

    #[test]
    fn normalizes_paths() {
        assert_eq!(normalize(" Prod / EU ").unwrap(), "Prod/EU");
        assert!(normalize("Prod//EU").is_err());
        assert!(normalize("/").is_err());
        assert!(within("A/B", "A") && within("A", "A") && !within("AB", "A"));
    }

    #[test]
    fn hive_lists_ancestors_and_empty_folders() {
        let s = store_with(vec![host("a", Some("Prod/EU"), 0)]);
        let hive = s.create_folder("Lab").unwrap();
        assert_eq!(hive.folders, ["Lab", "Prod", "Prod/EU"]);
    }

    #[test]
    fn moving_a_folder_carries_its_contents() {
        let s = store_with(vec![
            host("a", Some("Prod/EU"), 0),
            host("b", Some("Prod"), 0),
        ]);
        let hive = s.move_folder("Prod", "Archive/Prod").unwrap();
        assert_eq!(group_of(&hive, "a").as_deref(), Some("Archive/Prod/EU"));
        assert_eq!(group_of(&hive, "b").as_deref(), Some("Archive/Prod"));
        assert!(s.move_folder("Archive", "Archive/Prod/Inner").is_err());
    }

    #[test]
    fn deleting_a_folder_moves_contents_up() {
        let s = store_with(vec![
            host("a", Some("Prod/EU/Web"), 0),
            host("b", Some("Prod/EU"), 0),
        ]);
        let hive = s.delete_folder("Prod/EU").unwrap();
        assert_eq!(group_of(&hive, "a").as_deref(), Some("Prod/Web"));
        assert_eq!(group_of(&hive, "b").as_deref(), Some("Prod"));
        let hive = s.delete_folder("Prod").unwrap();
        assert_eq!(group_of(&hive, "a").as_deref(), Some("Web"));
        assert_eq!(group_of(&hive, "b"), None);
    }

    #[test]
    fn hosts_drop_before_a_sibling() {
        let s = store_with(vec![
            host("a", None, 0),
            host("b", None, 1),
            host("c", Some("X"), 0),
        ]);
        let hive = s.move_hosts(&["c".into()], None, Some("b")).unwrap();
        let mut top: Vec<_> = hive.hosts.iter().filter(|h| h.group.is_none()).collect();
        top.sort_by_key(|h| h.order);
        assert_eq!(
            top.iter().map(|h| h.id.as_str()).collect::<Vec<_>>(),
            ["a", "c", "b"]
        );
    }
}
