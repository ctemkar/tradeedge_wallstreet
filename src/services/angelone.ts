import { TOTP } from 'otpauth';

export interface AngelOneAccount {
  linked: boolean;
  clientCode: string;
  apiKey: string;
  mpin: string;
  totpSecret: string;
  profileName?: string;
  email?: string;
  availableCash?: number;
  availableNetMargin?: number;
  linkedAt?: string;
}

// Token mapping for highly liquid Nifty 50 symbols on NSE
export const ANGEL_NSE_TOKENS: { [key: string]: { token: string; tradingsymbol: string } } = {
  'RELIANCE.NS': { token: '2885', tradingsymbol: 'RELIANCE-EQ' },
  'TCS.NS': { token: '11536', tradingsymbol: 'TCS-EQ' },
  'INFY.NS': { token: '1594', tradingsymbol: 'INFY-EQ' },
  'HDFCBANK.NS': { token: '1333', tradingsymbol: 'HDFCBANK-EQ' },
  'ICICIBANK.NS': { token: '18630', tradingsymbol: 'ICICIBANK-EQ' },
  'SBIN.NS': { token: '3045', tradingsymbol: 'SBIN-EQ' },
  'AXISBANK.NS': { token: '5900', tradingsymbol: 'AXISBANK-EQ' },
  'BHARTIARTL.NS': { token: '10604', tradingsymbol: 'BHARTIARTL-EQ' },
  'WIPRO.NS': { token: '3787', tradingsymbol: 'WIPRO-EQ' },
  'LT.NS': { token: '11483', tradingsymbol: 'LT-EQ' },
  'RELIANCE': { token: '2885', tradingsymbol: 'RELIANCE-EQ' },
  'TCS': { token: '11536', tradingsymbol: 'TCS-EQ' },
  'INFY': { token: '1594', tradingsymbol: 'INFY-EQ' },
  'HDFCBANK': { token: '1333', tradingsymbol: 'HDFCBANK-EQ' }
};

export interface CachedSession {
  jwtToken: string;
  refreshToken: string;
  feedToken: string;
  timestamp: number;
}

// In-memory token/session cache index by client code
export const tokenCache: { [clientCode: string]: CachedSession } = {};

/**
 * Executes a session login into Angel One SmartAPI using ClientCode, MPIN, and TOTP (Secret or Code)
 */
