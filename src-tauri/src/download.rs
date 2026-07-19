//! Download sob demanda dos modelos de IA local (backlog B4 + fatia ⑤).
//!
//! Os modelos (isnet ~170 MB pra remoção de fundo, lama_fp32 ~208 MB pro
//! inpainting) NÃO vão no instalador: baixam na primeira vez que o usuário
//! pede, do espelho da suíte (Local-runtimes). A URL, o sha256 e o NOME DO
//! ARQUIVO moram no FRONT (`src/lib/bgremove.ts`, `src/lib/removeobj.ts`) — o
//! Rust daqui só executa: baixa pra um `.tmp`, confere o hash e renomeia. Hash
//! errado = erro nomeado e NENHUM arquivo no caminho final; o rename atômico
//! garante que `model_path()` nunca vê um download pela metade.
//!
//! O arquivo chega ao webview pelo asset protocol (`convertFileSrc`), não por
//! base64 — 208 MB virariam ~280 MB de string pelo invoke. Só a pasta de
//! modelos entra no escopo (`allow_models_dir`, chamada no setup), seguindo o
//! padrão do `allow_thumbs_dir` do LocalVideo: escopo mínimo, nunca `$APPDATA/**`.
//!
//! O nome do arquivo virou PARÂMETRO na fatia ⑤ (antes era uma const: havia um
//! modelo só). Como ele agora vem do front e é concatenado num caminho,
//! `safe_name` o valida — não porque o front seja hostil, mas porque um bug de
//! digitação lá não pode virar escrita fora da pasta de modelos aqui.

use std::sync::atomic::{AtomicBool, Ordering};

use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};

/// Pedido de cancelamento do download em curso. Global porque a UI só permite
/// UM download por vez (os dois modais bloqueiam enquanto baixam); o flag é
/// zerado no início de cada `model_fetch`, então um cancel atrasado da rodada
/// anterior não mata a próxima.
static CANCEL: AtomicBool = AtomicBool::new(false);

/// Aceita só nome de arquivo simples e com extensão `.onnx`. Barra, `..` e
/// raiz ficam de fora — o caminho final não pode escapar da pasta de modelos.
fn safe_name(file: &str) -> Result<&str, String> {
    let ok = !file.is_empty()
        && file.ends_with(".onnx")
        && file
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
        && !file.contains("..");
    if ok {
        Ok(file)
    } else {
        Err(format!("nome de modelo inválido: {file}"))
    }
}

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
pub fn model_path(app: tauri::AppHandle, file: String) -> Result<Option<String>, String> {
    let p = models_dir(&app)?.join(safe_name(&file)?);
    Ok(p.is_file().then(|| p.to_string_lossy().into_owned()))
}

/// Pede o cancelamento do download em curso (botão Cancelar dos modais). O
/// laço de `model_fetch` percebe no próximo chunk, apaga o `.tmp` e devolve
/// erro `cancelado` — que o front trata como fechar, não como falha.
#[tauri::command]
pub fn model_cancel() {
    CANCEL.store(true, Ordering::Relaxed);
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
pub async fn model_fetch(
    app: tauri::AppHandle,
    url: String,
    sha256: String,
    file: String,
) -> Result<String, String> {
    let name = safe_name(&file)?;
    let dir = models_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("criar {}: {e}", dir.display()))?;
    let dest = dir.join(name);
    let tmp = dir.join(format!("{name}.tmp"));
    // Zera aqui (não no cancel): um Cancelar clicado DEPOIS do fim da rodada
    // anterior não pode abortar a próxima antes dela começar.
    CANCEL.store(false, Ordering::Relaxed);

    let resp = reqwest::get(&url).await.map_err(|e| format!("rede: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("http {}", resp.status().as_u16()));
    }
    let total = resp.content_length();

    // Escreve em .tmp e calcula o hash NO CAMINHO — sem segunda leitura do
    // disco no fim, e o arquivo final só existe depois do hash conferir.
    // `out`, não `file`: o parâmetro `file` (o nome do modelo) segue vivo e
    // emprestado por `name` — sombrear os dois seria confusão gratuita.
    let mut out = std::fs::File::create(&tmp).map_err(|e| format!("criar {}: {e}", tmp.display()))?;
    let mut hasher = Sha256::new();
    let mut got: u64 = 0;
    let mut last_emit: u64 = 0;

    let mut resp = resp;
    let write_err = loop {
        if CANCEL.load(Ordering::Relaxed) {
            break Some("cancelado".to_string());
        }
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                use std::io::Write;
                if let Err(e) = out.write_all(&chunk) {
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
    drop(out);
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

#[cfg(test)]
mod tests {
    use super::safe_name;

    #[test]
    fn aceita_nome_de_modelo_simples() {
        assert_eq!(safe_name("lama_fp32.onnx").unwrap(), "lama_fp32.onnx");
        assert_eq!(safe_name("isnet-general-use.onnx").unwrap(), "isnet-general-use.onnx");
    }

    #[test]
    fn recusa_o_que_escaparia_da_pasta_de_modelos() {
        // Cada um destes, concatenado sem checagem, gravaria fora de models/.
        for mau in [
            "../lama_fp32.onnx",
            "sub/lama_fp32.onnx",
            "sub\\lama_fp32.onnx",
            "C:/tmp/lama_fp32.onnx",
            "..onnx",
            "lama_fp32.exe",
            "",
        ] {
            assert!(safe_name(mau).is_err(), "deveria recusar {mau:?}");
        }
    }
}
