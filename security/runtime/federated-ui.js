(() => {
  'use strict';
  // Invitation and recovery credentials never enter a provider redirect.
  const query = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (document.getElementById('owner-recovery-code') || query.has('implementation_invite') || fragment.has('implementation_invite')) return;
  const container = document.getElementById('federated-sign-in');
  if (!container) return;
  fetch('/api/auth/federated/providers', {credentials: 'same-origin', cache: 'no-store'})
    .then(response => response.ok ? response.json() : Promise.reject(new Error('Unavailable')))
    .then(data => {
      if (!Array.isArray(data.providers)) return;
      for (const provider of ['google', 'apple']) {
        const button = document.getElementById(provider + '-sign-in');
        if (!button || !data.providers.includes(provider)) continue;
        button.hidden = false;
        button.addEventListener('click', () => { location.assign('/api/auth/federated/' + provider + '/start'); });
        container.hidden = false;
      }
    }).catch(() => {}); // Existing passkey sign-in remains available.
})();
