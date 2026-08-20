import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import type { Route } from "./+types/root";
import "./globals.css";

/**
 * Archivo is the AMR Design System's only typeface. Weights 100 / 400 / 800 are
 * the licensed ones; the UI uses two of them (400 and 800), because a
 * composition may carry at most two weights.
 *
 * next/font used to load the font itself and hand it a variable name. Under
 * Vite it comes from Google Fonts and `--font-archivo` is set in globals.css,
 * so the token chain `--font-family → --font-archivo` is unchanged.
 */
export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Archivo:wght@400;800&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : null;
  const heading = status === 404 ? "Page not found" : "Something went wrong";
  const detail =
    status === 404
      ? "Check the address, or go back to the start."
      : "Try again. If it keeps happening, start over from the front page.";

  return (
    <div className="wrap">
      <div className="card">
        <div className="card-bar" />
        <div className="card-body">
          <h2>{heading}</h2>
          <p className="sub">{detail}</p>
          <div className="actions">
            <a href="/">
              <button type="button">Back to the start</button>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
