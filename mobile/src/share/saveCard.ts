/**
 * Saving a share card as a file is the desktop's Share (`saveCard.web.ts`). A phone shares
 * through the system sheet in `SharePreview.tsx` and never calls this.
 */
export async function saveCard(_node: unknown, _title: string, _px?: number): Promise<string | null> {
  return null;
}
