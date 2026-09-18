(function(){
'use strict';

const PASSKEY_MARKER='WFM_PASSKEY_UI_V1';
const enc=buf=>btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const dec=value=>{
  const s=String(value||'').replace(/-/g,'+').replace(/_/g,'/');
  const pad=s+'='.repeat((4-s.length%4)%4);
  const raw=atob(pad);
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
};
const credentialDescriptor=x=>({...x,id:dec(x.id)});
const publicKeyCreate=o=>({
  ...o,
  challenge:dec(o.challenge),
  user:{...o.user,id:dec(o.user.id)},
  excludeCredentials:(o.excludeCredentials||[]).map(credentialDescriptor)
});
const publicKeyGet=o=>({
  ...o,
  challenge:dec(o.challenge),
  allowCredentials:(o.allowCredentials||[]).map(credentialDescriptor)
});
const serialiseCreate=cred=>({
  id:cred.id,
  rawId:enc(cred.rawId),
  type:cred.type,
  response:{
    clientDataJSON:enc(cred.response.clientDataJSON),
    authenticatorData:enc(cred.response.getAuthenticatorData()),
    transports:typeof cred.response.getTransports==='function'?cred.response.getTransports():[]
  }
});
const serialiseGet=cred=>({
  id:cred.id,
  rawId:enc(cred.rawId),
  type:cred.type,
  response:{
    clientDataJSON:enc(cred.response.clientDataJSON),
    authenticatorData:enc(cred.response.authenticatorData),
    signature:enc(cred.response.signature),
    userHandle:cred.response.userHandle?enc(cred.response.userHandle):null
  }
});
async function api(path,method='GET',body){
  const init={method,credentials:'same-origin',headers:{Accept:'application/json'}};
  if(body!==undefined){
    init.headers['Content-Type']='application/json';
    init.body=JSON.stringify(body);
  }
  const res=await fetch(path,init);
  let data={};
  try{data=await res.json();}catch{}
  if(!res.ok)throw new Error(data.error||('Request failed ('+res.status+')'));
  return data;
}
function supported(){
  return window.isSecureContext&&'PublicKeyCredential'in window&&navigator.credentials;
}
function loginError(message){
  const el=document.getElementById('login-error');
  if(el)el.textContent=message||'';
}
async function signInWithPasskey(){
  if(!supported())throw new Error('Passkeys are not available in this browser or security context.');
  const options=await api('/api/passkeys/auth/options','POST',{});
  const credential=await navigator.credentials.get({publicKey:publicKeyGet(options.publicKey)});
  if(!credential)throw new Error('Passkey sign-in was cancelled.');
  await api('/api/passkeys/auth/verify','POST',serialiseGet(credential));
  location.reload();
}
function installLoginButton(){
  const form=document.getElementById('v2-login');
  if(!form||form.querySelector('[data-wfm-passkey-login]'))return;
  const signIn=form.querySelector('button[type="submit"]');
  if(!signIn)return;
  const button=document.createElement('button');
  button.type='button';
  button.className='btn wfm-passkey-login';
  button.dataset.wfmPasskeyLogin='true';
  button.textContent='Sign in with Face ID / Passkey';
  button.disabled=!supported();
  button.title=supported()?'Use your device passkey. On supported Apple devices this can use Face ID or Touch ID.':'Passkeys need a supported secure browser.';
  button.addEventListener('click',async()=>{
    loginError('');
    button.disabled=true;
    const before=button.textContent;
    button.textContent='Checking passkey…';
    try{await signInWithPasskey();}
    catch(err){
      if(err&&err.name==='NotAllowedError')loginError('Face ID / passkey sign-in was cancelled.');
      else loginError(err&&err.message||'Passkey sign-in failed.');
      button.disabled=false;
      button.textContent=before;
    }
  });
  signIn.insertAdjacentElement('afterend',button);
  const hint=document.createElement('p');
  hint.className='wfm-passkey-hint';
  hint.textContent='Your biometric stays on your device. WFM receives only cryptographic proof.';
  button.insertAdjacentElement('afterend',hint);
}
function securityContainer(){
  if(typeof ui!=='undefined'&&ui.page!=='personal')return null;
  return document.querySelector('.content')||document.querySelector('main')||document.getElementById('root');
}
async function loadPasskeys(card){
  const list=card.querySelector('[data-wfm-passkey-list]');
  if(!list)return;
  try{
    const data=await api('/api/passkeys');
    const rows=data.passkeys||[];
    list.innerHTML=rows.length?rows.map(p=>'<div class="wfm-passkey-row"><div><strong>'+escapeHtml(p.label||'Passkey')+'</strong><small>'+(p.lastUsedAt?'Last used '+new Date(p.lastUsedAt).toLocaleString():'Not used yet')+'</small></div><button type="button" class="btn small" data-wfm-revoke="'+escapeAttr(p.id)+'">Remove</button></div>').join(''):'<div class="wfm-passkey-empty">No passkeys enrolled yet.</div>';
  }catch(err){
    list.innerHTML='<div class="wfm-passkey-empty">'+escapeHtml(err.message||'Could not load passkeys.')+'</div>';
  }
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function escapeAttr(s){return escapeHtml(s);}
function installSecurityCard(){
  const host=securityContainer();
  if(!host||document.getElementById('wfm-passkey-security'))return;
  const card=document.createElement('section');
  card.id='wfm-passkey-security';
  card.className='wfm-passkey-security';
  card.innerHTML='<div class="wfm-passkey-head"><div><span class="eyebrow">SECURITY</span><h2>Passkeys & biometric sign-in</h2><p>Use Face ID, Touch ID, Windows Hello or your device PIN. WFM never receives your biometric.</p></div><span class="pill grey">Phishing-resistant</span></div><div data-wfm-passkey-list class="wfm-passkey-list"><div class="wfm-passkey-empty">Loading passkeys…</div></div><form data-wfm-passkey-enrol class="wfm-passkey-enrol"><label>Confirm current password<input type="password" name="password" autocomplete="current-password" required></label><button class="btn primary" type="submit">Add passkey</button></form><p class="wfm-passkey-status" data-wfm-passkey-status role="status"></p><p class="wfm-passkey-note">Staging note: a passkey enrolled on the Railway demo hostname is for this demo host only. Production enrolment will use the permanent WFM domain.</p>';
  host.appendChild(card);
  const status=card.querySelector('[data-wfm-passkey-status]');
  const form=card.querySelector('[data-wfm-passkey-enrol]');
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    if(!supported()){status.textContent='Passkeys are not available in this browser or security context.';return;}
    const button=form.querySelector('button[type="submit"]');
    const password=form.elements.password.value;
    if(!password)return;
    button.disabled=true;status.textContent='Confirming identity…';
    try{
      const options=await api('/api/passkeys/register/options','POST',{password});
      status.textContent='Approve the passkey on this device…';
      const credential=await navigator.credentials.create({publicKey:publicKeyCreate(options.publicKey)});
      if(!credential)throw new Error('Passkey enrolment was cancelled.');
      await api('/api/passkeys/register/verify','POST',{...serialiseCreate(credential),label:'This device'});
      form.reset();
      status.textContent='Passkey added. You can use Face ID / Passkey next time you sign in.';
      await loadPasskeys(card);
    }catch(err){
      status.textContent=err&&err.name==='NotAllowedError'?'Passkey enrolment was cancelled.':(err&&err.message||'Passkey enrolment failed.');
    }finally{button.disabled=false;}
  });
  card.addEventListener('click',async e=>{
    const button=e.target.closest('[data-wfm-revoke]');
    if(!button)return;
    const password=form.elements.password.value;
    if(!password){status.textContent='Enter your current password above before removing a passkey.';form.elements.password.focus();return;}
    button.disabled=true;
    try{
      await api('/api/passkeys/revoke','POST',{credentialId:button.dataset.wfmRevoke,password});
      status.textContent='Passkey removed.';
      await loadPasskeys(card);
    }catch(err){status.textContent=err.message||'Could not remove passkey.';}
    finally{button.disabled=false;}
  });
  loadPasskeys(card);
}
function enhance(){
  installLoginButton();
  installSecurityCard();
}
function start(){
  if(typeof showLogin==='function'&&!showLogin.__wfmPasskeyWrapped){
    const original=showLogin;
    const wrapped=function(){const value=original.apply(this,arguments);queueMicrotask(enhance);return value;};
    wrapped.__wfmPasskeyWrapped=true;
    showLogin=wrapped;
  }
  enhance();
  const observer=new MutationObserver(()=>queueMicrotask(enhance));
  observer.observe(document.documentElement,{subtree:true,childList:true});
}
window.WFMPasskeys={marker:PASSKEY_MARKER,supported,signInWithPasskey};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();