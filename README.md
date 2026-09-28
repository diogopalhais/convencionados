# sns-conv

Nome público: **Convencionados**, em `https://convencionados.xyz` (domínio registado a
2026-09-28). `sns-conv` é só o nome interno do repositório. A marca, o domínio, o aviso de não
oficialidade e o email de contacto vivem em `packages/web/src/brand.ts`.

PWA para descobrir onde fazer um P1 (requisição de MCDT) num prestador convencionado com o SNS.

Estado: **fundações / MVP de validação**. O objetivo desta fase é correr o pipeline de dados de
ponta a ponta, medir a qualidade dos dados oficiais e validar a UI/UX de pesquisa com dados reais.
Arquitetura e decisões em `docs/arquitetura.html`.

## Estrutura

```
packages/schema   tipos + validação zod do snapshot (partilhado)
packages/ingest   extrator do relatório SDM, normalização, tabela MCDT, relatório de qualidade
packages/web      PWA (Vite + React + MapLibre + MiniSearch)
data/             snapshots versionados + relatórios (saída da ingestão)
docs/             blueprint de arquitetura
```

## Correr

```bash
pnpm install
pnpm run ingest:fixture   # gera data/latest.json a partir do HTML do SDM guardado em fixtures
pnpm run web              # copia o snapshot para packages/web/public/data e arranca o Vite
pnpm test                 # testes do extrator, parser de valências, schema e pesquisa
pnpm lint
```

`pnpm run ingest:live` faz o pedido real ao SDM (≈25 s, ≈10 MB) e grava também o HTML bruto em
`data/raw/` para diagnóstico. Só atualiza `data/latest.json` se todas as portas de qualidade passarem.

## Fontes de dados

| fonte | uso | frequência |
|---|---|---|
| SDM (SPMS/ACSS) — relatório "Lista nacional de entidades que realizam exames", embutido em iframe na página da ACSS | lista de convenções vigentes, moradas, coordenadas, contactos, valências | mensal (dia 5) |
| ACSS — Tabela MCDT do setor convencionado (xlsx) | código P1 → área, descrição, preço | por circular |
| Transparência SNS — `exames-convencionados-e-area-mcdt` | validação: quem faturou nos últimos meses (fase 3) | mensal |

## Enriquecimento (na ingestão)

| enriquecimento | fonte | resultado no snapshot |
|---|---|---|
| Faturação ao SNS por entidade × área, últimos 12 meses (último mês, n.º de meses, requisições, atos) | Transparência SNS, export agregado num único pedido | `Convention.activity`; 92% das convenções faturaram nos últimos 3 meses; 142 convenções antigas sem faturação em 12 meses aparecem como anomalia `no-billing-12m` |
| Nomes de distrito, concelho e freguesia a partir dos códigos DICOFRE | listas auxiliares embutidas no próprio relatório SDM | `Address.municipalityName`, `districtName`, `parishName` a 100% |
| Reclamações e elogios por entidade (semestre mais recente) | ERS, tabela PDF "Reclamações em números", descoberta na página e lida com `unpdf`; cruzamento por nome canónico, semelhança de tokens com salvaguardas, e dicionário manual `fixtures/ers-name-overrides.json` | `Entity.complaints`; 282 de 828 entidades cruzadas, que representam 74% das requisições ao SNS; `data/ers-suggestions-<período>.json` lista candidatos para curadoria |
| Coordenadas para os 134 locais sem elas | 1) outro local com o mesmo CP7 · 2) GEO API PT com cache em `data/geocode-cache.json` e pausa entre pedidos · 3) centróide do CP4 | `coordsSource` = `geocoded` (exato) ou `approx`; cobertura passou de 95,5% para 99,4% |

Flags do CLI: `--ers live|off|<tabela.pdf>` (por defeito live, com fallback para a fixture), `--transparencia live|off|<fixture.json>` (por defeito live, com fallback para a fixture)
e `--no-geocode-api` para não tocar na GEO API PT.

Não existe API oficial nem licença publicada para o SDM. Antes de um lançamento público, pedir à
ACSS um feed oficial ou autorização de reutilização (Lei 26/2016).

## Como validar nesta fase

1. **Dados**: abrir `/qualidade` na app ou `data/report-<data>.md`. Ver portas, cobertura, valências
   sem família e anomalias (locais sem coordenadas, coordenadas partilhadas).
2. **Pesquisa**: testar termos como aparecem num P1 (`ecografia tiróide`, `TAC`, `análises`,
   `holter`), códigos (`748.0`, `770748`, `40550`) e localidades. Confirmar que o realce da valência
   faz sentido e que os sinónimos não trazem lixo.
