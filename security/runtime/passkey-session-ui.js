(() => {
  'use strict';
  const originalFetch=window.fetch;
  window.fetch=async function(input,init){
    const response=await originalFetch.apply(this,arguments);
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(url.origin===location.origin&&url.pathname==='/api/logout'&&response.ok)location.replace('/');
    return response;
  };
  // Keep device management reachable without introducing a parallel app shell.
  document.addEventListener('DOMContentLoaded',()=>{
    const link=document.createElement('a');link.href='/passkeys';link.textContent='Manage passkeys';link.className='vector-passkey-settings';
    link.style.cssText='position:fixed;bottom:8px;right:12px;font:11px system-ui;color:#165db9;background:#fff;padding:5px 9px;border:1px solid #dce6f2;border-radius:6px;z-index:30';
    document.body.appendChild(link);
  });
})();
