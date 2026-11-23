#!/usr/bin/env bash
# 端到端冒烟测试（本地开发环境，PAYMENT_PROVIDER=mock）
# 用法：先 npm run dev，然后在项目目录里 bash scripts/smoke-test.sh [http://localhost:3000]
# 每次运行都会注册一个随机的新测试用户，不依赖固定账号。
# 邮箱验证码从本机 dev server 写的 .data/dev-mail/<邮箱>.txt 里读（未配置 Resend 时），所以要对着本机跑。
set -euo pipefail
export MSYS_NO_PATHCONV=1

BASE="${1:-http://localhost:3000}"
JAR="$(mktemp)"
OUT="$(mktemp)"  # 用临时文件代替 /dev/null，兼容 Windows 版 curl
EMAIL="smoke+$(date +%s)$RANDOM@example.com"
PASS="Smoke-$(date +%s)-pass"
H=(-s -b "$JAR" -c "$JAR" -H "Origin: $BASE" -H "Content-Type: application/json")
pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; exit 1; }
credits() { curl "${H[@]}" "$BASE/api/auth/get-session" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)?.user?.credits))'; }
# 输出「响应体 状态码」，用来同时检查状态码和错误码（$OUT 在 Windows 版 curl 下读不回来，只能当丢弃用）
req() { curl "${H[@]}" -w " %{http_code}" "$@"; }
# 本机 dev server 发给这个邮箱的最新验证码（邮件标题以验证码开头）
mailcode() { node -e 'try{const m=/^Subject: (\d{6}) /m.exec(require("fs").readFileSync(`.data/dev-mail/${process.argv[1]}.txt`,"utf8"));console.log(m?m[1]:"")}catch{console.log("")}' "$1"; }
# 从标准输入的 JSON 里取一个字段：echo '{"a":1}' | json a
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s)[process.argv[1]]??"")}catch{console.log("")}})' "$1"; }

