// public: the root shell; renders no data
import './turnstile.css';

export const metadata = { title: 'Turnstile' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
