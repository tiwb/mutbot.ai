/**
 * MutBot Auth Relay — Cloudflare Worker
 *
 * 中转认证服务：帮助 mutbot 实例完成 OAuth 认证，无需每个实例单独注册 OAuth App。
 *
 * 流程：
 *   mutbot 实例 → /auth/start → GitHub 授权 → /auth/callback → Ed25519 签名断言 → 回跳 mutbot 实例
 *
 * 环境变量（Secrets）：
 *   GITHUB_CLIENT_ID      — GitHub OAuth App client ID
 *   GITHUB_CLIENT_SECRET   — GitHub OAuth App client secret
 *   ED25519_PRIVATE_KEY    — Ed25519 私钥（PKCS8 Base64 编码）
 */

export interface Env {
	ASSETS: Fetcher;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	ED25519_PRIVATE_KEY: string;
}

// Ed25519 公钥（PEM 格式）— 与私钥配对，公开发布用于验证签名
const ED25519_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEATkI3XCgWqnK5GWEPiANcBDWmwi1WMC2vORFlWV8Gb1M=
-----END PUBLIC KEY-----`;

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// --- 认证中转路由 ---
		if (url.pathname === "/auth/start") {
			return handleAuthStart(url, env);
		}
		if (url.pathname === "/auth/callback") {
			return handleAuthCallback(url, env);
		}
		if (url.pathname === "/.well-known/mutbot-relay.json") {
			return handleRelayMeta();
		}

		// --- 静态资源 ---
		return env.ASSETS.fetch(request);
	},
};

/**
 * /auth/start — 发起 OAuth 认证
 *
 * Query params:
 *   callback  — mutbot 实例的回调地址（如 http://192.168.1.100:8741/auth/relay-callback）
 *   provider  — 提供商名称（目前仅 github）
 *   nonce     — 防重放随机值
 */
function handleAuthStart(url: URL, env: Env): Response {
	const callback = url.searchParams.get("callback");
	const provider = url.searchParams.get("provider") || "github";
	const nonce = url.searchParams.get("nonce");

	if (!callback || !nonce) {
		return jsonResponse({ error: "missing callback or nonce" }, 400);
	}

	if (provider !== "github") {
		return jsonResponse({ error: `unsupported provider: ${provider}` }, 400);
	}

	// state 中编码回调信息，GitHub 回调时原样带回
	const state = encodeState({ callback, nonce, provider });

	const githubAuthUrl = new URL("https://github.com/login/oauth/authorize");
	githubAuthUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
	githubAuthUrl.searchParams.set("redirect_uri", `${url.origin}/auth/callback`);
	githubAuthUrl.searchParams.set("scope", "read:user");
	githubAuthUrl.searchParams.set("state", state);

	return Response.redirect(githubAuthUrl.toString(), 302);
}

/**
 * /auth/callback — GitHub OAuth 回调
 *
 * 接收 code，换取用户信息，Ed25519 签名后重定向回 mutbot 实例。
 */
async function handleAuthCallback(url: URL, env: Env): Promise<Response> {
	const code = url.searchParams.get("code");
	const stateStr = url.searchParams.get("state");

	if (!code || !stateStr) {
		return jsonResponse({ error: "missing code or state" }, 400);
	}

	// 解码 state
	let state: { callback: string; nonce: string; provider: string };
	try {
		state = decodeState(stateStr);
	} catch {
		return jsonResponse({ error: "invalid state" }, 400);
	}

	// 1. 用 code 换取 access_token
	const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: JSON.stringify({
			client_id: env.GITHUB_CLIENT_ID,
			client_secret: env.GITHUB_CLIENT_SECRET,
			code,
		}),
	});
	const tokenData = (await tokenRes.json()) as Record<string, string>;

	if (tokenData.error) {
		return jsonResponse(
			{ error: tokenData.error, description: tokenData.error_description },
			400,
		);
	}

	// 2. 获取用户信息
	const userRes = await fetch("https://api.github.com/user", {
		headers: {
			Authorization: `Bearer ${tokenData.access_token}`,
			Accept: "application/json",
			"User-Agent": "MutBot-Auth-Relay",
		},
	});
	const user = (await userRes.json()) as Record<string, unknown>;

	// 3. 签发断言 JWT（Ed25519 签名）
	const now = Math.floor(Date.now() / 1000);
	const assertion = await signJwt(
		{
			sub: `github:${user.login}`,
			name: (user.name as string) || (user.login as string),
			avatar: user.avatar_url as string,
			provider: "github",
			nonce: state.nonce,
			aud: state.callback,
			iat: now,
			exp: now + 300, // 5 分钟有效（仅用于传递，mutbot 实例验证后签发自己的 session）
		},
		env.ED25519_PRIVATE_KEY,
	);

	// 4. 重定向回 mutbot 实例，assertion 放在 URL fragment 中（不经过服务器日志）
	const callbackUrl = new URL(state.callback);
	return new Response(null, {
		status: 302,
		headers: {
			Location: `${callbackUrl.origin}${callbackUrl.pathname}#assertion=${assertion}`,
		},
	});
}

/**
 * /.well-known/mutbot-relay.json — 中转站元信息
 *
 * mutbot 实例用此端点获取中转站的 Ed25519 公钥（用于验证断言签名）和支持的提供商列表。
 */
function handleRelayMeta(): Response {
	return jsonResponse({
		name: "MutBot Official Auth Relay",
		version: 1,
		providers: ["github"],
		verify: "ed25519",
		public_key: ED25519_PUBLIC_KEY_PEM,
	});
}

// --- 工具函数 ---

function encodeState(data: object): string {
	return btoa(JSON.stringify(data));
}

function decodeState(state: string): { callback: string; nonce: string; provider: string } {
	return JSON.parse(atob(state));
}

/**
 * Ed25519 签名 JWT（alg: EdDSA）
 *
 * privateKeyB64: PKCS8 格式私钥的 Base64 编码
 */
async function signJwt(payload: object, privateKeyB64: string): Promise<string> {
	const header = { alg: "EdDSA", typ: "JWT" };

	const headerB64 = base64url(JSON.stringify(header));
	const payloadB64 = base64url(JSON.stringify(payload));
	const signingInput = `${headerB64}.${payloadB64}`;

	// 导入 PKCS8 格式的 Ed25519 私钥
	const keyData = Uint8Array.from(atob(privateKeyB64), (c) => c.charCodeAt(0));
	const key = await crypto.subtle.importKey(
		"pkcs8",
		keyData,
		{ name: "Ed25519" },
		false,
		["sign"],
	);

	const sig = await crypto.subtle.sign(
		"Ed25519",
		key,
		new TextEncoder().encode(signingInput),
	);
	return `${signingInput}.${base64url(sig)}`;
}

function base64url(input: string | ArrayBuffer): string {
	let bytes: Uint8Array;
	if (typeof input === "string") {
		bytes = new TextEncoder().encode(input);
	} else {
		bytes = new Uint8Array(input);
	}
	let binary = "";
	for (const b of bytes) {
		binary += String.fromCharCode(b);
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function jsonResponse(data: object, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
