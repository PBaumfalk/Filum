import { useEffect } from 'react';

/** Setzt den Fenstertitel, z. B. „seminar · Links · Filum“. */
export function useDocumentTitle(...parts: (string | null | undefined)[]): void {
  const title = [...parts.filter(Boolean), 'Filum'].join(' · ');
  useEffect(() => {
    document.title = title;
  }, [title]);
}
