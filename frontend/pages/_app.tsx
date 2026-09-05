import Head from 'next/head';
import '../src/styles/globals.css';
import type { AppProps } from 'next/app';
import { ConditionProvider, useCondition } from '../src/components/ConditionProvider';
import { NetworkBadge } from '../src/components/NetworkBadge';

function NavBar() {
  const { status, connectWallet, retry, switchToLocal } = useCondition();
  return (
    <nav className="nav">
      <a href="/" className="brand">
        <img src="/brand/mark-white.png" alt="" aria-hidden="true" />
        condition
      </a>
      <div className="nav-links">
        <a href="/policy">create policy</a>
        <a href="/claim">claim</a>
        <a href="/receipt">receipts</a>
      </div>
      <NetworkBadge
        status={status}
        onConnectWallet={connectWallet}
        onRetry={retry}
        onSwitchToLocal={switchToLocal}
      />
    </nav>
  );
}

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ConditionProvider>
      <Head>
        <link rel="icon" type="image/png" href="/brand/favicon.png" />
      </Head>
      <NavBar />
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
