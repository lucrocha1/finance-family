// delete-account: exclusão COMPLETA e irreversível da conta do usuário.
// Identifica o usuário pelo JWT, chama a RPC admin_delete_account (que apaga em
// cascata todos os dados financeiros e trata a posse da família) com
// service_role, e por fim remove o usuário do Auth (auth.admin.deleteUser).
// verify_jwt = true — só o próprio usuário autenticado dispara a exclusão dele.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  // Identifica o usuário a partir do próprio JWT (nunca confiar num id vindo do body).
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const admin = createClient(url, service);

  // 1) apaga dados financeiros + trata família + apaga profile (transacional na RPC).
  const { error: rpcErr } = await admin.rpc("admin_delete_account", { target: user.id });
  if (rpcErr) {
    console.error("[delete-account] rpc failed:", rpcErr.message);
    return json({ ok: false, error: rpcErr.message }, 500);
  }

  // 2) remove o usuário do Auth (não dá pra fazer via SQL).
  const { error: authErr } = await admin.auth.admin.deleteUser(user.id);
  if (authErr) {
    console.error("[delete-account] auth delete failed:", authErr.message);
    return json({ ok: false, error: authErr.message }, 500);
  }

  return json({ ok: true });
});
