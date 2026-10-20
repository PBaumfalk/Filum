export type Theme = 'system' | 'light' | 'dark';

export function storedTheme(): Theme {
  try {
    const v = localStorage.getItem('filum-theme');
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  try {
    if (t === 'system') localStorage.removeItem('filum-theme');
    else localStorage.setItem('filum-theme', t);
  } catch {
    /* privater Modus */
  }
}
