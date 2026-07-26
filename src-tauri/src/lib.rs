//! LocalPaint — editor raster (GIMP/Krita-lite) 100% offline da suíte Local.
//!
//! Divisão de trabalho (regra da suíte, a mesma do Slides/Video): TODA a
//! lógica de imagem mora no front — pintura em canvas 2D, camadas em TS,
//! `.tpaint` montado com JSZip no webview ("zip sempre no webview"). O Rust
//! daqui só move bytes de/para o disco e entrega o argumento de abertura.
//! É por isso que este arquivo é pequeno e deve continuar pequeno.

mod download;
mod fsio;

use tauri::Manager;

/// Caminho que chegou por associação de arquivo / linha de comando (`.tpaint`
/// com duplo-clique). O front pergunta no boot via `boot_open_path`.
fn arg_path() -> Option<String> {
    std::env::args().nth(1).filter(|a| {
        // Nem todo argv[1] é arquivo (ex.: flags do WebView). Só interessa o
        // que existe no disco.
        std::path::Path::new(a).is_file()
    })
}

#[tauri::command]
fn boot_open_path() -> Option<String> {
    arg_path()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ── Contorno da tela branca do webkit: REMOVIDO, e o porquê importa ──────
    //
    // Este bloco desligava o renderer DMABUF, desligava o compositing e forçava
    // XWayland, porque o webkit2gtk pintava a janela inteira de branco em
    // Arch/GNOME. Era mitigação às cegas — o comentário dizia "branco é pior que
    // lento" — e custava a aceleração do WebView.
    //
    // A CAUSA foi encontrada em 26/07/2026 e é de EMPACOTAMENTO, não de código:
    // o AppDir do AppImage levava `libwayland-*` do Ubuntu do CI, que brigavam
    // com o Mesa do host e derrubavam o EGL (`EGL_BAD_PARAMETER`). Corrigido em
    // `Anon5T4R/linux-packaging`: as libs que falam com driver/compositor agora
    // vêm do host, e o pacote nativo (pacman/apt) usa o webkit do sistema.
    // Tratar o sintoma deixou de fazer sentido.
    //
    // Remover o forçamento NÃO tira a saída de emergência: estas variáveis são
    // lidas pelo próprio webkitgtk, não por este código. Se a tela branca voltar
    // em alguma combinação de driver, rodar com
    // `WEBKIT_DISABLE_DMABUF_RENDERER=1` continua funcionando — e aí é sinal de
    // que sobrou lib de host em algum AppDir, que é onde se deve olhar.

    let mut builder = tauri::Builder::default();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Segunda instância (duplo-clique em outro .tpaint): traz a janela
            // e avisa o front, que decide se abre (guardando o não-salvo).
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
                if let Some(p) = args.get(1).filter(|a| std::path::Path::new(a).is_file()) {
                    use tauri::Emitter;
                    let _ = win.emit("open-path", p.clone());
                }
            }
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // O escopo do asset protocol nasce VAZIO; só a pasta de modelos
            // entra (padrão do LocalVideo). Falhar aqui não derruba o app —
            // só a remoção de fundo fica indisponível, e ela sabe avisar.
            if let Err(e) = download::allow_models_dir(app.handle()) {
                eprintln!("modelos fora do escopo do asset: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            boot_open_path,
            fsio::read_file_b64,
            fsio::write_file_b64,
            download::model_fetch,
            download::model_path,
            download::model_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
