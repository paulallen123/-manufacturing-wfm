/* Factory Capability Graph UX prototype for #92. Branch-only; not production wired. */
(function(){
  const tabs=[...document.querySelectorAll('[data-tab]')];
  const views=[...document.querySelectorAll('[data-view]')];
  const workcentres=[...document.querySelectorAll('.workcentre')];
  const detailTitle=document.querySelector('[data-detail-title]');
  const detailCopy=document.querySelector('[data-detail-copy]');
  const drawer=document.querySelector('.cap-drawer-backdrop');
  const detail={
    laser:{title:'Laser Cell',copy:'Two cutting assets · one workforce constraint before the 14:00 production window.'},
    press:{title:'Press Shop',copy:'Forming capacity is covered for the current plan with one qualified operator available.'},
    weld:{title:'Robot Weld Cell',copy:'A newly discovered welding capability needs semantic review before WFM will use it.'},
  };

  tabs.forEach((tab)=>tab.addEventListener('click',()=>{
    const target=tab.dataset.tab;
    tabs.forEach((item)=>{item.classList.toggle('active',item===tab);item.setAttribute('aria-selected',String(item===tab));});
    views.forEach((view)=>{view.hidden=view.dataset.view!==target;});
  }));

  workcentres.forEach((workcentre)=>workcentre.addEventListener('click',()=>{
    workcentres.forEach((item)=>item.classList.remove('active'));
    workcentre.classList.add('active');
    const selected=detail[workcentre.dataset.workcentre];
    if(selected){detailTitle.textContent=selected.title;detailCopy.textContent=selected.copy;}
  }));

  const openDrawer=()=>{drawer.hidden=false;document.body.style.overflow='hidden';drawer.querySelector('.drawer-close')?.focus();};
  const closeDrawer=()=>{drawer.hidden=true;document.body.style.overflow='';};
  document.querySelectorAll('[data-open-review]').forEach((button)=>button.addEventListener('click',openDrawer));
  drawer.querySelector('.drawer-close')?.addEventListener('click',closeDrawer);
  drawer.addEventListener('click',(event)=>{if(event.target===drawer)closeDrawer();});
  document.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&!drawer.hidden)closeDrawer();});
})();