// rotate-push-subscription (F51): atualiza a linha de push_subscriptions quando
// o navegador rotaciona/expira a subscription (evento pushsubscriptionchange no
// service worker). Identifica a linha pelo endpoint ANTIGO — um segredo do
// navegador — e a substitui pela nova subscription. NÃO cria linha nova, então
// não dá pra inserir inscrições arbitrárias por aqui.
//
// verify_jwt=false porque o service worker não tem sessão Supabase; a
// "autenticação" é implícita pelo conhecimento do endpoint antigo (só quem tinha
// a subscription antiga consegue rotacioná-la).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  let body: { old_endpoint?: string; endpoint?: string; p256dh?: string; auth?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }

  const { old_endpoint, endpoint, p256dh, auth } = body;
  if (!old_endpoint || !endpoint || !p256dh || !auth) {
    return json({ ok: false, error: "missing fields" }, 400);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { error, count } = await sb
    .from("push_subscriptions")
    .update({ endpoint, p256dh, auth }, { count: "exact" })
    .eq("endpoint", old_endpoint);

  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true, updated: count ?? 0 });
});
