/**
 * Catalogo de categorias de tickets soportadas por el backend.
 *
 * La IA elige una de estas categorias a partir del contenido del correo y
 * devuelve su id en ticket_data.categoria_id. Si la IA no logra interpretar
 * una categoria valida, el daemon usa DEFAULT_CATEGORY_ID (66).
 *
 * Mantener esta lista alineada con la respuesta de GET de categorias del backend
 * y con el catalogo embebido en el prompt (tabla prompt).
 */
export interface TicketCategory {
  id: number;
  name: string;
}

export const TICKET_CATEGORIES: readonly TicketCategory[] = [
  { id: 65, name: 'Software: Office, Windows, SAP, Aplicaciones' },
  { id: 66, name: 'Hardware: PC, notebook, conectores' },
  { id: 67, name: 'Internet, red, cableados, accesos' },
  { id: 68, name: 'Servidor, Switch, AD, Forti, Enlaces, Cloud' },
  { id: 69, name: 'Telefonia movil, fija, internos' },
  { id: 70, name: 'CCTV, camaras, DVR, TV, proyectores' },
  { id: 71, name: 'Impresoras, papel, toner, conexion' },
] as const;

/** Categoria por defecto cuando la IA no interpreta una categoria valida. */
export const DEFAULT_CATEGORY_ID = 66;

const CATEGORY_BY_ID = new Map<number, TicketCategory>(
  TICKET_CATEGORIES.map((c) => [c.id, c]),
);

/** true si el id corresponde a una categoria del catalogo. */
export function isValidCategoryId(id: unknown): id is number {
  return typeof id === 'number' && Number.isInteger(id) && CATEGORY_BY_ID.has(id);
}

/**
 * Devuelve un categoria_id valido. Si el valor recibido no es una categoria
 * conocida, cae al default configurado (66 salvo override por env).
 */
export function resolveCategoryId(
  candidate: unknown,
  fallback: number = DEFAULT_CATEGORY_ID,
): number {
  if (isValidCategoryId(candidate)) {
    return candidate;
  }
  return isValidCategoryId(fallback) ? fallback : DEFAULT_CATEGORY_ID;
}

/** Nombre de la categoria por id, o null si no existe. */
export function categoryName(id: number): string | null {
  return CATEGORY_BY_ID.get(id)?.name ?? null;
}
