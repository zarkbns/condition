import Head from 'next/head';
import { useRouter } from 'next/router';
import '../src/styles/globals.css';
import '../src/styles/landing.css';
import type { AppProps } from 'next/app';
import { ConditionProvider, useCondition } from '../src/components/ConditionProvider';
import { NetworkBadge } from '../src/components/NetworkBadge';

// Absolute origin for social cards: crawlers (X, Slack, Facebook, Discord)
// do not resolve relative og:image URLs. Overridable at build time.
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trycondition.vercel.app')
  .replace(/\/$/, '');

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
  const router = useRouter();
  // The landing page carries its own full-bleed section rhythm (1280px
  // canvas, edge-to-edge bands); app pages keep the narrow reading
  // container from globals.css.
  const fullBleed = router.pathname === '/';
  return (
    <ConditionProvider>
      <Head>
        <link rel="icon" type="image/png" href="/brand/favicon.png" />
        <link rel="apple-touch-icon" href="/brand/favicon.png" />
        <meta name="theme-color" content="#000000" />
        {/* Social preview: the Condition flyer, padded to 1200x630 on the
            black canvas. Site-wide defaults; pages override the title. */}
        <meta property="og:site_name" content="Condition" />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Condition — Prove fairness. Reveal nothing." />
        <meta
          property="og:description"
          content="Privacy-preserving parametric insurance on Midnight. Policies are transparent, claims settle privately, fairness is proven publicly."
        />
        <meta property="og:url" content={`${SITE_URL}/`} />
        <meta property="og:image" content={`${SITE_URL}/og/condition-preview.png`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Condition — Prove fairness. Reveal nothing." />
        <meta
          name="twitter:description"
          content="Privacy-preserving parametric insurance on Midnight. Live on Preprod."
        />
        <meta name="twitter:image" content={`${SITE_URL}/og/condition-preview.png`} />
      </Head>
      <NavBar />
      <main className={fullBleed ? 'landing' : 'container'}>
        <Component {...pageProps} />
      </main>
      <footer className="footer">
        privacy-preserving parametric insurance on midnight · policies are
        transparent · claims settle privately · fairness is proven publicly
      </footer>
    </ConditionProvider>
  );
}
