/**
 * Party domain type
 * Minimal shape used by UI for payer selection.
 */
export interface Party {
  id: string;
  name: string;
  code?: string | number | null;
  mobile?: string | null;
  address?: string | null;
}