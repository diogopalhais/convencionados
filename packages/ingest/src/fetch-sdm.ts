/**
 * Obtém o HTML do relatório SDM "Lista nacional de entidades que realizam exames".
 * 1. GET à página da ACSS para descobrir o src do iframe (tokens).
 * 2. GET ao relatório para obter __VIEWSTATE e cookie de sessão.
 * 3. POST com __EVENTTARGET=bt_load_relatorio para carregar os dados.
 */
const ACSS_PAGE = "https://www.acss.min-saude.pt/2025/03/25/rede-de-prestadores-convencionados/";
const UA =
  "sns-conv-ingest/0.1 (+https://github.com/appliedblockchain/sns-conv; contacto: diogo.palhais@appliedblockchain.com)";

function hidden(html: string, id: string): string {
  const m = new RegExp(`id="${id}"\\s+value="([^"]*)"`).exec(html);
  return m?.[1] ?? "";
}

export async function discoverReportUrl(fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(ACSS_PAGE, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`ACSS page HTTP ${res.status}`);
  const html = await res.text();
  const m = /src="(https:\/\/sdm\.min-saude\.pt\/sdm_report\.aspx[^"]+)"/.exec(html);
  if (!m?.[1]) throw new Error("iframe do SDM não encontrado na página da ACSS");
  return m[1].replace(/&amp;/g, "&");
}

export async function fetchSdmReport(
  fetchImpl: typeof fetch = fetch,
): Promise<{ html: string; url: string }> {
  const url = await discoverReportUrl(fetchImpl);
  const first = await fetchImpl(url, { headers: { "User-Agent": UA } });
  if (!first.ok) throw new Error(`SDM GET HTTP ${first.status}`);
  const cookie = (first.headers.get("set-cookie") ?? "")
    .split(/,(?=\s*\w+=)/)
    .map((c) => c.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
  const shell = await first.text();

  const body = new URLSearchParams({
    __EVENTTARGET: "bt_load_relatorio",
    __EVENTARGUMENT: "",
    __VIEWSTATE: hidden(shell, "__VIEWSTATE"),
    __VIEWSTATEGENERATOR: hidden(shell, "__VIEWSTATEGENERATOR"),
    __EVENTVALIDATION: hidden(shell, "__EVENTVALIDATION"),
    hf_sdm_report_pode_mostrar_label_report: "1",
  });
  const second = await fetchImpl(url, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: url,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body,
  });
  if (!second.ok) throw new Error(`SDM POST HTTP ${second.status}`);
  const html = await second.text();
  if (html.length < 1_000_000)
    throw new Error(`Resposta do SDM demasiado pequena (${html.length} bytes)`);
  return { html, url };
}
