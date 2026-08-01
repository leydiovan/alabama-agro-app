/* ============================================================================
   MAPA — FERRAMENTA GERAL (FONTE ÚNICA, compartilhada por TODOS os módulos)
   ----------------------------------------------------------------------------
   Cada módulo que usa mapa PUXA este arquivo com (módulos ficam em subpasta → "../"):
       <script src="../mapa_ferramenta_geral.js"></script>
   Muda AQUI → muda em TODOS (Ctrl+R nos módulos admin, sem rebuild). NUNCA copiar este
   conteúdo pra dentro de um módulo (foi o B.O.: duas cópias divergem → "ferramenta faltando").
   DEPLOY: este arquivo (raiz) tem que ir junto dos módulos publicados. Doc: 03_documentacao/11_MAPA_FERRAMENTA_GERAL.md

   Ferramentas GERAIS embutidas (viajam com qualquer mapa criado por _mgCriar):
     • camadas base: Croqui · Google · Esri · Sentinel-2 (cor+NDVI/Agri/Umidade/IR) · EOX cloudless
     • 🔄 buscar imagem por data (catálogo Copernicus/CDSE, sem chave)
     • 🎨 corrigir cores ("Alabama": Gain/Gamma/RGB, evalscript ao vivo)
     • 📏 medir distância/área (vértice arrastável · clique no ponto apaga · 1º ponto verde fecha a área)
     • ⛶ tela cheia (via classe CSS .mg-full — funciona dentro de iframe, ≠ Fullscreen API)
   Uso no módulo:
     const inst = _mgCriar(elemento, {pfx:'bf', baseInicial:'Satélite (Google)', centerFn});
     // ...depois o módulo desenha as ferramentas ESPECÍFICAS dele sobre inst.map
   Autônomo: usa document.getElementById (não depende do $ do módulo) e Leaflet global (L).
   ============================================================================ */
