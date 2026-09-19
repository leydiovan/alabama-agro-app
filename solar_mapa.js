/* =====================================================================
   solar_mapa.js — as USINAS (pivôs + 4 poços) no mapa + janela de detalhe
   =====================================================================
   ARQUIVO ÚNICO, puxado por quem mostra as usinas:
     05_modulos_outros/modulo_telemetria.html  (<script src="../solar_mapa.js">)
     mobile/index.html                         (<script src="../solar_mapa.js">)
   Mesma regra do `mapa_ferramenta_geral.js` e do `reservatorio_corte.js`:
   NÃO copiar para dentro de um módulo — cópia diverge e um lado passa a
   mostrar a usina diferente do outro.
   DEPLOY: este arquivo tem de ir junto no `tools/deploy_site.ps1`.

   Criado em 18/09/2026, a pedido do dono ("quero o desenho das usinas, as
   placas, a bateria e os poços nos locais reais").

   DADOS
     `solar_vigia`  (migração 109) — situação PRONTA: OK / MUDO / FALHA /
                    ALARME / BATERIA BAIXA, com a frase escrita. O critério
                    mora na view; aqui só se pinta.
     `solar_sitio.geom` (migração 110) — contorno em UTM 23S, formato dos lotes.
     `solar_inversor_atual` — o detalhe por inversor, na janela.

   PRECISÃO DO DESENHO (honestidade que a tela deve preservar)
   O contorno veio do Sentinel-2, 10 m por pixel: localiza a usina, não desenha
   mesa por mesa. As fileiras, a bateria e a casa de aparelhos só existem onde
   o dono descreveu o arranjo — e o arranjo MUDA de usina para usina. Por isso
   `detalhe` é opcional e cada sítio tem o seu; nada é herdado por padrão.
   ===================================================================== */
