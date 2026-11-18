//! XML export and import for the Hive (hosts, folders, trusted host keys, and optional
//! keychain secrets), with duplicate/conflict detection and resolution (`skip`, `replace`,
//! or `keepBoth`).

use super::{folders, AuthMethod, Hive, Host, HostInput, HostStore, Protocol, SecretUpdate};
use crate::{
    error::{AppError, AppResult},
    secrets::{self, SecretKind},
    ssh::known_hosts::KnownHosts,
    store,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    fs,
    io::Write,
    path::Path,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConflictReason {
    #[serde(rename = "sameId")]
    Id,
    #[serde(rename = "sameAddress")]
    Address,
    #[serde(rename = "sameName")]
    Name,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictResolution {
    Skip,
    Replace,
    KeepBoth,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportHostSummary {
    pub id: String,
    pub protocol: Protocol,
    pub label: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub auth_type: &'static str,
    pub key_path: Option<String>,
    pub group: Option<String>,
    pub tags: Vec<String>,
    pub color: String,
    pub icon: Option<String>,
    pub favorite: bool,
    pub has_password: bool,
    pub has_passphrase: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportConflict {
    pub incoming_id: String,
    pub reason: ConflictReason,
    pub incoming: ImportHostSummary,
    pub existing: ImportHostSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub path: String,
    pub total_hosts: usize,
    pub new_hosts: Vec<ImportHostSummary>,
    pub conflicts: Vec<ImportConflict>,
    pub folders_count: usize,
    pub known_hosts_count: usize,
    pub includes_secrets: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub hosts_count: usize,
    pub folders_count: usize,
    pub known_hosts_count: usize,
    pub included_secrets: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub hive: Hive,
    pub added: usize,
    pub replaced: usize,
    pub skipped: usize,
}

#[derive(Debug, Clone)]
struct ParsedHost {
    id: String,
    protocol: Protocol,
    label: String,
    hostname: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    group: Option<String>,
    tags: Vec<String>,
    color: String,
    icon: Option<String>,
    notes: Option<String>,
    favorite: bool,
    password: Option<String>,
    passphrase: Option<String>,
    has_saved_password: bool,
    has_saved_passphrase: bool,
}

#[derive(Debug, Clone)]
struct ParsedKnownHost {
    hostname: String,
    port: u16,
    key: String,
}

#[derive(Debug, Clone)]
struct ParsedBundle {
    includes_secrets: bool,
    folders: Vec<String>,
    hosts: Vec<ParsedHost>,
    known_hosts: Vec<ParsedKnownHost>,
}

fn summarize_existing(h: &Host) -> ImportHostSummary {
    let (auth_type, key_path) = match &h.auth {
        AuthMethod::Password => ("password", None),
        AuthMethod::Key { key_path } => ("key", Some(key_path.clone())),
    };
    ImportHostSummary {
        id: h.id.clone(),
        protocol: h.protocol,
        label: h.label.clone(),
        hostname: h.hostname.clone(),
        port: h.port,
        username: h.username.clone(),
        auth_type,
        key_path,
        group: h.group.clone(),
        tags: h.tags.clone(),
        color: h.color.clone(),
        icon: h.icon.clone(),
        favorite: h.favorite,
        has_password: h.saved_secrets.password,
        has_passphrase: h.saved_secrets.passphrase,
    }
}

fn summarize_parsed(h: &ParsedHost) -> ImportHostSummary {
    let (auth_type, key_path) = match &h.auth {
        AuthMethod::Password => ("password", None),
        AuthMethod::Key { key_path } => ("key", Some(key_path.clone())),
    };
    ImportHostSummary {
        id: h.id.clone(),
        protocol: h.protocol,
        label: h.label.clone(),
        hostname: h.hostname.clone(),
        port: h.port,
        username: h.username.clone(),
        auth_type,
        key_path,
        group: h.group.clone(),
        tags: h.tags.clone(),
        color: h.color.clone(),
        icon: h.icon.clone(),
        favorite: h.favorite,
        has_password: h.password.is_some() || h.has_saved_password,
        has_passphrase: h.passphrase.is_some() || h.has_saved_passphrase,
    }
}

/// Finds whether `incoming` conflicts with any existing host not yet matched.
fn find_conflict<'a>(
    incoming: &ParsedHost,
    existing: &'a [Host],
    used_existing_ids: &HashSet<String>,
) -> Option<(&'a Host, ConflictReason)> {
    let available = || {
        existing
            .iter()
            .filter(|e| !used_existing_ids.contains(&e.id))
    };

    if let Some(h) = available().find(|e| e.id == incoming.id) {
        return Some((h, ConflictReason::Id));
    }
    if let Some(h) = available().find(|e| {
        e.protocol == incoming.protocol
            && e.hostname.eq_ignore_ascii_case(&incoming.hostname)
            && e.port == incoming.port
            && e.username == incoming.username
    }) {
        return Some((h, ConflictReason::Address));
    }
    if let Some(h) = available()
        .find(|e| e.group == incoming.group && e.label.eq_ignore_ascii_case(&incoming.label))
    {
        return Some((h, ConflictReason::Name));
    }
    None
}

pub fn export_xml(
    store: &HostStore,
    known_hosts: &KnownHosts,
    path: &Path,
    include_secrets: bool,
) -> AppResult<ExportResult> {
    let hive = store.hive();
    let kh_list = known_hosts.list();

    let mut xml = String::with_capacity(4096);
    xml.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str(&format!(
        "<termbee version=\"1\" exportedAt=\"{}\" includesSecrets=\"{}\">\n",
        Utc::now().to_rfc3339(),
        include_secrets
    ));

    xml.push_str("  <folders>\n");
    for f in &hive.folders {
        xml.push_str(&format!("    <folder path=\"{}\" />\n", escape_xml(f)));
    }
    xml.push_str("  </folders>\n");

    xml.push_str("  <hosts>\n");
    for h in &hive.hosts {
        let proto = match h.protocol {
            Protocol::Ssh => "ssh",
            Protocol::Sftp => "sftp",
            Protocol::Rdp => "rdp",
        };
        let pwd = if include_secrets && h.saved_secrets.password {
            secrets::get(&h.id, SecretKind::Password)?
        } else {
            None
        };
        let pass = if include_secrets && h.saved_secrets.passphrase {
            secrets::get(&h.id, SecretKind::Passphrase)?
        } else {
            None
        };

        xml.push_str(&format!(
            "    <host id=\"{}\" protocol=\"{}\" favorite=\"{}\" color=\"{}\"{}\n      savedPassword=\"{}\" savedPassphrase=\"{}\">\n",
            escape_xml(&h.id),
            proto,
            h.favorite,
            escape_xml(&h.color),
            h.icon
                .as_ref()
                .map(|ic| format!(" icon=\"{}\"", escape_xml(ic)))
                .unwrap_or_default(),
            h.saved_secrets.password,
            h.saved_secrets.passphrase,
        ));
        xml.push_str(&format!("      <label>{}</label>\n", escape_xml(&h.label)));
        xml.push_str(&format!(
            "      <hostname>{}</hostname>\n",
            escape_xml(&h.hostname)
        ));
        xml.push_str(&format!("      <port>{}</port>\n", h.port));
        xml.push_str(&format!(
            "      <username>{}</username>\n",
            escape_xml(&h.username)
        ));
        if let Some(group) = &h.group {
            xml.push_str(&format!("      <group>{}</group>\n", escape_xml(group)));
        }
        match &h.auth {
            AuthMethod::Password => {
                xml.push_str("      <auth type=\"password\" />\n");
            }
            AuthMethod::Key { key_path } => {
                xml.push_str(&format!(
                    "      <auth type=\"key\" keyPath=\"{}\" />\n",
                    escape_xml(key_path)
                ));
            }
        }
        if !h.tags.is_empty() {
            xml.push_str("      <tags>\n");
            for t in &h.tags {
                xml.push_str(&format!("        <tag>{}</tag>\n", escape_xml(t)));
            }
            xml.push_str("      </tags>\n");
        }
        if let Some(notes) = &h.notes {
            xml.push_str(&format!("      <notes>{}</notes>\n", escape_xml(notes)));
        }
        if pwd.is_some() || pass.is_some() {
            xml.push_str("      <secrets>\n");
            if let Some(p) = pwd {
                xml.push_str(&format!(
                    "        <password>{}</password>\n",
                    escape_xml(&p)
                ));
            }
            if let Some(p) = pass {
                xml.push_str(&format!(
                    "        <passphrase>{}</passphrase>\n",
                    escape_xml(&p)
                ));
            }
            xml.push_str("      </secrets>\n");
        }
        xml.push_str("    </host>\n");
    }
    xml.push_str("  </hosts>\n");

    xml.push_str("  <knownHosts>\n");
    for kh in &kh_list {
        xml.push_str(&format!(
            "    <knownHost hostname=\"{}\" port=\"{}\" algorithm=\"{}\" fingerprint=\"{}\">\n",
            escape_xml(&kh.hostname),
            kh.port,
            escape_xml(&kh.algorithm),
            escape_xml(&kh.fingerprint)
        ));
        xml.push_str(&format!("      <key>{}</key>\n", escape_xml(&kh.key)));
        xml.push_str("    </knownHost>\n");
    }
    xml.push_str("  </knownHosts>\n");
    xml.push_str("</termbee>\n");

    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(".termbee-export-{}.tmp", uuid::Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary)?;
    let written = file.write_all(xml.as_bytes());
    drop(file);
    if let Err(error) = written.and_then(|()| fs::rename(&temporary, path)) {
        let _ = fs::remove_file(&temporary);
        return Err(error.into());
    }

    Ok(ExportResult {
        path: path.to_string_lossy().into_owned(),
        hosts_count: hive.hosts.len(),
        folders_count: hive.folders.len(),
        known_hosts_count: kh_list.len(),
        included_secrets: include_secrets,
    })
}

pub fn import_preview(store: &HostStore, path: &Path) -> AppResult<ImportPreview> {
    let raw = fs::read_to_string(path)?;
    let bundle = parse_xml(&raw)?;
    let existing = store.list();

    let mut used_existing_ids = HashSet::new();
    let mut new_hosts = Vec::new();
    let mut conflicts = Vec::new();

    for incoming in &bundle.hosts {
        if let Some((ex, reason)) = find_conflict(incoming, &existing, &used_existing_ids) {
            used_existing_ids.insert(ex.id.clone());
            conflicts.push(ImportConflict {
                incoming_id: incoming.id.clone(),
                reason,
                incoming: summarize_parsed(incoming),
                existing: summarize_existing(ex),
            });
        } else {
            new_hosts.push(summarize_parsed(incoming));
        }
    }

    Ok(ImportPreview {
        path: path.to_string_lossy().into_owned(),
        total_hosts: bundle.hosts.len(),
        new_hosts,
        conflicts,
        folders_count: bundle.folders.len(),
        known_hosts_count: bundle.known_hosts.len(),
        includes_secrets: bundle.includes_secrets,
    })
}

pub fn import_apply(
    store: &HostStore,
    known_hosts: &KnownHosts,
    path: &Path,
    resolutions: &HashMap<String, ConflictResolution>,
) -> AppResult<ImportResult> {
    let raw = fs::read_to_string(path)?;
    let bundle = parse_xml(&raw)?;

    for host in &bundle.hosts {
        to_host_input(host, None, host.label.clone()).validate()?;
    }

    // 1. Merge folders
    {
        let mut folders_guard = store.folders.lock().unwrap();
        let mut set: BTreeSet<String> = folders_guard.iter().cloned().collect();
        for f in &bundle.folders {
            if let Ok(norm) = folders::normalize(f) {
                set.insert(norm);
            }
        }
        let merged: Vec<String> = set.into_iter().collect();
        store::save(&store.folders_path, &merged)?;
        *folders_guard = merged;
    }

    // 2. Merge known_hosts (only add keys for hosts that aren't already trusted with a different key)
    for kh in &bundle.known_hosts {
        if let Ok(pub_key) = russh::keys::PublicKey::from_openssh(&kh.key) {
            if matches!(
                known_hosts.check(&kh.hostname, kh.port, &pub_key),
                crate::ssh::known_hosts::Verdict::Unknown
            ) {
                let _ = known_hosts.trust(&kh.hostname, kh.port, &pub_key);
            }
        }
    }

    // 3. Process hosts according to conflict resolutions
    let existing = store.list();
    let mut used_existing_ids = HashSet::new();
    let mut added = 0usize;
    let mut replaced = 0usize;
    let mut skipped = 0usize;

    for incoming in bundle.hosts {
        if let Some((ex, _reason)) = find_conflict(&incoming, &existing, &used_existing_ids) {
            used_existing_ids.insert(ex.id.clone());
            let action = resolutions
                .get(&incoming.id)
                .copied()
                .unwrap_or(ConflictResolution::Skip);

            match action {
                ConflictResolution::Skip => {
                    skipped += 1;
                }
                ConflictResolution::Replace => {
                    let mut input =
                        to_host_input(&incoming, Some(ex.id.clone()), incoming.label.clone());
                    if ex.protocol != incoming.protocol
                        || !ex.hostname.eq_ignore_ascii_case(&incoming.hostname)
                        || ex.port != incoming.port
                        || ex.username != incoming.username
                        || ex.auth != incoming.auth
                    {
                        if matches!(input.password, SecretUpdate::Keep) && ex.saved_secrets.password
                        {
                            input.password = SecretUpdate::Clear;
                        }
                        if matches!(input.passphrase, SecretUpdate::Keep)
                            && ex.saved_secrets.passphrase
                        {
                            input.passphrase = SecretUpdate::Clear;
                        }
                    }
                    store.save(input)?;
                    replaced += 1;
                }
                ConflictResolution::KeepBoth => {
                    let label = if ex.group == incoming.group
                        && ex.label.eq_ignore_ascii_case(&incoming.label)
                    {
                        format!("{} (imported)", incoming.label)
                    } else {
                        incoming.label.clone()
                    };
                    let input = to_host_input(&incoming, None, label);
                    store.save(input)?;
                    added += 1;
                }
            }
        } else {
            let input = to_host_input(&incoming, None, incoming.label.clone());
            store.save(input)?;
            added += 1;
        }
    }

    Ok(ImportResult {
        hive: store.hive(),
        added,
        replaced,
        skipped,
    })
}

fn to_host_input(h: &ParsedHost, id: Option<String>, label: String) -> HostInput {
    HostInput {
        id,
        protocol: h.protocol,
        label,
        hostname: h.hostname.clone(),
        port: h.port,
        username: h.username.clone(),
        auth: h.auth.clone(),
        group: h.group.clone(),
        tags: h.tags.clone(),
        color: h.color.clone(),
        icon: h.icon.clone(),
        notes: h.notes.clone(),
        favorite: h.favorite,
        password: match &h.password {
            Some(v) if !v.is_empty() => SecretUpdate::Set { value: v.clone() },
            _ => SecretUpdate::Keep,
        },
        passphrase: match &h.passphrase {
            Some(v) if !v.is_empty() => SecretUpdate::Set { value: v.clone() },
            _ => SecretUpdate::Keep,
        },
    }
}

fn escape_xml(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

fn unescape_xml(s: &str) -> String {
    s.replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn attr_value(tag_open: &str, name: &str) -> Option<String> {
    let pattern = format!("{name}=\"");
    let mut search_from = 0;
    while let Some(rel) = tag_open[search_from..].find(&pattern) {
        let idx = search_from + rel;
        let valid_boundary = idx == 0
            || tag_open[..idx]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_whitespace());
        if valid_boundary {
            let val_start = idx + pattern.len();
            let val_end = tag_open[val_start..].find('"')? + val_start;
            return Some(unescape_xml(&tag_open[val_start..val_end]));
        }
        search_from = idx + pattern.len();
    }
    None
}

fn child_text(block: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = block.find(&open)? + open.len();
    let end = block[start..].find(&close)? + start;
    Some(unescape_xml(&block[start..end]))
}

fn parse_xml(raw: &str) -> AppResult<ParsedBundle> {
    let trimmed = raw.trim();
    let root_idx = trimmed
        .find("<termbee")
        .ok_or_else(|| AppError::Invalid("This file is not a valid TermBee XML export.".into()))?;
    let root_open_end = trimmed[root_idx..]
        .find('>')
        .ok_or_else(|| AppError::Invalid("Malformed <termbee> root tag in XML file.".into()))?
        + root_idx;
    let root_open = &trimmed[root_idx..=root_open_end];
    if !root_open.starts_with("<termbee ")
        || attr_value(root_open, "version").as_deref() != Some("1")
        || !trimmed.ends_with("</termbee>")
    {
        return Err(AppError::Invalid(
            "Unsupported or incomplete TermBee XML export.".into(),
        ));
    }

    // Parse folders
    let mut folders = Vec::new();
    if let (Some(f_start), Some(f_end)) = (trimmed.find("<folders>"), trimmed.find("</folders>")) {
        if f_start < f_end {
            let section = &trimmed[f_start..f_end];
            let mut pos = 0;
            while let Some(rel) = section[pos..].find("<folder ") {
                let start = pos + rel;
                let Some(end_rel) = section[start..].find('>') else {
                    break;
                };
                let tag = &section[start..=start + end_rel];
                if let Some(p) = attr_value(tag, "path") {
                    if let Ok(norm) = folders::normalize(&p) {
                        folders.push(norm);
                    }
                }
                pos = start + end_rel + 1;
            }
        }
    }

    // Parse hosts
    let mut hosts = Vec::new();
    if let (Some(h_start), Some(h_end)) = (trimmed.find("<hosts>"), trimmed.find("</hosts>")) {
        if h_start < h_end {
            let section = &trimmed[h_start..h_end];
            let mut pos = 0;
            while let Some(rel) = section[pos..].find("<host ") {
                let start = pos + rel;
                let open_end = section[start..].find('>').ok_or_else(|| {
                    AppError::Invalid("Malformed <host> opening tag in XML file.".into())
                })? + start;
                let close_idx = section[open_end..].find("</host>").ok_or_else(|| {
                    AppError::Invalid("Missing closing </host> tag in XML file.".into())
                })? + open_end;

                let open_tag = &section[start..=open_end];
                let body = &section[open_end + 1..close_idx];
                hosts.push(parse_host(open_tag, body, hosts.len())?);
                pos = close_idx + "</host>".len();
            }
        }
    }

    let mut ids = HashSet::new();
    if hosts.iter().any(|host| !ids.insert(&host.id)) {
        return Err(AppError::Invalid(
            "The XML export contains duplicate host IDs.".into(),
        ));
    }
    let includes_secrets = hosts
        .iter()
        .any(|host| host.password.is_some() || host.passphrase.is_some());

    // Parse knownHosts
    let mut known_hosts = Vec::new();
    if let (Some(k_start), Some(k_end)) =
        (trimmed.find("<knownHosts>"), trimmed.find("</knownHosts>"))
    {
        if k_start < k_end {
            let section = &trimmed[k_start..k_end];
            let mut pos = 0;
            while let Some(rel) = section[pos..].find("<knownHost ") {
                let start = pos + rel;
                let Some(open_end_rel) = section[start..].find('>') else {
                    break;
                };
                let open_end = start + open_end_rel;
                let Some(close_rel) = section[open_end..].find("</knownHost>") else {
                    break;
                };
                let close_idx = open_end + close_rel;
                let open_tag = &section[start..=open_end];
                let body = &section[open_end + 1..close_idx];

                if let (Some(hostname), Some(port_s), Some(key)) = (
                    attr_value(open_tag, "hostname"),
                    attr_value(open_tag, "port"),
                    child_text(body, "key"),
                ) {
                    if let Ok(port) = port_s.parse::<u16>() {
                        known_hosts.push(ParsedKnownHost {
                            hostname,
                            port,
                            key,
                        });
                    }
                }
                pos = close_idx + "</knownHost>".len();
            }
        }
    }

    Ok(ParsedBundle {
        includes_secrets,
        folders,
        hosts,
        known_hosts,
    })
}

fn parse_host(open_tag: &str, body: &str, index: usize) -> AppResult<ParsedHost> {
    let id = attr_value(open_tag, "id")
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("imported-{index}"));
    let protocol = match attr_value(open_tag, "protocol")
        .unwrap_or_else(|| "ssh".into())
        .to_ascii_lowercase()
        .as_str()
    {
        "sftp" => Protocol::Sftp,
        "rdp" => Protocol::Rdp,
        _ => Protocol::Ssh,
    };
    let favorite = attr_value(open_tag, "favorite").is_some_and(|v| v == "true");
    let color = attr_value(open_tag, "color").unwrap_or_else(|| "honey".into());
    let icon = attr_value(open_tag, "icon").filter(|s| !s.trim().is_empty());
    let has_saved_password = attr_value(open_tag, "savedPassword").is_some_and(|v| v == "true");
    let has_saved_passphrase = attr_value(open_tag, "savedPassphrase").is_some_and(|v| v == "true");

    let hostname = child_text(body, "hostname")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Invalid(format!("Host #{}: missing <hostname>.", index + 1)))?;
    let label = child_text(body, "label")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| hostname.clone());
    let default_port = if protocol == Protocol::Rdp { 3389 } else { 22 };
    let port = child_text(body, "port")
        .and_then(|s| s.trim().parse::<u16>().ok())
        .filter(|&p| p > 0)
        .unwrap_or(default_port);
    let username = child_text(body, "username")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Invalid(format!("Host “{label}”: missing <username>.")))?;
    let group = match child_text(body, "group") {
        Some(g) => folders::normalize_opt(Some(&g))?,
        None => None,
    };

    let auth = if let Some(auth_idx) = body.find("<auth ") {
        let auth_end = body[auth_idx..]
            .find('>')
            .map(|e| auth_idx + e)
            .unwrap_or(body.len() - 1);
        let auth_tag = &body[auth_idx..=auth_end];
        let kind = attr_value(auth_tag, "type").unwrap_or_else(|| "password".into());
        if kind == "key" && protocol != Protocol::Rdp {
            let key_path = attr_value(auth_tag, "keyPath")
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "~/.ssh/id_ed25519".into());
            AuthMethod::Key { key_path }
        } else {
            AuthMethod::Password
        }
    } else {
        AuthMethod::Password
    };

    let mut tags = Vec::new();
    if let (Some(t_start), Some(t_end)) = (body.find("<tags>"), body.find("</tags>")) {
        if t_start < t_end {
            let t_sec = &body[t_start..t_end];
            let mut pos = 0;
            while let Some(rel) = t_sec[pos..].find("<tag>") {
                let s = pos + rel + "<tag>".len();
                let Some(e_rel) = t_sec[s..].find("</tag>") else {
                    break;
                };
                let tag_val = unescape_xml(&t_sec[s..s + e_rel]).trim().to_string();
                if !tag_val.is_empty() {
                    tags.push(tag_val);
                }
                pos = s + e_rel + "</tag>".len();
            }
        }
    }

    let notes = child_text(body, "notes")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let (password, passphrase) =
        if let (Some(s_start), Some(s_end)) = (body.find("<secrets>"), body.find("</secrets>")) {
            if s_start < s_end {
                let s_sec = &body[s_start..s_end];
                (
                    child_text(s_sec, "password").filter(|s| !s.is_empty()),
                    child_text(s_sec, "passphrase").filter(|s| !s.is_empty()),
                )
            } else {
                (None, None)
            }
        } else {
            (None, None)
        };

    Ok(ParsedHost {
        id,
        protocol,
        label,
        hostname,
        port,
        username,
        auth,
        group,
        tags,
        color,
        icon,
        notes,
        favorite,
        password,
        passphrase,
        has_saved_password,
        has_saved_passphrase,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn test_env() -> (PathBuf, HostStore, KnownHosts) {
        let dir = std::env::temp_dir().join(format!("termbee-xml-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let store = HostStore::open(dir.join("hosts.json"), dir.join("folders.json")).unwrap();
        let kh = KnownHosts::open(dir.join("known_hosts.json")).unwrap();
        (dir, store, kh)
    }

    #[test]
    fn roundtrips_xml_and_resolves_conflicts() {
        let (dir, store, kh) = test_env();
        store.create_folder("Production/EU").unwrap();
        let h1 = store
            .save(HostInput {
                id: None,
                protocol: Protocol::Ssh,
                label: "prod-api & <main>".into(),
                hostname: "10.0.0.10".into(),
                port: 22,
                username: "deploy".into(),
                auth: AuthMethod::Key {
                    key_path: "~/.ssh/id_ed25519".into(),
                },
                group: Some("Production/EU".into()),
                tags: vec!["ubuntu".into(), "api".into()],
                color: "honey".into(),
                icon: Some("server".into()),
                notes: Some("Line 1 & <tag>".into()),
                favorite: true,
                password: SecretUpdate::Keep,
                passphrase: SecretUpdate::Keep,
            })
            .unwrap();

        let xml_path = dir.join("backup.xml");
        let exp = export_xml(&store, &kh, &xml_path, false).unwrap();
        assert_eq!(exp.hosts_count, 1);

        // Preview against the same store should detect 1 conflict (SameId).
        let preview = import_preview(&store, &xml_path).unwrap();
        assert_eq!(preview.total_hosts, 1);
        assert_eq!(preview.conflicts.len(), 1);
        assert_eq!(preview.conflicts[0].reason, ConflictReason::Id);

        // Apply with KeepBoth -> creates a second host with "(imported)" suffix.
        let mut resolutions = HashMap::new();
        resolutions.insert(h1.id.clone(), ConflictResolution::KeepBoth);
        let res = import_apply(&store, &kh, &xml_path, &resolutions).unwrap();
        assert_eq!(res.added, 1);
        assert_eq!(res.hive.hosts.len(), 2);
        assert!(res
            .hive
            .hosts
            .iter()
            .any(|h| h.label == "prod-api & <main> (imported)"));
    }
}
