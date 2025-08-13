/*
 * Interactivity for the cosmic site. Provides language switching without
 * page reload, scroll‑triggered animations, and simple local counters for
 * downloads/views. Counts are stored in localStorage per user.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Translation dictionary
  const translations = {
    en: {
      brand: 'Cosmic Hub',
      nav_home: 'Home',
      nav_tools: 'Tools',
      nav_certificates: 'Certificates',
      nav_support: 'Support',
      hero_greeting: 'Welcome to the Cosmic Hub',
      hero_subtitle: 'Explore tools, certificates and more',
      hero_cta: 'Explore',
      tools_title: 'DNS & Sign Tools',
      dns_title: 'DNS',
      dns_status: 'Status: Working',
      dns_desc: 'Configure your DNS profile easily',
      dns_action: 'Install',
      sign_title: 'Sign Tools',
      ksign: 'KSign',
      esign: 'eSign',
      download: 'Download',
      certificates_title: 'Certificates',
      support_title: 'Support Me',
      support_desc: 'If you like this project, consider supporting me:',
      donate_kofi: 'Ko‑fi',
      donate_donatello: 'Donatello',
      donate_donatepay: 'DonatePay',
      footer_text: '© 2025 Cosmic Hub. All rights reserved.',
      total_visits: 'Total Visits',
      download_stats: 'Download Stats',
      ksign_bmw: 'KSign BMW',
      esign_vnj: 'eSign VNJ',
      certs: 'Certificates'
    },
    ru: {
      brand: 'Космический Центр',
      nav_home: 'Домой',
      nav_tools: 'Инструменты',
      nav_certificates: 'Сертификаты',
      nav_support: 'Поддержка',
      hero_greeting: 'Добро пожаловать в Космический Центр',
      hero_subtitle: 'Исследуйте инструменты, сертификаты и многое другое',
      hero_cta: 'Исследовать',
      tools_title: 'DNS и инструменты подписи',
      dns_title: 'DNS',
      dns_status: 'Статус: Работает',
      dns_desc: 'Просто настройте свой DNS‑профиль',
      dns_action: 'Установить',
      sign_title: 'Инструменты подписи',
      ksign: 'KSign',
      esign: 'eSign',
      download: 'Скачать',
      certificates_title: 'Сертификаты',
      support_title: 'Поддержать меня',
      support_desc: 'Если вам понравился проект, рассмотрите возможность поддержать меня:',
      donate_kofi: 'Ko‑fi',
      donate_donatello: 'Donatello',
      donate_donatepay: 'DonatePay',
      footer_text: '© 2025 Космический Центр. Все права защищены.',
      total_visits: 'Всего посещений',
      download_stats: 'Статистика скачиваний',
      ksign_bmw: 'KSign BMW',
      esign_vnj: 'eSign VNJ',
      certs: 'Сертификаты'
    }
  };

  let currentLang = 'ru';

  function setLanguage(lang) {
    currentLang = lang;
    // update text content on elements with data-key attribute
    document.querySelectorAll('[data-key]').forEach(el => {
      const key = el.dataset.key;
      const translation = translations[lang][key];
      if (translation !== undefined) {
        el.textContent = translation;
      }
    });
    // update HTML lang attribute
    document.documentElement.lang = lang;
    // update active state on language buttons
    document.getElementById('lang-ru').classList.toggle('active', lang === 'ru');
    document.getElementById('lang-en').classList.toggle('active', lang === 'en');
    // save preference
    localStorage.setItem('lang', lang);

    // Re‑render dynamic buttons (download text) after language switch
    document.querySelectorAll('.download-btn').forEach(btn => {
      const key = 'download';
      btn.textContent = translations[lang][key] || btn.textContent;
    });

    // Re‑render DNS action button
    const dnsAction = document.querySelector('.card a.btn.small');
    if (dnsAction) {
      dnsAction.textContent = translations[lang].dns_action;
    }
  }

  // initial language from localStorage or default
  const storedLang = localStorage.getItem('lang');
  if (storedLang && translations[storedLang]) {
    setLanguage(storedLang);
  } else {
    setLanguage(currentLang);
  }

  // Language toggle buttons
  document.getElementById('lang-ru').addEventListener('click', () => setLanguage('ru'));
  document.getElementById('lang-en').addEventListener('click', () => setLanguage('en'));

  // IntersectionObserver for scroll animations
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('[data-animate]').forEach(el => {
    observer.observe(el);
  });

  // Retrieve counts from localStorage
  const counts = JSON.parse(localStorage.getItem('counts') || '{}');
  // There are no inline count elements anymore; counts are displayed in the stats section only

  // Bind click handlers to download buttons to increment count
  function bindDownloadButtons() {
    document.querySelectorAll('.download-btn').forEach(btn => {
      // avoid multiple bindings
      if (!btn.dataset.bound) {
        btn.dataset.bound = 'true';
        btn.addEventListener('click', (e) => {
          const id = btn.dataset.id;
          // increment local counter for this download
          incrementDownloadCount(id);
          // do not prevent default; letting the browser handle the download via the anchor's href and download attribute
          // this ensures direct download when permitted by the remote server
        });
      }
    });
  }

  /*
    Increment the download count for a given tool both globally (via countapi)
    and locally (via localStorage) and update the corresponding stat cell.
    If the remote API is unreachable, only the local counter will be updated.
  */
  function incrementDownloadCount(id) {
    const updateLocal = (newVal) => {
      counts[id] = newVal;
      localStorage.setItem('counts', JSON.stringify(counts));
      const gridCounter = document.getElementById('counter-' + id);
      if (gridCounter) gridCounter.textContent = counts[id];
    };
    // Attempt to increment remote counter
    const tryIncrement = (url) => fetch(url)
      .then(res => res.json())
      .then(data => {
        updateLocal(data.value);
        return true;
      });
    tryIncrement(`https://countapi.xyz/hit/kalamitgames/${id}`)
      .catch(() => tryIncrement(`https://api.countapi.xyz/hit/kalamitgames/${id}`))
      .catch(() => {
        // remote unreachable; fall back to local increment
        updateLocal((counts[id] || 0) + 1);
      });
  }

  // Render counters in the separate stats grid
  function renderCounters() {
    const ids = ['ksign', 'esign', 'ksign-bmw', 'esign-vnj', 'certs'];
    ids.forEach(id => {
      const el = document.getElementById('counter-' + id);
      if (!el) return;
      // Attempt to fetch the global count
      const updateLocal = (val) => {
        counts[id] = val;
        localStorage.setItem('counts', JSON.stringify(counts));
        el.textContent = counts[id];
      };
      const tryGet = (url) => fetch(url)
        .then(res => res.json())
        .then(data => {
          updateLocal(data.value);
          return true;
        });
      tryGet(`https://countapi.xyz/get/kalamitgames/${id}`)
        .catch(() => tryGet(`https://api.countapi.xyz/get/kalamitgames/${id}`))
        .catch(() => {
          // remote unreachable; use local value
          updateLocal(counts[id] || 0);
        });
    });
  }

  // Initialise visit counter using countapi.xyz; fall back to localStorage if fetch fails
  function initVisits() {
    /*
      Use countapi.xyz to maintain a global visit counter. The endpoint
      `https://countapi.xyz/hit/namespace/key` will atomically increment
      and return the new count. In some environments the subdomain
      `api.countapi.xyz` may be blocked, so we try both domains in
      succession. If both fail (e.g. no network), fall back to a
      localStorage counter that counts only visits on this device.
    */
    const updateCount = (url) =>
      fetch(url)
        .then(res => res.json())
        .then(data => {
          document.getElementById('visit-count').textContent = data.value;
          return true;
        });
    updateCount('https://countapi.xyz/hit/kalamitgames/cosmic-site')
      .catch(() => updateCount('https://api.countapi.xyz/hit/kalamitgames/cosmic-site'))
      .catch(() => {
        const localVisits = parseInt(localStorage.getItem('visits') || '0', 10) + 1;
        localStorage.setItem('visits', localVisits);
        document.getElementById('visit-count').textContent = localVisits;
      });
  }

  // Populate tools and certificates from JSON file
  function populateData() {
    // Fallback data used if fetching the JSON fails (for local file access)
    const fallbackData = {
      tools: [
        {
          id: 'ksign',
          name: 'KSign',
          status: true,
          description: 'Мощный инструмент для подписи, поддерживающий iOS 16.0 и новее',
          url: 'https://loadly.io/57jdwiXt'
        },
        {
          id: 'esign',
          name: 'eSign',
          status: true,
          description: 'Популярный инструмент для подписания iPA‑файлов, обновляемый автоматически',
          url: 'https://loadly.io/KDxT6fCO'
        },
        {
          id: 'ksign-bmw',
          name: 'KSign BMW',
          status: true,
          description: 'Вариант KSign от BMW Brilliance Automotive Ltd',
          url: 'https://loadly.io/dKaQsrKZ'
        },
        {
          id: 'esign-vnj',
          name: 'eSign VNJ',
          status: false,
          description: 'Сертификат временно недоступен для загрузки',
          url: 'https://loadly.io/vnjes8ios'
        }
      ],
      certificates: [
        {
          id: 'certs',
          name: 'Certificates',
          description: 'Скачать все сертификаты одним архивом',
          url: 'https://github.com/esigncert/khoindvn/raw/refs/heads/main/document/DNS/Certs-Khoindvn.zip'
        }
      ]
    };
    fetch('data/statuses.json')
      .then(resp => {
        // If the fetch fails because file:// is disallowed, fallback will be used in catch
        if (!resp.ok) throw new Error('HTTP error');
        return resp.json();
      })
      .catch(() => fallbackData)
      .then(data => {
        // Tools
        const toolList = document.getElementById('tool-list');
        if (toolList) {
          toolList.innerHTML = '';
          data.tools.forEach(tool => {
            const li = document.createElement('li');
            // Name
            const nameSpan = document.createElement('span');
            nameSpan.className = 'tool-name';
            nameSpan.textContent = tool.name;
            li.appendChild(nameSpan);
            // Status
            const statusSpan = document.createElement('span');
            statusSpan.className = 'tool-status';
            statusSpan.textContent = tool.status ? '✅' : '❌';
            if (!tool.status) statusSpan.classList.add('unavailable');
            li.appendChild(statusSpan);
            // Download button
            const btn = document.createElement('a');
            btn.href = tool.url;
            // remove target to avoid opening new tab; specify download attribute so the browser attempts direct download
            btn.rel = 'noopener';
            btn.className = 'btn download-btn';
            btn.dataset.id = tool.id;
            btn.dataset.url = tool.url;
            btn.setAttribute('download', '');
            btn.textContent = translations[currentLang].download;
            li.appendChild(btn);
            // Append list item
            toolList.appendChild(li);
          });
        }
        // Certificates
        const certList = document.getElementById('cert-list');
        if (certList) {
          certList.innerHTML = '';
          data.certificates.forEach(cert => {
            const card = document.createElement('div');
            card.className = 'card';
            card.setAttribute('data-animate', '');
            const title = document.createElement('h3');
            title.textContent = cert.name;
            card.appendChild(title);
            const desc = document.createElement('p');
            desc.textContent = cert.description;
            card.appendChild(desc);
            const btn = document.createElement('a');
            btn.href = cert.url;
            btn.rel = 'noopener';
            btn.className = 'btn download-btn';
            btn.dataset.id = cert.id;
            btn.dataset.url = cert.url;
            btn.setAttribute('download', '');
            btn.textContent = translations[currentLang].download;
            card.appendChild(btn);
            // Append card to list
            certList.appendChild(card);
          });
        }
        // After dynamic content inserted, set up animations and counters
        document.querySelectorAll('[data-animate]').forEach(el => {
          observer.observe(el);
        });
        bindDownloadButtons();

        // Render counters after dynamic elements are added
        renderCounters();
      });
  }

  // Initialise dynamic content
  populateData();
  // Kick off site visit counter
  initVisits();
});