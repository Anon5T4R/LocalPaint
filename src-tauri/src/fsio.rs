//! I/O de bytes — a ponte inteira entre o disco e o webview.
//!
//! Base64 e não `Vec<u8>`: o invoke serializa vetor como array JSON (um número
//! por byte) e um PNG de 4 MB viraria ~20 MB de JSON. Base64 custa +33% e
//! decodifica nativo no front (`atob`/`fetch(dataURL)`).

use base64::{engine::general_purpose::STANDARD as B64, Engine};

#[tauri::command]
pub fn read_file_b64(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("ler {path}: {e}"))?;
    Ok(B64.encode(bytes))
}

#[tauri::command]
pub fn write_file_b64(path: String, data: String) -> Result<(), String> {
    let bytes = B64.decode(data.as_bytes()).map_err(|e| format!("base64: {e}"))?;
    // Gravação atômica (padrão do LocalKeys): escreve num .tmp ao lado e
    // renomeia. Queda de energia no meio do save não corrompe o documento.
    let tmp = format!("{path}.tmp");
    std::fs::write(&tmp, &bytes).map_err(|e| format!("gravar {tmp}: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("renomear pra {path}: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_de_bytes_pelo_base64() {
        let dir = std::env::temp_dir().join("localpaint-test-fsio");
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("t.bin").to_string_lossy().to_string();

        let dados = B64.encode([0u8, 155, 255, 7, 42]);
        write_file_b64(p.clone(), dados.clone()).unwrap();
        assert_eq!(read_file_b64(p.clone()).unwrap(), dados);

        // O .tmp não pode sobrar depois do rename.
        assert!(!std::path::Path::new(&format!("{p}.tmp")).exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn base64_invalido_da_erro_e_nao_panica() {
        let r = write_file_b64("irrelevante".into(), "###não-base64###".into());
        assert!(r.is_err());
    }
}
