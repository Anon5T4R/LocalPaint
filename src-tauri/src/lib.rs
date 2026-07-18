//! LocalPaint — editor raster (GIMP/Krita-lite) 100% offline da suíte Local.
//!
//! Divisão de trabalho (regra da suíte, a mesma do Slides/Video): TODA a
//! lógica de imagem mora no front — pintura em canvas 2D, camadas em TS,
//! `.tpaint` montado com JSZip no webview ("zip sempre no webview"). O Rust
//! daqui só move bytes de/para o disco e entrega o argumento de abertura.
//! É por isso que este arquivo é pequeno e deve continuar pequeno.

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
        .invoke_handler(tauri::generate_handler![
            boot_open_path,
            fsio::read_file_b64,
            fsio::write_file_b64,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