echo "1. 注册（默认要输入邮箱验证码才登录）"
VERIFY=""
signup=$(curl "${H[@]}" -X POST "$BASE/api/auth/sign-up/email" -d "{\"name\":\"Smoke Test\",\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
if echo "$signup" | grep -q '"token":"'; then
  pass "sign up（AUTH_REQUIRE_EMAIL_VERIFICATION=false：不验证邮箱，直接登录）"
else
  VERIFY=1
  echo "$signup" | grep -q '"token":null' && pass "注册成功，验证邮箱前不登录" || fail "sign up: $signup"
  [ "$(credits)" = "undefined" ] && pass "验证前没有登录态" || fail "unverified session: $(credits)"
  r=$(req -X POST "$BASE/api/auth/sign-in/email" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
  [[ "$r" == *EMAIL_NOT_VERIFIED*" 403" ]] && pass "未验证邮箱不能登录（并自动重发验证码）" || fail "unverified sign in: $r"
  otp=$(mailcode "$EMAIL"); [ -n "$otp" ] && pass "收到 6 位验证码" || fail "no code in .data/dev-mail/$EMAIL.txt (run against the local dev server)"
  wrong=$([ "$otp" = "000000" ] && echo 111111 || echo 000000)
  r=$(req -X POST "$BASE/api/auth/email-otp/verify-email" -d "{\"email\":\"$EMAIL\",\"otp\":\"$wrong\"}")
  [[ "$r" == *INVALID_OTP*" 400" ]] && pass "错误验证码被拒绝" || fail "wrong code: $r"
  curl "${H[@]}" -X POST "$BASE/api/auth/email-otp/verify-email" -d "{\"email\":\"$EMAIL\",\"otp\":\"$otp\"}" | grep -q '"token":"' && pass "验证码正确：邮箱已验证并自动登录" || fail "verify email"
fi
[ "$(credits)" = "10" ] && pass "注册赠送 10 积分" || fail "signup bonus: $(credits)"

echo "2. 受保护页面"
code=$(curl -s -o "$OUT" -w "%{http_code}" "$BASE/dashboard"); [ "$code" = "307" ] && pass "未登录访问 /dashboard 被重定向" || fail "anon dashboard: $code"
code=$(curl -s -b "$JAR" -o "$OUT" -w "%{http_code}" "$BASE/dashboard"); [ "$code" = "200" ] && pass "登录后可访问 /dashboard" || fail "dashboard: $code"

echo "3. 消耗积分"
curl "${H[@]}" -X POST "$BASE/api/credits/spend" | grep -q '"balance":9' && pass "消耗 1 积分，余额 9" || fail "spend"

echo "4. 一次性购买（starter，+100）"
url=$(curl "${H[@]}" -X POST "$BASE/api/checkout" -d '{"planId":"starter","locale":"en"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).url))')
order=$(node -e "console.log(new URL('$url').searchParams.get('order'))")
[ -n "$order" ] && pass "创建订单 $order" || fail "checkout"
code=$(curl -s -b "$JAR" -o "$OUT" -w "%{http_code}" "$url"); [ "$code" = "200" ] && pass "模拟收银台页面" || fail "mock page: $code"
curl "${H[@]}" -X POST "$BASE/api/mock/complete" -d "{\"orderId\":\"$order\"}" | grep -q '"ok":true' && pass "模拟支付成功" || fail "mock complete"
[ "$(credits)" = "109" ] && pass "积分到账，余额 109" || fail "credits after purchase: $(credits)"
curl "${H[@]}" -X POST "$BASE/api/mock/complete" -d "{\"orderId\":\"$order\"}" > "$OUT"
[ "$(credits)" = "109" ] && pass "重复通知不会重复加积分（幂等）" || fail "idempotency: $(credits)"

echo "4b. 站内通知（心跳轮询 /api/me/pulse）"
code=$(curl -s -o "$OUT" -w "%{http_code}" "$BASE/api/me/pulse"); [ "$code" = "401" ] && pass "未登录不能取通知" || fail "anon pulse: $code"
pulse=$(curl "${H[@]}" "$BASE/api/me/pulse")
echo "$pulse" | grep -q "\"type\":\"payment_succeeded\"" && pass "购买后收到「支付成功」通知" || fail "no payment_succeeded: $pulse"
echo "$pulse" | grep -q "\"credits\":109" && pass "心跳里的积分余额是最新的（109）" || fail "pulse credits: $pulse"
[ -z "$VERIFY" ] || { echo "$pulse" | grep -q "\"type\":\"signup_bonus\"" && pass "验证邮箱后收到「赠送积分」通知" || fail "no signup_bonus"; }
curl "${H[@]}" "$BASE/api/orders/$order" | grep -q "\"status\":\"paid\"" && pass "订单状态接口：已付款" || fail "order status"
code=$(curl -s -o "$OUT" -w "%{http_code}" "$BASE/api/orders/$order"); [ "$code" = "401" ] && pass "未登录不能查订单状态" || fail "anon order status: $code"
curl "${H[@]}" -X POST "$BASE/api/notifications/read" -d "{}" | grep -q "\"unread\":0" && pass "全部标为已读后未读数为 0" || fail "mark read"

echo "5. 订阅（pro，每月 +1000）"
url=$(curl "${H[@]}" -X POST "$BASE/api/checkout" -d '{"planId":"pro","locale":"en"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).url))')
order=$(node -e "console.log(new URL('$url').searchParams.get('order'))")
curl "${H[@]}" -X POST "$BASE/api/mock/complete" -d "{\"orderId\":\"$order\"}" | grep -q '"ok":true' && pass "订阅支付成功" || fail "subscribe"
[ "$(credits)" = "1109" ] && pass "订阅积分到账，余额 1109" || fail "credits after subscription: $(credits)"

echo "6. 安全检查"
code=$(curl -s -o "$OUT" -w "%{http_code}" -X POST -H "Content-Type: application/json" "$BASE/api/checkout" -d '{"planId":"starter"}'); [ "$code" = "401" ] && pass "未登录不能下单" || fail "anon checkout: $code"
code=$(curl -s -o "$OUT" -w "%{http_code}" -X POST -H "Content-Type: application/json" "$BASE/api/webhooks/creem" -d '{}'); [ "$code" = "400" ] && pass "Creem webhook 拒绝无签名请求" || fail "creem sig: $code"
# 未配置 WAFFO_STORE_ID 时直接拒绝（500 not_configured），配置了则验签失败（401）
code=$(curl -s -o "$OUT" -w "%{http_code}" -X POST -H "Content-Type: application/json" "$BASE/api/webhooks/waffo" -d '{}'); [ "$code" = "401" ] || [ "$code" = "500" ] && pass "Waffo webhook 拒绝无签名请求" || fail "waffo sig: $code"

echo "7. 退出与重新登录"
curl "${H[@]}" -X POST "$BASE/api/auth/sign-out" -d "{}" > "$OUT"
[ "$(credits)" = "undefined" ] && pass "已退出" || fail "sign out"
curl "${H[@]}" -X POST "$BASE/api/auth/sign-in/email" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | grep -q '"token"' && pass "重新登录" || fail "sign in"
curl "${H[@]}" -X POST "$BASE/api/auth/sign-in/email" -d "{\"email\":\"$EMAIL\",\"password\":\"wrong-password\"}" | grep -q '"token"' && fail "wrong password accepted" || pass "错误密码被拒绝"

echo "8. 找回密码（验证码；未配置 Resend 时打印在 dev 服务器终端里）"
code=$(curl "${H[@]}" -o "$OUT" -w "%{http_code}" -X POST "$BASE/api/auth/request-password-reset" -d "{\"email\":\"$EMAIL\",\"redirectTo\":\"/\"}"); [ "$code" = "404" ] && pass "链接式重置接口已关闭" || fail "link reset: $code"
curl "${H[@]}" -X POST "$BASE/api/auth/email-otp/request-password-reset" -d "{\"email\":\"$EMAIL\"}" | grep -q '"success":true' && pass "发送重置验证码" || fail "request reset"
otp=$(mailcode "$EMAIL"); [ -n "$otp" ] && pass "收到重置验证码" || fail "no reset code in .data/dev-mail/$EMAIL.txt"
NEWPASS="Smoke-$(date +%s)-new"
r=$(req -X POST "$BASE/api/auth/email-otp/reset-password" -d "{\"email\":\"$EMAIL\",\"otp\":\"$otp\",\"password\":\"onlyletters\"}")
[[ "$r" == *WEAK_PASSWORD*" 400" ]] && pass "新密码只有字母被拒绝（验证码不作废）" || fail "weak reset password: $r"
curl "${H[@]}" -X POST "$BASE/api/auth/email-otp/reset-password" -d "{\"email\":\"$EMAIL\",\"otp\":\"$otp\",\"password\":\"$NEWPASS\"}" | grep -q '"success":true' && pass "用验证码设置新密码" || fail "reset password"
curl "${H[@]}" -X POST "$BASE/api/auth/sign-in/email" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | grep -q '"token"' && fail "old password still works" || pass "旧密码失效"
PASS="$NEWPASS"

echo "9. AI 文本（未配置 AI_API_KEY 时走 mock）"
curl "${H[@]}" -X POST "$BASE/api/auth/sign-in/email" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" > "$OUT"
before=$(credits)
body=$(curl "${H[@]}" -X POST "$BASE/api/ai/text" -d '{"feature":"rewrite","input":"make this sentence better please"}')
echo "$body" | grep -q "\[mock\]" && pass "流式返回文本" || fail "ai text: $body"
[ "$(credits)" = "$((before-1))" ] && pass "扣 1 积分" || fail "ai text credits: $(credits)"

echo "10. AI 失败自动退积分"
before=$(credits)
body=$(curl "${H[@]}" -X POST "$BASE/api/ai/text" -d '{"feature":"rewrite","input":"please __fail__"}')
echo "$body" | grep -q "\[\[error\]\]" && pass "返回错误标记" || fail "ai fail marker: $body"
[ "$(credits)" = "$before" ] && pass "积分已退回" || fail "refund: $(credits) vs $before"

echo "11. AI 图片"
before=$(credits)
curl "${H[@]}" -X POST "$BASE/api/ai/image" -d '{"feature":"image","input":"a cozy reading nook"}' | grep -q '"url"' && pass "返回图片地址" || fail "ai image"
[ "$(credits)" = "$((before-5))" ] && pass "扣 5 积分" || fail "ai image credits: $(credits)"

echo "12. AI 视频（未配置 FAL_KEY 时走 mock，约 8 秒出片）"
# 轮询一个生成任务，直到不再是 pending（最多约 30 秒）
poll() { local s=""; for _ in $(seq 1 15); do s=$(curl "${H[@]}" "$BASE/api/ai/generations/$1" | json status); [ "$s" = "pending" ] || break; sleep 2; done; echo "$s"; }
printf '\x89PNG\r\n\x1a\n' > "$OUT.png"
resp=$(curl "${H[@]}" -X POST "$BASE/api/upload" -d '{"contentType":"image/png","size":8}')
curl -s -b "$JAR" -o "$OUT" -X PUT -H "Content-Type: image/png" --data-binary @- "$BASE$(echo "$resp" | json uploadUrl)" < "$OUT.png"
img=$(echo "$resp" | json publicUrl)
code=$(curl "${H[@]}" -o "$OUT" -w "%{http_code}" -X POST "$BASE/api/ai/video" -d '{"feature":"video","input":"wave","imageUrl":"/api/files/uploads/someone-else/x.png"}'); [ "$code" = "400" ] && pass "不能用别人的图片" || fail "foreign image: $code"
before=$(credits)
gen=$(curl "${H[@]}" -X POST "$BASE/api/ai/video" -d "{\"feature\":\"video\",\"input\":\"the person waves\",\"imageUrl\":\"$img\"}" | json id)
[ -n "$gen" ] && pass "提交视频任务 $gen" || fail "video submit"
[ "$(credits)" = "$((before-50))" ] && pass "先扣 50 积分" || fail "video credits: $(credits)"
[ "$(poll "$gen")" = "succeeded" ] && pass "轮询到视频完成" || fail "video not finished"
code=$(curl -s -o "$OUT" -w "%{http_code}" "$BASE/mock/sample-video.mp4"); [ "$code" = "200" ] && pass "视频文件可访问" || fail "video file: $code"
before=$(credits)
gen=$(curl "${H[@]}" -X POST "$BASE/api/ai/video" -d "{\"feature\":\"video\",\"input\":\"__fail__\",\"imageUrl\":\"$img\"}" | json id)
[ "$(poll "$gen")" = "failed" ] && pass "失败任务标记为 failed" || fail "video fail status"
[ "$(credits)" = "$before" ] && pass "失败后积分已退回" || fail "video refund: $(credits) vs $before"
code=$(curl -s -o "$OUT" -w "%{http_code}" -X POST "$BASE/api/webhooks/fal?gen=$gen&token=bad"); [ "$code" = "403" ] && pass "fal 回调拒绝错误签名" || fail "fal webhook: $code"
rm -f "$OUT.png"

echo "13. AI 输入校验"
code=$(curl "${H[@]}" -o "$OUT" -w "%{http_code}" -X POST "$BASE/api/ai/text" -d '{"feature":"image","input":"x"}'); [ "$code" = "400" ] && pass "功能类型不匹配被拒绝" || fail "feature kind: $code"
code=$(curl "${H[@]}" -o "$OUT" -w "%{http_code}" -X POST "$BASE/api/ai/text" -d '{"feature":"rewrite","input":""}'); [ "$code" = "400" ] && pass "空输入被拒绝" || fail "empty: $code"

echo "14. AI 限流（每用户每分钟 10 次）"
got429=""
for i in $(seq 1 12); do
  code=$(curl "${H[@]}" -o "$OUT" -w "%{http_code}" -X POST "$BASE/api/ai/image" -d '{"feature":"image","input":"rate limit probe"}')
  if [ "$code" = "429" ]; then got429="$i"; break; fi
done
[ -n "$got429" ] && pass "第 $got429 次请求返回 429" || fail "no 429 after 12 requests"

echo "15. 文件上传（未配置 R2 时存本地）"
printf '\x89PNG\r\n\x1a\n' > "$OUT.png"
resp=$(curl "${H[@]}" -X POST "$BASE/api/upload" -d '{"contentType":"image/png","size":8}')
upurl=$(echo "$resp" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).uploadUrl||""))')
puburl=$(echo "$resp" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).publicUrl||""))')
[ -n "$upurl" ] && pass "获取上传地址" || fail "upload url: $resp"
code=$(curl -s -b "$JAR" -o "$OUT" -w "%{http_code}" -X PUT -H "Content-Type: image/png" --data-binary @- "$BASE$upurl" < "$OUT.png"); [ "$code" = "200" ] && pass "PUT 上传成功" || fail "put: $code"
code=$(curl -s -o "$OUT" -w "%{http_code}" "$BASE$puburl"); [ "$code" = "200" ] && pass "文件可访问" || fail "get file: $code"
code=$(curl "${H[@]}" -o "$OUT" -w "%{http_code}" -X POST "$BASE/api/upload" -d '{"contentType":"application/x-msdownload","size":8}'); [ "$code" = "400" ] && pass "拒绝不允许的文件类型" || fail "bad type: $code"
code=$(curl -s -b "$JAR" -o "$OUT" -w "%{http_code}" -X PUT -H "Content-Type: image/png" --data-binary @- "$BASE/api/upload/local?key=uploads/someone-else/x.png" < "$OUT.png"); [ "$code" = "403" ] && pass "不能写别人的目录" || fail "foreign key: $code"
rm -f "$OUT.png"

