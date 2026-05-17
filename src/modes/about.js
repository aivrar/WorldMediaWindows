/**
 * About — what World Media is, where its content comes from, and the
 * isolation/privacy guarantees the build makes.
 *
 * Pure DOM, no fetches. Information here is curated, not crawled — counts
 * shown are reference values; live counts live in Library's sidebar.
 */

const VERSION = '0.1.1-windows';

const SOURCES_INFO = [
  {
    id: 'radio-browser',
    name: 'Radio Browser',
    home: 'https://www.radio-browser.info',
    api:  'https://api.radio-browser.info',
    types: 'Live internet radio (audio)',
    blurb:
      'A community-curated directory of internet radio stations. Volunteer-run, ' +
      'no API key, no signup. Around 40,000 stations indexed worldwide.',
  },
  {
    id: 'iptv-org',
    name: 'iptv-org',
    home: 'https://iptv-org.github.io',
    api:  'https://iptv-org.github.io/api/streams.json',
    types: 'Live IPTV channels (video)',
    blurb:
      'A crowd-sourced registry of free-to-air TV streams from around the world, ' +
      'published as plain JSON on GitHub. No service to sign up for — the data ' +
      'is just a public file. Around 10,000+ channels listed; many are regional.',
  },
  {
    id: 'internet-archive',
    name: 'Internet Archive',
    home: 'https://archive.org',
    api:  'https://archive.org/services/search/v1/scrape',
    types: 'On-demand video and audio',
    blurb:
      'A non-profit digital library. Millions of films, recordings, books, ' +
      'magazines, and software — much of it in the public domain or under ' +
      'open licenses. World Media surfaces the audio/video subsets.',
  },
  {
    id: 'nasa',
    name: 'NASA Image and Video Library',
    home: 'https://images.nasa.gov',
    api:  'https://images-api.nasa.gov',
    types: 'Public-domain video and audio',
    blurb:
      'Official NASA media library — photos, videos, and audio from missions, ' +
      'astronauts, and ground operations. Public-domain in the U.S. (and most ' +
      'jurisdictions); attribution requested but not required.',
  },
  {
    id: 'wikimedia',
    name: 'Wikimedia Commons',
    home: 'https://commons.wikimedia.org',
    api:  'https://commons.wikimedia.org/w/api.php',
    types: 'Free-licensed video and audio',
    blurb:
      'The Wikipedia foundation’s shared media repository. Every file is ' +
      'licensed for free reuse (typically CC-BY-SA or public domain). World ' +
      'Media filters for video and audio file types only.',
  },
  {
    id: 'librivox',
    name: 'LibriVox',
    home: 'https://librivox.org',
    api:  'https://librivox.org/api/feed/audiobooks',
    types: 'Public-domain audiobooks (audio)',
    blurb:
      'Volunteer recordings of public-domain books, read aloud chapter by ' +
      'chapter. Around 20,000 titles spanning fiction, poetry, history, ' +
      'philosophy, and more. Always free; no account needed to listen.',
  },
];

export function renderAbout(host) {
  host.innerHTML = `
    <div class="about-root">
      <div class="about-page">

        <header class="about-hero">
          <h1>World Media</h1>
          <p class="about-tagline">
            A unified player for free, open media. No accounts. No API keys. No telemetry.
          </p>
        </header>

        <section class="about-section">
          <h2>What this is</h2>
          <p>
            World Media is a desktop app that brings together six open archives of
            free media — internet radio, live TV, on-demand video and audio — under
            one consistent search-and-browse interface. Everything you see comes
            from public sources that anyone can access; the app just removes the
            friction of visiting six different sites and learning six different
            search interfaces.
          </p>
          <p>
            The app does not host content. It points to the upstream stream URL
            and plays it directly in the built-in player. If a station or video
            goes offline at the source, it goes offline in World Media too — but
            so does everyone else trying to reach it.
          </p>
        </section>

        <section class="about-section">
          <h2>Where the content comes from</h2>
          <p class="about-section-intro">
            Each source below is queried live when you search or browse.
            Click the home link to visit the source directly.
          </p>
          <div class="about-sources">
            ${SOURCES_INFO.map(s => `
              <article class="about-source" data-source="${s.id}">
                <div class="about-source-head">
                  <span class="about-source-dot" style="background:${dotColor(s.id)}"></span>
                  <h3>${escape(s.name)}</h3>
                </div>
                <div class="about-source-types">${escape(s.types)}</div>
                <p class="about-source-blurb">${escape(s.blurb)}</p>
                <dl class="about-source-meta">
                  <dt>Home</dt><dd><a href="${s.home}" target="_blank" rel="noopener">${escape(stripScheme(s.home))}</a></dd>
                  <dt>API</dt><dd><code>${escape(stripScheme(s.api))}</code></dd>
                </dl>
              </article>
            `).join('')}
          </div>
        </section>

        <section class="about-section">
          <h2>Privacy &amp; isolation</h2>
          <ul class="about-bullets">
            <li><strong>No accounts.</strong> Nothing to sign up for. The app does not have a server side.</li>
            <li><strong>No telemetry.</strong> The app does not phone home. It does not collect usage data.</li>
            <li><strong>No API keys.</strong> All six sources are accessed using their public, anonymous endpoints.</li>
            <li>
              <strong>Same-origin proxy.</strong> A few sources (LibriVox, Wikimedia, sometimes Internet Archive)
              block direct browser requests because of CORS. The Windows app runs a small local Python proxy
              that whitelists exactly those upstream hosts and forwards your request; nothing else can be proxied,
              and stream URLs (audio/video) are fetched directly without proxy.
            </li>
            <li>
              <strong>Local runtime.</strong> The app's Python proxy and HTTP server bind only to 127.0.0.1
              and store logs under LocalAppData. No WSL distro, rootfs, Docker image, or Linux setup step is used.
            </li>
          </ul>
        </section>

        <section class="about-section">
          <h2>Licenses</h2>
          <p>
            The World Media app itself is open source under the MIT license.
            Content from the listed sources retains its original license — check each
            item’s metadata for specifics. The app surfaces license info on every
            card via the source badge and the detail panel.
          </p>
        </section>

        <section class="about-section">
          <h2>Version</h2>
          <p class="about-version">
            World Media v${VERSION}<br>
            Windows-native desktop build.<br>
            <span class="about-build-line">Runtime: bundled Python + localhost HTTP server + WebView2 shell.</span>
          </p>
        </section>

      </div>
    </div>
  `;
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function stripScheme(url) {
  return String(url).replace(/^https?:\/\//, '');
}

function dotColor(id) {
  // Keep in sync with SOURCES in lib/sources.js — duplicated here so this
  // module can render before any adapter is loaded.
  const map = {
    'radio-browser':    '#42a5f5',
    'iptv-org':         '#ef5350',
    'internet-archive': '#f5a524',
    'nasa':             '#9c27b0',
    'wikimedia':        '#26a69a',
    'librivox':         '#7e57c2',
  };
  return map[id] || 'var(--text-mute)';
}
