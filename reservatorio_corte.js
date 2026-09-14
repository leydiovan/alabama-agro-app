/* =====================================================================
   reservatorio_corte.js — o PISCINÃO no mapa + a janela com o corte lateral
   =====================================================================
   ARQUIVO ÚNICO, puxado por quem mostra o reservatório:
     05_modulos_outros/modulo_telemetria.html  (<script src="../reservatorio_corte.js">)
     mobile/index.html                         (<script src="../reservatorio_corte.js">)
   Mesma regra do mapa_ferramenta_geral.js: NÃO copiar para dentro de um módulo —
   cópia diverge e um lado passa a mostrar o piscinão diferente do outro.
   DEPLOY: este arquivo tem de ir junto no tools/deploy_site.ps1.

   Criado em 14/09/2026 a pedido do dono ("desenha o talude lá no mapa para ficar
   mais real"; "quando clica, abre uma janela além das informações completas uma
   imagem de um corte... pega também os canos, aí sei se a água já tá acima ou
   abaixo da sucção, já mostra a casa de bomba").

   DADOS (migrações 105/106): situação pronta da view `reservatorio_vigia`;
   contorno e anéis do talude em `reservatorio.geom` (UTM23S); calibração e
   offset no cadastro. O critério de OK/FALHA/MUDO mora na view — aqui só pinta.

   GEOMETRIA DO CORTE (conferida pelo dono em 14/09/2026; registro em
   `Chat Claude estação e telemetria/docs/nivel-reservatorio-22ago2026.md`):
   terreno de fora +2,00 · crista +6,00 · talude 3,07:1 dos dois lados · testa
   ~5,5 m · adutoras DN 400 com topo em +2,40 seguindo o chão, reta e 90° para
   baixo até a boca da sucção = 0,00 · lado fundo −0,30 (onde fica a sonda).
   Cores do real: grama por fora, lona PRETA por dentro, testa bege.

   0 mA NÃO É VAZIO: em falha a view manda nível nulo — não se desenha água e a
   tela diz "sem leitura válida". Tratar isso como 0 m mostraria reservatório
   seco com a sonda arrancada.
   ===================================================================== */