echo "16. 管理后台权限"
code=$(curl "${H[@]}" -o "$OUT" -w "%{http_code}" -X POST "$BASE/api/admin/credits" -d '{"userId":"x","delta":5}'); [ "$code" = "403" ] && pass "普通用户不能调积分" || fail "admin api: $code"
code=$(curl -s -b "$JAR" -o "$OUT" -w "%{http_code}" "$BASE/admin"); [ "$code" = "404" ] && pass "普通用户看不到后台" || fail "admin page: $code"
code=$(curl -s -b "$JAR" -o "$OUT" -w "%{http_code}" "$BASE/admin/users"); [ "$code" = "404" ] && pass "普通用户看不到后台用户列表" || fail "admin users page: $code"
code=$(curl "${H[@]}" -o "$OUT" -w "%{http_code}" -X POST "$BASE/api/admin/users/x" -d "{\"action\":\"unban\"}"); [ "$code" = "403" ] && pass "普通用户不能封禁 / 解封别人" || fail "admin users api: $code"
for pg in payments subscriptions refunds reconciliation jobs payment-log credits ai newsletter system; do
  code=$(curl -s -b "$JAR" -o "$OUT" -w "%{http_code}" "$BASE/admin/$pg"); [ "$code" = "404" ] && pass "普通用户看不到后台 /admin/$pg" || fail "admin $pg: $code"
