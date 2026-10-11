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
                    ALARME / BATERIA BAIXA / LEITURA SUSPEITA (123), com a
                    frase escrita. Desde 21/09/2026 traz também
                    `pct_potencial` + `potencial_fonte` (122). O critério
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
  /* 'LEITURA SUSPEITA' (migração 123, 21/09/2026): o logger devolveu um número
     impossível — não é defeito do sistema nem bateria vazia, é o dado que não
     serve. Cor própria, âmbar apagado: não pode se parecer com OK (verde) nem
     gritar como falha (vermelho). Desconhecido é uma terceira coisa. */
  const COR = { 'OK': '#00c896', 'ALARME': '#ffb300', 'BATERIA BAIXA': '#ffb300',
                'FALHA': '#ff4444', 'MUDO': '#ff4444', 'LEITURA SUSPEITA': '#c9a227' };
  const br = (n, d) => (n == null || isNaN(n)) ? '—' : Number(n).toFixed(d).replace('.', ',');
  /* hora decimal -> "7:14". Usado pela faixa de liga/desliga e pela sugestão. */
  const fmtHora = v => { if (v == null || isNaN(v)) return '—';
    const h = Math.floor(v), m = Math.round((v - h) * 60);
    return m === 60 ? (h + 1) + ':00' : h + ':' + String(m).padStart(2, '0'); };

  /* AS TRÊS FAIXAS DE ZOOM (a terceira entrou em 04/10/2026 — ver "O SELO").
     Ficam aqui como constantes com nome porque são número de ajuste: quem
     achar o ponto de troca errado mexe em UM lugar, e não em cinco `z >= 18`
     espalhados. A conta que justifica os valores, nesta latitude (−12,65°),
     é `m/px = 152738 / 2^z` — a mesma do módulo:
       z 18 → 0,58 m/px · um poço de 50×30 m dá 86×52 px → cabe detalhe
       z 16 → 2,3 m/px  · 21×13 px → só o bloco central
       z 14 → 9,3 m/px  · 5×3 px   → nem o bloco central cabe: vai o selo */
  const Z_DETALHE = 18;   // daqui para cima: módulos, benfeitorias, geração, consumo
  const Z_BLOCO   = 15;   // daqui para cima a rosca ganha a % escrita embaixo
  /* O PISO DO FLUXOGRAMA, em escala (não em zoom). Abaixo dele o painel não se
     desenha e a rosca fica no lugar — ver "A TRAVA DOS 80%". Era 0,55; o dono
     mandou reduzir pela metade em 05/10/2026 para o painel vir um passo antes. */
  const PISO_PAINEL = 0.275;

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
  /* ================= FLUXO DE ENERGIA ANIMADO (04/10/2026) =================
     Pedido do dono: *"fazer o desenho da casa de bomba e da bateria animada
     quando dá zoom, igual padrão dos software específico: mostra as setas da
     carga saindo das placas indo para a bateria, e quanto tá sendo para
     carregar e quanto tá indo para bomba; se tiver puxando só da bateria a
     seta vem só da bateria para a bomba"*.

     A CONTA FECHA NO BANCO, não é estimativa. `solar_vigia` entrega as três
     potências e elas se somam: **p_fv = p_bateria + p_carga**, com
     `p_bateria` POSITIVO = carregando. Conferido com o dado de 04/10/2026
     06:10, que por sorte tinha os dois casos ao mesmo tempo:
       poço 01 · fv 44,1 · bat −33,6 · carga 77,8 → 44,1 + 33,6 = 77,7 ✔
                 (bomba rodando: placas E bateria alimentando)
       poço 03 · fv 45,5 · bat +45,3 · carga  0,2 → 45,5 − 45,3 = 0,2 ✔
                 (bomba parada: placas carregando a bateria)

     DAÍ SAEM AS TRÊS SETAS, e nenhuma é inventada:
       placas → bateria   quando p_bateria > 0        vale p_bateria
       placas → bomba     quando a bomba puxa          vale min(p_fv, p_carga)
       bateria → bomba    quando p_bateria < 0        vale |p_bateria|

     SÓ NOS POÇOS (o dono, no mesmo pedido: *"esse ícone vai ser apenas para os
     poços"*). A usina dos pivôs não tem bomba nem benfeitorias cadastradas —
     o código cai fora sozinho por falta de `bateria`/`poco`, mas o `tipo`
     também é conferido para não depender de ausência de dado.

     A ANIMAÇÃO é CSS sobre o `<path>` que o Leaflet já desenha: tracejado que
     anda (`stroke-dashoffset`), que é como os supervisórios mostram energia em
     trânsito. Não há `setInterval` aqui de propósito — timer de aba em segundo
     plano é estrangulado pelo navegador (regra do `CLAUDE.md`), e animação de
     CSS para junto com a aba e volta sozinha, sem vigia. */
  function estiloFluxo() {
    if (document.getElementById('solFluxoCss')) return;
    const e = document.createElement('style');
    e.id = 'solFluxoCss';
    e.textContent =
      '@keyframes solFluxoAnda{to{stroke-dashoffset:-24}}' +
      /* o `stroke-dasharray` NÃO mora aqui: cada seta calcula o seu pelo
         comprimento do trecho (padrão fixo some em trecho curto). Aqui fica só
         o que é comum — o andar. */
      '.solFluxo{stroke-linecap:round;animation:solFluxoAnda 1.15s linear infinite}' +
      '@media (prefers-reduced-motion:reduce){.solFluxo{animation:none}}';
    document.head.appendChild(e);
  }

  /* --------------------------------------------- O PAINEL DE FLUXO (SVG)
     Desenho esquemático de tamanho FIXO, pendurado na borda de baixo das
     placas. Três caixas — BATERIA · CASA (inversor) · BOMBA — e as setas de
     energia entre elas, no padrão dos supervisórios.

     POR QUE ESQUEMA E NÃO AS BENFEITORIAS DE VERDADE (decisão do dono,
     04/10/2026): *"a poligonal da casinha e da bateria pode deixar do jeito que
     está lá; vamos fazer algo mais visual"*. E a geometria explica por quê: num
     poço, bateria, casa, poço e hidrômetro cabem todos num raio de ~2 m. Setas
     geográficas entre eles seriam **invisíveis mesmo no zoom máximo** (em z 18,
     0,58 m/px, dois metros são 3 px). O esquema mostra o que a planta não
     consegue — e a planta continua lá, intacta, para quem quiser a posição.

     A DIREÇÃO DA SETA DA BATERIA VIRA com o sinal de `p_bateria_kw`:
     carregando, aponta da casa para a bateria; descarregando, da bateria para a
     casa — que é o caso do *"se tiver puxando só da bateria, a seta vem só da
     bateria para a bomba"*. */
  function painelFluxo(v, kFv, kBat, kCar, tipo) {
    const L1 = 264, A = 74;                       // o painel inteiro, em pixels
    const SOL = '#ffd479', VBAT = '#00c896', VCAR = '#5aa9ff';
    const soc = (v && v.soc_pct != null) ? Number(v.soc_pct) : null;
    const corS = soc == null ? '#8b949e' : soc >= 50 ? '#00c896' : soc >= 20 ? '#ffb300' : '#ff4444';
    const lig = v && v.bomba_ligada;
    const corL = lig === true ? '#00c896' : lig === false ? '#2b333e' : 'none';
    const vale = n => (n != null && !isNaN(n) && Math.abs(n) >= 0.5);

    /* caixas: bateria à esquerda, casa no meio, bomba à direita */
    /* VÃOS DE 56 px entre as caixas (eram 40, alargados a pedido do dono em
       04/10/2026: *"só tem que espaçar um pouquinho para ficar melhor os
       números"*). O rótulo "77,8 kW" a 9,5 px mede ~38 px: em 40 px ele
       encostava nas duas caixas e a seta sumia debaixo do texto. */
    const cxB = 6, cxC = 112, cxP = 208, cy = 28, cwB = 50, cwC = 40, cwP = 50, ch = 36;
    const mB = cxB + cwB / 2, mC = cxC + cwC / 2, mP = cxP + cwP / 2, mY = cy + ch / 2;

    const caixa = (x, w, borda) =>
      '<rect x="' + x + '" y="' + cy + '" width="' + w + '" height="' + ch + '" rx="5" ' +
      'fill="rgba(16,26,38,.92)" stroke="' + borda + '" stroke-width="1.3"/>';

    /* UMA SETA = trilho apagado + tracejado que anda + PONTA.
       O sentido do caminho É o sentido do fluxo (o CSS puxa o tracejado para a
       frente), então quem inverte a bateria inverte os PONTOS, não a cor.

       A PONTA não é enfeite — ela é o que faz a direção ser legível **sem a
       animação**: em imagem parada (print, PDF, a prévia deste commit) e no
       sistema de quem liga "reduzir movimento", o tracejado fica imóvel e os
       dois sentidos ficam idênticos. Pego na rasterização de 04/10/2026.

       E o TRACEJADO é proporcional ao trecho: o padrão fixo de 7/17 cabia nos
       80 px entre as caixas mas sumia nos 22 px da descida das placas — ficava
       um risquinho só, com cara de linha morta em vez de energia descendo. */
    const seta = (x1, y1, x2, y2, cor2) => {
      const dx = x2 - x1, dy = y2 - y1, comp = Math.hypot(dx, dy);
      const ux = dx / comp, uy = dy / comp, PONTA = 6.5;
      const px2 = x2 - ux * PONTA, py2 = y2 - uy * PONTA;      // a linha para antes da ponta
      const tr = (comp / 3).toFixed(1), vao = (comp / 3 * 1.4).toFixed(1);
      const cam = 'M ' + x1 + ' ' + y1 + ' L ' + px2.toFixed(1) + ' ' + py2.toFixed(1);
      const nx = -uy, ny = ux;                                  // normal, p/ abrir a ponta
      const pts = [ x2 + ',' + y2,
        (px2 + nx * 4).toFixed(1) + ',' + (py2 + ny * 4).toFixed(1),
        (px2 - nx * 4).toFixed(1) + ',' + (py2 - ny * 4).toFixed(1) ].join(' ');
      return '<path d="' + cam + '" fill="none" stroke="' + cor2 + '" stroke-width="1" opacity=".3"/>' +
        '<path class="solFluxo" d="' + cam + '" fill="none" stroke="' + cor2 + '" stroke-width="2.6"' +
        ' opacity=".95" style="stroke-dasharray:' + tr + ' ' + vao + '"/>' +
        '<polygon points="' + pts + '" fill="' + cor2 + '"/>';
    };
    const rotulo = (x, y, txt, cor2, meio) =>
      '<text x="' + x + '" y="' + y + '" fill="' + cor2 + '" font-size="9.5" font-weight="700" ' +
      'font-family="system-ui,sans-serif" text-anchor="' + (meio ? 'middle' : 'start') + '" ' +
      'stroke="#0b121b" stroke-width="2.6" paint-order="stroke">' + txt + '</text>';

    let d = '';
    /* 1 · das PLACAS para a casa — vem de cima, porque as placas estão em cima */
    if (vale(kFv)) {
      /* começa ACIMA do painel (y negativo, com `overflow:visible`): a linha
         encosta na borda das placas e o desenho diz de onde a energia vem. */
      d += seta(mC, -7, mC, cy - 2, SOL) +
           rotulo(mC + 8, 12, br(kFv, 1) + ' kW', SOL, false);
      /* "% DO POSSÍVEL" vem junto porque o bloco antigo saiu (04/10/2026) e era
         ele quem mostrava. É o número que separa NUBLADO de DEFEITO — 49 kW às
         7 h de céu limpo é ótimo e às 12 h30 seria alarme —, então não podia
         morrer com o bloco. Com inversor LIMITADO a view devolve nulo de
         propósito (está SOBRANDO energia) e aí vai a palavra, não o número. */
      const pp = v && v.pct_potencial, pf = v && v.potencial_fonte;
      if (pp != null) d += rotulo(mC + 8, 24, br(pp, 0) + '% do possível', '#ffb300', false);
      else if (pf === 'limitado') d += rotulo(mC + 8, 24, 'sobrando', VBAT, false);
    }
    /* 2 · casa <-> BATERIA, e o sentido vira com o sinal */
    if (vale(kBat)) {
      const carrega = kBat > 0;
      d += (carrega ? seta(cxC - 2, mY, cxB + cwB + 2, mY, VBAT)
                    : seta(cxB + cwB + 2, mY, cxC - 2, mY, VBAT)) +
           rotulo((cxB + cwB + cxC) / 2, mY - 7, br(Math.abs(kBat), 1) + ' kW', VBAT, true);
    }
    /* 3 · casa para a BOMBA */
    if (vale(kCar)) {
      d += seta(cxC + cwC + 2, mY, cxP - 2, mY, VCAR) +
           rotulo((cxC + cwC + cxP) / 2, mY - 7, br(kCar, 1) + ' kW', VCAR, true);
    }

    /* ---- os três desenhos ---- */
    const nivel = soc == null ? 0 : Math.max(2, Math.min(100, soc) / 100 * 26);
    const desBateria =
      caixa(cxB, cwB, corS) +
      '<rect x="' + (mB - 15) + '" y="' + (cy + 8) + '" width="30" height="13" rx="2.5" fill="none" stroke="' + corS + '" stroke-width="1.8"/>' +
      '<rect x="' + (mB + 16) + '" y="' + (cy + 12) + '" width="2.6" height="5" rx="1" fill="' + corS + '"/>' +
      (soc == null ? '' : '<rect x="' + (mB - 13) + '" y="' + (cy + 10) + '" width="' + nivel.toFixed(1) + '" height="9" rx="1.5" fill="' + corS + '"/>') +
      '<text x="' + mB + '" y="' + (cy + 31) + '" fill="#e8edf5" font-size="9.5" font-weight="800" ' +
      'font-family="system-ui,sans-serif" text-anchor="middle">' +
      (soc == null ? '—' : Math.round(soc) + '%') + '</text>';

    /* a CASA é o inversor: telhado + o raio, que é o símbolo universal dele */
    const desCasa =
      caixa(cxC, cwC, '#8ba0bd') +
      '<path d="M ' + (mC - 12) + ' ' + (cy + 17) + ' L ' + mC + ' ' + (cy + 7) + ' L ' + (mC + 12) + ' ' + (cy + 17) + ' Z" ' +
      'fill="none" stroke="#c3ccd8" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<rect x="' + (mC - 9) + '" y="' + (cy + 17) + '" width="18" height="10" fill="none" stroke="#c3ccd8" stroke-width="1.6"/>' +
      '<path d="M ' + (mC + 1.5) + ' ' + (cy + 18.5) + ' l -4.5 5.5 h3.5 l -2 4.5 l 5.5 -6 h -3.5 z" fill="' + SOL + '"/>';

    /* A CAIXA DE DESTINO muda com o sítio (05/10/2026):
         poço  → a BOMBA, com a sinaleira do motor (mesma linguagem da rosca);
         usina → os PIVÔS, desenhados como se veem no mapa: o círculo que a
                 torre varre, com o raio e o pivô central.
       E nos pivôs NÃO VAI SINALEIRA. Não é esquecimento: a view devolve
       `bomba_ligada` NULO para aquele sítio, e o estado de "ligado" ali seria
       invenção minha no desenho. O critério mora na view — se um dia ela passar
       a dizer, a sinaleira aparece sozinha pela regra de baixo. */
    const ePoco = tipo === 'poco';
    const desBomba =
      caixa(cxP, cwP, lig === true ? VBAT : '#8ba0bd') +
      (ePoco
        ? '<circle cx="' + (mP - 4) + '" cy="' + (cy + 20) + '" r="8" fill="none" stroke="#c3ccd8" stroke-width="2.2"/>' +
          '<path d="M ' + (mP - 4) + ' ' + (cy + 11) + ' V ' + (cy + 6) + ' h 10" fill="none" stroke="#c3ccd8" stroke-width="2.2" stroke-linecap="round"/>'
        : '<circle cx="' + (mP - 3) + '" cy="' + (cy + 17) + '" r="10.5" fill="none" stroke="#c3ccd8" stroke-width="1.6" stroke-dasharray="3 2.6"/>' +
          '<line x1="' + (mP - 3) + '" y1="' + (cy + 17) + '" x2="' + (mP + 7.5) + '" y2="' + (cy + 17) + '" stroke="#c3ccd8" stroke-width="2"/>' +
          '<circle cx="' + (mP - 3) + '" cy="' + (cy + 17) + '" r="2.6" fill="#c3ccd8"/>') +
      (lig == null ? ''
        : '<circle cx="' + (mP + 13) + '" cy="' + (cy + 24) + '" r="4.6" fill="#0b121b"/>' +
          (lig === true
            ? '<circle cx="' + (mP + 13) + '" cy="' + (cy + 24) + '" r="3.4" fill="' + VBAT + '" style="filter:drop-shadow(0 0 3px ' + VBAT + ')"/>'
            : '<circle cx="' + (mP + 13) + '" cy="' + (cy + 24) + '" r="3.4" fill="' + corL + '" stroke="#59636f" stroke-width="1"/>'));

    return '<svg width="' + L1 + '" height="' + A + '" viewBox="0 0 ' + L1 + ' ' + A + '" ' +
      'style="display:block;overflow:visible;filter:drop-shadow(0 2px 5px #000)">' +
      d + desBateria + desCasa + desBomba +
      '<text x="' + mB + '" y="' + (A - 1) + '" fill="#8ba0bd" font-size="8" font-family="system-ui,sans-serif" text-anchor="middle">bateria</text>' +
      '<text x="' + mC + '" y="' + (A - 1) + '" fill="#8ba0bd" font-size="8" font-family="system-ui,sans-serif" text-anchor="middle">inversor</text>' +
      '<text x="' + mP + '" y="' + (A - 1) + '" fill="#8ba0bd" font-size="8" font-family="system-ui,sans-serif" text-anchor="middle">' +
      (ePoco ? 'bomba' : 'pivôs') + '</text>' +
      '</svg>';
  }

  function desenhar(L, grupo, v, c, aoClicar) {
    if (!c || !c.anel) return;
    const cor = COR[v && v.situacao] || '#8b949e';
    /* declarada AQUI, no topo, e não junto do bloco central: as setas de
       energia (mais abaixo) também usam, e `const` tem zona morta — usar antes
       da linha em que é declarada dá ReferenceError, não `undefined`. */
    const sombra = 'text-shadow:0 0 3px #000,0 0 9px #000,0 2px 3px #000';
    /* DE LONGE, SÓ O QUE SE DECIDE OLHANDO (dono, 18/09/2026: "ficou muito
       poluído"). Numa vista de fazenda inteira, cinco usinas × quatro ícones
       viram um enxame de bolinhas que esconde o mapa. Então de longe fica
       apenas o bloco central — carga da bateria, geração, consumo e o estado
       da bomba — e o detalhe (casa, bateria, hidrômetro, a pílula com o kW da
       bomba) só aparece quando alguém aproxima para olhar aquela usina. */
    /* O ZOOM vem do mapa em que o grupo está. Se o grupo ainda não foi
       adicionado, não há como saber — e o desenho cairia calado na vista de
       longe, que foi exatamente o defeito do celular em 18/09/2026 (as placas
       não apareciam nunca). Então avisa, em vez de errar em silêncio. */
    if (!grupo._map && !desenhar._avisou) {
      desenhar._avisou = 1;
      console.warn('[solar_mapa] o grupo ainda não está no mapa: sem zoom, só a vista de longe. ' +
                   'Use L.layerGroup().addTo(map) ANTES de desenhar.');
    }
    const z = grupo._map ? grupo._map.getZoom() : 0;
    const perto = z >= Z_DETALHE;
    const longe = z < Z_BLOCO;

    L.polygon(c.anel, { color: cor, weight: 2, opacity: .95, fillColor: '#1b2430', fillOpacity: .35,
                        bubblingMouseEvents: false }).addTo(grupo).on('click', () => aoClicar('geral'));

    /* AS FILEIRAS sempre; OS MÓDULOS um a um só de perto. São ~140 por usina:
       de longe viram um borrão que custa desenho à toa, e no celular isso pesa.
       Os módulos vão num ÚNICO polígono com vários anéis (multipolígono) —
       uma camada em vez de 140. */
    if (c.fileiras && c.fileiras.length) {
      /* As faixas escuras das fileiras só aparecem DE LONGE, quando os módulos
         não são desenhados — senão elas viram um quadrado preto por cima das
         placas (o dono pediu para tirar em 18/09/2026). De perto, quem mostra
         a fileira são os próprios módulos. */
      /* E o piso de baixo entrou em 04/10/2026, junto com o selo: abaixo de
         `Z_BLOCO` as fileiras são SUB-PIXEL (em z 14, 9,3 m/px, uma fileira de
         3 m de largura dá 0,3 px). Não desenham informação — borram o contorno
         da usina com uma mancha escura e custam desenho à toa, cinco vezes na
         tela. De tão longe, quem diz "a usina é aqui" é o próprio contorno. */
      if (z >= Z_BLOCO && z < 17) c.fileiras.forEach(f => L.polygon(f, { stroke: false, fillColor: '#0d1b2a',
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
    /* OS CRACHÁS REDONDOS SAÍRAM em 04/10/2026, a pedido do dono: *"aquelas
       escritas e ícones antigos que tem lá no hidrômetro e casa antiga tá
       poluindo, pode tirar"*. Eram cinco medalhões de 26 px — casa, bateria,
       poço, cano, hidrômetro — empilhados num punhado de metros quadrados:
       numa área onde tudo cabe num raio de ~2 m, cinco círculos de 26 px se
       sobrepõem e escondem justamente as construções que deviam apontar.
       O DESENHO delas continua (polígono da casa com telhado, caixa da
       bateria, cano, hidrômetro) e o tooltip no toque continua dizendo o nome —
       o que saiu foi a camada de enfeite por cima. */

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
        /* A BOCA DO POÇO. O ESTADO da bomba não mora mais aqui (04/10/2026):
           quem diz é a sinaleira do fluxograma, de perto, e o centro da rosca,
           de longe. Aqui ficou só o furo no chão, que é o que a planta tem a
           dizer. */
        L.circle(b.ponto, { radius: b.raio || 0.5, color: '#00c2d1', weight: 2, fillColor: '#00363d',
          fillOpacity: .9, bubblingMouseEvents: false }).addTo(grupo)
          .bindTooltip(b.rot || 'poço', { direction: 'top' });
        /* A PÍLULA "BOMBA LIGADA · 77,8 kW" saiu junto (04/10/2026). Ela era a
           resposta certa quando não havia mais nada; agora o FLUXOGRAMA embaixo
           das placas diz o mesmo com mais contexto (de onde vem a energia), e
           duas respostas para a mesma pergunta na mesma tela é ruído, não
           redundância útil. O estado da bomba segue na sinaleira do fluxograma
           e, de longe, no centro da rosca. */
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

    /* ------------------------------------------ o painel de fluxo de energia */
    /* `temPainel` (e não "temFluxo", como se chamava até 05/10/2026): desde que
       o painel passou a aparecer SEMPRE, ter painel e ter fluxo deixaram de ser
       a mesma coisa — ele existe parado, sem seta nenhuma. O nome antigo faria
       a próxima pessoa achar que a rosca some quando há energia andando, e não
       é isso: a rosca some quando o PAINEL está na tela. */
    let temPainel = false;
    /* VALE TAMBÉM PARA A USINA DOS PIVÔS (dono, 05/10/2026: *"pode fazer na
       usina do pivô também"*). A conta é a mesma e fecha igual — em 05/10 às
       07h ela estava com fv 280,8 = bateria 275,6 + carga 5,2. O que muda é o
       destino: lá a energia não vai para uma bomba, vai para os PIVÔS. Ela
       também não tem benfeitorias cadastradas, e nem precisa: o painel se
       ancora na borda das placas, não nelas. */
    if (perto) {
      const kFv = Number(v && v.p_fv_kw), kBat = Number(v && v.p_bateria_kw),
            kCar = Number(v && v.p_carga_kw);
      /* O PAINEL APARECE SEMPRE — e isto mudou em 05/10/2026, pelo dono:
         *"percebi que quando não tá gerando o fluxograma some; então tem que
         aparecer mesmo quando não está gerando"*.

         Eu tinha condicionado o painel a existir alguma potência (as três
         acima de 0,5 kW). Parecia economia de tinta e era defeito: de noite as
         três são zero, o painel sumia **justamente na hora em que alguém
         aproxima para ver se a usina está bem** — e some sem dizer por quê, que
         é o pior jeito de sumir. "Não está gerando" é uma informação, não é
         ausência de informação.

         O que depende de haver fluxo são as SETAS, não as caixas: sem energia
         andando, ficam as três caixas com o que elas sabem (carga da bateria,
         estado da bomba) e nenhuma seta — o desenho diz "parado", que é a
         verdade. Mesmo espírito da regra do projeto: resposta vazia não é dado
         bom, e tela que apaga é pior que tela que mostra zero. */
      {
        /* ================= A TRAVA DOS 80% (dono, 04/10/2026) =================
           *"quando dá zoom ele trava quando atingir 80% da largura das placas"*.

           O painel é um ESQUEMA de tamanho fixo (264 px). Fixo resolve a leitura
           e cria outro problema: no zoom 18 as placas de um poço têm 86 px e o
           painel ficava quase três vezes mais largo que a usina que ele
           descreve — um balão maior que a coisa.

           Então ele passa a ACOMPANHAR o zoom, limitado a 80% da largura das
           placas, e TRAVA quando chega ao tamanho natural:

               escala = 0,8 × largura das placas em px ÷ 264

           ⚠️ SEM TETO, e isto foi um erro meu corrigido pelo dono em 05/10/2026.
           Eu tinha posto `min(1, …)`, travando no tamanho NATURAL do desenho —
           e ele viu o efeito na hora: *"ele aparece com 80 porém ele não trava
           com o zoom: você dá zoom, a placa cresce e o fluxograma não cresce
           junto"*. "Travar em 80% das placas" é **ficar preso nos 80%**, não
           parar de crescer. O painel acompanha as placas para sempre, como se
           fosse pintado no chão junto com elas.

           E UM PISO, que o pedido não cobre mas a aritmética cobra: abaixo de
           certa escala o texto de 9,5 px vira um borrão. Abaixo dele o painel
           não se desenha e a ROSCA fica no lugar; aproximar um passo o traz.
           O valor caiu de 0,55 para 0,275 em 05/10/2026 a pedido do dono —
           *"o zoom quando sai do ícone + % para o fluxograma pode reduzir pela
           metade o ponto de troca, ou seja, mais rápido"* —, o que antecipa o
           painel em um passo de zoom (com as placas de 80 m, do 19 para o 18).
           Efeito colateral bom: ele aparece MAIS CEDO em usina grande, porque
           quem manda é o tamanho na tela e não o número do zoom. */
        const bb = L.polygon(c.anel).getBounds();
        const mapa = grupo._map;
        let escala = 1;
        if (mapa && mapa.latLngToLayerPoint) {
          const pO = mapa.latLngToLayerPoint(L.latLng(bb.getSouth(), bb.getWest()));
          const pL = mapa.latLngToLayerPoint(L.latLng(bb.getSouth(), bb.getEast()));
          escala = 0.8 * Math.abs(pL.x - pO.x) / 264;
        }
        if (escala >= PISO_PAINEL) {
          temPainel = true;
          estiloFluxo();
          /* ANCORADO NA BORDA DE BAIXO DAS PLACAS, centrado — *"usa o desenho das
             placas e na parte inferior dela, embaixo"*. O ponto é geográfico (anda
             com o mapa); o tamanho é em pixels. `transform-origin:top center` com
             `translate(-50%,6px) scale(s)` mantém o topo colado na borda das placas
             e o painel centrado, qualquer que seja a escala. */
          const pe = L.latLng(bb.getSouth(), bb.getCenter().lng);
          L.marker(pe, { keyboard: false, zIndexOffset: 500, icon: L.divIcon({ className: '',
            iconSize: [0, 0], iconAnchor: [0, 0],
            html: '<div style="position:absolute;transform-origin:top center;' +
                  'transform:translate(-50%,6px) scale(' + escala.toFixed(3) + ');cursor:pointer">' +
                  painelFluxo(v, kFv, kBat, kCar, c.tipo) + '</div>' }) })
            .on('click', () => aoClicar('geral')).addTo(grupo)
            .bindTooltip('fluxo de energia ao vivo — clique abre a usina', { direction: 'top' });
        }
      }
    }

    /* ------------------------------------------- as peças da ROSCA
       Ideia do dono (04/10/2026): *"um círculo, parecido com o gráfico de
       rosca: a extremidade do círculo vira a barra de carga da bateria e o
       centro a sinaleira do motor"*.

       POR QUE O CÍRCULO GANHOU DA PÍLULA que eu tinha feito antes: ele **não
       tem eixo longo**. A pílula crescia para o lado conforme o número — "100%"
       é mais larga que "9%" — e era esse crescimento lateral que embaralhava
       quando duas usinas ficam perto. O disco ocupa o mesmo espaço sempre.

       E a SINALEIRA é a metáfora certa: lâmpada de painel ACESA = motor
       rodando. Não é código de cor a decorar, é o que o operador vê no quadro. */
    const centro = L.polygon(c.anel).getBounds().getCenter();
    const RAIO = 9.5, GROSSO = 3.5, VOLTA = 2 * Math.PI * RAIO;
    const frac = (v && v.soc_pct != null) ? Math.max(0, Math.min(100, Number(v.soc_pct))) / 100 : null;
    const corS2 = (v && v.soc_pct == null) ? '#8b949e'
                : v.soc_pct >= 50 ? '#00c896' : v.soc_pct >= 20 ? '#ffb300' : '#ff4444';
    const lig = v && v.bomba_ligada;
    /* a sinaleira, três estados — e "apagada" tem de PARECER apagada:
         ligada      verde viva, com brilho (lâmpada acesa);
         desligada   disco escuro com aro: a lâmpada existe e está apagada;
         sem leitura vazada âmbar, o "não sei" do resto do arquivo.
       O SOQUETE escuro atrás dela (r 6,6) não é enfeite: sem ele a carga e a
       sinaleira se FUNDEM quando calham da mesma cor — pego na prévia de
       04/10/2026 com a usina dos pivôs (28% = arco âmbar, bomba sem leitura =
       sinaleira âmbar), que a 26 px virava um borrão âmbar só. */
    const lampada = lig === true
      ? '<circle cx="13" cy="13" r="5.2" fill="#00c896" style="filter:drop-shadow(0 0 4px #00c896)"/>'
      : lig === false
      ? '<circle cx="13" cy="13" r="5.2" fill="#2b333e" stroke="#59636f" stroke-width="1.4"/>'
      : '<circle cx="13" cy="13" r="5.2" fill="none" stroke="#ffb300" stroke-width="1.8"/>';
    /* o anel de FORA é a SITUAÇÃO, e só existe quando há o que avisar: de longe
       quem dizia FALHA/MUDO era o contorno do polígono, e em z 14 ele tem 5 px
       e fica DEBAIXO da rosca — uma usina em falha viraria rosca igual às sãs. */
    const sitRuim = v && v.situacao && v.situacao !== 'OK';

    /* ================= AS TRÊS FAIXAS, revistas em 04/10/2026 ===============
       Pedido do dono: *"o segundo estágio de zoom pode deixar a rosca em vez de
       aparecer o modelo antigo; você apenas coloca a % escrita embaixo da
       rosca, e depois com mais zoom já vai direto para o fluxograma"*.

       Então o BLOCO CENTRAL SAIU — pilha, número grande, ícone da bomba,
       geração, consumo e "% do possível". Era o desenho de 18/09/2026, e cada
       pedaço dele tem hoje um lugar melhor:
         carga e bomba  → a rosca (lê-se de relance, e não cresce para o lado)
         geração e consumo → o fluxograma, com de ONDE vem e para ONDE vai
         "% do possível"  → foi junto para o fluxograma, ao lado da seta do sol
       Nada se perdeu; o que saiu foi a terceira forma de dizer a mesma coisa.

         z < Z_BLOCO     rosca sozinha
         Z_BLOCO..Z_DET  rosca + a % escrita embaixo
         z >= Z_DETALHE  o fluxograma
       com uma RESSALVA que o pedido não cobre e a noite cobra: se não houver
       fluxo nenhum (de madrugada as três potências são zero), o fluxograma não
       se desenha — e aí a rosca VOLTA, para a usina não sumir do mapa justo
       quando alguém abre para ver se ela está viva. */

    /* A % ESCRITA, só do segundo estágio para cima (dono, 04/10/2026: *"você
       apenas coloca a % escrita embaixo da rosca"*): de longe o arco basta — o
       número vira letra miúda que ninguém lê àquela distância; a partir do
       momento em que a pessoa aproximou, ela quer o valor exato.

       O NÚMERO VAI DENTRO DO SVG, não num `<span>` ao lado. Três razões, e a
       terceira foi a que me pegou: (1) um elemento só, que escala junto e não
       depende de flexbox; (2) a sombra do texto fica na mesma pintura do resto;
       (3) a ferramenta de prévia extrai o `<svg>` — com o número de fora, ele
       não aparecia na imagem e eu ia jurar que o código estava errado. Desenho
       que se parte em dois pedaços é desenho que alguém vai conferir pela
       metade. */
    const pctTxt = (v && v.soc_pct != null) ? Math.round(Number(v.soc_pct)) + '%'
                 : (v && v.situacao === 'MUDO') ? 'sem sinal'
                 : (v && v.situacao === 'FALHA') ? 'falha' : '—';
    const corPct = (v && v.soc_pct != null) ? '#ffffff' : cor;
    const comPct = z >= Z_BLOCO;
    const ALT = comPct ? 41 : 26;

    const rosca =
      '<svg width="26" height="' + ALT + '" viewBox="0 0 26 ' + ALT + '" ' +
      'style="display:block;overflow:visible;filter:drop-shadow(0 1px 3px #000)">' +
        '<circle cx="13" cy="13" r="11.4" fill="rgba(11,18,27,.85)"/>' +
        (sitRuim ? '<circle cx="13" cy="13" r="12.2" fill="none" stroke="' + cor + '" stroke-width="1.6"/>' : '') +
        '<circle cx="13" cy="13" r="' + RAIO + '" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="' + GROSSO + '"/>' +
        (frac == null ? '' :
          '<circle cx="13" cy="13" r="' + RAIO + '" fill="none" stroke="' + corS2 + '" stroke-width="' + GROSSO + '"' +
          ' stroke-linecap="round" transform="rotate(-90 13 13)"' +
          ' stroke-dasharray="' + (frac * VOLTA).toFixed(2) + ' ' + VOLTA.toFixed(2) + '"/>') +
        '<circle cx="13" cy="13" r="6.6" fill="#0b121b"/>' +
        lampada +
        (comPct
          ? '<text x="13" y="38" text-anchor="middle" font-family="system-ui,sans-serif" ' +
            'font-size="11.5" font-weight="800" fill="' + corPct + '" ' +
            'stroke="#0b121b" stroke-width="3" paint-order="stroke">' + pctTxt + '</text>'
          : '') +
      '</svg>';

    if (!temPainel) {
      L.marker(centro, { keyboard: false, zIndexOffset: 400, icon: L.divIcon({ className: '',
        iconSize: [0, 0], iconAnchor: [0, 0],
        /* o -40% (e não -50%) sobe a rosca um pouco: com o número embaixo, o
           centro do CONJUNTO desce, e quem tem de ficar sobre a usina é o
           disco, não o conjunto. */
        html: '<div style="position:absolute;transform:translate(-50%,' + (comPct ? '-40%' : '-50%') + ');' +
              'cursor:pointer">' + rosca + '</div>' }) })
        /* `() => aoClicar('geral')` e NAO `aoClicar` direto (corrigido 08/10/2026,
           relatado pelo dono: *"quando clica no icone dos poços a bolinha hoje
           não faz nada"*). Passando a função direto, quem chega no 1º argumento
           é o EVENTO do Leaflet — e `abrirJanela(id, fonte, aba)` fazia
           `abaAtual = aba || 'geral'`, então a aba virava o objeto do evento,
           que é verdadeiro mas não é aba nenhuma: a janela abria vazia.
           Defeito silencioso clássico de callback com assinatura diferente da
           esperada — o `|| 'geral'` só protege contra nulo, não contra lixo. */
        .on('click', () => aoClicar('geral')).addTo(grupo)
        .bindTooltip((lig === true ? 'bomba LIGADA' : lig === false ? 'bomba desligada' : 'bomba: sem leitura') +
                     ' · carga da bateria ' + pctTxt, { direction: 'top' });
    }
  }

  /* ======================= A ABA DO OBJETIVO: 10 h/dia ======================
     Pedido do dono (08/10/2026): *"uma aba apenas focada no objetivo de
     funcionar 10h por dia na solar; então tem o gráfico do dia, ela ligada, ela
     desligada, quantas horas no total"* — mais as ideias que ele pediu que eu
     acrescentasse.

     A DESCOBERTA QUE DESENHOU A ABA. Ao montar a view horária apareceu que ao
     MEIO-DIA o céu oferece 124 kW e a bomba só puxa 79: aquele excedente NÃO
     vira hora de bomba, porque a bomba já está no talo — só pode ir para a
     bateria. **As horas que faltam para os 10 não estão no meio do dia, estão
     nas BORDAS** (6–8 h e 16–18 h). Por isso a aba separa o desperdício em dois:
     o que daria para bombear e o que não daria. Um painel que cobra o
     impossível ensina a ignorar painel.

     TUDO É HORA EQUIVALENTE (energia ÷ kW da bomba), como na migração 122: o
     Modbus do SmartLogger não entrega o contato da bomba, entrega potência.
     Meia hora a meia carga conta 0,25 h, que é o que de fato bombeou. */
  const META_H = 10;
  /* UM SÓ LUGAR decide o que é "tela estreita" — a janela e a aba precisam
     concordar, senão o cabeçalho vira de tela cheia e os cartões continuam no
     formato de desktop dentro dele. 640 px é o corte usual entre celular em
     pé e o resto. */
  const telaEstreita = () => (typeof window !== 'undefined' ? (window.innerWidth || 1024) : 1024) <= 640;

  /* ============ A SUGESTÃO DE HORÁRIO (migração 149, 08/10/2026) ============
     *"uma avaliação constante e a indicação de ligar e desligar a bomba para
     melhor aproveitamento; ela vai alterando com o passar dos dias"*.

     Aqui só se PINTA — o critério inteiro mora na view, inclusive a confiança.
     Isso importa mais que de costume: uma sugestão de horário é algo que o dono
     vai executar no temporizador, então a conta precisa estar num lugar só,
     auditável, e não espalhada entre o banco e o JavaScript da tela. */
  function blocoSugestao(sg, estreito) {
    if (!sg) return '';
    const n = x => (x == null || isNaN(x)) ? null : Number(x);
    const hm = x => { const v = n(x); if (v == null) return '—';
      const h = Math.floor(v), m = Math.round((v - h) * 60);
      return (m === 60 ? (h + 1) + ':00' : h + ':' + String(m).padStart(2, '0')); };

    const ganho = n(sg.minutos_sobrando) || 0;
    const ligaH = n(sg.liga_hoje), deslH = n(sg.desliga_hoje);
    const cm = n(sg.custo_manha_kw), ct = n(sg.custo_tarde_kw);
    const jog = n(sg.horas_jogadas_fora) || 0;
    const conf = sg.confianca || '—';
    const corConf = conf === 'FIRME' ? '#00c896' : conf === 'RAZOÁVEL' ? '#ffb300' : '#ff8a5c';
    const vale = ganho >= 8;

    const linha = (rot, agora, sug, nota) =>
      '<div style="display:flex;align-items:baseline;gap:8px;padding:6px 0;border-top:1px solid #1e2a38">' +
        '<span style="color:#8ba0bd;font-size:11px;width:72px;flex:none">' + rot + '</span>' +
        '<b style="font-size:' + (estreito ? '16px' : '14px') + '">' + agora + '</b>' +
        (sug ? '<span style="color:#6b7683">→</span><b style="font-size:' + (estreito ? '16px' : '14px') +
               ';color:#00c896">' + sug + '</b>' : '') +
        (nota ? '<span style="color:#8ba0bd;font-size:10px;margin-left:auto;text-align:right;max-width:46%">' + nota + '</span>' : '') +
      '</div>';

    return '<div style="background:#101a26;border:1px solid #2d4a63;border-radius:8px;padding:10px 12px;margin:14px 0 4px">' +
      '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:5px">' +
        '<b style="font-size:13px;color:#dbe9f7">⏱ horário sugerido</b>' +
        '<span style="margin-left:auto;font-size:10px;color:' + corConf + ';font-weight:700">' + conf + '</span>' +
      '</div>' +

      /* DOIS RELÓGIOS NA MESMA TELA PRECISAM SE APRESENTAR. A faixa verde lá
         em cima é o MINUTO DO DIA escolhido; estes números são a MEDIANA dos
         dias fechados. Sem esta linha os dois pareciam a mesma medida e a
         diferença parecia defeito — foi o que o dono reportou em 11/10/2026. */
      '<div style="font-size:10px;color:#8ba0bd;line-height:1.5;margin-bottom:6px">' +
        'mediana dos <b style="color:#dbe9f7">' + (sg.dias_na_janela || '?') + ' dias fechados</b> — ' +
        'o que ela <b>vem fazendo</b>, não o relógio do dia que está no gráfico ' +
        '(esse é a faixa verde, com minuto exato).' +
      '</div>' +

      /* O BANCO VEM CAINDO? O aviso DESCREVE, não explica — e isso é correção
         do mesmo dia. Eu tinha escrito aqui que "o sol da tarde enfraqueceu",
         ajustando uma reta a cinco pontos. O teste certo era comparar com a
         usina dos pivôs, que vê o mesmo céu: ela caiu junto em UM dia (10/10,
         -12%) e só nele. Nos poços o sol da tarde estava plano nos quatro dias
         anteriores (108, 103, 106, 103 kWh) e caiu num (95). O que puxou o
         banco foi bombear mais — intencional — mais um dia nublado.
         Não é tendência; a queda é fato, a causa não era a que eu disse. */
      (n(sg.tendencia_pts_dia) < -0.8
        ? '<div style="background:#2a2014;border:1px solid #6b4a1a;border-radius:6px;padding:6px 8px;' +
          'margin-bottom:7px;font-size:11px;color:#ffd9a0;line-height:1.45">' +
          '⚠️ <b>o banco vem caindo ' + br(Math.abs(n(sg.tendencia_pts_dia)), 1) + ' pontos por dia</b> ' +
          'nos últimos dias — pode ser o dia rendendo mais bomba (intencional), pode ser tarde ' +
          'nublada, e a tela não separa os dois. O relógio acima já parte do banco de HOJE, mas ' +
          '<b>confira o fundo da manhã antes de adiantar mais</b>: enquanto o banco não firmar, ' +
          'a margem encolhe sozinha.' +
          '</div>'
        : '') +

      /* "VEM LIGANDO", e não "ligar": o número da esquerda é a MEDIANA dos dias
         fechados, não uma ordem nem o relógio de hoje. Com o rótulo "ligar" o
         dono leu os dois como a mesma medida e estranhou, com razão, que a
         faixa verde do dia mostrasse 17:01 e aqui estivesse 16:43 (11/10/2026). */
      /* O RELÓGIO NA FRENTE, O DESCONTO ATRÁS (migração 161). O "adianta X
         min" é a distância até uma MEDIANA de dias fechados, que defasa um
         dia — somá-lo ao horário real de hoje leva para antes do que o banco
         aguenta. O número que se pendura no temporizador é o absoluto. */
      '<div style="display:flex;align-items:baseline;gap:8px;padding:6px 0;border-top:1px solid #1e2a38">' +
        '<span style="color:#8ba0bd;font-size:11px;width:72px;flex:none">pode ligar</span>' +
        '<b style="font-size:' + (estreito ? '20px' : '17px') + ';color:#00c896">' +
          (n(sg.liga_ideal) != null ? hm(n(sg.liga_ideal)) : hm(ligaH)) + '</b>' +
        '<span style="color:#8ba0bd;font-size:10px;margin-left:auto;text-align:right;max-width:52%">' +
          'o banco do amanhecer (' + br(n(sg.soc_amanhecer), 0) + '%) chega aos 15% quando o sol assume' +
        '</span>' +
      '</div>' +
      linha('vem ligando', hm(ligaH), null,
            vale ? 'mediana de ' + (sg.dias_na_janela || '?') + ' dias — <b style="color:#00c896">' +
                   br(ganho, 0) + ' min</b> atrás do relógio acima' : 'no ponto') +
      /* O NÚMERO CRU DA ARITMÉTICA, quando a trava das 6h corta. O dono pediu
         que a sugestão faça as contas e a decisão seja dele (11/10/2026), e
         esconder o quanto foi cortado seria decidir por ele. Mas o recomendado
         continua sendo o travado: antes de o sol dar 20% da bomba o minuto
         custa 69 kW de bateria contra 16 kW às 7h. */
      (n(sg.minutos_pela_conta) > ganho + 2
        ? '<div style="font-size:10px;color:#8ba0bd;padding:2px 0 0 62px">a conta pura daria <b>+' +
          br(n(sg.minutos_pela_conta), 0) + ' min</b> (' + hm(ligaH - n(sg.minutos_pela_conta) / 60) +
          '), mas antes das ' + br(n(sg.hora_sol_ajuda), 0) + 'h não há sol: seria bateria pura, ' +
          'a água mais cara do dia, e o banco no piso antes de amanhecer.</div>'
        : '') +
      linha('vem parando', hm(deslH), null,
            (cm != null && ct != null)
              ? 'manter: sai do banco que tem de atravessar a noite'
              : '') +

      /* OS DOIS PORQUÊS, e o segundo é o maior. Sem eles a sugestão é uma ordem
         sem argumento — e ordem sem argumento ninguém segue, com razão. */
      '<div style="margin-top:8px;border-top:1px solid #1e2a38;padding-top:7px;font-size:11px;color:#9aa3b0;line-height:1.5">' +
        '<b style="color:#dbe9f7">por quê a manhã, e não a tarde</b><br>' +
        /* ATENÇÃO AO ARGUMENTO, que mudou em 11/10/2026 e por um bom motivo.
           Eu justificava a manhã pelo custo BRUTO do minuto (kW de bateria por
           minuto de bomba), que era menor de manhã. Conforme o dono foi
           adiantando a partida, esse número INVERTEU: em três dos quatro poços
           a tarde passou a custar menos (34 contra 53 no Poço 02) — os minutos
           baratos da manhã já tinham sido tomados. A tela chegou a se
           contradizer, dizendo "a tarde custa menos" e logo abaixo "a manhã
           rende mais".

           O custo bruto nunca foi o critério certo: ele ignora a DEVOLUÇÃO. O
           que se gasta de manhã abre espaço na bateria para o meio-dia
           estrangulado repor no MESMO dia; o que se gasta à tarde sai do banco
           que ainda tem de atravessar a noite. Medido nos quatro poços: a
           partida foi ~30 min mais cedo e o SOC do fim do dia SUBIU 12 a 21
           pontos. Gasto que volta não é gasto. */
        '1 · <b>a manhã é devolvida no mesmo dia</b>: o que a bateria adianta ao ' +
        'amanhecer abre espaço para o meio-dia repor — e o meio-dia tem ' +
        (jog > 0.1 ? '<b style="color:#ff8a5c">' + br(jog, 1) + ' h/dia</b> de sol' : 'sol') +
        ' sendo recusado por falta de onde pôr. Já o minuto da tarde sai do banco ' +
        'que precisa atravessar a noite, e só volta no meio-dia seguinte.' +
        /* ESTA FRASE JÁ FOI MAIS FORTE E ESTAVA ERRADA. Eu dizia "a bateria
           passou a terminar o dia mais cheia", comparando com o período
           antigo. No período RECENTE ela vinha caindo — mas pelo outro lado
           do dia: o pico do meio-dia se manteve em 89-91% TODO dia, enquanto
           o fim da tarde caiu de 70 para 58%, porque o sol depois das 14h
           enfraqueceu. O que a frase pode afirmar com segurança é o pico. */
        '<br>2 · <b>e está medido no pico</b>: o meio-dia devolve o que a manhã ' +
        'gastou — o banco encosta em <b style="color:#00c896">90%</b> todo dia, mesmo nos ' +
        'dias em que a partida foi bem mais cedo. Quem manda no quanto sobra à noite é a ' +
        '<b>tarde</b>, não a manhã.' +
        (cm != null && ct != null
          ? '<br>3 · <b>o minuto bruto já não decide</b>: hoje ele custa <b>' + br(cm, 0) +
            ' kW</b> de manhã contra <b>' + br(ct, 0) + ' kW</b> à tarde' +
            (ct < cm ? ' — a tarde ficou mais barata, sinal de que os minutos fáceis da manhã já foram tomados. Ainda assim a manhã ganha, porque volta.'
                     : ' — e a manhã ainda é a mais barata das duas.')
          : '') +
        (n(sg.soc_fundo_manha) != null
          ? '<br>4 · <b>e não fura o piso</b>: no fundo da manhã a bateria chega a <b style="color:' +
            (n(sg.soc_fundo_manha) > 18 ? '#00c896' : '#ffb300') + '">' +
            br(n(sg.soc_fundo_manha), 0) + '%</b>, com a proteção do BESS em 10%. ' +
            'É esse fundo que limita o quanto dá para antecipar.'
          : '') +
        '<br><span style="color:#6b7683">Em dia nublado não há sol estrangulado para repor; ' +
        'nesses dias a bateria termina mais baixa. A conta é do dia típico.</span>' +
      '</div>' +

      /* DE QUANTO EM QUANTO TEMPO ELE AVALIA (pergunta do dono, 11/10/2026).
         Vale estar escrito na tela: uma sugestão que o dono vai pendurar num
         temporizador precisa dizer de quando ela é, senão ele não sabe se
         deve esperar o número mudar amanhã ou daqui a uma semana. */
      '<div style="color:#6b7683;font-size:10px;margin-top:5px;border-top:1px solid #1e2a38;padding-top:5px">' +
        '⚙ <b style="color:#8ba0bd">automático</b>: a conta é refeita a cada vez que esta tela abre, ' +
        'sobre os ' + (sg.dias_na_janela || '?') + ' últimos dias <b>fechados</b> — o dia de hoje só entra ' +
        'depois que o Pi fecha e extrai as transições, de madrugada. Por isso o horário muda de um ' +
        'dia para o outro, nunca durante o dia.' +
      '</div></div>';
  }

  function abaObjetivo(v, f) {
    /* NO TOPO, e não no meio junto dos cartões: as setas de data (mais acima)
       também usam, e `const` tem zona morta — usar antes da linha que declara
       dá ReferenceError e derruba a aba inteira, não `undefined`. É a segunda
       vez que isso me pega neste arquivo (a primeira foi o `sombra`), então
       vale a regra: o que mais de um trecho usa nasce no começo. */
    const estreito = telaEstreita();
    const horas = (f.horas || []).slice().sort((a, b) => (a.dia + '').localeCompare(b.dia + '') || a.hora - b.hora);
    const dias  = (f.dias  || []).slice().sort((a, b) => (a.dia + '').localeCompare(b.dia + ''));
    if (!horas.length && !dias.length)
      return '<div style="color:#9aa3b0">sem série ainda para este sítio — a aba precisa das views <code>solar_poco_hora</code> e <code>solar_poco_dia</code></div>';

    /* OS DIAS QUE EXISTEM, para as setas saberem até onde ir. Sai da própria
       série horária: se o dado não chegou, a seta não aparece — em vez de
       aparecer e levar a uma tela vazia. */
    const diasComHora = [...new Set(horas.map(h => (h.dia + '') ))].sort();
    const ultimoISO = diasComHora.length ? diasComHora[diasComHora.length - 1]
                    : (dias.length ? (dias[dias.length - 1].dia + '') : '');
    const hojeISO = (diaAba && diasComHora.includes(diaAba)) ? diaAba : ultimoISO;
    const iAtual = diasComHora.indexOf(hojeISO);
    const temAntes = iAtual > 0, temDepois = iAtual >= 0 && iAtual < diasComHora.length - 1;
    const hoje = horas.filter(h => (h.dia + '') === hojeISO);
    const dHoje = dias.find(d => (d.dia + '') === hojeISO) || {};
    const n = x => (x == null || isNaN(x)) ? 0 : Number(x);

    const feitas = n(dHoje.horas_bomba), teto = n(dHoje.horas_possiveis);
    /* DIA ABERTO NÃO SE JULGA. Pego no primeiro teste (08/10/2026, 11 h da
       manhã): a aba dizia "o céu não deu, o potencial foi 6,3 h" — e eram 6,3 h
       porque o dia tinha 11 horas, não porque o céu falhou. Dashboard que dá
       veredito sobre dia pela metade ensina a não acreditar nele. O corte é
       18 h: depois disso o sol daqui já não acrescenta hora de bomba. */
    const agora = new Date();
    const hojeLocal = new Date(agora.getTime() - agora.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    /* só o dia CORRENTE pode estar pela metade; dia do passado está fechado,
       mesmo que a hora do relógio seja cedo. */
    const parcial = (hojeISO === hojeLocal) && agora.getHours() < 18;
    const bombaKw = n(hoje.length ? hoje[0].bomba_kw : 0) || 1;

    /* ---------- 1 · O PLACAR ---------- */
    /* DIA ABERTO NÃO LEVA COR DE JULGAMENTO. Às 11 h o placar marcava 4,7 h em
       VERMELHO — acusando um dia que ainda tinha seis horas de sol pela frente.
       Enquanto parcial, azul neutro: informa sem condenar. */
    const corMeta = parcial ? '#5aa9ff'
                  : feitas >= META_H ? '#00c896' : feitas >= META_H * 0.8 ? '#ffb300' : '#ff4444';
    const larg = p => Math.max(0, Math.min(100, p)) + '%';
    const placar =
      '<div style="display:flex;align-items:baseline;gap:10px;margin:2px 0 6px">' +
        '<span style="font:800 30px/1 system-ui,sans-serif;color:' + corMeta + '">' + br(feitas, 1) + '</span>' +
        '<span style="color:#9aa3b0;font-size:12px">h de bomba ' + (parcial ? 'até agora' : 'hoje') + '</span>' +
        '<span style="margin-left:auto;color:#9aa3b0;font-size:12px">meta <b style="color:#e8edf5">' + META_H + ' h</b>' +
        ' · sol direto <b style="color:#ffd479">' + br(teto, 1) + ' h</b></span>' +
      '</div>' +
      /* a barra mostra as TRÊS coisas de uma vez: feito, meta e teto do céu */
      '<div style="position:relative;height:12px;border-radius:6px;background:#1b2430;overflow:hidden;margin-bottom:3px">' +
        '<div style="position:absolute;inset:0 auto 0 0;width:' + larg(teto / META_H * 100) + ';background:#3a3420"></div>' +
        '<div style="position:absolute;inset:0 auto 0 0;width:' + larg(feitas / META_H * 100) + ';background:' + corMeta + '"></div>' +
        '<div style="position:absolute;top:0;bottom:0;left:100%;width:2px;background:#e8edf5"></div>' +
      '</div>' +
      '<div style="color:#6b7683;font-size:10px;margin-bottom:10px">a risca branca é a meta de ' + META_H +
        ' h · a faixa escura é o que o <b>sol sozinho</b> consegue tocar na bomba' +
        /* PASSAR DO SOL DIRETO NÃO É ERRO DE CONTA — é a bateria trabalhando,
           e é a única forma de chegar nas 10 h. Dizer isso explicitamente
           evita que o número pareça defeito (o dono já pegou um defeito real
           hoje; a tela tem de distinguir um do outro). */
        (feitas > teto + 0.1
          ? ' · <b style="color:#00c896">a bateria esticou +' + br(feitas - teto, 1) + ' h</b> além disso'
          : '') +
        /* O RECORDE RESPONDE A PERGUNTA QUE ELE FEZ (11/10/2026): *"não tem esse
           sol para tocar 11h"*. Tem razão, e agora a tela diz — com um dia que
           de fato aconteceu, não com a soma dos melhores de cada hora. */
        (n(dHoje.horas_recorde) > 0
          ? ' · <b style="color:#9aa3b0">recorde desta usina no mês: ' + br(n(dHoje.horas_recorde), 1) + ' h</b>'
          : '') + '</div>';

    /* ---------- 2 · A BARRA DE 24 HORAS ---------- */
    /* Verde = bombeando. Âmbar = sobrou sol E a bomba tinha folga (hora
       recuperável). Cinza-escuro = sobrou sol mas a bomba já estava cheia
       (NÃO vira hora, e dizer que vira seria mentir). */
    let recup = 0, excedente = 0;
    const colunas = [];
    for (let h = 0; h < 24; h++) {
      const r = hoje.find(x => x.hora === h);
      const fb = r ? n(r.frac_bomba) : 0, ft = r ? n(r.frac_teto) : 0;
      /* DESDE A MIGRAÇÃO 154 o dado já vem separado: `frac_teto` é o sol que
         CABE na bomba (teto 1) e `frac_excedente` é o que passa dela. Antes
         os dois vinham somados num `ft` que chegava a 1,58 e o desenho tinha
         de separar — e foi somar as duas coisas num número só que produziu a
         leitura errada que o dono pegou em 11/10/2026. */
      const folga = Math.max(0, ft - fb);                     // o que ainda caberia na bomba
      const sobra = r ? n(r.frac_excedente) : 0;              // o que não cabe de jeito nenhum
      /* A SOBRA PRECISA CABER NA TELA E APARECER. A trava antiga cortava em
         0,25 de coluna, o que fazia sentido quando a sobra era pequena; com o
         teto da 154 ela chega a 1,0 (ao meio-dia o sol dobra a bomba) e a
         trava escondia justamente o maior número da aba. Agora a coluna tem
         60% de céu acima da altura cheia da bomba, na MESMA escala — sobra de
         meia bomba desenha meia altura. */
      const sobraDes = Math.min(sobra, 0.6);
      recup += folga; excedente += sobra;
      const H = 44, HT = Math.round(H * 1.6);
      colunas.push('<div title="' + h + 'h · bomba ' + br(fb * 60, 0) + ' min equiv' +
        (folga > 0.02 ? ' · dava +' + br(folga * 60, 0) + ' min' : '') + '" ' +
        'style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:' + HT + 'px;gap:1px">' +
        (sobra > 0.02 ? '<div style="height:' + (Math.max(0, sobraDes) * H).toFixed(1) + 'px;background:#2b3744"></div>' : '') +
        (folga > 0.02 ? '<div style="height:' + (folga * H).toFixed(1) + 'px;background:#ffb300"></div>' : '') +
        (fb > 0.01 ? '<div style="height:' + (fb * H).toFixed(1) + 'px;background:#00c896"></div>' : '') +
        '</div>');
    }
    /* AS SETAS, uma de cada lado do título do gráfico. Desabilitada (cinza, sem
       clique) quando não há dia para aquele lado — seta que não leva a lugar
       nenhum é pior que seta ausente. */
    const seta = (iso, sinal, pode) =>
      '<button ' + (pode ? 'onclick="SOLAR_DIA(\'' + iso + '\')"' : 'disabled') + ' style="' +
      'background:' + (pode ? '#1b2634' : 'transparent') + ';color:' + (pode ? '#9fb4c9' : '#2a3b4d') + ';' +
      'border:1px solid ' + (pode ? '#2a3b4d' : 'transparent') + ';border-radius:7px;' +
      (estreito ? 'padding:6px 12px;font-size:15px;' : 'padding:2px 8px;font-size:13px;') +
      'cursor:' + (pode ? 'pointer' : 'default') + ';flex:none;line-height:1">' + sinal + '</button>';
    const dd = s2 => s2.slice(8, 10) + '/' + s2.slice(5, 7);
    /* "hoje" só quando for hoje DE VERDADE (pelo relógio), não quando for
       apenas o dia mais recente que chegou: com o espelho atrasado, o último
       dia da série pode ser ontem, e chamar aquilo de hoje esconde a falha. */
    /* AVISA QUANDO PULA. Em 08/10/2026 a busca vinha truncada em 1.000 linhas e
       a seta saltava de 07/10 para 28/09 — sem dizer nada, parecendo que os
       dias do meio simplesmente não existiam. Corrigida a busca, o aviso FICA:
       falta de dado é uma informação, e navegação que pula em silêncio é a
       mesma classe de defeito do vigia que dizia OK sobre um nó em laço. */
    const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
    const pulo = temAntes ? diasEntre(diasComHora[iAtual - 1], hojeISO) - 1 : 0;
    const titulo = ((hojeISO === hojeLocal) ? 'hoje, hora a hora'
                 : dd(hojeISO) + ', hora a hora') +
      (pulo > 0 ? '<span style="color:#ff8a5c;font-weight:400;font-size:10px"> · ◀ pula ' +
                  pulo + ' dia' + (pulo > 1 ? 's' : '') + ' sem dado</span>' : '');

    /* ---------- A FAIXA DE LIGA/DESLIGA (migração 152, 08/10/2026) ----------
       *"o que não dá de ver no gráfico é quando a bomba tá ligada e desligada"*.

       Vai POR BAIXO da barra de rendimento, e não no lugar dela: as duas dizem
       coisas diferentes e as duas importam. A faixa diz **se estava ligada**; a
       barra diz **se estava rendendo**. Ao meio-dia, com o inversor
       estrangulado, a bomba está ligada e rende menos — e só as duas juntas
       contam isso.

       A fonte é outra: a barra vem da potência horária (hora equivalente), a
       faixa vem das transições extraídas do CSV de MINUTO do Pi. Por isso ela
       tem minuto de verdade e a barra não. */
    const periodos = (f.periodos || []).filter(x => (x.dia + '') === hojeISO);
    const horaDe = iso => { const d = new Date(iso); return d.getHours() + d.getMinutes() / 60; };
    const faixa = periodos.length
      ? '<div style="position:relative;height:11px;border-radius:3px;background:#1b2430;overflow:hidden;margin-top:3px">' +
        periodos.map(pz => {
          const a = Math.max(0, horaDe(pz.inicio));
          /* PERÍODO EM ABERTO PARA AGORA, não à meia-noite. A view fecha o
             período no fim do dia por não ter o desliga; se a tela desenhasse
             isso, às 9 h da manhã a faixa já mostraria a bomba rodando até
             23 h — afirmando um futuro que ninguém sabe. */
          const fimAgora = agora.getHours() + agora.getMinutes() / 60;
          const b = Math.min(24, pz.em_aberto ? fimAgora : (horaDe(pz.fim) || 24));
          if (!(b > a)) return '';
          return '<div title="ligada ' + fmtHora(a) + ' → ' + fmtHora(b) + '" style="position:absolute;top:0;bottom:0;left:' +
                 (a / 24 * 100).toFixed(2) + '%;width:' + ((b - a) / 24 * 100).toFixed(2) + '%;background:#00c896"></div>';
        }).join('') + '</div>' +
        '<div style="color:#9aa3b0;font-size:10px;margin-top:3px">bomba ligada ' +
        periodos.map(pz => '<b style="color:#dbe9f7">' + fmtHora(horaDe(pz.inicio)) + '</b> → <b style="color:#dbe9f7">' +
          (pz.em_aberto ? 'agora' : fmtHora(horaDe(pz.fim))) + '</b>').join(' · ') + '</div>'
      /* sem dado é DIFERENTE de bomba parada, e a tela tem de dizer qual dos
         dois: o extrator só tem CSV a partir de 18/09/2026. */
      : '<div style="color:#6b7683;font-size:10px;margin-top:3px">sem registro de liga/desliga neste dia</div>';

    const grafDia =
      '<div style="display:flex;align-items:center;gap:8px;margin:4px 0 5px">' +
        seta(temAntes ? diasComHora[iAtual - 1] : '', '◀', temAntes) +
        '<b style="font:700 12px/1 system-ui,sans-serif;color:#dbe9f7;flex:1;text-align:center">' + titulo + '</b>' +
        seta(temDepois ? diasComHora[iAtual + 1] : '', '▶', temDepois) +
      '</div>' +
      '<div style="display:flex;gap:1px;align-items:flex-end">' + colunas.join('') + '</div>' +
      '<div style="display:flex;justify-content:space-between;color:#6b7683;font-size:9px;margin-top:2px">' +
        '<span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>' +
      faixa +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;color:#9aa3b0;font-size:10px;margin:5px 0 10px">' +
        '<span><i style="display:inline-block;width:8px;height:8px;background:#00c896;border-radius:2px"></i> bombeando</span>' +
        '<span><i style="display:inline-block;width:8px;height:8px;background:#ffb300;border-radius:2px"></i> dava para bombear</span>' +
        '<span><i style="display:inline-block;width:8px;height:8px;background:#2b3744;border-radius:2px"></i> sobra: não cabe na bomba</span>' +
      '</div>';

    /* ---------- 5 · A FRASE DO PORQUÊ ---------- */
    const comBomba = hoje.filter(x => n(x.frac_bomba) > 0.05);
    const comTeto  = hoje.filter(x => n(x.frac_teto)  > 0.05);
    const primeira = comBomba.length ? comBomba[0].hora : null;
    const ultima   = comBomba.length ? comBomba[comBomba.length - 1].hora : null;
    const tetoAte  = comTeto.length ? comTeto[comTeto.length - 1].hora : null;
    const tetoDe   = comTeto.length ? comTeto[0].hora : null;

    /* O MINUTO MANDA, NÃO O BALDE HORÁRIO (defeito que o dono viu em
       11/10/2026: *"tem dias que a janela da bomba acaba 17h e la na mensagem
       embaixo fala que parou as 16h e podia ter ficado mais, nao ta tendo
       coerencia"*).

       A causa: `comBomba` exige frac_bomba > 0,05 — 3 minutos. Em 08/10 o
       Poço 04 desligou às 17:01, deixando 2 min na hora das 17 (frac 0,026),
       e a hora SUMIA do filtro: `ultima` virava 16 e a tela acusava "parou às
       16h" num dia que foi até 17:01. Pior: acusava de ter parado cedo.

       Duas frases na mesma tela não podem ter relógios diferentes: agora a
       hora vem das transições (migração 152), a MESMA fonte da faixa verde
       logo acima. O balde fica só de reserva, para os dias anteriores a
       18/09/2026, que não têm CSV de minuto no Pi. */
    const ligouAs = periodos.length ? horaDe(periodos[0].inicio)
                  : (primeira != null ? primeira : null);
    const ultPer  = periodos.length ? periodos[periodos.length - 1] : null;
    /* DIA EM ANDAMENTO NÃO TEM HORA DE PARADA. Sem o registro do Pi (que só
       fecha o dia de madrugada), o balde diria "parou às 10h" de uma bomba que
       está rodando agora — exatamente a classe de erro que esta correção veio
       consertar, só que no outro sentido. Null, e o cartão escreve "agora". */
    const parouAs = ultPer ? (ultPer.em_aberto ? null : horaDe(ultPer.fim))
                  : (parcial || ultima == null) ? null : ultima + 1;

    /* QUANTO SOL FICOU NA MESA, e não "até que hora havia sol". A hora das 17
       podia ter frac_teto 0,07 — quatro minutos. Dizer "havia sol até 18h"
       por causa disso cobra uma hora que nunca existiu. Soma-se o que o céu
       ofereceu depois do minuto da parada, descontando a fatia já usada da
       hora em que ela parou. */
    const somaTeto = (hLim, depois) => hLim == null ? 0 : comTeto.reduce((s2, x) => {
      const t = Math.min(n(x.frac_teto) || 0, 1), hz = Math.floor(hLim);
      if (depois ? x.hora < hz : x.hora > hz) return s2;
      if (x.hora !== hz) return s2 + t;
      return s2 + (depois ? Math.max(0, t - (hLim - hz)) : Math.max(0, Math.min(t, hLim - hz)));
    }, 0);
    const deixouTarde = somaTeto(parouAs, true);
    const deixouManha = somaTeto(ligouAs, false);
    const socMin   = n(dHoje.soc_min_pct);
    let porque;
    if (parcial)
      porque = '⏳ <b>dia em andamento</b> — ' + br(feitas, 1) + ' h até agora, de ' + br(teto, 1) +
               ' h que o céu já ofereceu' + (comTeto.length ? ' (sol desde ' + tetoDe + 'h)' : '') + '.';
    else if (feitas >= META_H) porque = '✅ meta batida.';
    /* A FRASE DO "CÉU NÃO DEU" FOI REESCRITA NA 154. Com o teto velho ela
       comparava a meta contra um dia-Frankenstein; com o teto novo (o sol que
       cabe na bomba, 9,1 a 9,7 h) ela dispararia TODO DIA, porque o sol
       sozinho nunca chega às 10 h nesta usina. E não chegar é o normal: as
       10 h se fazem com o sol direto MAIS a bateria nas pontas. Então o que
       a tela precisa dizer é de quanto foi a ajuda da bateria, não que o céu
       falhou. */
    else if (feitas > teto + 0.1)
      porque = '🔋 <b>passou do sol direto</b>: o sol sozinho tocava ' + br(teto, 1) +
               ' h e a bateria esticou mais ' + br(feitas - teto, 1) + ' h. Faltaram ' +
               br(META_H - feitas, 1) + ' h para a meta.';
    else if (teto < META_H - 0.3 && feitas >= teto - 0.2)
      porque = '☀️ <b>o sol direto deu ' + br(teto, 1) + ' h e foi todo usado</b>. As ' + META_H +
               ' h só saem esticando com a bateria nas pontas — é o que a indicação lá embaixo persegue.';
    else if (socMin > 0 && socMin <= 22)
      porque = '🔋 <b>a bateria chegou ao piso</b> (' + br(socMin, 0) + '%). Faltou reserva para seguir bombeando quando o sol caiu.';
    /* O LIMIAR DE 0,3 h (18 min) existe para a tela não acusar "parou cedo"
       por causa de três minutos de sol fraco no fim da tarde — que foi
       exatamente o que acontecia com o desliga às 17:01. Antes da correção
       a frase acusava "parou cedo" nos QUATRO dias conferidos, todos falsos. */
    else if (parouAs != null && deixouTarde > 0.3)
      porque = '⏱ <b>parou cedo</b>: a bomba desligou às <b>' + fmtHora(parouAs) +
               '</b> e o céu ainda ofereceu <b>' + br(deixouTarde, 1) + ' h</b> de bomba depois disso.';
    else if (ligouAs != null && deixouManha > 0.3)
      porque = '⏱ <b>começou tarde</b>: a bomba entrou às <b>' + fmtHora(ligouAs) +
               '</b> e o céu já oferecia <b>' + br(deixouManha, 1) + ' h</b> de bomba antes disso.';
    else porque = 'o dia rendeu ' + br(feitas, 1) + ' h de ' + br(teto, 1) + ' h possíveis.';

    /* ---------- 6, 7, 10 · os números do dia ---------- */
    const m3 = feitas * 204;          // 204 m³/h por poço, medido em 08/10/2026 (doc 17)
    /* DOIS POR LINHA no celular (min-width 150) e três no desktop (92). Com 92
       no celular cabiam três, e aí "do que o céu deu até agora" quebrava em
       três linhas dentro de um cartão de 92 px — legível no papel, ilegível no
       polegar. */
    const cartao = (rot, val, cor2, nota) =>
      '<div style="flex:1;min-width:' + (estreito ? 150 : 92) + 'px;background:#151f2b;border:1px solid #223044;border-radius:7px;padding:' +
      (estreito ? '8px 10px' : '6px 8px') + '">' +
      '<div style="color:#8ba0bd;font-size:10px">' + rot + '</div>' +
      '<div style="font:800 15px/1.3 system-ui,sans-serif;color:' + (cor2 || '#e8edf5') + '">' + val + '</div>' +
      (nota ? '<div style="color:#6b7683;font-size:9px">' + nota + '</div>' : '') + '</div>';

    /* AS DUAS FALHAS QUE A NOTA NÃO CONTA, e que são mais graves que nota
       baixa. Dono, 11/10/2026: *"o grande B.O. é esses 10% chegar no fim do
       dia: o sistema come durante a noite, não carrega, aí sim entra em
       proteção, desliga o BESS, tem que fazer um black start, isso sim
       demora"*. A noite come 4 a 4,5 pontos — por isso o piso do FIM do dia
       (20%) é mais alto que o da manhã (15%): de manhã o sol vem repor. */
    const alerta = (dHoje.desarmou === true || dHoje.fim_arriscado === true)
      ? '<div style="background:#2a1420;border:1px solid #7a2540;border-radius:8px;padding:8px 10px;' +
        'margin-bottom:8px;font-size:12px;color:#ffc4d2">' +
        (dHoje.desarmou === true
          ? '⚠️ <b>raspou a proteção</b>: a bateria chegou a ' + br(n(dHoje.soc_min_pct), 0) +
            '%, com o corte do BESS em ' + br(n(dHoje.soc_protecao_pct) || 10, 0) + '%. ' +
            'A bomba desarma e o banco passa a noite no fundo.'
          : '') +
        (dHoje.fim_arriscado === true
          ? (dHoje.desarmou === true ? '<br>' : '') +
            '⚠️ <b>terminou o dia em ' + br(n(dHoje.soc_fim_pct), 0) + '%</b>, abaixo dos ' +
            br(n(dHoje.soc_fim_seguro_pct) || 20, 0) + '% seguros. A noite come ~4 pontos: ' +
            'daqui o sistema pode entrar em proteção de madrugada e exigir <b>black start</b>.'
          : '') +
        '</div>' : '';

    const numeros = alerta +
      '<div style="background:#101a26;border:1px solid #223044;border-radius:8px;padding:8px;margin-bottom:10px;font-size:12px;color:#dbe9f7">' +
        porque + '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' +
        /* APROVEITAMENTO é o número que a cor das barras já mostra — e cor
           sozinha é vaga. Ele responde a pergunta certa: "dei conta do que o
           céu ofereceu?", que é o que está no controle de quem opera. A meta
           de 10 h depende do tempo; esta não. */
        /* A NOTA DO DIA (155) no lugar do aproveitamento. O teto inclui o que a
           bateria podia esticar, por isso 100% é raro — foi o pedido do dono. */
        /* DIA QUE RASPOU A PROTEÇÃO NÃO É NOTA 100. O teto da nota é o
           ACHÁVEL COM SEGURANÇA; ultrapassá-lo desarmando o BESS não é
           mérito, é ter passado do ponto — e cobra a manhã seguinte (em
           26/09 o Poço 04 amanheceu a 10% e perdeu a hora das 7). Não
           invento desconto: mantenho o número e marco o que ele é. */
        cartao('nota do dia',
               (n(dHoje.nota_pct) > 0 ? br(n(dHoje.nota_pct), 0) + ' %' : '—') +
               (dHoje.desarmou === true ? '<span style="font-size:11px"> ⚠</span>' : ''),
               dHoje.desarmou === true ? '#c060ff'
               : n(dHoje.nota_pct) >= 95 ? '#00c896'
               : n(dHoje.nota_pct) >= 85 ? '#ffb300' : '#ff4444',
               dHoje.desarmou === true
                 ? 'passou do seguro, não é perfeição'
                 : 'de ' + br(n(dHoje.teto_total_h), 1) + ' h possíveis' + (parcial ? ' até agora' : '')) +
        /* O FUNDO DA MANHÃ é o diagnóstico do próprio dono: ficou muito acima
           da proteção => sobrou carga que não virou água, dava para largar
           mais cedo. Encostou nos 10% => passou do ponto. */
        (n(dHoje.soc_fundo_manha) > 0
          ? cartao('fundo da manhã', br(n(dHoje.soc_fundo_manha), 0) + ' %',
              n(dHoje.soc_fundo_manha) <= 16 ? '#00c896'
              : n(dHoje.soc_fundo_manha) <= 30 ? '#ffb300' : '#ff4444',
              n(dHoje.soc_fundo_manha) > 30
                ? 'sobrou bateria: dava para largar mais cedo'
                : 'usou a bateria da manhã') : '') +
        cartao('água bombeada', br(m3, 0) + ' m³', '#5aa9ff', br(feitas, 1) + ' h × 204 m³/h') +
        cartao('dava para bombear', '+' + br(recup, 1) + ' h', recup > 0.5 ? '#ffb300' : '#9aa3b0', 'sol que cabia na bomba') +
        cartao('bateria no fim', br(n(dHoje.soc_fim_pct), 0) + ' %', n(dHoje.soc_fim_pct) >= 50 ? '#00c896' : '#ffb300',
               'menor do dia: ' + br(socMin, 0) + ' %') +
        /* O QUE O INVERSOR RECUSOU, em hora de bomba (migração 153). Antes este
           cartão só dizia "258 min limitado", que não decide nada. A energia
           recusada é a ÚNICA hora a mais que ainda existe de graça — e só se
           pega ligando mais cedo, para a bateria ter espaço ao meio-dia. É a
           conta que sustenta a recomendação lá embaixo.
           Fica FORA do aproveitamento de propósito: energia que o inversor não
           deixou entrar não é energia que a bomba deixou de usar. Misturar as
           duas foi o erro que o dono pegou em 11/10/2026. */
        /* O EXCEDENTE DO MEIO-DIA (migração 154). Não é "perda do operador": é
           energia que as placas fazem e a bomba NÃO pode absorver, por ser
           carga de potência fixa. Só vira hora de bomba passando pela bateria,
           nas pontas do dia. São 4 a 6 h por dia — o maior número da tela, e
           o que de fato diz onde está o ganho que falta. */
        cartao('sobra das placas', br(n(dHoje.horas_excedente), 1) + ' h', '#ffb300',
               'não cabe na bomba · ' + br(n(dHoje.min_limitado), 0) + ' min estrangulado') +
        /* MESMO RELÓGIO DA FAIXA VERDE: este cartão mostrava o balde horário
           ("7h → 16h") logo abaixo de uma faixa que dizia 7:26 → 17:01. */
        (ligouAs != null ? cartao('janela da bomba',
               fmtHora(ligouAs) + ' → ' + (parouAs != null ? fmtHora(parouAs) : 'agora'), '#e8edf5',
               periodos.length ? 'minuto exato do registro' : 'estimado pela hora') : '') +
      '</div>';

    /* ---------- 3 e 4 · O HISTÓRICO E O MÊS ---------- */
    const ult = dias.slice(-30);
    const maxH = Math.max(META_H, ...ult.map(d => n(d.teto_total_h) || n(d.horas_possiveis)), 1);
    const barras = ult.map(d => {
      const hb = n(d.horas_bomba), hp = n(d.teto_total_h) || n(d.horas_possiveis), H = 42;
      /* A COR MEDE APROVEITAMENTO (feito ÷ possível), NÃO a meta fixa — e isto
         é decisão de projeto, não de estética. Um dia em que o céu deu 6,3 h e
         a bomba fez 6,2 é um dia ÓTIMO; pintá-lo de vermelho porque não chegou
         a 10 culpa o operador pelo tempo que fez. A meta continua na tela,
         como a linha branca: ela diz onde se quer chegar, a cor diz se o que
         havia foi aproveitado. */
      /* A COR É A NOTA DO DIA (migração 155), não mais o aproveitamento.
         O aproveitamento media só contra o sol direto — e sol direto é o que
         a operação já faz todo dia, então marcava 100% em 61 de 88 dias.
         Dono, 11/10/2026: *"você sabe que 100% é muita coisa, digamos assim
         tem que ser perfeito"*. A nota inclui o que a bateria PODE esticar,
         e aí 100% sai em 1 de 88 dias. Mediana 90, pior 70.
         Cortes: 95 e 85, que é onde a distribuição de fato se parte. */
      const aprov = n(d.nota_pct) > 0 ? n(d.nota_pct) / 100 : null;
      const c = aprov == null ? '#6b7683'
              : n(d.desarmou) || d.desarmou === true ? '#c060ff'
              : aprov >= 0.95 ? '#00c896' : aprov >= 0.85 ? '#ffb300' : '#ff4444';
      return '<div title="' + (d.dia + '').slice(5) + ' · ' + br(hb, 1) + ' h de ' +
        br(n(d.teto_total_h) || hp, 1) + ' h possíveis · nota ' +
        (aprov == null ? '—' : br(aprov * 100, 0) + '%') +
        (d.desarmou === true ? ' · ⚠ raspou a proteção' : '') +
        (d.fim_arriscado === true ? ' · ⚠ terminou abaixo de 20%' : '') +
        (hb >= META_H ? ' · bateu a meta' : '') + '" ' +
        'style="flex:1;min-width:4px;display:flex;flex-direction:column;justify-content:flex-end;height:' + H + 'px">' +
        '<div style="height:' + ((hp - hb) / maxH * H).toFixed(1) + 'px;background:#2b3744"></div>' +
        '<div style="height:' + (hb / maxH * H).toFixed(1) + 'px;background:' + c + '"></div></div>';
    }).join('');

    /* ===== A FAIXA DAS HORAS FEITAS, DEBAIXO DA BARRA =====
       Dono, 11/10/2026: *"coloca uma forma de identificar o dia que bateu os
       10h também, tipo para baixo da barra mostra um quadrado da largura da
       barra: vermelho abaixo de 5h, amarelo até 9,9 e 10 para cima verde"*.

       São DUAS PERGUNTAS e por isso duas faixas, e não duas cores na mesma:
         · a BARRA mede aproveitamento — "o que as placas fizeram chegou na
           bomba?" — e é sobre operar bem, independente do tempo;
         · esta FAIXA mede hora absoluta — "bati a meta?" — e depende do céu.
       Um dia nublado bem operado é barra VERDE com faixa AMARELA, e as duas
       estão certas. Era isso que a tela não sabia dizer.

       Mesma geometria das barras (flex:1, gap 1px) para cada quadrado cair
       debaixo do seu dia. */
    const corHoras = hb => hb >= META_H ? '#00c896' : hb >= 5 ? '#ffb300' : '#ff4444';
    const metas = ult.map(d => {
      const hb = n(d.horas_bomba);
      /* DIA EM CURSO NÃO LEVA COR DE JULGAMENTO — a mesma regra do placar. Às
         10 h da manhã o dia tem 3,3 h feitas e sairia VERMELHO, acusando um dia
         que ainda tem seis horas de sol pela frente. Cinza: informa sem
         condenar, e some sozinho quando o dia fecha. */
      const emCurso = (d.dia + '') === hojeLocal && agora.getHours() < 18;
      return '<div title="' + (d.dia + '').slice(5) + ' · ' + br(hb, 1) + ' h' +
        (emCurso ? ' · dia em andamento' : hb >= META_H ? ' · bateu a meta' : '') + '" ' +
        'style="flex:1;min-width:4px;height:7px;border-radius:1px;background:' +
        (emCurso ? '#3d4a5a' : corHoras(hb)) + '"></div>';
    }).join('');
    const quantosBateram = ult.filter(d => n(d.horas_bomba) >= META_H).length;

    const mesAtual = hojeISO.slice(0, 7);
    const doMes = dias.filter(d => (d.dia + '').slice(0, 7) === mesAtual);
    const somaMes = doMes.reduce((s, d) => s + n(d.horas_bomba), 0);
    const mediaMes = doMes.length ? somaMes / doMes.length : 0;
    const diasNoMes = new Date(+mesAtual.slice(0, 4), +mesAtual.slice(5, 7), 0).getDate();
    const faltaMes = Math.max(0, META_H * diasNoMes - somaMes);
    const diasRestam = Math.max(0, diasNoMes - doMes.length);
    const precisaDia = diasRestam > 0 ? faltaMes / diasRestam : 0;
    /* o teto TÍPICO é a mediana dos dias fechados, não a média: uma semana
       nublada puxaria a média e faria a tela dizer que a meta é alcançável
       quando não é. */
    /* TETO TOTAL, não só o sol direto: esta linha decide se a meta do mês é
       alcançável, e com o sol direto (9,1 a 9,7 h) ela diria "impossível"
       todo mês — as 10 h se fazem com o sol MAIS a bateria. */
    const tetos = ult.filter(d => n(d.teto_total_h) > 1).map(d => n(d.teto_total_h)).sort((a, b) => a - b);
    const tetoTipico = tetos.length ? tetos[Math.floor(tetos.length / 2)] : META_H;
    const historico =
      '<div style="font:700 12px/1 system-ui,sans-serif;color:#dbe9f7;margin:2px 0 5px">últimos ' + ult.length + ' dias</div>' +
      '<div style="position:relative;display:flex;gap:1px;align-items:flex-end">' + barras +
        '<div style="position:absolute;left:0;right:0;bottom:' + (META_H / maxH * 42).toFixed(1) + 'px;height:1px;background:#e8edf5;opacity:.65"></div>' +
      '</div>' +
      '<div style="display:flex;gap:1px;margin-top:2px">' + metas + '</div>' +
      /* A LEGENDA EXPLÍCITA, porque cor sem legenda é adivinhação — e o dono
         disse exatamente isso em 11/10/2026. A cor responde "aproveitei o que
         o céu deu?"; o ponto verde responde "bati as 10 h?". São perguntas
         diferentes e um dia pode acertar uma e errar a outra: céu de 6 h
         totalmente aproveitado fica VERDE e SEM ponto. */
      '<div style="margin-top:5px;font-size:9px;color:#8ba0bd;line-height:1.6">' +
        '<div style="margin-bottom:2px"><b style="color:#dbe9f7">a cor</b> = a nota do dia (sol que cabe na bomba + o que a bateria podia esticar):' +
          ' <i style="display:inline-block;width:7px;height:7px;background:#00c896;border-radius:2px"></i> 95% ou mais' +
          ' · <i style="display:inline-block;width:7px;height:7px;background:#ffb300;border-radius:2px"></i> 85 a 95%' +
          ' · <i style="display:inline-block;width:7px;height:7px;background:#ff4444;border-radius:2px"></i> abaixo de 85%' +
          ' · <i style="display:inline-block;width:7px;height:7px;background:#c060ff;border-radius:2px"></i> raspou a proteção</div>' +
        '<div><b style="color:#dbe9f7">a faixa de baixo</b> = horas feitas no dia:' +
          ' <i style="display:inline-block;width:7px;height:7px;background:#00c896;border-radius:2px"></i> ' + META_H + ' h ou mais' +
          ' · <i style="display:inline-block;width:7px;height:7px;background:#ffb300;border-radius:2px"></i> 5 a ' + META_H + ' h' +
          ' · <i style="display:inline-block;width:7px;height:7px;background:#ff4444;border-radius:2px"></i> abaixo de 5 h' +
          ' — bateu a meta em <b style="color:#00c896">' + quantosBateram + ' de ' + ult.length + ' dias</b></div>' +
      '</div>' +
      '<div style="margin-top:7px;font-size:12px;color:#dbe9f7">' +
        'no mês: <b>' + br(somaMes, 0) + ' h</b> em ' + doMes.length + ' dias · média <b style="color:' +
        (mediaMes >= META_H ? '#00c896' : '#ffb300') + '">' + br(mediaMes, 1) + ' h</b>' +
        /* "faltam 243 h" não decide nada; "10,6 h/dia nos 23 que sobram" decide.
           E quando o necessário passa do que o céu costuma dar, a tela diz —
           em vez de cobrar um número que o sol não entrega. */
        (faltaMes > 0 && diasRestam > 0
          ? ' · faltam <b>' + br(faltaMes, 0) + ' h</b> em ' + diasRestam + ' dias = <b style="color:' +
            (precisaDia > tetoTipico ? '#ff4444' : '#ffb300') + '">' + br(precisaDia, 1) + ' h/dia</b>' +
            (precisaDia > tetoTipico ? ' <span style="color:#9aa3b0">(acima das ' + br(tetoTipico, 1) +
             ' h que o céu costuma dar)</span>' : '')
          : faltaMes > 0 ? ' · faltam ' + br(faltaMes, 0) + ' h' : ' · meta do mês batida') +
      '</div>';

    /* A SUGESTÃO VAI NO FIM (dono, 08/10/2026: *"a indicação pode colocar bem no
       final"*). Faz sentido: primeiro se vê o que aconteceu, depois o que fazer
       a respeito — recomendação antes do diagnóstico é palpite. */
    return placar + grafDia + numeros + historico + blocoSugestao(f.sugestao, estreito);
  }

  /* ---------------------------------------------------------------- janela */
  let abertaId = null, fonteAtual = null, ultimoHTML = '', abaAtual = 'geral';
  /* QUAL DIA a aba do objetivo está mostrando (dono, 08/10/2026: *"duas setas,
     uma do lado direito do gráfico do dia e outra do lado esquerdo, para voltar
     e passar a data; aí consigo ver o histórico"*). `null` = o dia mais recente
     que houver — e volta a `null` toda vez que a janela abre, para o padrão ser
     sempre "hoje" e ninguém encontrar a tela parada num dia de duas semanas
     atrás sem saber por quê. */
  let diaAba = null;

  function fecharJanela() { abertaId = null; const e = document.getElementById('solarJanela'); if (e) e.remove(); }
  /* ABAS: cada parte do desenho abre a sua (pedido do dono, 18/09/2026):
     o meio da usina abre o GERAL, a casa abre os INVERSORES, a bateria abre a
     BATERIA, e cada string abre a dela. A janela é a mesma — muda o que ela
     mostra —, para não virar quatro janelas concorrendo na tela. */
  /* `typeof aba === 'string'` e não `aba || 'geral'` (08/10/2026). O `||` só
     protege contra nulo; qualquer objeto passa por verdadeiro. Foi assim que um
     `.on('click', aoClicar)` — que entrega o EVENTO do Leaflet no 1º argumento —
     fez `abaAtual` virar um MouseEvent, e a renderização quebrar em
     `abaAtual.startsWith(...)`: a janela não abria e não dizia por quê.
     Guarda de TIPO, não de presença. */
  function abrirJanela(id, fonte, aba) {
    abertaId = id; fonteAtual = fonte; diaAba = null;
    abaAtual = (typeof aba === 'string' && aba) ? aba : 'geral';
    ultimoHTML = ''; atualizarJanela();
  }
  window.SOLAR_ABA = a => { abaAtual = a; diaAba = null; ultimoHTML = ''; atualizarJanela(); };
  /* passo de um dia. O limite não vem daqui: quem sabe até onde há dado é a aba,
     que simplesmente não desenha a seta quando não há para onde ir. */
  window.SOLAR_DIA = iso => { diaAba = iso || null; ultimoHTML = ''; atualizarJanela(); };

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
    /* TELA ESTREITA = TELA CHEIA (dono, 08/10/2026: *"no mobile fica ruim aquela
       janelinha; quando clicar tem que abrir tela inteira, abas bem definidas
       para trocar, um botão de voltar para a tela da telemetria"*).
       Medido a cada repintura, e não só ao criar: se não, girar o celular
       deixava a janela no formato errado até o próximo clique. */
    const estreito = telaEstreita();
    const sel = k => abaAtual === k || (k === 'string' && String(abaAtual).startsWith('string'));
    /* ALVO DE TOQUE: 38 px de altura no celular. Os 3 px de antes davam um
       botão de ~20 px — abaixo de qualquer recomendação de toque, e o dono
       errava a aba. No desktop fica compacto como era. */
    const aba = (k, r) => '<button onclick="SOLAR_ABA(\'' + k + '\')" style="' +
      'background:' + (sel(k) ? '#2d6a9f' : '#1b2634') + ';' +
      'color:' + (sel(k) ? '#fff' : '#9fb4c9') + ';' +
      'border:1px solid ' + (sel(k) ? '#4a8fc7' : '#2a3b4d') + ';border-radius:8px;' +
      (estreito ? 'padding:9px 14px;font-size:13px;font-weight:700;' : 'padding:3px 9px;font-size:12px;') +
      'margin-right:5px;cursor:pointer;white-space:nowrap;flex:none">' + r + '</button>';
    /* A aba do OBJETIVO só existe em POÇO: a meta de 10 h/dia é da bomba, e a
       usina dos pivôs não tem bomba (nem `solar_poco_dia`, que filtra por
       tipo='poco'). Mostrar uma aba que abriria vazia é pior que não mostrar. */
    const ePoco = v.tipo === 'poco';
    /* `overflow-x:auto` em vez de quebrar linha: com 5 abas num celular estreito,
       quebrar empurrava o conteúdo para baixo da dobra. Rolar de lado é o que
       o dedo já espera. */
    const abas = '<div style="display:flex;gap:0;overflow-x:auto;margin:' +
      (estreito ? '10px 0 4px' : '8px 0 6px') + ';padding-bottom:2px;-webkit-overflow-scrolling:touch">' +
      aba('geral', 'usina') + (ePoco ? aba('objetivo', '10 h/dia') : '') + aba('inversores', 'inversores') +
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
      abaAtual === 'objetivo' ? abaObjetivo(v, f) :
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
    /* CABEÇALHO GRUDADO NO TOPO em tela cheia: com a aba "10 h/dia" rolando
       bastante, o botão de voltar sumia lá em cima e o dono ficava preso na
       tela. Sticky resolve sem precisar de um segundo botão no fim. */
    const voltar = '<button onclick="SOLAR_UI.fecharJanela()" style="' +
      'background:#22303f;color:#cfe4f7;border:1px solid #33475c;border-radius:8px;' +
      (estreito ? 'padding:9px 13px;font-size:14px;' : 'padding:4px 9px;font-size:12px;') +
      'cursor:pointer;font-weight:700;flex:none">← telemetria</button>';

    const cabeca =
      '<div style="position:sticky;top:0;z-index:2;background:#161a21;' +
      (estreito ? 'padding:10px 14px 0;margin:-12px -14px 0;' : '') + '">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          (estreito ? voltar : '') +
          '<b style="font-size:' + (estreito ? '16px' : '15px') + ';flex:1;min-width:0;' +
          'overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (v.nome || abertaId) + '</b>' +
          '<span style="color:' + cor + ';font-weight:700;flex:none">' + v.situacao + '</span>' +
        '</div>' +
        (v.mensagem ? '<div style="color:#9aa3b0;font-size:12px;margin:3px 0 0">' + v.mensagem + '</div>' : '') +
        abas +
        '<div style="height:1px;background:#2a3b4d;margin-bottom:' + (estreito ? '10px' : '6px') + '"></div>' +
      '</div>';

    const html = cabeca + miolo +
      '<div style="margin-top:10px;color:#6b7683;font-size:11px">Contorno aproximado (Sentinel-2, ~10 m).</div>' +
      /* no celular quem fecha é o "← telemetria" do topo; um segundo botão no
         rodapé só ocupa polegar e confunde sobre qual é o caminho de volta */
      (estreito ? '<div style="height:10px"></div>'
                : '<div style="text-align:right;margin-top:8px"><button onclick="SOLAR_UI.fecharJanela()" ' +
                  'style="background:#22303f;color:#e6e6e6;border:1px solid #33475c;border-radius:6px;padding:5px 10px;cursor:pointer">fechar</button></div>');

    if (html === ultimoHTML) return;      // não repinta igual: evita piscar a cada ciclo
    ultimoHTML = html;
    let e = document.getElementById('solarJanela');
    if (!e) { e = document.createElement('div'); e.id = 'solarJanela'; document.body.appendChild(e); }
    /* O ESTILO É REAPLICADO A CADA REPINTURA, não só na criação: assim girar o
       celular (ou redimensionar a janela no desktop) troca de formato sozinho,
       em vez de ficar no formato de quando foi aberta. */
    e.style.cssText = estreito
      ? 'position:fixed;z-index:3000;inset:0;overflow:auto;-webkit-overflow-scrolling:touch;' +
        'background:#161a21;padding:12px 14px calc(14px + env(safe-area-inset-bottom));color:#e6e6e6;' +
        'font:13px/1.45 system-ui,sans-serif'
      : 'position:fixed;z-index:3000;right:14px;bottom:14px;width:min(360px,92vw);max-height:70vh;overflow:auto;' +
        'background:#161a21;border:1px solid #2a2f3a;border-radius:10px;padding:12px 14px;color:#e6e6e6;' +
        'font:13px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)';
    e.innerHTML = html;
  }

  /* `abaObjetivo` sai junto para a ferramenta de prévia poder RENDERIZAR a aba
     fora do navegador, pelo mesmo motivo que o `desenhar` sai: maquete feita à
     mão mostra o que eu achei que o código faz, não o que ele faz. */
  window.SOLAR_UI = { COR, prepararCadastro, desenhar, abrirJanela, atualizarJanela, fecharJanela, abaObjetivo };
})();