(function(){
  const COR = {'OK':'#00c896','BATERIA BAIXA':'#ffb300','FALHA':'#ff4444','MUDO':'#ff4444'};
  const br = (n,d)=>(n==null||isNaN(n))?'—':Number(n).toFixed(d).replace('.',',');

  /* linha do cadastro -> anéis em [lat,lon]. `conv(E,N)` é a conversão UTM de
     quem chama (cada página já tem a sua). */
  function prepararCadastro(row, conv){
    let g=row.geom; if(typeof g==='string'){ try{ g=JSON.parse(g); }catch(e){ g=null; } }
    const ll=ring=>(Array.isArray(ring)&&ring.length>2) ? ring.map(v=>conv(+v[0],+v[1])) : null;
    const an=g&&g.aneis;
    return {
      nome: row.nome,
      max: row.nivel_max_m!=null ? Number(row.nivel_max_m) : null,
      off: Number(row.offset_fundo_m)||0,
      anel: ll(g&&g.ring),
      aneis: an ? { crista_ext:ll(an.crista_ext), crista_int:ll(an.crista_int), fundo:ll(an.fundo),
                    agua:(an.agua||[]).map(x=>({h:Number(x.h), anel:ll(x.ring)})).filter(x=>x.anel) } : null
    };
  }

  /* TALUDE NO MAPA: faixas em anel com furo (grama, testa, lona) e a ÁGUA no
     anel pré-calculado mais próximo do nível (passo de 25 cm). */
  function desenhar(L, grupo, r, c, aoClicar){
    if(!c||!c.anel) return;
    const cor=COR[r.situacao]||'#8b949e', a=c.aneis;
    const faixa=(fora,dentro,fc,op)=>L.polygon([fora,dentro],{stroke:false,fillColor:fc,fillOpacity:op,interactive:false}).addTo(grupo);
    if(a && a.crista_ext && a.crista_int){
      faixa(c.anel, a.crista_ext, '#3f8f3a', .8);            // talude de fora — grama
      faixa(a.crista_ext, a.crista_int, '#c9b48a', .8);      // testa
      let agua=null;
      if(r.nivel_m!=null && a.agua && a.agua.length){
        const h=Math.max(0,Math.min(6,Number(r.nivel_m)));
        if(h>0.12) agua=a.agua.reduce((m,x)=>Math.abs(x.h-h)<Math.abs(m.h-h)?x:m).anel;
      }
      if(agua) faixa(a.crista_int, agua, '#111111', .88);    // talude de dentro seco — lona
      else if(a.fundo) faixa(a.crista_int, a.fundo, '#111111', .88);
      if(a.fundo) L.polygon(a.fundo,{color:'#bbdefb',weight:1,dashArray:'6 5',opacity:.55,fill:!agua,fillColor:'#111111',fillOpacity:.88,interactive:false}).addTo(grupo);
      if(agua) L.polygon(agua,{stroke:false,fillColor:'#1e88e5',fillOpacity:.8,interactive:false}).addTo(grupo);
    }
    const borda=L.polygon(c.anel,{color:cor,weight:2.4,opacity:.95,fill:true,fillOpacity:0,bubblingMouseEvents:false})
      .addTo(grupo).on('click', aoClicar);
    /* SÓ A PORCENTAGEM no mapa, grande, no meio do piscinão (pedido do dono,
       14/09/2026: "as escritas não precisa; quando clica abre todas as
       informações"). Em falha/mudo não há %: aparece a palavra, na cor do alerta. */
    const rot = r.pct_cheio!=null ? Math.round(Number(r.pct_cheio))+'%'
              : r.situacao==='MUDO' ? 'sem sinal' : r.situacao==='FALHA' ? 'falha' : '—';
    const corRot = r.pct_cheio!=null ? '#ffffff' : cor;
    L.marker(borda.getBounds().getCenter(),{keyboard:false, zIndexOffset:500, icon:L.divIcon({className:'', iconSize:[0,0], iconAnchor:[0,0],
      html:`<div style="position:absolute;transform:translate(-50%,-50%);white-space:nowrap;font:800 28px/1 system-ui,sans-serif;color:${corRot};text-shadow:0 0 3px #000,0 0 9px #000,0 2px 3px #000;cursor:pointer">${rot}</div>`})})
      .on('click', aoClicar).addTo(grupo);
  }

  /* a frase que responde a pergunta do dono: acima ou abaixo da sucção */
  function manchete(r){
    const h=r.nivel_m!=null?Number(r.nivel_m):null;
    if(h==null) return {txt:'Sem leitura válida da sonda', cor:'#ff4444'};
    if(h<=0) return {txt:'ÁGUA ABAIXO DA BOCA DA SUCÇÃO', cor:'#ff4444'};
    if(h<0.5) return {txt:'Água '+br(h*100,0)+' cm acima da boca da sucção — atenção', cor:'#ffb300'};
    return {txt:'Água '+br(h,2)+' m acima da boca da sucção', cor:'#00c896'};
  }

  /* CORTE LATERAL esquemático. Altura exagerada ~7× para caber na tela.
     `compacto` (tela estreita): o desenho CABE na largura, as letras crescem ~1,8×
     e somem os rótulos secundários (grama, lona, testa…) — no celular o corte
     inteiro aparece de cara e a pinça amplia o detalhe (dono, 14/09/2026: "abre
     com a imagem cortada, tem que arrastar para o lado"). A manchete saiu do SVG
     e virou texto da janela, para ter tamanho de letra de verdade. */
  function corteSVG(r,c,compacto){
    const K=6, V=40, T=3.07, Y0=330, F=compacto?1.8:1;
    const y=z=>+(Y0-z*V).toFixed(1);
    const toeL=150, cOutL=toeL+4*T*K, cInL=cOutL+5.5*K, botL=cInL+6*T*K;
    const pocA=540, pocB=580, botR=650, cInR=botR+6.3*T*K, cOutR=cInR+5.5*K, toeR=cOutR+4*T*K;
    const xL=z=>botL-z*T*K, xR=z=>botR+(z+0.3)*T*K;
    const P=a=>a.map(p=>(+p[0]).toFixed(1)+','+p[1]).join(' ');
    const txt=(x,yy,s,o={})=>(compacto&&o.m) ? '' : `<text x="${(+x).toFixed(1)}" y="${yy}" fill="${o.c||'#e8edf5'}" font-size="${((o.s||12)*F).toFixed(1)}" font-weight="${o.b?700:400}" text-anchor="${o.a||'start'}" stroke="#0b121b" stroke-width="${(3*F).toFixed(1)}" paint-order="stroke">${s}</text>`;
    const h=r.nivel_m!=null?Math.max(-0.3,Math.min(6,Number(r.nivel_m))):null;
    const off=Number(c.off)||0;
    const xs=botL+1.8*K+14;
    let agua='';
    if(h!=null && h>-0.3){
      const pts = h>0
        ? [[xL(h),y(h)],[xR(h),y(h)],[botR,y(-0.3)],[pocB,y(-0.3)],[pocA,y(0)],[botL,y(0)]]
        : [[pocA+(-h/0.3)*(pocB-pocA),y(h)],[xR(h),y(h)],[botR,y(-0.3)],[pocB,y(-0.3)]];
      agua=`<polygon points="${P(pts)}" fill="#1e88e5" opacity=".88"/>
        ${h>0?`<rect x="${xs-16}" y="${y(0)}" width="32" height="${0.3*V}" fill="#1e88e5" opacity=".88"/>`:''}
        <line x1="${pts[0][0].toFixed(1)}" y1="${y(h)}" x2="${pts[1][0].toFixed(1)}" y2="${y(h)}" stroke="#90caf9" stroke-width="2"/>
        ${txt((Math.max(xL(Math.max(h,0)),pocA)+xR(h))/2, y(h)-8, '▼ '+br(h,2)+' m', {a:'middle', s:15, b:1})}`;
    }
    const sz = off<=-0.29 ? -0.3 : Math.max(-0.3, Math.min(0.5, off));
    const sx = sz<=-0.29 ? botR-14 : xR(sz);
    const pole=cInR+16;
    const regua=[0,1,2,3,4,5,6].filter(z=>!compacto||z%2===0).map(z=>`<line x1="462" x2="474" y1="${y(z)}" y2="${y(z)}" stroke="#cfd8dc" stroke-width="1.2"/>${txt(478, y(z)+4*F, z+' m', {s:10, c:'#cfd8dc'})}`).join('');
    return `<svg viewBox="0 0 1000 420" width="100%" style="display:block;font-family:system-ui,sans-serif">
      <rect x="0" y="0" width="1000" height="420" fill="#0b121b"/>
      <polygon points="${P([[0,y(2)],[toeL,y(2)],[cOutL,y(6)],[cInL,y(6)],[botL,y(0)],[pocA,y(0)],[pocB,y(-0.3)],[botR,y(-0.3)],[cInR,y(6)],[cOutR,y(6)],[toeR,y(2)],[1000,y(2)],[1000,420],[0,420]])}" fill="#5b4631"/>
      <rect x="${xs-16}" y="${y(0)}" width="32" height="${0.3*V}" fill="#0a0a0a"/>
      <polyline points="${P([[0,y(2)],[toeL,y(2)],[cOutL,y(6)]])}" fill="none" stroke="#43a047" stroke-width="6"/>
      <polyline points="${P([[cOutR,y(6)],[toeR,y(2)],[1000,y(2)]])}" fill="none" stroke="#43a047" stroke-width="6"/>
      <line x1="${cOutL}" y1="${y(6)}" x2="${cInL}" y2="${y(6)}" stroke="#c9b48a" stroke-width="6"/>
      <line x1="${cInR}" y1="${y(6)}" x2="${cOutR}" y2="${y(6)}" stroke="#c9b48a" stroke-width="6"/>
      <polyline points="${P([[cInL,y(6)],[botL,y(0)],[pocA,y(0)],[pocB,y(-0.3)],[botR,y(-0.3)],[cInR,y(6)]])}" fill="none" stroke="#0a0a0a" stroke-width="6" stroke-linejoin="round"/>
      ${agua}
      <line x1="${xL(5.5)}" y1="${y(5.5)}" x2="${xR(5.5)}" y2="${y(5.5)}" stroke="#ffb300" stroke-width="1.5" stroke-dasharray="8 6"/>
      ${txt(xR(5.5)-6, y(5.5)-5, 'ladrão 5,50 m', {a:'end', s:11, c:'#ffcc66'})}
      <line x1="500" y1="${y(-0.02)}" x2="512" y2="${y(-0.02)-14}" stroke="#e8edf5" stroke-width="1.4"/>
      <line x1="508" y1="${y(-0.02)}" x2="520" y2="${y(-0.02)-14}" stroke="#e8edf5" stroke-width="1.4"/>
      ${txt(440, y(0)+22, 'fundo — largura fora de escala', {a:'middle', s:10, c:'#8ba0bd', m:1})}
      ${regua}
      <path d="M 112 ${y(2.2)} H ${xs} V ${y(0.25)}" fill="none" stroke="#4b535c" stroke-width="20" stroke-linejoin="round"/>
      <path d="M 112 ${y(2.2)} H ${xs} V ${y(0.25)}" fill="none" stroke="#aab4be" stroke-width="13" stroke-linejoin="round"/>
      <path d="M ${xs-13} ${y(0)} L ${xs-7} ${y(0.28)} H ${xs+7} L ${xs+13} ${y(0)} Z" fill="#aab4be" stroke="#4b535c" stroke-width="2"/>
      ${txt(196, y(2.4)-8, 'adutora de sucção DN 400', {s:11, m:1})}
      ${txt(xs+18, y(0)+4*F, compacto?'◄ sucção 0,00':'◄ boca da sucção = 0,00', {s:11, b:1, c:'#ffe082'})}
      <rect x="14" y="${y(2)-72}" width="98" height="72" fill="#cfd8dc" stroke="#78909c" stroke-width="2"/>
      <polygon points="${P([[6,y(2)-72],[63,y(2)-100],[120,y(2)-72]])}" fill="#90a4ae"/>
      <circle cx="62" cy="${y(2.2)}" r="14" fill="#1976d2" stroke="#fff" stroke-width="2"/>
      ${txt(compacto?8:62, y(2)-(compacto?108:80), compacto?'casa de bomba':'casa de bomba', {a:compacto?'start':'middle', s:12, b:1})}
      ${txt(62, y(2)-108, '↑ recalque → pivôs', {a:'middle', s:11, c:'#90caf9', m:1})}
      ${txt(90, y(2)+18, 'terreno +2,00', {s:11, c:'#a5d6a7', m:1})}
      ${txt(cInL, y(6)-10, 'crista +6,00', {a:'middle', s:11, m:1})}
      ${txt(cOutL-8, y(6)+6, 'testa ~5,5 m', {a:'end', s:10, c:'#e6d7b0', m:1})}
      ${txt((toeL+cOutL)/2-34, y(4)+4, 'grama', {a:'middle', s:11, c:'#a5d6a7', m:1})}
      ${txt((cInL+botL)/2+30, y(3.2), 'lona', {s:11, c:'#bdbdbd', m:1})}
      ${txt(560, y(-0.3)+18, 'lado fundo −0,30', {a:'middle', s:10, c:'#8ba0bd', m:1})}
      <line x1="${pole}" y1="${y(6)}" x2="${pole}" y2="${y(6)-74}" stroke="#b0bec5" stroke-width="3"/>
      <polygon points="${P([[pole-26,y(6)-70],[pole+22,y(6)-84],[pole+26,y(6)-72],[pole-22,y(6)-58]])}" fill="#1565c0" stroke="#90caf9"/>
      <rect x="${pole-9}" y="${y(6)-36}" width="18" height="20" fill="#eceff1" stroke="#78909c"/>
      ${txt(compacto?pole-30:pole+16, y(6)-92, compacto?'nó LoRa':'nó solar + LoRa', {a:'middle', s:11})}
      <polyline points="${P([[pole,y(6)-16],[cInR+2,y(6)-5],[sx+6,y(sz)-8]])}" fill="none" stroke="#ffc107" stroke-width="2"/>
      <rect x="${sx-6}" y="${y(sz)-14}" width="12" height="14" rx="2" fill="#ffc107" stroke="#6d4c00"/>
      ${txt(sx+10, y(sz)+16*F, 'sonda', {s:11, b:1, c:'#ffd54f'})}
      ${off<-0.05?`<circle cx="${xR(0)+4}" cy="${y(0)-8}" r="8" fill="none" stroke="#ffc107" stroke-dasharray="3 3"/>${txt(xR(0)+16, y(0)+4, 'subir '+br(-off*100,0)+' cm', {s:10, c:'#ffd54f', m:1})}`:''}
      ${txt(986, 412, 'corte esquemático · altura exagerada ~7× · fundo fora de escala', {a:'end', s:10, c:'#8ba0bd', m:1})}
    </svg>`;
  }

  /* PINÇA DE ZOOM no corte (dois dedos amplia; um dedo arrasta quando ampliado;
     toque/clique duplo amplia e volta; Ctrl+roda ou pinça do touchpad no PC).
     O estado fica guardado aqui, então a atualização periódica da janela não
     joga o zoom fora. Parado em 1×, um dedo rola a janela normalmente. */
  let Z={s:1,x:0,y:0};
  function ligarPinca(){
    const box=document.getElementById('resvCorteBox'), inn=document.getElementById('resvCorteIn');
    if(!box||!inn) return;
    const lim=()=>{ Z.s=Math.max(1,Math.min(5,Z.s)); const w=box.clientWidth, hh=box.clientHeight;
      Z.x=Math.min(0,Math.max(w-w*Z.s,Z.x)); Z.y=Math.min(0,Math.max(hh-hh*Z.s,Z.y)); };
    const aplica=()=>{ lim(); inn.style.transform=`translate(${Z.x}px,${Z.y}px) scale(${Z.s})`;
      box.style.touchAction = Z.s>1.01 ? 'none' : 'pan-y'; box.style.cursor = Z.s>1.01 ? 'grab' : 'zoom-in'; };
    const rel=e=>{ const b=box.getBoundingClientRect(); return {x:e.clientX-b.left, y:e.clientY-b.top}; };
    const zoomEm=(p,ns)=>{ ns=Math.max(1,Math.min(5,ns)); const k=ns/Z.s; Z.x=p.x-(p.x-Z.x)*k; Z.y=p.y-(p.y-Z.y)*k; Z.s=ns; if(ns<=1.01) Z={s:1,x:0,y:0}; aplica(); };
    const pts=new Map(); let pinca=null, arr=null, ultimo=0;
    box.addEventListener('pointerdown',e=>{
      try{ box.setPointerCapture(e.pointerId); }catch(_){}
      pts.set(e.pointerId, rel(e));
      if(pts.size===2){ const [a,b]=[...pts.values()]; pinca={d:Math.hypot(a.x-b.x,a.y-b.y)||1, s:Z.s}; arr=null; return; }
      if(pts.size===1){
        const p=rel(e), agora=Date.now();
        if(agora-ultimo<320){ ultimo=0; zoomEm(p, Z.s>1.01?1:2.5); return; }
        ultimo=agora; arr = Z.s>1.01 ? {p, x:Z.x, y:Z.y} : null;
      }
    });
    box.addEventListener('pointermove',e=>{
      if(!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, rel(e));
      if(pts.size===2 && pinca){ const [a,b]=[...pts.values()];
        zoomEm({x:(a.x+b.x)/2, y:(a.y+b.y)/2}, pinca.s*Math.hypot(a.x-b.x,a.y-b.y)/pinca.d); e.preventDefault(); }
      else if(pts.size===1 && arr){ const p=rel(e); Z.x=arr.x+(p.x-arr.p.x); Z.y=arr.y+(p.y-arr.p.y); aplica(); e.preventDefault(); }
    });
    const solta=e=>{ pts.delete(e.pointerId); if(pts.size<2) pinca=null; if(!pts.size) arr=null; };
    box.addEventListener('pointerup',solta); box.addEventListener('pointercancel',solta);
    box.addEventListener('wheel',e=>{ if(!e.ctrlKey) return; e.preventDefault(); zoomEm(rel(e), Z.s*(e.deltaY<0?1.15:1/1.15)); },{passive:false});
    aplica();
  }

  /* JANELA: corte + cartões + gráfico de 24 h. `fonte(id)` devolve {r, c, serie}
     com os dados MAIS NOVOS de quem chama — assim a janela aberta acompanha o
     ciclo de atualização da página (atualizarJanela) sem guardar cópia. */
  let abertaId=null, fonteAtual=null, ultimoHTML='';
  function fecharJanela(){ abertaId=null; fonteAtual=null; ultimoHTML=''; const j=document.getElementById('resvJan'); if(j) j.remove(); }
  document.addEventListener('keydown',e=>{ if(e.key==='Escape' && abertaId!=null) fecharJanela(); });
  function abrirJanela(id, fonte){ abertaId=id; fonteAtual=fonte; ultimoHTML=''; Z={s:1,x:0,y:0}; atualizarJanela(); }
  function atualizarJanela(){
    if(abertaId==null || !fonteAtual) return;
    const {r,c,serie}=fonteAtual(abertaId)||{};
    if(!r||!c){ fecharJanela(); return; }
    let j=document.getElementById('resvJan');
    if(!j){
      j=document.createElement('div'); j.id='resvJan';
      j.style.cssText='position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;padding:10px';
      j.onclick=e=>{ if(e.target===j) fecharJanela(); };
      document.body.appendChild(j);
    }
    const cor=COR[r.situacao]||'#8b949e';
    const h=r.nivel_m!=null?Number(r.nivel_m):null;
    const man=manchete(r), compacto=window.innerWidth<700;
    const idade=r.medido_em?Math.round((Date.now()-new Date(r.medido_em))/1000):null;
    const v=r.variacao_cm_h;
    const hm=t=>new Date(t).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    const card=(rot,val,sub,cv)=>`<div style="background:#132033;border:1px solid #26364d;border-radius:10px;padding:10px 12px">
        <div style="font-size:11px;color:#8ba0bd;text-transform:uppercase;letter-spacing:.04em">${rot}</div>
        <div style="font-size:20px;font-weight:700;color:${cv||'#e8edf5'};margin-top:2px">${val}</div>
        ${sub?`<div style="font-size:12px;color:#8ba0bd;margin-top:2px">${sub}</div>`:''}</div>`;
    let suc='sem leitura', sucCor='#ff4444';
    if(h!=null){
      if(h<=0){ suc='ABAIXO da sucção'; sucCor='#ff4444'; }
      else if(h<0.5){ suc=br(h*100,0)+' cm acima'; sucCor='#ffb300'; }
      else { suc=br(h,2)+' m acima'; sucCor='#00c896'; }
    }
    const s=(serie||[]).filter(x=>x.nivel_m!=null);
    let graf='';
    if(s.length>1){
      const W=300,H=46, ys=s.map(x=>+x.nivel_m), mn=Math.min(...ys), mx=Math.max(...ys);
      const d=s.map((x,k)=>(k?'L':'M')+(k/(s.length-1)*W).toFixed(1)+' '+(H-3-(mx>mn?(+x.nivel_m-mn)/(mx-mn):.5)*(H-6)).toFixed(1)).join('');
      graf=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:46px"><path d="${d}" fill="none" stroke="#38bdf8" stroke-width="2"/></svg>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#8ba0bd"><span>${hm(s[0].hora)}</span><span>${br(mn,2)} a ${br(mx,2)} m · últimas 24 h, por hora</span><span>${hm(s[s.length-1].hora)}</span></div>`;
    }
    /* min-width:0 + border-box: item de flex não encolhe abaixo do conteúdo por
       padrão — com o corte de 760 px dentro, a janela ficava mais larga que o
       celular e o ✕ saía da tela (pego no teste de 375 px, 14/09/2026). O corte
       rola de lado dentro da própria caixa. */
    const html=`<div style="box-sizing:border-box;min-width:0;background:#0f1722;border:1px solid #26364d;border-radius:14px;max-width:1080px;width:100%;max-height:96vh;overflow:auto;color:#e8edf5;box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:system-ui,sans-serif">
      <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #26364d;flex-wrap:wrap">
        <span style="width:12px;height:12px;border-radius:50%;background:${cor}"></span>
        <b style="font-size:18px">${c.nome||'Reservatório'}</b>
        <span style="font-weight:700;color:${cor};font-size:13px">${r.situacao}</span>
        <button id="resvFecha" title="fechar (Esc)" style="margin-left:auto;background:none;border:1px solid #26364d;color:#e8edf5;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:16px">✕</button>
        <span style="flex-basis:100%;font-size:12px;color:#8ba0bd">${r.medido_em?new Date(r.medido_em).toLocaleString('pt-BR'):''}${idade!=null?' · leitura de '+(idade<120?idade+' s':Math.round(idade/60)+' min')+' atrás':''}</span>
      </div>
      <div style="padding:12px 16px">
        <div style="font-size:${compacto?15:17}px;font-weight:700;color:${man.cor};margin:0 0 8px">${man.txt}</div>
        <div id="resvCorteBox" style="position:relative;overflow:hidden;background:#0b121b;border:1px solid #26364d;border-radius:10px;touch-action:pan-y;user-select:none;-webkit-user-select:none">
          <div id="resvCorteIn" style="transform-origin:0 0;will-change:transform">${corteSVG(r,c,compacto)}</div>
        </div>
        <div style="font-size:11px;color:#8ba0bd;margin-top:4px;text-align:center">${compacto?'pinça para ampliar · toque duplo amplia e volta':'clique duplo amplia e volta · Ctrl + roda do mouse'}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-top:12px">
          ${card('Nível', h!=null?br(h,2)+' m':'—', c.max!=null?'ladrão em '+br(c.max,2)+' m':'', h!=null?null:'#ff4444')}
          ${card('Em relação à sucção', suc, 'boca da sucção = 0,00', sucCor)}
          ${card('Cheio', r.pct_cheio!=null?br(r.pct_cheio,1)+' %':'—', 'do nível do ladrão')}
          ${card('Volume', r.volume_m3!=null?Math.round(r.volume_m3).toLocaleString('pt-BR')+' m³':'—', r.volume_m3!=null?br(r.volume_m3/1000,1)+' milhões de litros':'')}
          ${card('Variação', v!=null?(v>0?'▲ ':v<0?'▼ ':'')+br(Math.abs(v),1)+' cm/h':'—', 'última hora fechada')}
          ${card('Bateria', r.bateria_mv!=null?br(r.bateria_mv/1000,2)+' V':'—', 'no borne do nó')}
          ${card('Sonda', r.ma!=null?br(r.ma,3)+' mA':'—', '4 mA = sonda fora da água')}
        </div>
        ${graf?`<div style="margin-top:12px;background:#132033;border:1px solid #26364d;border-radius:10px;padding:10px 12px">${graf}</div>`:''}
        ${(c.off||0)<-0.05?`<div style="margin-top:10px;font-size:12px;color:#ffb300">Sonda provisoriamente ${br(-c.off*100,0)} cm abaixo da boca da sucção — o nível já desconta. Ao subir a sonda, zerar o ajuste no cadastro.</div>`:''}
      </div></div>`;
    /* só reescreve se mudou: senão a janela voltaria ao topo a cada ciclo,
       no meio da leitura (no celular a janela rola) */
    if(html!==ultimoHTML){ j.innerHTML=html; ultimoHTML=html; ligarPinca(); }
    const b=document.getElementById('resvFecha'); if(b) b.onclick=fecharJanela;
  }

  window.RESV_UI = { COR, prepararCadastro, desenhar, corteSVG, abrirJanela, atualizarJanela, fecharJanela };
})();