(function(){ 'use strict';
  if (window._mgCriar) return;   // já carregado (evita redefinição se incluído 2×)

  const SHINST='c7dc487f-9637-419e-a400-5fee5a3e6989';   // instância WMS Sentinel Hub (CDSE, keyless)
  const FXDEF={gain:3.6,gamma:1.5,rmin:0,rmax:0.45,gmin:0.1,gmax:0.7,bmin:0.25,bmax:1};
  const MG={};   // instâncias por prefixo: {map,s2,variants,all,bases,centerFn}
  const gid=id=>document.getElementById(id);
  function fxVal(id,def){ const el=gid(id); if(!el) return def; const v=parseFloat(String(el.value).replace(',','.')); return isNaN(v)?def:v; }

  function s2FxScript(pfx){   // evalscript "Alabama" lendo os IDs pfx+gain/gamma/rmin/…
    const V=k=>fxVal(pfx+k,FXDEF[k]);
    const g=V('gain'),gm=V('gamma'),rn=V('rmin'),rx=V('rmax'),gn=V('gmin'),gx=V('gmax'),bn=V('bmin'),bx=V('bmax');
    return '//VERSION=3\n'
      +'function setup(){return {input:["B04","B03","B02","dataMask"],output:{bands:4}};}\n'
      +'function adj(refl,g,gm,mn,mx){var v=2.5*refl;v=v*g;v=Math.pow(Math.max(0,v),gm);v=mn+v*(mx-mn);return Math.max(0,Math.min(1,v));}\n'
      +'function evaluatePixel(s){return [adj(s.B04,'+g+','+gm+','+rn+','+rx+'),adj(s.B03,'+g+','+gm+','+gn+','+gx+'),adj(s.B02,'+g+','+gm+','+bn+','+bx+'),s.dataMask];}';
  }
  function s2FxLabels(pfx){ const a=gid(pfx+'gainv'); if(a) a.textContent=fxVal(pfx+'gain',FXDEF.gain).toFixed(1); const b=gid(pfx+'gammav'); if(b) b.textContent=fxVal(pfx+'gamma',FXDEF.gamma).toFixed(2); }
  function s2FxResetVals(pfx){ Object.keys(FXDEF).forEach(k=>{ const e=gid(pfx+k); if(e) e.value=FXDEF[k]; }); }

  async function s2Buscar(centerLL, maxcc){   // catálogo keyless Copernicus → [{date,cloud}] (1/dia, ≤maxcc%, 6 meses)
    const de=new Date(Date.now()-180*864e5).toISOString().slice(0,10);
    const filtro="Collection/Name eq 'SENTINEL-2' and contains(Name,'MSIL2A') and OData.CSC.Intersects(area=geography'SRID=4326;POINT("+centerLL[1]+" "+centerLL[0]+")') and ContentDate/Start gt "+de+"T00:00:00.000Z";
    const url="https://catalogue.dataspace.copernicus.eu/odata/v1/Products?$filter="+encodeURIComponent(filtro)+"&$orderby=ContentDate/Start desc&$top=50&$expand=Attributes";
    const r=await fetch(url); const j=await r.json(); const seen={}, passes=[];
    (j.value||[]).forEach(p=>{ const cc=(p.Attributes||[]).find(a=>a.Name==='cloudCover'); const cloud=cc?Math.round(cc.Value):null;
      const date=((p.ContentDate&&p.ContentDate.Start)||'').slice(0,10);
      if(!date||seen[date]) return; seen[date]=1; if(cloud!=null && cloud>maxcc) return; passes.push({date,cloud}); });
    return passes;
  }
  function optHTML(passes, maxcc){ return '<option value="">— '+passes.length+' passagens ≤'+maxcc+'% nuvem —</option>'
    +passes.map(p=>'<option value="'+p.date+'">'+p.date+' · '+(p.cloud!=null?p.cloud+'% nuvem':'nuvem ?')+'</option>').join(''); }

  function layerSet(pfx){
    const _h=new Date(), _d=new Date(_h.getTime()-120*864e5), _iso=x=>x.toISOString().slice(0,10);
    const wms=(layers,extra)=>L.tileLayer.wms('https://sh.dataspace.copernicus.eu/ogc/wms/'+SHINST,Object.assign({layers:layers,format:'image/png',version:'1.3.0',maxZoom:22,maxNativeZoom:16,attribution:'Sentinel-2 © Copernicus/CDSE',TIME:_iso(_d)+'/'+_iso(_h),MAXCC:'20',PRIORITY:'mostRecent',showLogo:false,UPSAMPLING:'BICUBIC'},extra||{}));
    const google=L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',{maxZoom:22,maxNativeZoom:21,subdomains:['mt0','mt1','mt2','mt3'],attribution:'Imagery © Google'});
    const esri=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:22,maxNativeZoom:19,attribution:'Imagery © Esri'});
    const croqui=L.tileLayer('data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',{maxZoom:22,attribution:'Croqui'});
    const s2=wms('TRUE_COLOR',{evalscript:btoa(s2FxScript(pfx+'_fx_'))});   // cor natural com ajuste "Alabama"
    const ndvi=wms('VEGETATION_INDEX'), agri=wms('AGRICULTURE'), moist=wms('MOISTURE_INDEX'), cir=wms('COLOR_INFRARED');
    const eox=y=>L.tileLayer('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-'+y+'_3857/default/g/{z}/{y}/{x}.jpg',{maxZoom:22,maxNativeZoom:16,attribution:'Sentinel-2 cloudless '+y+' © EOX'});
    const eox24=eox('2024'), eox23=eox('2023');
    const bases={'Satélite (Google)':google,'Satélite (Esri)':esri,'Sentinel-2 — cor natural (data)':s2,'Sentinel-2 — NDVI (vigor)':ndvi,'Sentinel-2 — Agricultura':agri,'Sentinel-2 — Umidade':moist,'Sentinel-2 — Infravermelho':cir,'Sentinel-2 cloudless 2024':eox24,'Sentinel-2 cloudless 2023':eox23,'Croqui (limpo)':croqui};
    return {bases:bases, s2:s2, variants:[s2,ndvi,agri,moist,cir], all:[google,esri,croqui,s2,ndvi,agri,moist,cir,eox24,eox23]};
  }
  function fxInner(pfx){
    const p=pfx+'_fx_';
    const sl=(k,mn,mx,st,v)=>'<input id="'+p+k+'" type="range" min="'+mn+'" max="'+mx+'" step="'+st+'" value="'+v+'" oninput="_mgFx(\''+pfx+'\')" style="width:110px">';
    const nu=(k,v)=>'<input id="'+p+k+'" type="number" step="0.01" min="0" max="1" value="'+v+'" oninput="_mgFx(\''+pfx+'\')" style="width:56px">';
    return '<label class="hint" style="display:inline-flex;align-items:center;gap:5px">Gain '+sl('gain',0.5,5,0.1,3.6)+'<b id="'+p+'gainv" style="min-width:26px">3.6</b></label>'
      +'<label class="hint" style="display:inline-flex;align-items:center;gap:5px">Gamma '+sl('gamma',0.2,2,0.05,1.5)+'<b id="'+p+'gammav" style="min-width:30px">1.50</b></label>'
      +'<span class="hint" style="display:inline-flex;align-items:center;gap:3px;color:#ff8a8a">Red '+nu('rmin',0)+'–'+nu('rmax',0.45)+'</span>'
      +'<span class="hint" style="display:inline-flex;align-items:center;gap:3px;color:#7fe0a0">Green '+nu('gmin',0.1)+'–'+nu('gmax',0.7)+'</span>'
      +'<span class="hint" style="display:inline-flex;align-items:center;gap:3px;color:#8ab6ff">Blue '+nu('bmin',0.25)+'–'+nu('bmax',1)+'</span>'
      +'<button type="button" class="btn sm" onclick="_mgFxReset(\''+pfx+'\')">↺ Alabama</button>';
  }
  function toolbarHTML(pfx){
    const box='pointer-events:auto;background:rgba(9,16,34,.93);border:1px solid #2c4a78;border-radius:10px;padding:6px 10px;box-shadow:0 6px 18px rgba(0,0,0,.45);max-width:72vw';
    return '<div style="'+box+';display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
        +'<span class="hint" style="font-weight:700;color:#8ab6ff">🛰️ Imagem</span>'
        +'<button type="button" class="btn sm" onclick="_mgBuscar(\''+pfx+'\')">🔄 buscar</button>'
        +'<select id="'+pfx+'_s2date" onchange="_mgPick(\''+pfx+'\',this.value)" style="max-width:180px"><option value="">— busque as passagens —</option></select>'
        +'<label class="hint" style="display:inline-flex;align-items:center;gap:3px">máx nuvem <input id="'+pfx+'_s2cc" type="number" min="0" max="100" value="20" style="width:50px">%</label>'
        +'<button type="button" class="btn sm" onclick="_mgFxToggle(\''+pfx+'\')">🎨 cores</button>'
        +'<button type="button" id="'+pfx+'_medbtn" class="btn sm" onclick="_mgMedir(\''+pfx+'\')">📏 medir</button>'
        +'<span id="'+pfx+'_measbox" style="display:none;align-items:center;gap:6px"><span id="'+pfx+'_measout" class="hint"></span><button type="button" class="btn sm" onclick="_mgMedLimpar(\''+pfx+'\')">🧹 limpar</button></span>'
        +'<button type="button" id="'+pfx+'_fullbtn" class="btn sm" onclick="_mgFull(\''+pfx+'\')" title="Tela cheia">⛶ tela cheia</button>'
      +'</div>'
      +'<div id="'+pfx+'_fxpanel" style="'+box+';display:none;margin-top:6px;flex-wrap:wrap;gap:10px;align-items:center">'+fxInner(pfx)+'</div>';
  }
  function overlay(map,pfx){   // barra geral COLADA no topo do mapa (folga p/ zoom à esq. e camadas à dir.)
    const host=map.getContainer();
    try{ if(getComputedStyle(host).position==='static') host.style.position='relative'; }catch(e){}
    const ov=document.createElement('div'); ov.className='mgtools';
    ov.style.cssText='position:absolute;left:52px;right:52px;top:8px;z-index:1000;display:flex;flex-direction:column;gap:6px;align-items:flex-start;pointer-events:none';
    ov.innerHTML=toolbarHTML(pfx);
    L.DomEvent.disableClickPropagation(ov); L.DomEvent.disableScrollPropagation(ov);
    host.appendChild(ov);
  }
  function criar(el, opts){
    opts=opts||{}; const pfx=opts.pfx;
    const map=L.map(el,{zoomControl:true,maxZoom:22,doubleClickZoom:opts.doubleClickZoom!==false,attributionControl:opts.attribution!==false});
    const LS=layerSet(pfx);
    (LS.bases[opts.baseInicial]||LS.bases['Satélite (Google)']).addTo(map);
    L.control.layers(LS.bases,null,{position:'topright',collapsed:true}).addTo(map);
    const inst={map:map, pfx:pfx, s2:LS.s2, variants:LS.variants, all:LS.all, bases:LS.bases,
      centerFn:opts.centerFn||(()=>{ const c=map.getCenter(); return [c.lat,c.lng]; })};
    MG[pfx]=inst;
    inst.meas={on:false,pts:[],layers:[],closed:false};   // ferramenta GERAL: medir distância/área
    map.on('click', e=>{ if(inst.meas.on && !inst.meas.closed){ inst.meas.pts.push([e.latlng.lat,e.latlng.lng]); measRedraw(pfx); } });
    overlay(map,pfx);
    s2FxLabels(pfx+'_fx_');
    return inst;
  }
  function setBase(pfx,layer){ const I=MG[pfx]; if(!I||!layer) return; I.all.forEach(b=>{ if(b!==layer && I.map.hasLayer(b)) I.map.removeLayer(b); }); if(!I.map.hasLayer(layer)) layer.addTo(I.map); }

  /* ---- MEDIR (ferramenta GERAL): distância + área, em qualquer mapa ---- */
  function haversine(a,b){ const R=6371000, tr=x=>x*Math.PI/180; const dLat=tr(b[0]-a[0]), dLon=tr(b[1]-a[1]); const s=Math.sin(dLat/2)**2+Math.cos(tr(a[0]))*Math.cos(tr(b[0]))*Math.sin(dLon/2)**2; return 2*R*Math.asin(Math.sqrt(s)); }
  function polyAreaHa(pts){ if(pts.length<3) return 0; const R=6371000, tr=x=>x*Math.PI/180; let s=0; for(let i=0;i<pts.length;i++){ const p1=pts[i], p2=pts[(i+1)%pts.length]; s+=(tr(p2[1])-tr(p1[1]))*(2+Math.sin(tr(p1[0]))+Math.sin(tr(p2[0]))); } return Math.abs(s*R*R/2)/10000; }
  function measIcon(hl){ return L.divIcon({className:'',iconSize:[16,16],iconAnchor:[8,8],html:'<div style="width:16px;height:16px;border-radius:50%;background:'+(hl?'#7ee787':'#ffd24a')+';border:2px solid #111;box-shadow:0 0 0 1px #fff'+(hl?',0 0 7px #7ee787':'')+';cursor:'+(hl?'pointer':'move')+'"></div>'}); }
  function measReadout(pfx){ const I=MG[pfx]; if(!I||!I.meas) return; const m=I.meas; let dist=0; for(let i=1;i<m.pts.length;i++) dist+=haversine(m.pts[i-1],m.pts[i]); if(m.closed&&m.pts.length>=3) dist+=haversine(m.pts[m.pts.length-1],m.pts[0]); const area=m.pts.length>=3?polyAreaHa(m.pts):0; const out=gid(pfx+'_measout');
    if(out) out.innerHTML=(m.pts.length<1)?'clique no mapa p/ marcar · arraste os pontos · 1º ponto (verde) fecha a área · clique num ponto apaga':('<b>'+(dist>=1000?(dist/1000).toFixed(2)+' km':Math.round(dist)+' m')+'</b>'+(area>0?' · <b>'+(area<0.1?Math.round(area*10000)+' m²':area.toFixed(2)+' ha')+'</b>':'')); }
  function measRedraw(pfx){ const I=MG[pfx]; if(!I||!I.meas) return; const m=I.meas; m.layers.forEach(l=>I.map.removeLayer(l)); m.layers=[]; m._line=null;
    if(m.pts.length>=2){ m._line=(m.closed&&m.pts.length>=3)?L.polygon(m.pts,{color:'#ffd24a',weight:2,fillColor:'#ffd24a',fillOpacity:.18,interactive:false}).addTo(I.map):L.polyline(m.pts,{color:'#ffd24a',weight:2,dashArray:'5 4',interactive:false}).addTo(I.map); m.layers.push(m._line); }
    m.pts.forEach((p,i)=>{ const podeFechar=(i===0 && !m.closed && m.pts.length>=3); const mk=L.marker(p,{draggable:true,icon:measIcon(podeFechar),zIndexOffset:1000}).addTo(I.map); m.layers.push(mk);
      mk.on('drag', e=>{ m.pts[i]=[e.latlng.lat,e.latlng.lng]; if(m._line) m._line.setLatLngs(m.pts); measReadout(pfx); });
      mk.on('click', ev=>{ L.DomEvent.stop(ev); if(i===0 && !m.closed && m.pts.length>=3){ m.closed=true; } else { m.pts.splice(i,1); if(m.pts.length<3) m.closed=false; } measRedraw(pfx); }); });
    measReadout(pfx); }

  /* públicos — chamados pelos módulos (_mgCriar) e pelos handlers inline da barra */
  window._mgCriar=criar;
  window._mgInst=function(pfx){ return MG[pfx]; };
  window._mgSetBase=setBase;
  window._mgFxToggle=function(pfx){ const p=gid(pfx+'_fxpanel'); if(p) p.style.display=(p.style.display==='flex')?'none':'flex'; };
  window._mgMedir=function(pfx){ const I=MG[pfx]; if(!I) return; I.meas=I.meas||{on:false,pts:[],layers:[],closed:false}; const m=I.meas; m.on=!m.on;
    const b=gid(pfx+'_medbtn'), box=gid(pfx+'_measbox');
    if(m.on){ if(b){b.style.background='#f0b400';b.style.color='#111';} if(box) box.style.display='inline-flex'; try{I.map.getContainer().style.cursor='crosshair';}catch(e){} measRedraw(pfx); }
    else { m.pts=[]; m.closed=false; measRedraw(pfx); if(b){b.style.background='';b.style.color='';} if(box) box.style.display='none'; try{I.map.getContainer().style.cursor='';}catch(e){} } };
  window._mgMedLimpar=function(pfx){ const I=MG[pfx]; if(!I||!I.meas) return; I.meas.pts=[]; I.meas.closed=false; measRedraw(pfx); };
  window._mgFull=function(pfx){ const I=MG[pfx]; if(!I) return; const el=I.map.getContainer(); const on=el.classList.toggle('mg-full'); const b=gid(pfx+'_fullbtn'); if(b) b.textContent=on?'⛶ sair':'⛶ tela cheia'; setTimeout(()=>{ try{I.map.invalidateSize();}catch(e){} },60); };
  if(!window._mgFullCss){ window._mgFullCss=true; const s=document.createElement('style'); s.textContent='.mg-full{position:fixed!important;left:0!important;top:0!important;right:0!important;bottom:0!important;width:auto!important;height:auto!important;z-index:100000!important;border-radius:0!important;margin:0!important}'; (document.head||document.documentElement).appendChild(s); }
  window._mgFx=function(pfx){ const I=MG[pfx]; s2FxLabels(pfx+'_fx_'); if(I&&I.s2) I.s2.setParams({evalscript:btoa(s2FxScript(pfx+'_fx_'))}); };
  window._mgFxReset=function(pfx){ s2FxResetVals(pfx+'_fx_'); window._mgFx(pfx); };
  window._mgPick=function(pfx,date){ const I=MG[pfx]; if(!date||!I) return; I.variants.forEach(l=>l.setParams({TIME:date,MAXCC:'100'})); const ativa=I.variants.find(l=>I.map.hasLayer(l)); setBase(pfx, ativa||I.s2); const s=gid(pfx+'_s2date'); if(s&&s.value!==date) s.value=date; };
  window._mgBuscar=async function(pfx){ const I=MG[pfx]; if(!I) return; const c=I.centerFn&&I.centerFn(); if(!c){ alert('Sem referência de local para buscar a imagem (selecione o lote ou centralize o mapa).'); return; }
    const sel=gid(pfx+'_s2date'); const ccEl=gid(pfx+'_s2cc'); const maxcc=Math.max(0,Math.min(100,+((ccEl&&ccEl.value)||20)));
    if(sel) sel.innerHTML='<option value="">buscando passagens…</option>';
    try{ const passes=await s2Buscar(c, maxcc); if(sel) sel.innerHTML=optHTML(passes, maxcc);
      if(!passes.length) alert('Nenhuma passagem com ≤'+maxcc+'% de nuvem nos últimos 6 meses. Aumente o "máx nuvem".');
      else window._mgPick(pfx, passes[0].date);
    }catch(e){ if(sel) sel.innerHTML='<option value="">erro ao buscar</option>'; alert('Erro ao buscar passagens (Copernicus): '+e.message); }
  };
})();
