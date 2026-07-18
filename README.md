# LocalPaint

Editor de imagem **raster** 100% offline da suíte **Local** — pense num
GIMP/Krita-lite que abre em um segundo. Camadas, pincel com pressão de caneta,
lápis pixel-perfect, balde com tolerância, formas e undo por região. Sem nuvem,
sem conta, sem telemetria: nada do que você pinta sai da sua máquina.

## Recursos (v0.1)

- **Camadas**: adicionar, remover, duplicar, reordenar, opacidade, visibilidade
  e 9 modos de mesclagem (normal, multiplicar, divisão, sobrepor, escurecer,
  clarear, diferença, luz suave, luz forte).
- **Ferramentas**: lápis (Bresenham, pixel cheio), pincel e borracha com
  **pressão de caneta** (Pointer Events), conta-gotas (lê a cor composta),
  balde com tolerância (scanline), linha/retângulo/elipse (Shift = perfeito).
- **Undo/redo por região** (dirty-rect) com orçamento de memória — desfazer não
  guarda o documento inteiro a cada traço.
- **Zoom/pan**: roda do mouse ancorada no cursor (5%–3200%), espaço ou botão do
  meio pra arrastar, ajustar à janela e 100%.
- **Arquivos**: abre PNG/JPG/WebP/BMP/GIF; salva no formato nativo **`.tpaint`**
  (zip com `doc.json` + uma PNG por camada — abre em qualquer descompactador);
  exporta PNG/JPG/WebP achatado.
- **Padrão da suíte**: tema claro/escuro/sistema + 5 temas nomeados, UI em
  PT/EN/ES, configurações.

## Atalhos

| Tecla | Ação |
|---|---|
| P / B / E | lápis / pincel / borracha |
| G / I | balde / conta-gotas |
| L / R / O | linha / retângulo / elipse |
| X | trocar cor primária ↔ secundária |
| `[` / `]` | diminuir / aumentar o pincel |
| Ctrl+Z / Ctrl+Y | desfazer / refazer |
| Ctrl+N / O / S / Shift+S | novo / abrir / salvar / salvar como |
| Espaço + arrastar · roda | pan · zoom |
| Botão direito | pinta com a cor secundária |

## Formato `.tpaint`

Zip comum: `doc.json` (dimensões + metadados das camadas, versão 1) e
`layers/NNN-id.png`. A ordem dos arquivos é a ordem de empilhamento. Se o
LocalPaint sumir do mundo, seus arquivos continuam abríveis — o formato é a
apólice de seguro do usuário.

## Desenvolvimento

```bash
npm install
npm run tauri dev   # porta 1482
npm test            # vitest (libs puras: fill, geometry, history, tpaint…)
cargo test          # em src-tauri/
```

Stack: Tauri 2 + React 19 + TypeScript. Toda a lógica de imagem vive no front
(canvas 2D); o Rust só move bytes (`read/write_file_b64`, gravação atômica).

## Licença

MIT.