export async function loginToAngelOne(
  apiKey: string,
  clientCode: string,
  mpin: string,
  totpSecretOrCode: string,
  forceRefresh = false
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const normClient = clientCode.trim().toUpperCase();
    
    // Check in-memory cache for valid session (valid up to 2 hours to avoid rate limit HTTP 403)
    const cached = tokenCache[normClient];
    const now = Date.now();
    if (!forceRefresh && cached && (now - cached.timestamp < 2 * 60 * 60 * 1000)) {
      console.log(`[SmartAPI Cache] Reusing valid cached session token for client ${normClient} (${Math.round((now - cached.timestamp) / 1000 / 60)} minutes old).`);
      return {
        success: true,
        data: {
          jwtToken: cached.jwtToken,
          refreshToken: cached.refreshToken,
          feedToken: cached.feedToken
        }
      };
    }

    let totpCode = totpSecretOrCode ? totpSecretOrCode.trim() : '';
    
    // Generate TOTP if secret is supplied instead of manual 6-digit code
    if (totpSecretOrCode && totpSecretOrCode.trim().length > 8) {
      const cleanSecret = totpSecretOrCode.replace(/\s+/g, '').toUpperCase();
      const totp = new TOTP({
        secret: cleanSecret,
        algorithm: 'SHA1',
        digits: 6,
        period: 30
      });
      totpCode = totp.generate();
    }

    if (!totpCode || totpCode.length !== 6 || isNaN(Number(totpCode))) {
      return { success: false, error: 'Invalid 6-digit TOTP code generated or provided. Check your TOTP secret key.' };
    }

    const payload = {
      clientcode: normClient,
      password: mpin.trim(),
      totp: totpCode
    };

    const host = 'https://apiconnect.angelone.in';
    const response = await fetch(`${host}/rest/auth/angelbroking/user/v1/loginByPassword`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-UserIP': process.env.ANGEL_USER_IP || '127.0.0.1',
        'X-ClientLocalIP': process.env.ANGEL_CLIENT_LOCAL_IP || '127.0.0.1',
        'X-ClientPublicIP': process.env.ANGEL_CLIENT_PUBLIC_IP || '127.0.0.1',
        'X-MACAddress': process.env.ANGEL_MAC_ADDRESS || '00:00:00:00:00:00',
        'X-PrivateKey': apiKey.trim(),
        'X-SourceID': process.env.ANGEL_SOURCE_ID || 'WEB',
        'X-UserType': process.env.ANGEL_USER_TYPE || 'USER'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Gateway returned HTTP ${response.status}: ${text}` };
    }

    const resJson: any = await response.json();
    if (!resJson.status) {
      return { success: false, error: resJson.message || 'SmartAPI authentication rejected.' };
    }

    // Success - cache the session details
    if (resJson.data && resJson.data.jwtToken) {
      tokenCache[normClient] = {
        jwtToken: resJson.data.jwtToken,
        refreshToken: resJson.data.refreshToken || '',
        feedToken: resJson.data.feedToken || '',
        timestamp: Date.now()
      };
      console.log(`[SmartAPI Cache] Successfully retrieved and cached new session token for client ${normClient}.`);
    }

    return { success: true, data: resJson.data };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

/**
 * Fetches Angel One account profile details
 */
export async function fetchAngelProfile(
  apiKey: string,
  jwtToken: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const host = 'https://apiconnect.angelone.in';
    const response = await fetch(`${host}/rest/secure/angelbroking/user/v1/getProfile`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-UserIP': process.env.ANGEL_USER_IP || '127.0.0.1',
        'X-ClientLocalIP': process.env.ANGEL_CLIENT_LOCAL_IP || '127.0.0.1',
        'X-ClientPublicIP': process.env.ANGEL_CLIENT_PUBLIC_IP || '127.0.0.1',
        'X-MACAddress': process.env.ANGEL_MAC_ADDRESS || '00:00:00:00:00:00',
        'X-PrivateKey': apiKey,
        'X-SourceID': process.env.ANGEL_SOURCE_ID || 'WEB',
        'X-UserType': process.env.ANGEL_USER_TYPE || 'USER'
      }
    });

    if (!response.ok) {
      return { success: false, error: `HTTP status ${response.status}` };
    }

    const resJson: any = await response.json();
    if (!resJson.status) {
      return { success: false, error: resJson.message || 'Profile retrieval unsuccessful' };
    }

    return { success: true, data: resJson.data };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

/**
 * Fetches Angel One RMS limits and cash margins
 */
export async function fetchAngelRMS(
  apiKey: string,
  jwtToken: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const host = 'https://apiconnect.angelone.in';
    const response = await fetch(`${host}/rest/secure/angelbroking/user/v1/getRMS`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-UserIP': process.env.ANGEL_USER_IP || '127.0.0.1',
        'X-ClientLocalIP': process.env.ANGEL_CLIENT_LOCAL_IP || '127.0.0.1',
        'X-ClientPublicIP': process.env.ANGEL_CLIENT_PUBLIC_IP || '127.0.0.1',
        'X-MACAddress': process.env.ANGEL_MAC_ADDRESS || '00:00:00:00:00:00',
        'X-PrivateKey': apiKey,
        'X-SourceID': process.env.ANGEL_SOURCE_ID || 'WEB',
        'X-UserType': process.env.ANGEL_USER_TYPE || 'USER'
      }
    });

    if (!response.ok) {
      return { success: false, error: `HTTP status ${response.status}` };
    }

    const resJson: any = await response.json();
    if (!resJson.status) {
      return { success: false, error: resJson.message || 'RMS margin limits fetch failed.' };
    }

    return { success: true, data: resJson.data };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

/**
 * Transmits a live buy/sell order to Angel One's trading gateway
 */
export async function placeAngelOrder(
  apiKey: string,
  jwtToken: string,
  params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    price: number;
    quantity: number;
    orderType?: 'LIMIT' | 'MARKET';
    productType?: 'INTRADAY' | 'DELIVERY';
  }
): Promise<{ success: boolean; orderId?: string; error?: string }> {
  try {
    const host = 'https://apiconnect.angelone.in';
    const mapping = ANGEL_NSE_TOKENS[params.symbol] || ANGEL_NSE_TOKENS[params.symbol.toUpperCase()] || {
      token: '2885', // Default to Reliance EQ if unrecognized Nifty asset as fallback
      tradingsymbol: `${params.symbol.replace('.NS', '')}-EQ`
    };

    const payload = {
      variety: 'NORMAL',
      tradingsymbol: mapping.tradingsymbol,
      symboltoken: mapping.token,
      transactiontype: params.side,
      exchange: 'NSE',
      ordertype: params.orderType || 'MARKET',
      producttype: params.productType || 'INTRADAY', 
      duration: 'DAY',
      price: params.orderType === 'LIMIT' ? String(params.price) : '0',
      squareoff: '0',
      stoploss: '0',
      trailingstoploss: '0',
      quantity: String(params.quantity)
    };

    const response = await fetch(`${host}/rest/secure/angelbroking/order/v1/placeOrder`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-UserIP': process.env.ANGEL_USER_IP || '127.0.0.1',
        'X-ClientLocalIP': process.env.ANGEL_CLIENT_LOCAL_IP || '127.0.0.1',
        'X-ClientPublicIP': process.env.ANGEL_CLIENT_PUBLIC_IP || '127.0.0.1',
        'X-MACAddress': process.env.ANGEL_MAC_ADDRESS || '00:00:00:00:00:00',
        'X-PrivateKey': apiKey,
        'X-SourceID': process.env.ANGEL_SOURCE_ID || 'WEB',
        'X-UserType': process.env.ANGEL_USER_TYPE || 'USER'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      return { success: false, error: `Order request HTTP ${response.status}` };
    }

    const resJson: any = await response.json();
    if (!resJson.status) {
      return { success: false, error: resJson.message || 'Order rejected by broker.' };
    }

    return { success: true, orderId: resJson.data.orderid };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

/**
 * Fetches Angel One account portfolio holdings (long-term equity)
 */
export async function fetchAngelHoldings(
  apiKey: string,
  jwtToken: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const host = 'https://apiconnect.angelone.in';
    const response = await fetch(`${host}/rest/secure/angelbroking/portfolio/v1/getHolding`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-UserIP': process.env.ANGEL_USER_IP || '127.0.0.1',
        'X-ClientLocalIP': process.env.ANGEL_CLIENT_LOCAL_IP || '127.0.0.1',
        'X-ClientPublicIP': process.env.ANGEL_CLIENT_PUBLIC_IP || '127.0.0.1',
        'X-MACAddress': process.env.ANGEL_MAC_ADDRESS || '00:00:00:00:00:00',
        'X-PrivateKey': apiKey,
        'X-SourceID': process.env.ANGEL_SOURCE_ID || 'WEB',
        'X-UserType': process.env.ANGEL_USER_TYPE || 'USER'
      }
    });

    if (!response.ok) {
      return { success: false, error: `HTTP status ${response.status}` };
    }

    const resJson: any = await response.json();
    if (!resJson.status) {
      return { success: false, error: resJson.message || 'Holdings retrieval unsuccessful' };
    }

    return { success: true, data: resJson.data || [] };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

/**
 * Fetches Angel One active positions
 */
export async function fetchAngelPositions(
  apiKey: string,
  jwtToken: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const host = 'https://apiconnect.angelone.in';
    const response = await fetch(`${host}/rest/secure/angelbroking/order/v1/getPosition`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-UserIP': process.env.ANGEL_USER_IP || '127.0.0.1',
        'X-ClientLocalIP': process.env.ANGEL_CLIENT_LOCAL_IP || '127.0.0.1',
        'X-ClientPublicIP': process.env.ANGEL_CLIENT_PUBLIC_IP || '127.0.0.1',
        'X-MACAddress': process.env.ANGEL_MAC_ADDRESS || '00:00:00:00:00:00',
        'X-PrivateKey': apiKey,
        'X-SourceID': process.env.ANGEL_SOURCE_ID || 'WEB',
        'X-UserType': process.env.ANGEL_USER_TYPE || 'USER'
      }
    });

    if (!response.ok) {
      return { success: false, error: `HTTP status ${response.status}` };
    }

    const resJson: any = await response.json();
    if (!resJson.status) {
      return { success: false, error: resJson.message || 'Positions retrieval unsuccessful' };
    }

    return { success: true, data: resJson.data || [] };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

