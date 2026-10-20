import '@fontsource-variable/onest';
import '@fontsource-variable/martian-mono';
import './styles/app.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { App } from './App';
import { ToastProvider } from './components/toast';
import { ApiError } from './lib/api';
import { applyTheme, storedTheme } from './lib/theme';

applyTheme(storedTheme());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

// Data-Router (statt BrowserRouter), damit useBlocker ungespeicherte Änderungen schützen kann.
// Die eigentlichen Routen bleiben als <Routes> in App.tsx.
const router = createBrowserRouter([
  {
    path: '*',
    element: (
      <ToastProvider>
        <App />
      </ToastProvider>
    ),
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
