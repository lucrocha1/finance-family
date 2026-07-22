// send-push-notifications: dispatches a Web Push payload to every
// subscription of a given user. Invoked from generate-notifications
// after inserting a notification row, or manually for testing.
//
// Body: { user_id: string; title: string; body?: string; link?: string }
//
// Subscriptions returning 410 Gone are deleted.

// deno-lint-ignore-file no-explicit-any
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7";

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:lucasdanroc@gmail.com";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

type Payload = {
  user_id: string;
  title: string;
  body?: string;
  link?: string;
  severity?: "info" | "warning" | "danger" | "celebrate";
};

const sendOne = async (
  sb: SupabaseClient,
  sub: { id: string; endpoint: string; p256dh: string; auth: string },
  payload: { title: string; body?: string; link?: string; severity?: string },
) => {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
    );
    return { ok: true };
  } catch (err: any) {
    const status = err?.statusCode || 0;
    if (status === 404 || status === 410) {
      await sb.from("push_subscriptions").delete().eq("id", sub.id);
      return { ok: false, removed: true };
    }
    return { ok: false, error: err?.message || String(err) };
  }
};

Deno.serve(async (req: Request) => {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return new Response(
      JSON.stringify({ ok: false, error: "VAPID keys not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid json" }), { status: 400 });
  }

  if (!payload.user_id || !payload.title) {
    return new Response(JSON.stringify({ ok: false, error: "missing user_id or title" }), { status: 400 });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Autorização (F41/F48): só o backend (service role) pode enviar push pra um
  // user_id arbitrário. Um usuário autenticado só pode disparar pra si mesmo.
  // Sem isso, qualquer usuário logado poderia enviar push arbitrário (título,
  // corpo e link controlados) pros dispositivos de outro usuário — IDOR/spoofing
  // com potencial de phishing (o SW navega pro `link` no clique).
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (token !== serviceKey) {
    if (!token) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const { data: userData, error: userErr } = await sb.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ ok: false, error: "invalid token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (userData.user.id !== payload.user_id) {
      return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const { data: subs, error } = await sb
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", payload.user_id);

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }

  const pushPayload = {
    title: payload.title,
    body: payload.body,
    link: payload.link,
    severity: payload.severity,
  };

  const results = await Promise.all(
    (subs ?? []).map((sub) => sendOne(sb, sub as any, pushPayload)),
  );

  return new Response(
    JSON.stringify({
      ok: true,
      total: subs?.length ?? 0,
      sent: results.filter((r) => r.ok).length,
      removed: results.filter((r: any) => r.removed).length,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
