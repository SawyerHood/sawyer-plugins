const SPRITE_BASE_URL =
  "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";

/** The front sprite PokeAPI serves for a species' default form. */
export function spriteUrlFor(speciesId: number): string {
  return `${SPRITE_BASE_URL}/${speciesId}.png`;
}

export function artworkUrlFor(speciesId: number): string {
  return `${SPRITE_BASE_URL}/other/official-artwork/${speciesId}.png`;
}
