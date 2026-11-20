use std::path::Path;

use super::{Files, STANDARD};
use anyhow::{Context, Result};
use base64::Engine;
use serde_json::json;
use sqlx::SqlitePool;
use std::collections::BTreeMap;
use tokio::fs;

use crate::db::sessions::Session;

pub struct Launch {
    pub flags: Vec<String>,
    pub snapshot: String,
}

/// Called with the session lifecycle lock held. Only the selected packages ever
/// reach this session's private, read-only directory, including on revocation.
pub async fn prepare(pool: &SqlitePool, data: &Path, session: &Session) -> Result<Launch> {
    let company = session.company_id.map(|id| format!("@company:{id}"));
    let packages: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT name, description, files, revision FROM skill_packages p
         WHERE EXISTS(SELECT 1 FROM skill_grants g WHERE g.skill=p.name AND enabled AND target IN (?,?,'*')) ORDER BY name")
        .bind(&session.name).bind(company).fetch_all(pool).await?;
    let parent = data.join("session-config").join(&session.name);
    if session.company_id.is_some() {
        // Confinement binds this parent when the shell starts. A later grant
        // must also be visible when the agent is started in that same shell.
        fs::create_dir_all(&parent).await?;
    }
    let root = parent.join("agent-skills");
    if packages.is_empty() {
        remove_if_present(&root).await?;
        return Ok(Launch {
            flags: vec![],
            snapshot: "{}".into(),
        });
    }
    let stage = parent.join(format!(".skills-{}", uuid::Uuid::new_v4()));
    let result = materialize(&stage, &root, &packages, &session.provider).await;
    if result.is_err() {
        let _ = fs::remove_dir_all(&stage).await;
    }
    result
}

async fn remove_if_present(dir: &Path) -> Result<()> {
    match fs::remove_dir_all(dir).await {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        r => Ok(r?),
    }
}

async fn materialize(
    stage: &Path,
    root: &Path,
    packages: &[(String, String, String, String)],
    provider: &str,
) -> Result<Launch> {
    let skills = stage.join(".claude/skills");
    let mut catalog = BTreeMap::new();
    let mut versions = BTreeMap::new();
    for (name, description, encoded, revision) in packages {
        let files: Files = serde_json::from_str(encoded)?;
        super::validate(name, &files).context("Invalid stored skill")?;
        let folder = skills.join(name);
        for (path, content) in &files {
            let file = folder.join(path);
            fs::create_dir_all(file.parent().context("Missing parent")?).await?;
            fs::write(file, STANDARD.decode(content)?).await?;
        }
        catalog.insert(
            name,
            json!({"description":description, "files":files.keys().collect::<Vec<_>>()}),
        );
        versions.insert(name, revision);
    }
    let flags = if provider == "codex" {
        fs::write(stage.join("catalog.json"), serde_json::to_vec(&catalog)?).await?;
        fs::write(stage.join("skills.py"), include_bytes!("skills.py")).await?;
        let script = serde_json::to_string(&root.join("skills.py"))?;
        vec![
            "-c".into(),
            format!("mcp_servers.supermux_skills={{command=\"python3\",args=[{script}]}}"),
        ]
    } else {
        vec!["--add-dir".into(), root.to_string_lossy().into_owned()]
    };
    // The previous agent has exited. A failed swap aborts this launch. A
    // retry recreates the entire snapshot from the committed database rows.
    remove_if_present(root).await?;
    fs::rename(stage, root).await?;
    Ok(Launch {
        flags,
        snapshot: serde_json::to_string(&versions)?,
    })
}

pub async fn record(pool: &SqlitePool, session: &str, launch: &Launch) -> Result<()> {
    if launch.snapshot == "{}" {
        sqlx::query("DELETE FROM skill_launches WHERE session=?")
            .bind(session)
            .execute(pool)
            .await?;
    } else {
        sqlx::query("INSERT INTO skill_launches VALUES(?,?) ON CONFLICT(session) DO UPDATE SET snapshot=excluded.snapshot")
            .bind(session).bind(&launch.snapshot).execute(pool).await?;
    }
    Ok(())
}
