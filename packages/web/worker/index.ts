/**
 * Worker à frente dos assets estáticos (run_worker_first):
 * 1. http:// e www → 301 para https://convencionados.xyz (só em produção; em `wrangler dev` não redireciona)
 * 2. ficheiros existentes → servidos tal como estão (com public/_headers)
 * 3. rotas da app (/, /p/:id, /qualidade, /privacidade) → index.html com 200
 * 4. tudo o resto → 404.html com estado 404 (evita soft 404)
 */
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const HOST = "convencionados.xyz";
const APP_ROUTES = [/^\/$/, /^\/p\/\d+$/, /^\/qualidade$/, /^\/privacidade$/];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const prod = url.hostname === HOST || url.hostname.endsWith(`.${HOST}`);
    // esquema visto pela Cloudflare; ausente em `wrangler dev`, que emula o host de produção em http
    const scheme = /"scheme":"(\w+)"/.exec(request.headers.get("cf-visitor") ?? "")?.[1];

    if (prod && (scheme === "http" || url.hostname !== HOST)) {
      url.protocol = "https:";
      url.hostname = HOST;
      return Response.redirect(url.toString(), 301);
    }

    // barra final nas rotas da app → versão canónica sem barra
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      const bare = url.pathname.replace(/\/+$/, "");
      if (APP_ROUTES.some((r) => r.test(bare))) {
        url.pathname = bare;
        return Response.redirect(url.toString(), 301);
      }
    }

    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) return asset;

    if (APP_ROUTES.some((r) => r.test(url.pathname))) {
      const shell = await env.ASSETS.fetch(new Request(new URL("/index.html", url), request));
      return new Response(shell.body, { status: 200, headers: shell.headers });
    }
    return asset; // 404.html com estado 404 (not_found_handling: "404-page")
  },
};
