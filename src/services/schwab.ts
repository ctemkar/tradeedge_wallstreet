const SCHWAB_OAUTH_BASE = 'https://api.schwabapi.com/v1/oauth';
const SCHWAB_TRADER_BASE = 'https://api.schwabapi.com/trader/v1';

export interface SchwabTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType?: string;
}

function normalizeSchwabRedirectUri(rawValue: string): string {
  if (rawValue.includes('#')) {
    throw new Error('SCHWAB_REDIRECT_URI cannot include an inline comment or URL fragment. Put comments on separate lines.');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error('SCHWAB_REDIRECT_URI must be a valid absolute URL.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('SCHWAB_REDIRECT_URI must use https:// for Schwab OAuth callbacks.');
  }

  return parsed.toString();
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export function getSchwabConfig() {
  return {
    clientId: getRequiredEnv('SCHWAB_CLIENT_ID'),
    clientSecret: getRequiredEnv('SCHWAB_CLIENT_SECRET'),
    redirectUri: normalizeSchwabRedirectUri(getRequiredEnv('SCHWAB_REDIRECT_URI')),
  };
}

export function buildSchwabAuthorizationUrl(state?: string) {
  const config = getSchwabConfig();
  const url = new URL(`${SCHWAB_OAUTH_BASE}/authorize`);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  if (state) {
    url.searchParams.set('state', state);
  }
  return url.toString();
}

function getBasicAuthHeader() {
  const config = getSchwabConfig();
  return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`;
}

async function requestSchwabTokens(body: URLSearchParams): Promise<SchwabTokens> {
  const response = await fetch(`${SCHWAB_OAUTH_BASE}/token`, {
    method: 'POST',
    headers: {
      'Authorization': getBasicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: body.toString(),
  });

  const rawText = await response.text();
  let payload: any = null;

  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = rawText;
  }

  if (!response.ok) {
    const detail = typeof payload === 'string' ? payload : payload?.error_description || payload?.error || rawText;
    throw new Error(`Schwab token exchange failed with HTTP ${response.status}: ${detail || 'Unknown error'}`);
  }

  if (!payload?.access_token || !payload?.refresh_token) {
    throw new Error('Schwab token response did not include access_token and refresh_token.');
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: Number(payload.expires_in || 1800),
    tokenType: payload.token_type,
  };
}

export async function exchangeSchwabAuthorizationCode(code: string) {
  const config = getSchwabConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
  });
  return requestSchwabTokens(body);
}

export async function refreshSchwabAccessToken(refreshToken: string) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  return requestSchwabTokens(body);
}

export async function fetchSchwabAccounts(accessToken: string) {
  const response = await fetch(`${SCHWAB_TRADER_BASE}/accounts?fields=positions`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  });

  const rawText = await response.text();
  let payload: any = null;
  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = rawText;
  }

  if (!response.ok) {
    const detail = typeof payload === 'string' ? payload : payload?.message || rawText;
    throw new Error(`Schwab accounts fetch failed with HTTP ${response.status}: ${detail || 'Unknown error'}`);
  }

  return payload;
}

export async function placeSchwabOrder(
  accessToken: string,
  accountHash: string,
  params: {
    symbol: string;
    instruction: 'BUY' | 'SELL' | 'SELL_SHORT' | 'BUY_TO_COVER';
    quantity: number;
  }
) {
  const response = await fetch(`${SCHWAB_TRADER_BASE}/accounts/${accountHash}/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      orderType: 'MARKET',
      session: 'NORMAL',
      duration: 'DAY',
      orderStrategyType: 'SINGLE',
      orderLegCollection: [
        {
          instruction: params.instruction,
          quantity: params.quantity,
          instrument: {
            symbol: params.symbol,
            assetType: 'EQUITY',
          },
        },
      ],
    }),
  });

  if (!response.ok) {
    const rawText = await response.text();
    throw new Error(`Schwab order placement failed with HTTP ${response.status}: ${rawText || 'Unknown error'}`);
  }

  return {
    success: true,
    orderId: response.headers.get('location') || response.headers.get('Location') || '',
  };
}