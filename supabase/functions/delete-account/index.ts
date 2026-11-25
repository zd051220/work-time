// 小猫搬金条 5.4.1 · 真正删号（Supabase Edge Function）
// 部署后把前端 MW_DEL_ENDPOINT 改成 https://<project>.supabase.co/functions/v1/delete-account
// 环境变量（只在 Supabase 后台配置，绝不写进前端/仓库）：
//   SUPABASE_URL              项目地址（平台自动注入）
//   SUPABASE_SERVICE_ROLE_KEY  service_role 密钥（平台自动注入，需在 Dashboard 里可见）
// 说明：只删“调用者自己”的数据——uid 取自 JWT，不接受请求体里的 uid。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ ok: false, error: "no_token" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!url || !serviceKey) return json({ ok: false, error: "server_not_configured" }, 500);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // 1) 用调用者的 token 换 uid：拿不到就是无效 token
  const { data: userData, error: userErr } = await admin.auth.getUser(auth.slice(7));
  if (userErr || !userData?.user) return json({ ok: false, error: "invalid_token" }, 401);
  const uid = userData.user.id;

  // 2) 先删业务数据，再删账号；每一步失败都如实返回，不假装成功
  // work_sessions / feedback 建表早于仓库迁移，不假定线上有 on delete cascade，显式删除兜底。
  for (const table of ["records", "record_dels", "work_sessions", "feedback"]) {
    const { error } = await admin.from(table).delete().eq("user_id", uid);
    if (error) return json({ ok: false, error: "delete_" + table + "_failed", detail: error.message }, 500);
  }

  // 3) 删除 auth 用户（同时清掉 user_metadata 里保存的会话标记）
  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  // 已经不存在视为成功（可重复调用）
  if (delErr && !/not\s*found|does not exist/i.test(delErr.message)) {
    return json({ ok: false, error: "delete_auth_user_failed", detail: delErr.message }, 500);
  }

  return json({ ok: true, uid });
});
