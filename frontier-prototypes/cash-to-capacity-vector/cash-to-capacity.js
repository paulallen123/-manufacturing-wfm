(function(){
 const backdrop=document.querySelector('.drawer-backdrop');
 const close=()=>{backdrop.hidden=true;document.body.style.overflow='';};
 const open=()=>{backdrop.hidden=false;document.body.style.overflow='hidden';backdrop.querySelector('.close')?.focus();};
 document.querySelectorAll('[data-open],[data-why]').forEach(b=>b.addEventListener('click',open));
 backdrop.querySelector('.close')?.addEventListener('click',close);
 backdrop.addEventListener('click',e=>{if(e.target===backdrop)close();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!backdrop.hidden)close();});
 document.querySelectorAll('[data-role]').forEach(b=>b.addEventListener('click',()=>{
   document.querySelectorAll('[data-role]').forEach(x=>x.classList.toggle('active',x===b));
   const role=b.dataset.role;
   document.querySelector('.opportunity .eyebrow').textContent=role==='finance'?'Working capital opportunity · Evidence current':role==='ops'?'Production & cash opportunity · Evidence current':'Cash & production opportunity · Evidence current';
 }));
})();