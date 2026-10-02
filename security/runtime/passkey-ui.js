(() => {
  'use strict';
  const status=document.getElementById('status');
  const signIn=document.getElementById('sign-in');
  const enroll=document.getElementById('enroll');
  const ownerRecovery=document.getElementById('owner-recovery-code');
  let busy=false;
  const query=new URLSearchParams(location.search);
  const invitation=query.get('implementation_invite')||new URLSearchParams(location.hash.slice(1)).get('implementation_invite')||'';
  const next=()=>invitation?'/?implementation_invite='+encodeURIComponent(invitation):'/';
  // Keep invitation authority out of subsequent referrers and page URLs.
  if(invitation)history.replaceState(null,'',location.pathname);
  async function request(route,body,prefix='/api/passkeys/') {
    const response=await fetch(prefix+route,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body||{})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Please try again.');return result;
  }
  async function act(register) {
    if(busy)return;busy=true;
    signIn.disabled=true;enroll.disabled=true;status.textContent=register?'Follow your device’s instructions to create your passkey.':'Follow your device’s instructions to sign in.';
    try {
      const authority=register?(ownerRecovery?{ownerRecovery:ownerRecovery.value}:invitation?{invitation}:{}):{};
      if(register&&ownerRecovery&&!/^[A-Za-z0-9_-]{43}$/.test(authority.ownerRecovery))throw new Error('Enter the one-time access setup code provided by your environment owner.');
      if(register&&ownerRecovery)await request('owner-access-recovery',{token:authority.ownerRecovery},'/api/');
      if(!window.PublicKeyCredential)throw new Error('This browser does not support passkeys. Open VECTOR in a current browser on your phone or computer.');
      const options=await request(register?'register/options':'authenticate/options',authority);
      const response=register?await SimpleWebAuthnBrowser.startRegistration({optionsJSON:options}):await SimpleWebAuthnBrowser.startAuthentication({optionsJSON:options});
      await request(register?'register/verify':'authenticate/verify',{response,...authority});
      status.textContent=register?'Passkey created. Opening VECTOR…':'Signed in. Opening VECTOR…';if(ownerRecovery)ownerRecovery.value='';location.replace(ownerRecovery?'/':next());
    }catch(error){status.textContent=error.name==='NotAllowedError'?(register?'Passkey setup was cancelled. Try again when you are ready.':'Sign-in was cancelled. Try again or use another registered device.'):error.message;busy=false;signIn.disabled=false;enroll.disabled=!!ownerRecovery&&!/^[A-Za-z0-9_-]{43}$/.test(ownerRecovery.value);}
  }
  signIn.addEventListener('click',()=>act(false));enroll.addEventListener('click',()=>act(true));
  if(ownerRecovery){
    signIn.hidden=true;enroll.hidden=false;enroll.textContent='Create my passkey';
    document.getElementById('heading').textContent='Set up your secure access';
    document.getElementById('intro').textContent='Enter your one-time access setup code, then create your passkey using your fingerprint, face or device PIN. Your access permissions stay the same.';
    const ready=()=>{enroll.disabled=busy||!/^[A-Za-z0-9_-]{43}$/.test(ownerRecovery.value);};
    ownerRecovery.addEventListener('input',ready);ready();return;
  }
  if(invitation){document.getElementById('heading').textContent='Set up your secure access';document.getElementById('intro').textContent='Create a passkey for your invited account. Then you can continue your implementation.';enroll.hidden=false;}
  fetch('/api/passkeys/status',{credentials:'same-origin'}).then(r=>r.json()).then(data=>{
    if(data.canEnroll){enroll.hidden=false;enroll.textContent=data.credentialCount?'Add another passkey':'Set up a passkey';document.getElementById('continue').hidden=false;document.getElementById('intro').textContent='Add a passkey on another device or security key so you have a second way to sign in.';}
  }).catch(()=>{});
})();
