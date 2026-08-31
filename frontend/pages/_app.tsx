import '../src/styles/globals.css';
import type { AppProps } from 'next/app';
import { ConditionProvider } from '../src/components/ConditionProvider';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ConditionProvider>
      <nav className="nav">
        <a href="/" className="brand">⚡ condition</a>
        <div className="nav-links">
          <a href="/policy">create policy</a>
          <a href="/claim">claim</a>
          <a href="/receipt">receipts</a>
        </div>
      </nav>
      <main className="container">
        <Component {...pageProps} />
      </main>
      <footer className="footer">
        privacy-preserving parametric insurance on midnight · policies are
        transparent · claims settle privately · fairness is proven publicly
      </footer>
    </ConditionProvider>
  );
}
