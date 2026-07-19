/** Pra QUAL camada o recorte flutuante assenta — a regra, pura e testável.
 *
 *  Regra (a do Photoshop com o move tool): o carimbo vai pra camada ATIVA no
 *  momento do commit — mover o recorte e trocar de camada é a forma idiomática
 *  de "mover seleção pra outra camada". A origem (`floatingLayerId`) é só o
 *  último recurso, pro caso da ativa ter morrido junto com tudo.
 */

/** Resolve o destino do carimbo. Precedência: alvo explícito → camada ativa →
 *  camada de origem do recorte. Ids mortos (fora de `layerIds`) são pulados;
 *  null = não há onde carimbar (doc sem camadas). */
export function resolveStampTarget(opts: {
  /** Alvo pedido explicitamente (commit(id)) — vence se estiver vivo. */
  explicit?: string | null;
  /** Camada ativa no momento do commit. */
  activeId: string | null;
  /** De onde os pixels foram levantados. */
  floatingLayerId: string | null;
  /** Camadas vivas no doc. */
  layerIds: readonly string[];
}): string | null {
  const alive = (id: string | null | undefined): id is string =>
    !!id && opts.layerIds.includes(id);
  if (alive(opts.explicit)) return opts.explicit;
  if (alive(opts.activeId)) return opts.activeId;
  if (alive(opts.floatingLayerId)) return opts.floatingLayerId;
  return null;
}