done
code=$(curl "${H[@]}" -o "$OUT" -w "%{http_code}" -X POST "$BASE/api/admin/jobs" -d "{\"name\":\"cleanup\",\"action\":\"run\"}"); [ "$code" = "403" ] && pass "普通用户不能运行定时任务" || fail "admin jobs api: $code"
code=$(curl -s -b "$JAR" -o "$OUT" -w "%{http_code}" "$BASE/api/admin/issues"); [ "$code" = "403" ] && pass "普通用户看不到问题表" || fail "admin issues api: $code"
code=$(curl -s -o "$OUT" -w "%{http_code}" "$BASE/api/cron/tick"); [ "$code" = "401" ] && pass "不带密钥不能触发调度器" || fail "anon tick: $code"

echo "17. 注册防刷"
code=$(curl -s -o "$OUT" -w "%{http_code}" -X POST -H "Origin: $BASE" -H "Content-Type: application/json" "$BASE/api/auth/sign-up/email" -d '{"name":"x","email":"bot@mailinator.com","password":"whatever-123456"}'); [ "$code" = "400" ] && pass "临时邮箱注册被拒绝" || fail "disposable: $code"
for weak in onlyletters 12345678 abc123; do
  r=$(curl -s -w " %{http_code}" -H "Origin: $BASE" -H "Content-Type: application/json" -X POST "$BASE/api/auth/sign-up/email" -d "{\"name\":\"x\",\"email\":\"weak+$(date +%s)$RANDOM@example.com\",\"password\":\"$weak\"}")
  [[ "$r" == *" 400" ]] && pass "密码 $weak 不合规被拒绝（至少 8 位，含字母和数字）" || fail "weak password $weak: $r"
done
code=$(curl "${H[@]}" -o "$OUT" -w "%{http_code}" -X POST "$BASE/api/auth/sign-in/email-otp" -d "{\"email\":\"$EMAIL\",\"otp\":\"123456\"}"); [ "$code" = "404" ] && pass "验证码登录接口已关闭（建号只能走注册页）" || fail "otp sign-in: $code"
if [ -n "$VERIFY" ]; then
  curl -s -H "Origin: $BASE" -H "Content-Type: application/json" -X POST "$BASE/api/auth/sign-up/email" -d "{\"name\":\"x\",\"email\":\"$EMAIL\",\"password\":\"whatever-123456\"}" | grep -q '"token":null' && pass "已注册的邮箱再注册：结果和新注册一样（不暴露邮箱已注册）" || fail "duplicate sign up"
fi

rm -f "$JAR" "$OUT"
echo "全部通过 ✅"
