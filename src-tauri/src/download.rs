//! Download sob demanda do modelo de remoção de fundo (backlog B4).
//!
//! O modelo (isnet-general-use.onnx, ~170 MB) NÃO vai no instalador: baixa na
//! primeira vez que o usuário pede, do espelho da suíte (Local-runtimes). A
//! URL e o sha256 esperados moram no FRONT (`src/lib/bgremove.ts`) — o Rust
//! daqui só executa: baixa pra um `.tmp`, confere o hash e renomeia. Hash
//! errado = erro nomeado e NENHUM arquivo no caminho final; o rename atômico
//! garante que `model_path()` nunca vê um download pela metade.
//!
//! O arquivo chega ao webview pelo asset protocol (`convertFileSrc`), não por
//! base64 — 170 MB virariam ~230 MB de string pelo invoke. Só a pasta de
//! modelos entra no escopo (`allow_models_dir`, chamada no setup), seguindo o
//! padrão do `allow_thumbs_dir` do LocalVideo: escopo mínimo, nunca `$APPDATA/**`.

use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};

/// Nome fixo: um modelo só. Se um dia houver mais, o comando ganha o nome por
/// parâmetro — hoje seria generalidade sem cliente.
const MODEL_FILE: &str = "isnet-general-use.onnx";

/// Pasta dos modelos dentro do app_data do PRÓPRIO app (não da suíte toda).
fn models_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("models"))
}

/// Entra com a pasta de modelos no escopo do asset protocol. Chamada no setup;
/// criar ANTES de liberar (lição do LocalVideo: `allow_directory` canonicaliza
/// o que existe — pasta que ainda não nasceu entraria na forma não-canônica,
/// que é a que o `is_allowed` não compara no Windows).
pub fn allow_models_dir(app: &tauri::AppHandle) -> Result<(), String> {
    let dir = models_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("criar {}: {e}", dir.display()))?;
    app.asset_protocol_scope()
        .allow_directory(&dir, false)
        .map_err(|e| format!("escopo: {e}"))
}

/// Caminho do modelo se ele JÁ está no disco (baixado numa sessão anterior).
/// `None` manda o front pro fluxo de download — nunca é erro.
#[tauri::command]
pub fn model_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let p = models_dir(&app)?.join(MODEL_FILE);
    Ok(p.is_file().then(|| p.to_string_lossy().into_owned()))
}

#[derive(Clone, serde::Serialize)]
struct Progress {
    got: u64,
    total: Option<u64>,
}

/// Baixa o modelo, confere o sha256 e só então o coloca no caminho final.
/// Progresso sai pelo evento `model-progress` ({got, total}); o total é o
/// content-length quando o servidor informa.
#[tauri::command]
pub async fn model_fetch(app: tauri::AppHandle, url: String, sha256: String) -> Result<String, String> {
    let dir = models_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("criar {}: {e}", dir.display()))?;
    let dest = dir.join(MODEL_FILE);
    let tmp = dir.join(format!("{MODEL_FILE}.tmp"));

    let resp = reqwest::get(&url).await.map_err(|e| format!("rede: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("http {}", resp.status().as_u16()));
    }
    let total = resp.content_length();

    // Escreve em .tmp e calcula o hash NO CAMINHO — sem segunda leitura do
    // disco no fim, e o arquivo final só existe depois do hash conferir.
    let mut file = std::fs::File::create(&tmp).map_err(|e| format!("criar {}: {e}", tmp.display()))?;
    let mut hasher = Sha256::new();
    let mut got: u64 = 0;
    let mut last_emit: u64 = 0;

    let mut resp = resp;
    let write_err = loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                use std::io::Write;
                if let Err(e) = file.write_all(&chunk) {
                    break Some(format!("gravar: {e}"));
                }
                hasher.update(&chunk);
                got += chunk.len() as u64;
                // Emite a cada ~1 MB (por chunk seria spam de evento).
                if got - last_emit >= 1_048_576 {
                    last_emit = got;
                    let _ = app.emit("model-progress", Progress { got, total });
                }
            }
            Ok(None) => break None,
            Err(e) => break Some(format!("rede: {e}")),
        }
    };
    drop(file);
    if let Some(e) = write_err {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    let _ = app.emit("model-progress", Progress { got, total });

    let digest = format!("{:x}", hasher.finalize());
    if !digest.eq_ignore_ascii_case(sha256.trim()) {
        // Hash errado = download corrompido ou espelho adulterado. O erro é
        // NOMEADO (o front mostra) e o .tmp sai do disco — não fica isca pra
        // alguém renomear na mão.
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("sha256 não confere (esperado {sha256}, veio {digest})"));
    }

    std::fs::rename(&tmp, &dest).map_err(|e| format!("renomear: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}
