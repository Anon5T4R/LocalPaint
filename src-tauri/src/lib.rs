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
    // Linux: o webkit2gtk pinta a janela INTEIRA de branco em várias combinações
    // de driver/compositor — o app sobe, o processo vive, e não há erro pra ler.
    // (Visto num Arch com GNOME/Wayland; o LocalAI já tinha pago o mesmo pedágio.)
    // Como o WebView é o mesmo em toda a suíte, este bloco é IDÊNTICO nos 31 apps.
    // Desliga o renderer DMABUF (suspeito nº 1), o compositing (reforço) e, em
    // Wayland, força XWayland — em AppImage o branco costuma sobreviver aos dois
    // primeiros. Custa aceleração no WebView, e branco é pior que lento.
    // Variável já setada MANDA (inclusive `=0`): quem depurou o próprio sistema
    // não pode ser sobrescrito por nós. Tem que vir ANTES do GTK subir — o
    // webkitgtk lê estas variáveis uma vez só, no arranque.
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
        let on_wayland = std::env::var_os("WAYLAND_DISPLAY").is_some()
            || std::env::var("XDG_SESSION_TYPE")
                .map(|t| t.eq_ignore_ascii_case("wayland"))
                .unwrap_or(false);
        if on_wayland && std::env::var_os("GDK_BACKEND").is_none() {
            std::env::set_var("GDK_BACKEND", "x11");
        }
    }

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