(function () {
  const COR = { 'OK': '#00c896', 'ALARME': '#ffb300', 'BATERIA BAIXA': '#ffb300',
                'FALHA': '#ff4444', 'MUDO': '#ff4444' };
  const br = (n, d) => (n == null || isNaN(n)) ? '—' : Number(n).toFixed(d).replace('.', ',');

  /* linha do cadastro -> anéis em [lat,lon]. `conv(E,N)` é a conversão UTM de
     quem chama (cada página já tem a sua). */
  function prepararCadastro(row, conv) {
    let g = row.geom; if (typeof g === 'string') { try { g = JSON.parse(g); } catch (e) { g = null; } }
    const ll = r => (Array.isArray(r) && r.length > 2) ? r.map(v => conv(+v[0], +v[1])) : null;
    const anel = ll(g && g.ring);
    const c = {
      id: row.id, nome: row.nome, tipo: row.tipo,
      anel: anel,
      fonte: g && g.fonte,
      benfeitorias: [],
    };
    if (anel && g && g.arranjo) Object.assign(c, arranjar(anel, g.arranjo));
    /* BENFEITORIAS (bateria, casa de aparelhos) são POR SÍTIO: o dono avisou em
       18/09/2026 que a posição MUDA de usina para usina — nada é herdado.
       Guardadas em METROS a partir do centro do polígono (x ao longo do
       comprimento, y ao longo da largura), e não em lat/lon: assim elas andam
       junto se o contorno for corrigido, em vez de ficarem para trás. */
    if (anel && g && g.benfeitorias) {
      const eixo = eixos(anel);
      /* ÂNCORA: `ax`/`ay` dizem de que borda do CONJUNTO DE PLACAS a medida
         parte ('dir'/'esq', 'sup'/'inf'), e `dx`/`dy` são os metros a partir
         dela — negativo para dentro. Sem âncora, `x`/`y` continuam valendo a
         partir do centro do polígono, como antes. */
      const pl = c.placas || { sx: 0, sy: 0 };
      const ancX = (b, d) => (b.ax === 'dir' ? pl.sx : b.ax === 'esq' ? -pl.sx : 0) + (d || 0);
      const ancY = (b, d) => (b.ay === 'sup' ? pl.sy : b.ay === 'inf' ? -pl.sy : 0) + (d || 0);
      g.benfeitorias.forEach(b => {
        if (!b.ax && !b.ay) return;
        b.x = ancX(b, b.dx); b.y = ancY(b, b.dy);
        if (b.dx2 != null) { b.x2 = ancX(b, b.dx2); b.y2 = ancY(b, b.dy2); }
      });
      c.benfeitorias = g.benfeitorias.map(b => {
        // `girado`: o lado declarado como comprimento passa a correr no sentido
        // da LARGURA. Foi o caso da bateria do poço 01 — o dono girou ela para
        // os 2,5 m dela acompanharem os 2,5 m da casa.
        const cc = b.girado ? b.l : b.c, ll2 = b.girado ? b.c : b.l;
        return {
          id: b.id, rot: b.rot, tipo: b.tipo || 'caixa', c: b.c, l: b.l,
          raio: b.raio,
          ponto: eixo.ponto(b.x, b.y),
          // tubulação: a linha do eixo E o corpo do cano com largura de verdade.
          // Só a linha não serve: a espessura dela é em PIXELS, então o cano
          // parecia grosso de perto e virava risco de caneta ao afastar. O
          // corpo é um retângulo em METROS, e acompanha o zoom como o resto.
          linha: (b.x2 != null) ? [ eixo.ponto(b.x, b.y), eixo.ponto(b.x2, b.y2) ] : null,
          corpo: (b.x2 != null) ? eixo.faixa(b.x, b.y, b.x2, b.y2, b.diam || 0.2) : null,
          anel: (b.c && b.l) ? eixo.caixa(b.x, b.y, cc, ll2) : null,
          // TELHADO DE UMA ÁGUA (corrigido pelo dono em 18/09/2026): não há
          // cumeeira no meio; há a parte ALTA numa borda e o beiral na outra.
          // `caimento` diz para que lado desce: 'n','s','l','o'.
          alto: (b.tipo === 'casa') ? bordaAlta(eixo, b, cc, ll2) : null,
        };
      });
    }
    return c;
  }

  /* A borda ALTA do telhado de uma água (a linha de cima; o beiral fica na
     borda oposta). Sem ela o telhado vira um retângulo chapado e ninguém sabe
     para que lado a água corre. */
  function bordaAlta(eixo, b, cc, ll2) {
    const d = b.caimento || 's';                 // padrão: água desce para o sul
    if (d === 's') return [ eixo.ponto(b.x - cc / 2, b.y + ll2 / 2), eixo.ponto(b.x + cc / 2, b.y + ll2 / 2) ];
    if (d === 'n') return [ eixo.ponto(b.x - cc / 2, b.y - ll2 / 2), eixo.ponto(b.x + cc / 2, b.y - ll2 / 2) ];
    if (d === 'l') return [ eixo.ponto(b.x - cc / 2, b.y - ll2 / 2), eixo.ponto(b.x - cc / 2, b.y + ll2 / 2) ];
    return [ eixo.ponto(b.x + cc / 2, b.y - ll2 / 2), eixo.ponto(b.x + cc / 2, b.y + ll2 / 2) ];
  }

  /* Eixos locais do polígono: x ao longo do comprimento, y ao longo da largura.
     Serve tanto para as placas quanto para as benfeitorias — uma conta só. */
  function eixos(anel) {
    const mLat = 111320, mLon = la => 111320 * Math.cos(la * Math.PI / 180);
    const o = [ (anel[0][0] + anel[2][0]) / 2, (anel[0][1] + anel[2][1]) / 2 ];
    const xy = p => [ (p[1] - o[1]) * mLon(o[0]), (p[0] - o[0]) * mLat ];
    const ll = (x, y) => [ o[0] + y / mLat, o[1] + x / mLon(o[0]) ];
    const P = anel.map(xy);
    const lado = (i, j) => [P[j][0] - P[i][0], P[j][1] - P[i][1]];
    const l01 = lado(0, 1), l12 = lado(1, 2);
    const n01 = Math.hypot(l01[0], l01[1]), n12 = Math.hypot(l12[0], l12[1]);
    const comp = n01 >= n12 ? l01 : l12, larg = n01 >= n12 ? l12 : l01;
    const L = Math.max(n01, n12), W = Math.min(n01, n12);
    const u = [comp[0] / L, comp[1] / L], v = [larg[0] / W, larg[1] / W];
    const ponto = (s, t) => ll(u[0] * s + v[0] * t, u[1] * s + v[1] * t);
    const caixa = (s, t, cc, ll2) => [[-cc / 2, -ll2 / 2], [cc / 2, -ll2 / 2], [cc / 2, ll2 / 2], [-cc / 2, ll2 / 2]]
      .map(([ds, dt]) => ponto(s + ds, t + dt));
    /* Faixa entre dois pontos, com largura em metros — é o corpo do cano.
       A perpendicular sai da própria direção do trecho, então serve para
       qualquer ângulo. */
    const faixa = (s1, t1, s2, t2, larg) => {
      const ds = s2 - s1, dt = t2 - t1, n = Math.hypot(ds, dt) || 1;
      const ps = -dt / n * larg / 2, pt = ds / n * larg / 2;
      return [ ponto(s1 + ps, t1 + pt), ponto(s2 + ps, t2 + pt),
               ponto(s2 - ps, t2 - pt), ponto(s1 - ps, t1 - pt) ];
    };
    return { L, W, ponto, caixa, faixa };
  }

  /* AS PLACAS, DESENHADAS UMA A UMA — geradas aqui, não guardadas no banco.
     Descrição do dono (18/09/2026): "deixa um espaço no meio do polígono, que é
     o espaçamento da sombra entre as duas fileiras; cada fileira tem dois
     painéis pelo lado mais comprido do módulo, um em cima do outro, e vai assim
     um do lado do outro até o limite do comprimento".
     Ou seja: módulo DEITADO (lado maior na horizontal), 2 empilhados formam a
     altura da fileira, e a fileira se repete ao longo do comprimento.

     Por que gerar aqui e guardar só os PARÂMETROS no banco: são ~140 módulos
     por usina; guardar o polígono de cada um seriam dezenas de KB por sítio
     para um desenho que a própria conta refaz. E ajustar o arranjo passa a ser
     mudar um número, não regravar geometria. */
  function arranjar(anel, a) {
    // Módulo EM PÉ (retrato): o lado comprido vai de sul para norte, ou seja,
    // ao longo da LARGURA do polígono. Dois em pé, um sobre o outro, formam a
    // altura da fileira; eles se repetem lado a lado ao longo do comprimento.
    // (Correção do dono em 18/09/2026 — a primeira versão desenhou deitado.)
    const prop = (a.modulo_c || 2.28) / (a.modulo_l || 1.134);     // comprido ÷ estreito
    const empilhados = a.empilhados || 2, nFil = a.fileiras || 2;
    const mLat = 111320, mLon = la => 111320 * Math.cos(la * Math.PI / 180);
    const o = [ (anel[0][0] + anel[2][0]) / 2, (anel[0][1] + anel[2][1]) / 2 ];      // centro
    const xy = p => [ (p[1] - o[1]) * mLon(o[0]), (p[0] - o[0]) * mLat ];            // [leste, norte] em m
    const ll = (x, y) => [ o[0] + y / mLat, o[1] + x / mLon(o[0]) ];
    const P = anel.map(xy);
    // eixo comprido = o maior dos dois lados do retângulo
    const lado = (i, j) => [P[j][0] - P[i][0], P[j][1] - P[i][1]];
    const l01 = lado(0, 1), l12 = lado(1, 2);
    const n01 = Math.hypot(l01[0], l01[1]), n12 = Math.hypot(l12[0], l12[1]);
    const comp = n01 >= n12 ? l01 : l12, larg = n01 >= n12 ? l12 : l01;
    const L = Math.max(n01, n12), W = Math.min(n01, n12);
    const u = [comp[0] / L, comp[1] / L];                 // ao longo do comprimento
    const v = [larg[0] / W, larg[1] / W];                 // ao longo da largura
    const ponto = (s, t) => ll(u[0] * s + v[0] * t, u[1] * s + v[1] * t);
    const caixa = (s, t, cc, ll2) => [[-cc / 2, -ll2 / 2], [cc / 2, -ll2 / 2], [cc / 2, ll2 / 2], [-cc / 2, ll2 / 2]]
      .map(([ds, dt]) => ponto(s + ds, t + dt));

    /* A LARGURA É REPARTIDA EM PORCENTAGEM, não em metros (dono, 18/09/2026):
       "entre as duas fileiras duplas deixa 20% do polígono vazio, e os outros
       40% de cada lado preenche com as placas". Fazer em porcentagem é o certo
       aqui porque o contorno veio do Sentinel (±10 m): a PROPORÇÃO do arranjo é
       conhecida, a medida exata não. Se um dia chegar o as-built, troca-se por
       metros sem mexer no desenho. */
    /* Vale para QUALQUER número de fileiras. Com 2, é o caso dos poços
       (40 % + 20 % de vão + 40 %). Com 6, é a usina dos pivôs: a mesma fração
       total de placas, repartida em seis, e os vãos divididos entre elas. */
    /* DOIS MODOS, e a diferença é de honestidade:
       - 'real': o módulo tem o tamanho de verdade (do projeto) e o conjunto
         ocupa o que ocupa. Só dá para usar quando se sabe quantos módulos são.
       - proporcional: o módulo é esticado para preencher a fração da largura
         que o dono descreveu. É o que sobra enquanto não há projeto — e faz o
         desenho parecer maior do que é.
       A usina dos pivôs virou 'real' em 18/09/2026, quando chegou o as-built. */
    const real = a.escala === 'real';
    const modAltR = a.modulo_c || 2.28, modLargR = a.modulo_l || 1.134;
    const pctTotal = a.placas_pct || ((a.fileira_pct || 0.40) * (a.fileiras || 2));
    const pctVao = 1 - pctTotal;
    const altFileira = real ? empilhados * modAltR : W * pctTotal / nFil;
    const modAlt = altFileira / empilhados;
    let modLarg = real ? modLargR : modAlt / prop;
    /* COLUNAS E CORREDORES (dono, 18/09/2026, corrigindo a primeira leitura):
       a usina se divide em POUCAS colunas — na dos pivôs são 3 — e o corredor
       de 1,5 m existe ENTRE elas, ou seja, 2 corredores. Não é um vão entre
       cada módulo: assim seriam dezenas de corredores e a usina teria metade
       das placas que tem. */
    const nCol = a.colunas || 1, corredor = a.corredor || 0;
    const util = L - (nCol - 1) * corredor;               // comprimento que sobra para placas
    let largCol = util / nCol;
    /* `por_coluna` vem do PROJETO quando existe (o as-built da SV Agro diz
       quantos módulos há em cada bloco). Só quando não existe é que se estima
       pelo espaço — estimativa é o que se usa até o desenho oficial chegar. */
    /* `total` é a CONTAGEM de módulos informada pelo dono (18/09/2026: 252 nos
       poços 01–03, 282 no poço 04). Quando ela existe, manda nela: as posições
       são geradas até bater o número e o resto da última fileira fica vazio —
       é o que acontece na usina de verdade, onde o número de módulos raramente
       fecha um retângulo exato. Arredondar para cima e desenhar a mais seria
       inventar placa que não existe. */
    const total = a.total || null;
    const porCol = a.por_coluna || (total ? Math.ceil(total / (nFil * empilhados * nCol))
                                          : Math.max(1, Math.floor(largCol / modLarg)));
    if (a.por_coluna && !real) modLarg = largCol / porCol;  // sem projeto: o módulo se ajusta à coluna
    if (real) largCol = porCol * modLarg;                   // com projeto: a coluna é o que as placas ocupam
    const n = porCol * nCol;
    /* CENTRALIZADO no polígono (dono, 18/09/2026). No tamanho real o conjunto
       é menor que o contorno do Sentinel — 125,5 m contra 139,7 m na usina dos
       pivôs. Encostar na ponta esquerda faria parecer que ele está deslocado
       para um lado, o que é afirmação que ninguém mediu. Centrar não afirma
       nada além do que se sabe. */
    const larguraTotal = nCol * largCol + (nCol - 1) * corredor;
    const x0 = -larguraTotal / 2;
    // no modo real o vão é o que sobra da largura depois das fileiras
    /* `vao_m` fixa o vão de sombra em metros. Nos poços ele foi copiado da
       usina dos pivôs (5,35 m), que é a única com projeto: entre chutar um
       vão e usar o que a mesma instaladora fez no sítio vizinho, o segundo
       erra menos. */
    const vao = a.vao_m != null ? a.vao_m
              : (nFil > 1 ? ((real ? W - nFil * altFileira : W * pctVao)) / (nFil - 1) : 0);
    const passo = altFileira + vao;
    const fileiras = [], modulos = [];
    /* AS STRINGS, LIDAS DA PRANCHA (SV Agro 05/12, "Strings dos módulos
       alterados", 29/07/2025) — rótulos e posições extraídos do próprio PDF.
       Cada string é uma LINHA de 18 módulos: a mesa tem dois níveis, e cada
       nível de um bloco leva 36 módulos, ou seja 2 strings (metade esquerda e
       metade direita). São 12 linhas (6 mesas × 2 níveis) × 6 strings = 72, em
       8 inversores de 9 MPPTs — uma string por MPPT.
       `planta` é essa tabela, de CIMA para baixo e da ESQUERDA para a direita,
       com o rótulo da prancha "inversor.MPPT.string". Ter a tabela é o que faz
       o desenho parar de adivinhar: a divisão que eu tinha deduzido (9 módulos
       × 2 níveis, em bloco) parecia razoável e estava ERRADA — a prancha mostra
       a string correndo na horizontal. */
    const mps = a.modulos_por_string || 0;
    const planta = a.planta || null;
    const porLinha = mps ? Math.round(porCol / mps) : 0;   // strings por bloco, em cada nível
    const grupos = {};
    for (let f = 0; f < nFil; f++) {
      // da borda norte para a sul, com as fileiras centradas na largura
      const t = (nFil - 1) / 2 * passo - f * passo;
      for (let col = 0; col < nCol; col++)
        fileiras.push(caixa(x0 + col * (largCol + corredor) + largCol / 2, t, largCol, altFileira));
      for (let i = 0; i < n; i++) {
        if (total && modulos.length >= total) break;
        const col = Math.floor(i / porCol), dentro = i % porCol;
        const xCol = x0 + col * (largCol + corredor);          // início da coluna
        const s = xCol + dentro * modLarg + modLarg / 2;
        for (let e = 0; e < empilhados; e++) {
          if (total && modulos.length >= total) break;
          const tm = t - altFileira / 2 + modAlt / 2 + e * modAlt;
          modulos.push(caixa(s, tm, modLarg * 0.96, modAlt * 0.97));
          if (mps) {
            /* a que string este módulo pertence: a LINHA (mesa × nível, contada
               de cima para baixo, que é como a prancha desenha) e a METADE do
               bloco (coluna × posição dentro dela). */
            const linha = f * empilhados + (empilhados - 1 - e);
            const metade = col * porLinha + Math.floor(dentro / mps);
            const k = linha + ':' + metade;
            const g = grupos[k] || (grupos[k] = { linha, metade, s0: s, s1: s, t0: tm, t1: tm, qtd: 0 });
            g.s0 = Math.min(g.s0, s); g.s1 = Math.max(g.s1, s);
            g.t0 = Math.min(g.t0, tm); g.t1 = Math.max(g.t1, tm);
            g.qtd++;
          }
        }
      }
    }
    /* Cada string vira um QUADRO — a moldura em volta dos módulos dela. É o
       que separa uma da outra sem repintar módulo por módulo. */
    /* `enderecos` é o de-para entre a PRANCHA e o MODBUS: {"1": 1, "2": 2, …},
       o endereço RS-485 de cada inversor numerado na prancha. A prancha numera
       1..8; o logger enxerga o endereço configurado em cada aparelho, e os dois
       não são obrigatoriamente a mesma coisa — dois inversores vieram com
       endereço repetido e foram para 10 e 11 em campo. Sem esse de-para a
       string fica sem cor de alerta: pintar vermelho no inversor errado manda
       procurar defeito na mesa errada. */
    const ends = a.enderecos || null;
    const strings = Object.keys(grupos).map(k => {
      const g = grupos[k];
      const rot = (planta && planta[g.linha]) ? planta[g.linha][g.metade] : null;
      const parte = rot ? String(rot).split('.') : null;
      const inv = parte ? +parte[0] : null, mppt = parte ? +parte[1] : null;
      return {
        rot: rot ? ('ST ' + rot) : null, qtd: g.qtd, linha: g.linha, metade: g.metade,
        inv: inv, mppt: mppt,
        /* o MPPT é o que o Modbus chama de PV: o SUN2000-75KTL tem 9 MPPTs e
           aqui vai uma string em cada, então PV<n> = MPPT<n>. */
        pv: mppt,
        endereco: (ends && inv != null && ends[inv] != null) ? ends[inv] : null,
        quadro: caixa((g.s0 + g.s1) / 2, (g.t0 + g.t1) / 2,
                      (g.s1 - g.s0) + modLarg, (g.t1 - g.t0) + modAlt),
      };
    }).sort((x, y) => x.linha - y.linha || x.metade - y.metade);
    /* AS MEIAS-MEDIDAS DO CONJUNTO DE PLACAS. Servem de âncora para a bateria,
       a casa e o poço: o dono descreve a posição delas em relação à USINA
       ("do lado esquerdo da usina, a 3 metros"), não em relação ao contorno do
       Sentinel. Enquanto as duas coisas coincidiam dava no mesmo; quando o
       arranjo passou a ser o real, o conjunto encolheu dentro do contorno e as
       benfeitorias ficariam para trás. */
    const alturaTotal = nFil * altFileira + (nFil - 1) * vao;
    return { fileiras, modulos, strings, strings_conferido: !!a.strings_conferido,
             placas: { sx: larguraTotal / 2, sy: alturaTotal / 2 },
             medidas: { L: +L.toFixed(1), W: +W.toFixed(1), n_modulos: modulos.length, strings_n: strings.length,
             fileiras_n: nFil, colunas: nCol, por_coluna: porCol, corredor: corredor, vao: +vao.toFixed(1), modulo: modLarg.toFixed(2) + ' x ' + modAlt.toFixed(2) + ' m' } };
  }

  /* A usina no mapa: contorno pintado pela situação, fileiras de placas em
     escuro (é o que se vê do alto) e as benfeitorias marcadas. */
  function desenhar(L, grupo, v, c, aoClicar) {
    if (!c || !c.anel) return;
    const cor = COR[v && v.situacao] || '#8b949e';
    /* DE LONGE, SÓ O QUE SE DECIDE OLHANDO (dono, 18/09/2026: "ficou muito
       poluído"). Numa vista de fazenda inteira, cinco usinas × quatro ícones
       viram um enxame de bolinhas que esconde o mapa. Então de longe fica
       apenas o bloco central — carga da bateria, geração, consumo e o estado
       da bomba — e o detalhe (casa, bateria, hidrômetro, a pílula com o kW da
       bomba) só aparece quando alguém aproxima para olhar aquela usina. */
    const z = grupo._map ? grupo._map.getZoom() : 0;
    const perto = z >= 18;

    L.polygon(c.anel, { color: cor, weight: 2, opacity: .95, fillColor: '#1b2430', fillOpacity: .35,
                        bubblingMouseEvents: false }).addTo(grupo).on('click', aoClicar);

    /* AS FILEIRAS sempre; OS MÓDULOS um a um só de perto. São ~140 por usina:
       de longe viram um borrão que custa desenho à toa, e no celular isso pesa.
       Os módulos vão num ÚNICO polígono com vários anéis (multipolígono) —
       uma camada em vez de 140. */
    if (c.fileiras && c.fileiras.length) {
      /* As faixas escuras das fileiras só aparecem DE LONGE, quando os módulos
         não são desenhados — senão elas viram um quadrado preto por cima das
         placas (o dono pediu para tirar em 18/09/2026). De perto, quem mostra
         a fileira são os próprios módulos. */
      if (z < 17) c.fileiras.forEach(f => L.polygon(f, { stroke: false, fillColor: '#0d1b2a',
        fillOpacity: .85, interactive: false }).addTo(grupo));
      if (z >= 17 && c.modulos && c.modulos.length)
        L.polygon(c.modulos.map(m => [m]), { color: '#5aa9ff', weight: .6, opacity: .85,
          fillColor: '#123a6b', fillOpacity: .95, bubblingMouseEvents: false }).addTo(grupo)
          .on('click', () => aoClicar('string'))
          .bindTooltip('placas — abre as strings', { direction: 'top' });
      /* AS STRINGS por cima das placas: uma moldura em volta dos módulos de
         cada uma. Só de bem perto (z >= 18) — de longe 72 molduras viram um
         rabisco e escondem justamente o que deviam mostrar.
         A COR é neutra enquanto o mapa string -> posição não foi conferido em
         campo: a divisão do desenho vem do projeto (18 módulos por string),
         mas QUAL delas é a PV3 do inversor 2 no Modbus é suposição. Pintar
         vermelho na string errada mandaria alguém procurar defeito no lugar
         errado — e o desenho perderia a confiança de quem usa. */
      if (z >= 18 && c.strings && c.strings.length) {
        const corS = { 'OK': '#00c896', 'FRACA': '#ffb300', 'SEM CORRENTE': '#ff4444' };
        const leit = (v && v.strings) || [];
        c.strings.forEach(s => {
          /* Só pinta a situação quando a string sabe QUAL inversor do Modbus é
             o dela (`enderecos` no arranjo). A prancha numera os inversores de
             1 a 8; o logger enxerga o endereço configurado no aparelho, e dois
             deles foram para 10 e 11 depois de virem repetidos de fábrica.
             Sem o de-para, pintar vermelho manda procurar defeito na mesa
             errada — então a moldura fica neutra e só separa. */
          const dado = s.endereco != null
            ? leit.find(x => x.endereco === s.endereco && x.string_n === s.pv) : null;
          const cor = (dado && corS[dado.situacao]) || '#dbe9f7';
          const rot = (s.rot || 'string') +
                      (s.inv ? ' — Inversor ' + s.inv + ' · MPPT ' + s.mppt : '') +
                      ' · ' + s.qtd + ' módulos' +
                      (dado ? (' — ' + dado.situacao + ' · ' + (dado.corrente_a != null ? dado.corrente_a + ' A' : ''))
                            : (s.endereco == null ? ' (sem o de-para do inversor no Modbus)' : ''));
          L.polygon(s.quadro, { color: cor, weight: dado ? 2 : 1.4, opacity: dado ? .95 : .7,
            fillColor: dado ? cor : ((s.linha + s.metade) % 2 ? '#7fc4ff' : '#0a1626'),
            fillOpacity: dado ? .18 : .12, bubblingMouseEvents: false })
            .addTo(grupo)
            .on('click', () => aoClicar(s.endereco != null
                                        ? ('string:' + s.endereco + ':' + s.pv) : 'string'))
            .bindTooltip(rot, { direction: 'top' });
        });
      }
    }
    /* ALVO DE CLIQUE DE TAMANHO FIXO (18/09/2026, pedido do dono: "lá na casa é
       difícil clicar, ela aparece bem pequena").
       A casa tem 5 × 2,5 m: no zoom em que se vê a usina inteira ela dá poucos
       PIXELS, e no celular ninguém acerta com o dedo. A geometria continua no
       tamanho real — o que se acrescenta é um BOTÃO que não encolhe: 26 px na
       tela, sempre, seja qual for o zoom. Desenho e alvo de toque são coisas
       diferentes, e tratá-los como a mesma coisa é o que torna mapa impossível
       de usar no telefone. */
    const icone = { casa: '⌂', bateria: '▮', poco: '◎', hidrometro: '◍' };
    const abaDe = { casa: 'inversores', bateria: 'bateria', poco: 'geral', hidrometro: 'geral' };
    if (perto) (c.benfeitorias || []).forEach(b => {
      if (!icone[b.tipo] || !b.ponto) return;
      L.marker(b.ponto, { keyboard: false, zIndexOffset: 700, icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13],
        html: '<div style="width:26px;height:26px;border-radius:50%;background:rgba(10,12,16,.72);border:1.5px solid #8fb9e0;' +
              'display:flex;align-items:center;justify-content:center;color:#cfe4f7;font:700 14px/1 system-ui,sans-serif;cursor:pointer">' +
              icone[b.tipo] + '</div>' }) })
        .addTo(grupo).on('click', () => aoClicar(abaDe[b.tipo]))
        .bindTooltip(b.rot || b.id, { direction: 'top' });
    });

    /* BENFEITORIAS. A casa vai com TELHADO DE UMA ÁGUA visto de cima: um plano
       só, com a borda alta marcada em claro. É o que se enxerga numa foto
       aérea, e é o que faz a pessoa reconhecer o lugar na tela. */
    (c.benfeitorias || []).forEach(b => {
      if (b.tipo === 'casa') {
        L.polygon(b.anel, { stroke: false, fillColor: '#a2552f', fillOpacity: .95, interactive: false }).addTo(grupo);
        if (b.alto) L.polyline(b.alto, { color: '#f0c49b', weight: 1.6, opacity: .95, interactive: false }).addTo(grupo);
        L.polygon(b.anel, { color: '#5a2f18', weight: 1.2, fill: false, bubblingMouseEvents: false })
          .addTo(grupo).on('click', () => aoClicar('inversores'))
          .bindTooltip((b.rot || b.id) + ' · abre os inversores', { direction: 'top' });
      } else if (b.tipo === 'tubo') {
        /* O cano de metal que sai do poço e corre na superfície até entrar no
           chão. Desenhado em duas passadas (escuro por baixo, claro por cima)
           para parecer tubo e não risco de caneta. */
        /* Duas camadas: o CORPO em metros (some quando se afasta, e tudo bem)
           e uma linha fina por cima, que garante o cano visível de longe. */
        /* O CANO TEM 20 cm: na escala do mapa isso é um fio de cabelo (1 px lá
           pelo zoom 20). Então vão os dois: o corpo em metros, que é a verdade
           geométrica, e por cima um traço de espessura FIXA, que é o que faz
           enxergar um cano. Mesmo princípio do alvo de clique — o que é exato
           e o que é legível nem sempre é a mesma coisa. */
        L.polyline(b.linha, { color: '#2b323b', weight: 7, opacity: .95, interactive: false }).addTo(grupo);
        L.polyline(b.linha, { color: '#aab6c2', weight: 4, opacity: 1, bubblingMouseEvents: false })
          .addTo(grupo).bindTooltip(b.rot || 'cano', { direction: 'top' });
        L.polyline(b.linha, { color: '#e8eef4', weight: 1, opacity: .7, interactive: false }).addTo(grupo);
        if (b.corpo) L.polygon(b.corpo, { stroke: false, fillColor: '#8d99a6', fillOpacity: .9,
          interactive: false }).addTo(grupo);
        // a ponta onde ele entra no solo
        L.circleMarker(b.linha[1], { radius: 3, color: '#6b4a2a', fillColor: '#6b4a2a', fillOpacity: .95,
          bubblingMouseEvents: false }).addTo(grupo).bindTooltip('entra no solo', { direction: 'top' });
      } else if (b.tipo === 'poco') {
        /* O POÇO, e ao lado dele o estado da BOMBA. O estado vem PRONTO da
           view (migração 113) — aqui não se recalcula nada. Três estados, e o
           terceiro importa: `null` é DESCONHECIDO (dado velho), e desconhecido
           não pode se parecer com desligado. */
        const lig = v && v.bomba_ligada;
        const corB = lig === true ? '#00c896' : lig === false ? '#6b7683' : '#ffb300';
        L.circle(b.ponto, { radius: b.raio || 0.5, color: '#00c2d1', weight: 2, fillColor: '#00363d',
          fillOpacity: .9, bubblingMouseEvents: false }).addTo(grupo)
          .bindTooltip(b.rot || 'poço', { direction: 'top' });
        const txt = lig === true ? 'BOMBA LIGADA' : lig === false ? 'bomba desligada' : 'bomba: sem leitura';
        const detalhe = (v && v.p_carga_kw != null) ? ' · ' + br(v.p_carga_kw, 1) + ' kW' : '';
        /* A pílula com o texto e o kW é detalhe de perto; de longe quem conta
           o estado da bomba é o ícone no bloco central. */
        if (perto) L.marker(b.ponto, { keyboard: false, zIndexOffset: 600, icon: L.divIcon({ className: '', iconSize: [0, 0], iconAnchor: [0, 0],
          html: '<div style="position:absolute;transform:translate(-50%,-190%);display:flex;align-items:center;gap:4px;white-space:nowrap;' +
                'background:rgba(10,12,16,.82);border:1px solid ' + corB + ';border-radius:999px;padding:2px 7px;' +
                'font:700 11px/1 system-ui,sans-serif;color:' + corB + '">' +
                '<span style="width:8px;height:8px;border-radius:50%;background:' + corB +
                (lig === true ? ';box-shadow:0 0 6px ' + corB : '') + '"></span>' + txt + detalhe + '</div>' }) })
          .addTo(grupo).bindTooltip('estado inferido pelo consumo da usina — ainda não há sinal direto da bomba',
            { direction: 'top' });
      } else if (b.tipo === 'hidrometro') {
        L.polygon(b.anel, { color: '#1f7a34', weight: 1.2, fillColor: '#2ecc71', fillOpacity: .95,
          bubblingMouseEvents: false }).addTo(grupo).bindTooltip(b.rot || 'hidrômetro', { direction: 'top' });
      } else {
        L.polygon(b.anel, { color: '#4ea3ff', weight: 1.5, fillColor: '#2f6fb3', fillOpacity: .85,
          bubblingMouseEvents: false }).addTo(grupo)
          .on('click', () => aoClicar(b.id === 'bateria' ? 'bateria' : 'geral'))
          .bindTooltip((b.rot || b.id) + (b.id === 'bateria' ? ' · abre a bateria' : ''), { direction: 'top' });
      }
    });

    /* O BLOCO CENTRAL — o que se lê sem clicar em nada (dono, 18/09/2026):
       a carga da bateria, quanto está gerando, quanto está consumindo e se a
       BOMBA está ligada. São os quatro números que decidem bombear agora ou
       esperar; o resto abre no clique.
       A bomba vira ÍCONE e não texto: de longe, com cinco usinas na tela, um
       rótulo escrito em cada uma vira parede de letra. O ícone diz o estado
       pela cor e some da leitura quando não é o que se procura. */
    const soc = (v && v.soc_pct != null) ? Math.round(Number(v.soc_pct)) + '%'
              : (v && v.situacao === 'MUDO') ? 'sem sinal'
              : (v && v.situacao === 'FALHA') ? 'falha' : '—';
    const corRot = (v && v.soc_pct != null) ? '#ffffff' : cor;
    const sombra = 'text-shadow:0 0 3px #000,0 0 9px #000,0 2px 3px #000';
    const lig = v && v.bomba_ligada;
    /* três estados, e o terceiro importa: `null` é DESCONHECIDO (leitura
       velha), e desconhecido não pode se parecer com desligado. */
    const corB = lig === true ? '#00c896' : lig === false ? '#6b7683' : '#ffb300';
    const bomba = '<svg width="16" height="16" viewBox="0 0 24 24" style="flex:none;filter:drop-shadow(0 1px 2px #000)' +
      (lig === true ? ' drop-shadow(0 0 4px ' + corB + ')' : '') + '">' +
      '<circle cx="10" cy="15" r="6.5" fill="none" stroke="' + corB + '" stroke-width="2.6"/>' +
      '<path d="M10 8.5 V3.5 h9" fill="none" stroke="' + corB + '" stroke-width="2.6" stroke-linecap="round"/></svg>';
    /* A BATERIA como desenho de bateria (dono, 18/09/2026). O número sozinho
       ("88%") obriga a ler; o símbolo com o nível preenchido se entende de
       relance, que é o ponto de uma tela vista de longe. A cor segue a carga —
       e sem leitura ele fica vazio e cinza, que não é o mesmo que zero. */
    const s = (v && v.soc_pct != null) ? Number(v.soc_pct) : null;
    const corS2 = s == null ? '#8b949e' : s >= 50 ? '#00c896' : s >= 20 ? '#ffb300' : '#ff4444';
    const larg = s == null ? 0 : Math.max(1.5, Math.min(100, s) / 100 * 14);
    const pilha = '<svg width="22" height="13" viewBox="0 0 24 14" style="flex:none;filter:drop-shadow(0 1px 2px #000)">' +
      '<rect x="1" y="1.5" width="18" height="11" rx="2.2" fill="none" stroke="' + corS2 + '" stroke-width="2"/>' +
      '<rect x="20.5" y="5" width="2.6" height="4" rx="1" fill="' + corS2 + '"/>' +
      (s == null ? '' : '<rect x="3" y="3.5" width="' + larg.toFixed(1) + '" height="7" rx="1" fill="' + corS2 + '"/>') +
      '</svg>';
    const num = (n, d) => (n == null || isNaN(n)) ? null : br(n, d);
    const ger = num(v && v.p_fv_kw, 0), cons = num(v && v.p_carga_kw, 0);
    const detalhe = [ger != null ? 'ger ' + ger : null, cons != null ? 'cons ' + cons : null]
      .filter(Boolean).join(' · ') + ((ger != null || cons != null) ? ' kW' : '');
    /* QUANTO DO POSSÍVEL ELA ESTÁ GERANDO (pedido do dono, 18/09/2026).
       Este é o número que separa "nublado" de "defeito": 118 kW não diz nada
       sozinho — 118 kW às 9h de céu limpo pode ser ótimo, e às 12h30 seria
       alarme. A conta precisa da CURVA DE CÉU LIMPO de cada usina, que só sai
       com dias de coleta; quando a view passar a devolver `pct_potencial`,
       ele aparece aqui sem mais nenhuma mudança de tela. */
    const pot = num(v && v.pct_potencial, 0);
    /* TUDO NUMA LINHA SÓ, e no VÃO ENTRE AS MESAS (dono, 18/09/2026). Duas
       linhas empilhadas tampavam as placas; uma linha fina cabe na faixa vazia
       que existe no meio da usina — o mesmo vão de sombra que separa as
       fileiras. O centro do polígono já cai nessa faixa porque as fileiras são
       simétricas (2 nos poços, 6 nos pivôs, sempre par). */
    const centro = L.polygon(c.anel).getBounds().getCenter();
    const peca = (txt, est) => '<span style="' + est + ';' + sombra + '">' + txt + '</span>';
    /* DE LONGE, SÓ A CARGA E A BOMBA — nada mais (dono, 18/09/2026). Geração e
       consumo são números que alguém vai ler quando estiver olhando AQUELA
       usina; na vista de fazenda inteira eles só ocupam espaço e escondem o
       mapa. Quem aproxima quer o detalhe; quem está longe quer saber se tem
       carga e se a bomba está rodando. */
    const miolo = pilha +
      peca(soc, 'font:800 15px/1 system-ui,sans-serif;color:' + corRot) +
      bomba +
      (perto && detalhe.trim() ? peca(detalhe, 'font:700 11px/1 system-ui,sans-serif;color:#dbe9f7') : '') +
      (perto && pot != null ? peca(pot + '% do possível', 'font:700 11px/1 system-ui,sans-serif;color:#ffd479') : '');
    L.marker(centro, { keyboard: false, zIndexOffset: 400, icon: L.divIcon({ className: '', iconSize: [0, 0], iconAnchor: [0, 0],
      html: '<div style="position:absolute;transform:translate(-50%,-50%);white-space:nowrap;cursor:pointer;' +
            'display:flex;align-items:center;gap:5px">' + miolo + '</div>' }) })
      .on('click', aoClicar).addTo(grupo)
      .bindTooltip((lig === true ? 'bomba LIGADA' : lig === false ? 'bomba desligada' : 'bomba: sem leitura') +
                   ' · carga da bateria, geração e consumo', { direction: 'top' });
  }

  /* ---------------------------------------------------------------- janela */
  let abertaId = null, fonteAtual = null, ultimoHTML = '', abaAtual = 'geral';

  function fecharJanela() { abertaId = null; const e = document.getElementById('solarJanela'); if (e) e.remove(); }
  /* ABAS: cada parte do desenho abre a sua (pedido do dono, 18/09/2026):
     o meio da usina abre o GERAL, a casa abre os INVERSORES, a bateria abre a
     BATERIA, e cada string abre a dela. A janela é a mesma — muda o que ela
     mostra —, para não virar quatro janelas concorrendo na tela. */
  function abrirJanela(id, fonte, aba) { abertaId = id; fonteAtual = fonte; abaAtual = aba || 'geral'; ultimoHTML = ''; atualizarJanela(); }
  window.SOLAR_ABA = a => { abaAtual = a; ultimoHTML = ''; atualizarJanela(); };

  /* Redesenha do dado ATUAL a cada ciclo da página — sem guardar cópia, para a
     janela aberta não congelar num retrato velho (UI = reflexo do banco). */
  function atualizarJanela() {
    if (!abertaId || !fonteAtual) return;
    const f = fonteAtual(abertaId) || {};
    const v = f.v, inv = f.inversores || [];
    if (!v) return;
    const linha = (r, val) => '<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#9aa3b0">' + r + '</span><b>' + val + '</b></div>';
    const cor = COR[v.situacao] || '#8b949e';

    const est = { '0x200': 'gerando', '0x201': 'limitado', '0x202': 'limitado', '0xa000': 'sem sol' };
    const strings = f.strings || [];
    const aba = (k, r) => '<button onclick="SOLAR_ABA(\'' + k + '\')" style="background:' +
      (abaAtual === k || (k === 'string' && abaAtual.startsWith('string')) ? '#2d4a63' : '#22303f') +
      ';color:#e6e6e6;border:1px solid #33475c;border-radius:6px;padding:3px 8px;margin-right:4px;cursor:pointer;font-size:12px">' + r + '</button>';
    const abas = '<div style="margin:8px 0 6px">' + aba('geral', 'usina') + aba('inversores', 'inversores') +
      aba('bateria', 'bateria') + (strings.length ? aba('string', 'strings') : '') + '</div>';
    const corS = { 'OK': '#00c896', 'FRACA': '#ffb300', 'SEM CORRENTE': '#ff4444', 'SEM SOL': '#6b7683', 'SEM LEITURA': '#8b949e' };
    /* O INVERSOR APARECE PELO NOME, não pelo endereço (dono, 18/09/2026). O
       endereço Modbus (10..17 nos pivôs) é detalhe de fiação: quem está na
       frente da usina procura "Inversor 3", que é como a prancha chama e como
       o próprio logger o nomeia. O endereço só aparece se o logger não tiver
       nome para aquele aparelho. */
    const nomeInv = {};
    inv.forEach(i => { if (i.nome) nomeInv[i.endereco] = i.nome; });
    const chamar = end => nomeInv[end] || ('endereço ' + end);
    /* E EM ORDEM DE NOME, não de endereço (dono, 18/09/2026: "começa pelo 7,
       depois o 1 está lá no meio"). Nos pivôs o endereço 10 é o Inversor 7 e o
       12 é o Inversor 1 — ordenar por endereço espalha a lista numa sequência
       que não existe para quem olha. Ordena-se pelo NÚMERO dentro do nome; sem
       número, o endereço serve de desempate, e esses vão para o fim. */
    const ordem = end => {
      const m = /(\d+)/.exec(nomeInv[end] || '');
      return m ? +m[1] : 1000 + (+end || 0);
    };
    const tabelaStrings = () => strings.length ? ('<table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:12px">' +
      '<tr style="color:#9aa3b0"><td>string</td><td align="right">V</td><td align="right">A</td><td align="right">W</td><td>estado</td></tr>' +
      strings.slice().sort((a, b) => ordem(a.endereco) - ordem(b.endereco) || a.string_n - b.string_n).map(s =>
        '<tr' + (abaAtual === 'string:' + s.endereco + ':' + s.string_n ? ' style="background:#22303f"' : '') + '>' +
        '<td>' + chamar(s.endereco) + ' · PV' + s.string_n + '</td><td align="right">' + br(s.tensao_v, 0) +
        '</td><td align="right">' + br(s.corrente_a, 2) + '</td><td align="right">' + br(s.potencia_w, 0) +
        '</td><td style="color:' + (corS[s.situacao] || '#8b949e') + '">' + s.situacao + '</td></tr>').join('') +
      '</table>') : '<div style="color:#9aa3b0">sem leitura de string ainda</div>';
    const tabela = inv.length ? ('<table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:12px">' +
      '<tr style="color:#9aa3b0"><td>inversor</td><td align="right">kW</td><td align="right">°C</td><td align="right">hoje</td><td>estado</td></tr>' +
      inv.slice().sort((a, b) => ordem(a.endereco) - ordem(b.endereco))
        .map(i => '<tr><td>' + chamar(i.endereco) + '</td><td align="right">' + br(i.p_ativa_kw, 1) +
        '</td><td align="right">' + br(i.temp_c, 0) + '</td><td align="right">' + br(i.e_hoje_kwh, 0) +
        '</td><td>' + (est[String(i.estado).toLowerCase()] || i.estado || '—') +
        (i.falha ? ' <span style="color:#ff4444">falha ' + i.falha + '</span>' : '') + '</td></tr>').join('') +
      '</table>') : '';

    const miolo =
      abaAtual === 'inversores' ? tabela :
      abaAtual === 'bateria' ? (
        linha('Carga (SOC)', br(v.soc_pct, 1) + ' %') +
        linha('Potência', br(v.p_bateria_kw, 1) + ' kW' + (v.p_bateria_kw > 0 ? ' (carregando)' : v.p_bateria_kw < 0 ? ' (descarregando)' : '')) +
        '<div style="margin-top:6px;color:#6b7683;font-size:11px">A bateria aparece SOMADA: o Modbus do logger não separa cada LUNA2000B.</div>') :
      abaAtual.startsWith('string') ? tabelaStrings() :
      (linha('Bateria', br(v.soc_pct, 1) + ' %') +
       linha('Gerando agora', br(v.p_fv_kw, 1) + ' kW') +
       linha('Bateria carrega/descarrega', br(v.p_bateria_kw, 1) + ' kW') +
       linha('Energia hoje', br(v.e_hoje_kwh, 0) + ' kWh') +
       (v.bomba_ligada == null ? '' : linha('Bomba (' + (v.bomba_fonte || 'inferida') + ')',
         (v.bomba_ligada ? 'LIGADA' : 'desligada') + ' · ' + br(v.p_carga_kw, 1) + ' kW')) +
       linha('Leitura', v.idade_s != null ? ('há ' + Math.round(v.idade_s / 60) + ' min') : '—'));
    const html =
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px">' +
        '<b style="font-size:15px">' + (v.nome || abertaId) + '</b>' +
        '<span style="color:' + cor + ';font-weight:700">' + v.situacao + '</span></div>' +
      '<div style="color:#9aa3b0;font-size:12px;margin:2px 0 8px">' + (v.mensagem || '') + '</div>' +
      abas + miolo +
      '<div style="margin-top:8px;color:#6b7683;font-size:11px">Contorno aproximado (Sentinel-2, ~10 m).</div>' +
      '<div style="text-align:right;margin-top:8px"><button onclick="SOLAR_UI.fecharJanela()" ' +
        'style="background:#22303f;color:#e6e6e6;border:1px solid #33475c;border-radius:6px;padding:5px 10px;cursor:pointer">fechar</button></div>';

    if (html === ultimoHTML) return;      // não repinta igual: evita piscar a cada ciclo
    ultimoHTML = html;
    let e = document.getElementById('solarJanela');
    if (!e) {
      e = document.createElement('div');
      e.id = 'solarJanela';
      e.style.cssText = 'position:fixed;z-index:3000;right:14px;bottom:14px;width:min(360px,92vw);max-height:70vh;overflow:auto;' +
        'background:#161a21;border:1px solid #2a2f3a;border-radius:10px;padding:12px 14px;color:#e6e6e6;' +
        'font:13px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)';
      document.body.appendChild(e);
    }
    e.innerHTML = html;
  }

  window.SOLAR_UI = { COR, prepararCadastro, desenhar, abrirJanela, atualizarJanela, fecharJanela };
})();