3. **UX**: "Perto de mim" ou código postal → ordenação por distância; alternar lista/mapa; ficha do
   prestador com ligar/direções. As classificações Google só entram na UI quando a função edge existir.

## Design

Tema sóbrio, à maneira dos sites de marketing da Apple: tipografia Geist com títulos grandes e
tracking apertado, superfícies brancas com sombra suave sobre cinzento #f5f5f7, um só acento azul.
Modo claro por defeito, modo escuro opcional (toggle na barra, persistido em `localStorage`). O mapa
segue o tema (OpenFreeMap `positron` / `dark`). Não há resultados antes de uma intenção explícita
(texto, área ou localização); a página inicial mostra números e as áreas. A escrita tem debounce de
320 ms e o estado da pesquisa vive no URL (`q`, `area`, `cp`, `sort`, `raio`). A barra de pesquisa
é um controlo composto: campo do exame, campo de localização (código postal ou "usar a minha
localização") e o botão "Pesquisar". Códigos postais resolvem-se primeiro num índice local
construído a partir das moradas do snapshot e só depois na GEO API PT. Tags: positivo azul,
atenção âmbar, neutro cinzento (sem verde nem vermelho, por decisão de produto).

## Conformidade com as Human Interface Guidelines

Revisão feita contra o texto das HIG (Accessibility, Layout, Typography, Color, Dark Mode,
Searching, Text fields, Buttons, Feedback, Loading, Lists and tables, Segmented controls, Writing,
Maps). Implementado: escala tipográfica em `rem` com raiz de 17 px e mínimo de 12 px (o texto
escala com a preferência do utilizador, testado a 200%); alvos de toque de 44 px e 10 px entre
controlos em ecrãs de toque (`pointer: coarse`); aparência a seguir o sistema por defeito, com
override claro/escuro no botão da barra (ciclo sistema → claro → escuro); título do documento por
página; explicação do aviso visível no cartão, sem depender de hover; pesquisas recentes e
sugestões (áreas e exames da tabela MCDT) enquanto se escreve; linguagem para utentes nas linhas
de decisão ("vale em todo o país", "exames pedidos pelo SNS"); indicação visível nos links que
abrem noutra janela; mapas como `section` com etiqueta e a lista como alternativa;
`prefers-contrast: more` com hairlines e cinzentos mais escuros. Contrastes verificados: 19 pares
acima de 4,5:1 nos dois modos.

## Ficha do prestador: princípios

Baseada em Nielsen Norman Group (progressive disclosure: "tudo o que o utilizador precisa com
frequência fica à vista"; cartões como ponto de entrada, listas mais scannable do que cartões;
57% do tempo acima da dobra), GOV.UK Design System (summary list para factos-chave, tags poucas,
adjetivas, nunca interativas, cor nunca sozinha) e Apple HIG (clareza, deferência, hierarquia por
tipografia e espaço). Estrutura: título e ações → lista de factos com uma pergunta por linha (o seu
exame, aceita o SNS, requisições, reclamações, onde) com valor, nota e tag de estado → lista de exames
com os que correspondem à pesquisa em destaque → "Mais sobre este local" com todos os sinais → mapa,
contactos, antes de ir. O cartão passa a levar `q` e a origem no link para a ficha responder à
pergunta concreta do utente. Linguagem para utentes: "fez exames pelo SNS" em vez de "faturou".

## Página de dados (`/qualidade`): princípios

Mesma linguagem visual da ficha: 4 tiles de destaque (locais, verificações a passar, no mapa,
ativas no último ano) e painéis em duas colunas. Regras de visualização: barras finas de uma só
cor (o azul de destaque) para grandezas; estado (passou/atenção) apenas com ponto + texto, azul/âmbar,
nunca verde/vermelho; valores sempre em texto (mono, tabular) e nunca só na barra; `title` em cada
barra para tooltip. Nomes técnicos das portas, campos, sinais e anomalias traduzidos para frases
(`GATES`, `COVERAGE`, `SIGNALS`, `ANOMALIES` em `Quality.tsx`). A cobertura agrupa-se por local,
convenção e entidade; as anomalias têm chips com contagem, uma frase de contexto por tipo e
paginação de 25 em 25. As fontes do snapshot (SDM, Transparência, ERS, tabela MCDT, geocodificação)
mostram data, origem e link.

## Repositório

`https://github.com/diogopalhais/convencionados`. `data/latest.json` é versionado (o histórico
mensal fica nos commits); `data/snapshot-<data>.json` e `data/raw/` são ignorados por duplicarem
o conteúdo.

## Deploy (Cloudflare)

Alojamento em **Cloudflare Workers com assets estáticos** (`packages/web/wrangler.jsonc`): o `dist`
é servido como SPA (`not_found_handling: single-page-application`, por isso `/p/123` funciona em
refresh), com `public/_headers` (CSP, HSTS, cache imutável em `/assets`, 1 h em `/data`). Domínios: `convencionados.xyz` e `www.convencionados.xyz` como
custom domains do Worker (a zona tem de estar na conta Cloudflare). O www serve o mesmo conteúdo
e o `canonical` aponta para o apex; para um 301 www → apex, criar uma Redirect Rule na zona
(o `_redirects` dos Workers só aceita caminhos relativos, não hosts).

- `worker/index.ts` corre à frente dos assets (`run_worker_first`): 301 de http:// e www para o
  apex, barra final removida nas rotas da app, `index.html` só em `/`, `/p/:id`, `/qualidade` e
  `/privacidade`, e `404.html` com estado 404 para o resto (sem soft 404).
- Ficheiros para máquinas: `/.well-known/security.txt`, `/.well-known/api-catalog` (linkset para os
  JSON), `/llms.txt`, `/humans.txt`; JSON-LD `WebSite` com `SearchAction` no `index.html`.
  Auditoria de referência: https://specification.website/checklist/.
- Manual: `pnpm --filter @sns-conv/web run deploy` (faz build e `wrangler deploy`; na primeira vez
  `pnpm exec wrangler login`). `deploy:dry` valida sem publicar.
- Automático: `.github/workflows/deploy.yml` publica a cada push para `main` (inclui os merges dos
  PRs de snapshot). Segredos do repositório: `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit +
  Workers Routes: Edit na zona) e `CLOUDFLARE_ACCOUNT_ID`. `ci.yml` corre lint, testes e build em
  cada PR.
- SEO: `index.html` tem canonical, Open Graph e `og.png`; `robots.txt` aponta para `sitemap.xml`,
  gerado em `scripts/sync-data.mjs` com uma entrada por local (ignorado no git).
- Email `contacto@convencionados.xyz`: ativar Cloudflare Email Routing na zona e reencaminhar
  para a caixa pessoal.
- A CSP permite só: `self`, `tiles.openfreemap.org` e `json.geoapi.pt` (a Geist é servida de
  `public/fonts`, licença OFL incluída). Qualquer
  novo serviço externo tem de ser acrescentado em `_headers`. O registo do service worker é um
  script externo (`injectRegister: "script-defer"`) por causa de `script-src 'self'`.

## Publicação: privacidade e enquadramento

- **NIF de pessoas singulares** (a começar por 1, 2 ou 3) nunca é publicado: `packages/ingest/src/privacy.ts`
  substitui-o por um pseudónimo estável `P` + 8 hex no fim da ingestão, depois dos cruzamentos por
  NIF. O schema aceita as duas formas (`Nif`), e a ficha omite o NIF quando é pseudónimo.
- **Aviso de não oficialidade** no rodapé e na página `/privacidade`, que lista o que não recolhemos,
  os terceiros que o navegador contacta (OpenFreeMap, GEO API PT, Google Maps ao
  clicar), as fontes e o contacto.
- **Erro de carregamento**: a página inicial e a ficha mostram uma caixa com "Tentar de novo" se o
  snapshot falhar; uma falha não fica em cache (`data.ts`).
- Pendente antes do lançamento: pedido de reutilização à ACSS/SPMS (Lei 26/2016), Email Routing
  para o contacto, ícones PNG maskable, fontes locais, mapa em lazy-load.

## Sinais (tags)

Calculados na ingestão (`packages/ingest/src/signals.ts`) e guardados em `Location.signals`, cada um com
`tone` (positivo, aviso, neutro), `label`, `detail` (o porquê, com números) e `priority`. O cartão mostra
no máximo 3 por prioridade, mais "Exame confirmado" quando a valência refere o que se pesquisou; a ficha
mostra todos com a explicação. Limiares em `THRESHOLDS`; percentis calculados por área entre entidades
(volume no quartil superior, rácio de reclamações vs. mediana e decil superior). Não há pontuação única
nem estrelas, por decisão de produto.

## Decisões desta fase

- Snapshot estático servido como ficheiro; sem base de dados no caminho do utilizador.
- Pesquisa e ordenação por distância correm no cliente. A relevância multiplica a pontuação textual
  por um fator de atividade (0,35 sem faturação em 12 meses … 1,15 com faturação no último mês e
  volume alto), calculado a partir da Transparência SNS; pesquisas só por área ordenam por esse fator.
- Um local pode ter convenções de entidades diferentes (`Convention.entityNif`).
- Valências em texto livre são classificadas por dicionário de famílias (`packages/ingest/src/valencias.ts`);
  as linhas sem match aparecem no relatório para alimentar o dicionário.
- Locais sem coordenadas (≈4,5%) ficam marcados; geocodificação por código postal é a fase seguinte.
